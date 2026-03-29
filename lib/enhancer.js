const OpenAI = require('openai');
const { SYSTEM_PROMPT } = require('./system-prompt');

const client = new OpenAI({
  apiKey: process.env.TUZI_API_KEY,
  baseURL: process.env.TUZI_BASE_URL,
});

/**
 * 构建用户消息内容（base64 图片）
 */
function buildUserContent({ intent, params, baseImage, references }) {
  const content = [];

  // 文本部分
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

  if (baseImage) {
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

  // 基础图
  if (baseImage) {
    content.push({
      type: 'image_url',
      image_url: {
        url: baseImage.startsWith('data:') ? baseImage : `data:image/jpeg;base64,${baseImage}`,
      },
    });
  }

  // 参考图
  if (references && references.length > 0) {
    for (const ref of references) {
      if (ref.image) {
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
async function* enhancePromptStream({ intent, params, baseImage, references }) {
  const userContent = buildUserContent({ intent, params, baseImage, references });

  const stream = await client.chat.completions.create({
    model: process.env.MODEL || 'claude-opus-4-6',
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
