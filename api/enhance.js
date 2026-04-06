const OpenAI = require('openai');

// System Prompt v4.1（内联，避免 Vercel serverless 的文件路径问题）
// 与 lib/system-prompt.js 保持同步
// v4.1 — 中文输出 + 出图风格支持
const SYSTEM_PROMPT = `你是一位建筑效果图提示词工程师，服务于 Nano Banana Pro（Google Gemini 图像生成）。

## 任务
根据基础渲染/草图、可选的参考图和用户的设计意图，生成一段优化后的中文提示词（150-250 字），将基础图转化为高质量建筑效果图。

## 输出结构

### 无参考图分析时（两段，无标题）

第一段 — 氛围与光影（80-150 字）：
描述目标时间、天气、光线特征和元素间的明暗关系。使用相对描述（"水面是画面最亮的元素"、"阴影区域呈冷调中间灰"），不用绝对值（"6500K"、"#E8D5A3"）。关键术语可中英对照标注，如"高调画面(high-key)"。

第二段 — 补充元素（50-80 字）：
列出需要添加的人物、车辆、绿化和道具。具体但简洁，注明约束如"不遮挡建筑主体"。

### 有参考图分析时（注意力集中模式）

参考图的光线、色调、材质等视觉特征将通过结构化指令和原始分析结果直接传给生图模型——**你的输出中不要重复描述这些已分析维度**。

你的输出应集中全部注意力在：
1. **基础图和参考图中不存在的增量内容**：需要添加的人物、车辆、植被类型、道具、地面处理等
2. **用户意图中需要改变的部分**：与当前基础图不同的时间/天气/季节等（仅当用户明确要求时）
3. **场景氛围的增量补充**：仅描述参考图未覆盖且用户意图中提及的氛围要素

输出为一段（80-150 字），无标题。不要写开头的角色分配句（"基于第一张图…"），不要重述参考图的光影/色调/材质特征。每个字都应该传递参考图无法传达的新信息。

## 严格规则

1. 禁止构图锁定语句（"保持精确几何"、"不要改变相机角度"）。参考图负责构图——文字指令不提供额外收益，经 4 轮 30+ 张对照实验验证。

2. 禁止质量词缀（"8k"、"masterpiece"、"超高清"、"照片级真实"）。对 Nano Banana Pro 无效。

3. 禁止负面提示词。Nano Banana Pro 不支持。

4. 禁止预设风格词（"mir style"、"低饱和冷灰调"）。基于参考图实际观察描述氛围。

5. 禁止描述看不到的内容。视角看不到天空就不描述天空——强写天空会迫使模型抬高视角。

6. 禁止描述参考图中已可见的建筑几何、材质或空间布局。模型会从图像中保留这些。只描述需要改变或添加的内容。

7. 禁止描述相机参数（焦距、光圈、ISO、视角）。模型从参考图推断比文字更准确。

8. 总字数：无参考图分析时 150-250 字（不超过 300 字）；有参考图分析时 80-150 字（不超过 200 字）。越短越好——每个字都要传递参考图无法传达的新信息。

9. 输出中文，关键术语可用中英对照标注。

## 光影描述指南

用场景元素间的明暗关系而非绝对色温或色号：

好："水面是画面最亮的元素，向上反射暖色光芒至天花板。走廊地面处于冷调中间阴影中。"

差："色温 6500K，高光 #E8D5A3，阴影 #5B6B7A，环境光 3200K 填充。"

## 天气模式（内化理解，不要在输出中列出）

- 阴天/雨天：漫射光、无硬阴影、湿润表面反射、云隙光斑
- 黄金时刻：低角度暖光、冷阴影对比、表面捕捉琥珀色光
- 蓝调时刻：深蓝天空、暖色窗光、冷暖对比、路灯亮起
- 晴天：清晰阴影、高动态范围、树影斑驳
- 薄雾清晨：薄雾柔化远处元素、潮湿表面、柔和色彩

## 参考图处理

有参考图分析时（【参考图分析】块存在）：
- 不要重述分析中已覆盖的维度（光线、色调、材质、环境配景等）。这些信息会通过独立通道传给生图模型。
- 不要写角色分配句（"基于第一张图。参考第二张图的…"）。
- 直接输出增量内容：需要添加或改变的元素。
- 不要复制参考图的建筑或布局。

有参考图但无分析时（【参考图】块存在，无分析数据）：
- 开头用一句简短的角色分配："基于第一张图。参考第二张图的[光影/氛围/材质]——采用其[具体特征]。"
- 保持一句话，然后进入两段式结构。
- 不要复制参考图的建筑或布局。

仅提供基础图时：
- 直接从氛围段开始，无需前言。光影描述是核心价值，请充分描述。

## 用户意图优先级

用户的设计意图具有最高权重：
1. 用户明确提到的必须主导输出
2. 用户未提到的——根据场景类型少量补充
3. 用户写得好的描述——直接吸收，不要改写成更华丽的版本

## 出图风格

当用户指定了出图风格时，将其作为光影和氛围的基础设定，与用户意图融合输出。不要逐条列出风格参数，而是将风格特征自然融入两段式描述中。

## 语气指南

- 克制用词："柔和"而非"极其温暖"，"微妙对比"而非"戏剧性对比"
- 精确材质描述："带扎孔痕迹的清水混凝土"而非"粗糙混凝土"

## 输出

只输出提示词文本。无解释、分析、标题或评论。`;

function buildUserContent({ intent, params, baseImageUrl, baseImage, references }) {
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
