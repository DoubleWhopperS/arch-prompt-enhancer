const OpenAI = require('openai');

const ANALYSIS_PROMPT = `你是一位建筑效果图视觉分析师。请仔细观察提供的建筑效果图或实景照片，只分析用户指定的维度。

## 维度定义

- **光线**：光源方向与类型（直射/漫射/逆光/侧光）、阴影硬度与方向、明暗区域在画面中的分布、高光与暗部特征、光影对比度。用相对描述（"建筑右侧面最亮"、"阴影通透偏冷蓝"），不用绝对色温或色号。

- **色调**：整体色温倾向（冷/暖/中性）、饱和度水平、对比度、画面调性（高调/低调/中间调）、主色调与辅助色的关系。描述色彩间的关系而非罗列颜色名。

- **材质**：可识别的建筑表面材料、肌理特征（粗糙/光滑/纹理方向）、反射与吸光特性、材料之间的过渡与拼接方式。

- **建筑特征**：建筑形体语言（简洁/复杂/有机）、立面逻辑（网格/自由/层叠）、体量关系、结构表达方式、开窗比例与节奏。

- **环境配景**：植被类型与季节状态、人物数量/尺度/姿态、车辆、地面处理（铺装/草地/水面）、天空状态、其他道具与细节。

## 输出要求

1. 只分析用户指定的维度，不分析未指定的
2. 每个维度输出 2-4 句精确描述（30-60 字/维度）
3. 用「【维度名】」作为每段开头
4. 使用相对描述和具体观察，不用笼统形容词
5. 只输出分析内容，无前言、评论或总结`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageUrl, dimensions } = req.body;

  if (!imageUrl || !dimensions || dimensions.length === 0) {
    return res.status(400).json({ error: '请提供参考图和分析维度' });
  }

  const apiKey = process.env.TUZI_API_KEY;
  const baseURL = process.env.TUZI_BASE_URL || 'https://llm.ai-nebula.com/v1';
  const model = process.env.ENHANCE_MODEL || 'claude-sonnet-4-6';

  if (!apiKey) {
    return res.status(500).json({ error: 'API Key 未配置' });
  }

  const client = new OpenAI({ apiKey, baseURL, timeout: 120000 });

  const userText = `请分析这张建筑效果图的以下维度：${dimensions.join('、')}`;

  const userContent = [
    { type: 'text', text: userText },
    { type: 'image_url', image_url: { url: imageUrl } },
  ];

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(`data: ${JSON.stringify({ connected: true })}\n\n`);

  try {
    const stream = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: ANALYSIS_PROMPT },
        { role: 'user', content: userContent },
      ],
      stream: true,
      max_tokens: 2048,
      temperature: 0.3, // lower temp for factual analysis
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
      }
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (err) {
    console.error('Analysis error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  } finally {
    res.end();
  }
};
