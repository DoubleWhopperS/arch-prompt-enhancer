const OpenAI = require('openai');
const { withAuth } = require('../lib/auth');

const ANALYSIS_PROMPT = `你是一位建筑效果图视觉分析师。请仔细观察提供的建筑效果图或实景照片，只分析用户指定的维度。

## 维度定义

- **光线**：光源方向与类型（直射/漫射/逆光/侧光）、阴影硬度与方向、明暗区域在画面中的分布、高光与暗部特征、光影对比度。用相对描述（"建筑右侧面最亮"、"阴影通透偏冷蓝"），不用绝对色温或色号。

- **色调**：使用三区色彩分析法——分别描述亮部色倾向（如"亮部偏向琥珀黄调"）、暗部色倾向（如"暗部沉入冷蓝灰"）、中间调色倾向（如"中间调呈橄榄绿灰"）。再描述整体调性（高调/低调/中间调）、饱和度水平、以及关键色彩过渡（如"天空从顶部深钴蓝过渡到地平线暖粉橙"）。用具体色彩名词锚定（"琥珀黄"、"钴蓝"、"玫瑰灰"），不用笼统形容词（"偏暖"、"偏冷"）。

- **材质**：可识别的建筑表面材料、肌理特征（粗糙/光滑/纹理方向）、反射与吸光特性、材料之间的过渡与拼接方式。

- **建筑特征**：建筑形体语言（简洁/复杂/有机）、立面逻辑（网格/自由/层叠）、体量关系、结构表达方式、开窗比例与节奏。

- **环境配景**：植被类型与季节状态、人物数量/尺度/姿态、车辆、地面处理（铺装/草地/水面）、天空状态、其他道具与细节。

## 输出要求

1. 只分析用户指定的维度，不分析未指定的
2. 每个维度输出 2-4 句精确描述（30-60 字/维度）
3. 用「【维度名】」作为每段开头
4. 使用相对描述和具体观察，不用笼统形容词
5. 只输出分析内容，无前言、评论或总结`;

module.exports = withAuth(async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageUrl, dimensions, supplement } = req.body;

  if (!imageUrl || !dimensions || dimensions.length === 0) {
    return res.status(400).json({ error: '请提供参考图和分析维度' });
  }

  const { apiKey, baseUrl: baseURL, enhanceModel: model } = req.userKeys;
  const client = new OpenAI({ apiKey, baseURL, timeout: 120000 });

  let userText = `请分析这张建筑效果图的以下维度：${dimensions.join('、')}`;
  if (supplement) {
    userText += `\n\n补充说明：${supplement}`;
  }

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
});
