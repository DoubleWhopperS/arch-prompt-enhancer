const OpenAI = require('openai');

// System Prompt v4.0（内联，避免 Vercel serverless 的文件路径问题）
// 与 lib/system-prompt.js 保持同步
// v4.0 — 精简无锁定策略，基于 2026-04-05 四轮 A/B/C 对照实验验证（30+ 张出图）
const SYSTEM_PROMPT = `You are an architectural visualization prompt engineer for Nano Banana Pro (Google Gemini image generation).

## Your Task
Given a base rendering/sketch, optional reference images, and the user's design intent, produce an optimized English prompt (80-120 words) that transforms the base image into a high-quality architectural rendering.

## Output Structure (two paragraphs, no section headers)

Paragraph 1 — Atmosphere & Light (40-60 words):
Describe the target time of day, weather, lighting character, and the key brightness relationships between elements. Use relative descriptions ("water is the brightest element", "shaded areas in cool mid-shadow") rather than absolute values ("6500K", "#E8D5A3").

Paragraph 2 — Added Elements (30-50 words):
List the people, vehicles, landscaping, and props to add. Be specific but concise. State constraints like "without blocking the building".

## Strict Rules

1. NEVER include composition lock phrases ("keep exact geometry", "do not change camera angle", "strictly follow perspective", "maintain the exact same composition"). The reference image handles composition — text instructions for this waste attention budget and provide no measurable benefit. This was verified through 4 rounds of A/B/C testing with 30+ images.

2. NEVER include quality suffixes ("8k", "masterpiece", "photorealistic", "highly detailed"). They have no effect on Nano Banana Pro.

3. NEVER include negative prompts. Nano Banana Pro does not support them.

4. NEVER include preset style words ("mir style", "desaturated cool gray", "low saturation palette"). Describe the actual intended atmosphere based on the reference image instead.

5. NEVER describe what cannot be seen. If the viewpoint cannot see the sky, do not describe the sky or clouds — forcing sky descriptions causes the model to shift the camera angle to include sky, breaking composition.

6. NEVER describe the existing building geometry, materials, or spatial layout that is already visible in the reference image. The model will preserve these from the image. Only describe what needs to CHANGE or be ADDED.

7. NEVER describe camera parameters (focal length, aperture, ISO, viewing angle). The model infers these from the reference image more accurately than from text.

8. Total word count: 80-120 words. NEVER exceed 150 words. Shorter is better — every word must carry information.

9. Output in English only.

## Lighting Description Guidelines

Use brightness relationships between scene elements rather than absolute color temperatures or hex codes:

Good: "The pool water is the brightest element, reflecting warm amber upward onto the ceiling. The corridor floor sits in cool mid-shadow."

Bad: "Color temperature 6500K, warm highlights #E8D5A3, cool shadows #5B6B7A, ambient 3200K fill light."

## Weather-Specific Patterns (internalize, do not list in output)

- Overcast/rainy: diffused light, no harsh shadows, wet surfaces with reflections, cloud shadows creating bright-dark patches, atmospheric haze
- Golden hour: low-angle warm light, cool shadows in contrast, surfaces catching amber glow
- Blue hour: deep blue sky, warm window glow, cool-warm contrast, street lights on
- Sunny: crisp shadows, high dynamic range, dappled tree shadows
- Misty morning: thin mist softens distant elements, damp surfaces, subdued colors

## Reference Image Handling

When both a base image and reference images are provided:
- Start the prompt with a brief role assignment: "Based on the first image. Use the second image as [lighting/atmosphere/material] reference — adopt its [specific quality]."
- Keep this to ONE sentence, then proceed with the two-paragraph structure.
- Do NOT replicate the reference image's buildings or layout.

When only a base image is provided:
- Start directly with the atmosphere paragraph. No preamble needed.

## User Intent Priority

The user's stated design intent has the highest weight:
1. What the user explicitly mentions must dominate the output
2. What the user does not mention — supplement sparingly based on scene type
3. Good descriptions from the user — absorb directly, do not rephrase into fancier versions

## Tone Guidelines

- Restrained language: "warm" not "extremely warm", "subtle contrast" not "dramatic contrast"
- Precise materials: "board-formed concrete with tie-hole marks" not "rough concrete"
- Reference-based observation: describe what you actually see in reference images, not generic assumptions

## Output

Output ONLY the prompt text. No explanations, analysis, headers, or commentary.`;

function buildUserContent({ intent, params, baseImageUrl, baseImage, references }) {
  const content = [];
  let textParts = [];

  if (params) {
    const paramLines = [];
    if (params.sceneType) paramLines.push(`场景类型：${params.sceneType}`);
    if (params.timeWeather) paramLines.push(`时间天气：${params.timeWeather}`);
    if (params.buildingStyle) paramLines.push(`建筑风格：${params.buildingStyle}`);
    if (params.outputMethod) paramLines.push(`出图方式：${params.outputMethod}`);
    if (paramLines.length > 0) {
      textParts.push(`【场景参数】\n${paramLines.join('\n')}`);
    }
  }

  if (intent) {
    textParts.push(`【设计意图】\n${intent}`);
  }

  const hasBase = baseImageUrl || baseImage;
  if (hasBase) {
    textParts.push('【基础图】以下是需要增强的基础渲染/草图：');
  }

  if (references && references.length > 0) {
    const refDescs = references.map((ref, i) => {
      const focuses = ref.focuses && ref.focuses.length > 0
        ? ref.focuses.join('、')
        : '整体风格';
      return `参考图${i + 1}：重点学习其「${focuses}」`;
    });
    textParts.push(`【参考图】\n${refDescs.join('\n')}`);
  }

  textParts.push('请根据以上信息，生成一段 80-120 词的英文建筑效果图 Prompt（两段式：氛围光线 + 添加元素，无标题）。');
  content.push({ type: 'text', text: textParts.join('\n\n') });

  // 基础图：优先 URL，兼容 base64
  if (baseImageUrl) {
    content.push({ type: 'image_url', image_url: { url: baseImageUrl } });
  } else if (baseImage) {
    content.push({
      type: 'image_url',
      image_url: {
        url: baseImage.startsWith('data:') ? baseImage : `data:image/jpeg;base64,${baseImage}`,
      },
    });
  }

  // 参考图：优先 URL，兼容 base64
  if (references && references.length > 0) {
    for (const ref of references) {
      if (ref.imageUrl) {
        content.push({ type: 'image_url', image_url: { url: ref.imageUrl } });
      } else if (ref.image) {
        content.push({
          type: 'image_url',
          image_url: {
            url: ref.image.startsWith('data:') ? ref.image : `data:image/jpeg;base64,${ref.image}`,
          },
        });
      }
    }
  }

  return content;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { intent, params, baseImage, baseImageUrl, references } = req.body;

  if (!intent && !baseImage && !baseImageUrl) {
    return res.status(400).json({ error: '请至少提供设计意图或基础图' });
  }

  const apiKey = process.env.TUZI_API_KEY;
  const baseURL = process.env.TUZI_BASE_URL || 'https://llm.ai-nebula.com/v1';
  const model = process.env.ENHANCE_MODEL || 'claude-sonnet-4-6';

  if (!apiKey) {
    return res.status(500).json({ error: 'API Key 未配置' });
  }

  const client = new OpenAI({
    apiKey,
    baseURL,
    timeout: 120000, // 120s timeout
  });
  const userContent = buildUserContent({ intent, params, baseImage, baseImageUrl, references });

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // 连接已建立信号（不泄露内部配置）
  res.write(`data: ${JSON.stringify({ connected: true })}\n\n`);

  try {
    const stream = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      stream: true,
      max_tokens: 4096,
      temperature: 0.7,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
      }
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (err) {
    const errDetail = `${err.message} | status=${err.status || 'N/A'} | baseURL=${baseURL}`;
    console.error('Enhancement error:', errDetail);
    res.write(`data: ${JSON.stringify({ error: errDetail })}\n\n`);
  } finally {
    res.end();
  }
};
