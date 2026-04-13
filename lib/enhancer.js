const OpenAI = require('openai');
const { SYSTEM_PROMPT } = require('./system-prompt');

const client = new OpenAI({
  apiKey: process.env.ECHOTECH_API_KEY,
  baseURL: process.env.ECHOTECH_BASE_URL || 'https://llm.echo.tech/v1',
  timeout: 120000,
});

/**
 * 构建用户消息内容（base64 图片）
 */
function buildUserContent({ intent, params, baseImage, baseImageUrl, references }) {
  const content = [];
  let textParts = [];

  if (params) {
    const paramLines = [];
    if (params.sceneType) paramLines.push(`场景类型：${params.sceneType}`);
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
    const refsWithAnalysis = references.filter(r => r.analysis);
    if (refsWithAnalysis.length > 0) {
      const analysisDescs = references.map((ref, i) => {
        if (!ref.analysis) return null;
        const dims = ref.focuses?.join('、') || '整体';
        return `参考图${i + 1}（${dims}）的视觉分析：\n${ref.analysis}`;
      }).filter(Boolean);
      textParts.push(`【参考图分析】\n${analysisDescs.join('\n\n')}`);
      textParts.push('请将以上参考图的视觉分析结果融入最终提示词，确保对应维度的描述忠实于参考图的实际视觉特征。');
    } else {
      const refDescs = references.map((ref, i) => {
        const focuses = ref.focuses && ref.focuses.length > 0
          ? ref.focuses.join('、')
          : '整体风格';
        return `参考图${i + 1}：重点学习其「${focuses}」`;
      });
      textParts.push(`【参考图】\n${refDescs.join('\n')}`);
    }
  }

  textParts.push('请根据以上信息，生成一段 150-250 字的中文建筑效果图提示词（两段式：氛围光影 + 补充元素，无标题）。关键术语可中英对照标注。');

  content.push({ type: 'text', text: textParts.join('\n\n') });

  // 基础图：优先 CDN URL（轻量），base64 作为 fallback
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

  // 参考图：优先 CDN URL
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

/**
 * 流式增强 Prompt
 */
async function* enhancePromptStream({ intent, params, baseImage, baseImageUrl, references }) {
  const userContent = buildUserContent({ intent, params, baseImage, baseImageUrl, references });

  const stream = await client.chat.completions.create({
    model: process.env.ENHANCE_MODEL || 'claude-sonnet-4-6',
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
      yield delta;
    }
  }
}

module.exports = { enhancePromptStream };
