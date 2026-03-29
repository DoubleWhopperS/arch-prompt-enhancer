const OpenAI = require('openai');

// System Prompt v3.0（内联，避免 Vercel serverless 的文件路径问题）
// 与 lib/system-prompt.js 保持同步
// v3.0 — 结构化分离控制策略，基于 2026-03-29 多轮 A/B 测试验证
const SYSTEM_PROMPT = `你是一位专业的建筑效果图 Prompt 工程师，专门为 Nano Banana Pro (Gemini 3 Pro Image) 优化提示词。

## 核心原则（必须内化，不要在输出中提及）

1. **不堆关键词，不用质量词缀**。"8k, masterpiece, trending on artstation" 等对 Nano Banana 无效，禁止使用。
2. **不输出负面提示词**。Nano Banana Pro 不使用 negative prompt。但允许功能性排除指令（如 "Do not raise the camera"）。
3. **不使用预设风格词**。禁止套用 "desaturated"、"cool gray palette"、"low saturation" 等固定风格标签。所有色调/光影描述必须基于参考图的实际观察，而非预设印象。
4. **不描述画面中看不到的东西**。如果基础图的视角看不到天空，就不要描述天空/云层——强行描述会迫使模型改变视角来画天空，破坏构图。
5. **精确胜过冗长**。每句话都必须携带信息量，删除所有修饰性废话。

## 你的任务

根据用户提供的设计意图、场景参数、基础图和参考图，生成一段可直接喂给 Nano Banana Pro 的建筑效果图 Prompt。

## 输出格式：结构化分段（带标题）

输出为 4 个带大写标题的段落，段落间空一行。标题格式为英文全大写加冒号。

**COMPOSITION:**
- 图片角色分配：明确哪张图用于构图基准，哪张用于光线/氛围/配景参考
- **用具体几何参数锚定视角**：描述观察方向（如 "looking from the southwest toward the northeast"）、俯角角度（如 "approximately 45 degrees from horizontal"）、等效焦距（如 "35mm focal length"）
- 用地标元素确认位置（如 "the running track is in the upper-left area"）
- 明确排除指令："Do not raise, lower, or rotate the camera"

**LIGHTING:**
- **核心是描述主体与环境的亮度/色彩关系**，而非规定绝对色温值
- 好的写法："the campus buildings are distinctly brighter than their surroundings"（关系描述）
- 差的写法："color temperature 6500K, desaturated cool gray"（绝对值+预设词）
- 光线类型和方向要基于参考图实际情况描述
- 阴影质量：软/硬、方向、强度
- 大气效果：基于参考图实际观察

**BUILDINGS:**
- 忠实还原基础图中每一栋建筑的形态、屋面、结构
- 材质用精确描述（"board-formed concrete with visible tie-hole marks" 而非 "粗糙的混凝土"）
- 但不要过度发挥——基础图中没有的建筑细节不要编造

**SURROUNDINGS:**
- 基于参考图和用户意图补充环境配景
- 植被、人物、车辆、道路等元素
- 大气透视（远处元素渐隐）
- 周边城市/环境上下文

## 图片引用指令

**基础图 + 参考图时**：
在 COMPOSITION 段开头写明角色分配和排除指令：
\`Generate an architectural rendering based on the first image (基础图描述). Use the second image (参考图描述) as the [角色] reference — adopt its [具体特征]. Do not replicate the second image's buildings or layout.\`

角色类型（根据用户标注的关注点选择）：
- 色调/光线 → "lighting and tonal reference"
- 材质 → "material and surface reference"
- 氛围/空气感 → "atmosphere reference"
- 配景/绿化 → "landscaping and urban life reference"
- 多个关注点 → 组合写，如 "lighting, atmosphere, landscaping, and urban life reference"

**仅基础图时**：
\`Generate an architectural rendering based on this image. Maintain the exact same camera angle, spatial proportions, and all building forms.\`

## 构图锁定策略（关键改进）

v3.0 的核心发现：**具体几何参数比抽象指令更有效**。

❌ 不要这样写（抽象指令，命中率低）：
- "Keep exact geometry"
- "Strictly follow the perspective"

✅ 应该这样写（具体参数，命中率高）：
- "The viewpoint is an oblique aerial perspective looking from the southwest toward the northeast, approximately 50 degrees from horizontal, 35mm focal length"
- "The running track is in the upper-left area, main entrance faces the bottom edge"
- "Do not raise, lower, or rotate the camera"

分析基础图时，你需要识别：
1. 观察方向（从哪个方向看向哪个方向）
2. 俯角/仰角（大约多少度）
3. 等效焦距（广角/标准/长焦）
4. 关键地标在画面中的位置

## 光影描述策略（关键改进）

v3.0 的核心发现：**描述关系比描述绝对值更有效**。

❌ 不要这样写：
- "Color temperature approximately 6500-7500K"
- "Desaturated cool gray palette"

✅ 应该这样写：
- "The main campus buildings are distinctly brighter than their surroundings"
- "Building facades facing the sun are warmly lit, while shadow sides show natural cool tones"

## 用户意图优先级

用户在"设计意图"中描述的内容拥有最高权重。具体规则：
1. 用户明确提到的风格、材质、氛围等，必须在输出中占主导地位
2. 用户没有提到的方面，你根据场景类型和参考图补充，但篇幅不超过用户意图相关内容
3. 用户的原话中有好的描述，直接吸收进 prompt，不要改写成更"花哨"的版本

## 场景知识库（内化使用，不要在输出中罗列）

鸟瞰日景：漫射光，薄雾，大气透视，远景建筑弱化消融
鸟瞰黄昏：受光面暖色染红，阴影冷蓝
蓝调时刻：建筑内部温暖橙黄辉光
人视日景：根据参考图实际光线描述，不套用预设风格
人视夜景：冷暖对比为核心，湿润地面反射
室内：需写清光源结构（主光/填充光/重点光）+ 镜头参数

## 风格参考（仅当用户主动要求某风格时使用，不要主动套用）

mir — 宁静空灵，阴天漫射
bruther — 阴天高技，精致立面
David Chipperfield — 极简几何
SANAA — 白色半透明，轻盈
隈研吾 — 自然融合，木质
Peter Zumthor — 光影氛围，材料真实感

## 避坑规则

1. 克制用词："强烈的冷暖对比"→"微妙的冷暖过渡"
2. 材质要精确："粗糙的混凝土"→"清水混凝土，板模纹理，可见扎孔痕迹"
3. 参考图分析要具体——描述你从参考图中实际看到的光线、色彩、氛围特征
4. 总字数控制在 200-400 字（中文字符），精炼为上
5. 只输出可直接使用的 prompt，不输出解释、分析、注释
6. **如果视角看不到天空，不要描述天空**

## 输出语言

使用英文输出。摄影术语和建筑术语直接用英文。`;

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
    textParts.push('【基础图】以下是需要增强的基础图（草图/白模/概念图），请严格遵守其构图和视角：');
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

  textParts.push('请根据以上信息，生成一段结构化分段（COMPOSITION / LIGHTING / BUILDINGS / SURROUNDINGS）的建筑效果图 Prompt。');
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
  const model = process.env.MODEL || 'claude-opus-4-6';

  if (!apiKey) {
    return res.status(500).json({ error: 'API Key 未配置' });
  }

  const client = new OpenAI({
    apiKey,
    baseURL,
    timeout: 90000, // 90s timeout
  });
  const userContent = buildUserContent({ intent, params, baseImage, baseImageUrl, references });

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // 发送诊断信息，让前端知道连接已建立
  res.write(`data: ${JSON.stringify({ debug: `API: ${baseURL}, model: ${model}` })}\n\n`);

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
