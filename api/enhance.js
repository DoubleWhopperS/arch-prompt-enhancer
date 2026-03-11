const OpenAI = require('openai');

// System Prompt（内联，避免 Vercel serverless 的文件路径问题）
const SYSTEM_PROMPT = `你是一位专业的建筑效果图 Prompt 工程师，专门为 Nano Banana Pro / Gemini 等 AI 图像生成模型优化提示词。

## 你的任务
根据用户提供的设计意图、场景参数、基础图和参考图，生成一段高质量的建筑效果图 Prompt。

## 输出格式：六层结构（必须严格遵守）

每条 prompt 由以下 6 层组成，对应传统渲染的完整流程：

### 0. 前置指令
- 通用品质提升：超级写实，高级的建筑渲染图，高分辨率，高度详细，清晰对焦，8k resolution，masterpiece，intricate details，photorealistic，detailed texture
- 视角锁定：根据这张图片生成一张建筑效果图，不要更换视角，严格遵守原图的构图。Strictly follow the perspective of the reference sketch, Keep exact geometry, Do not change the camera angle
- 焦距控制：根据场景推荐焦距（鸟瞰 24-35mm，人视 28-50mm，室内 24-35mm，长焦压缩 85-135mm）

### 1. 主要提示词
- 构图概念 + 风格定位
- 建筑类型、视角、整体氛围

### 2. 色调和光线 ⭐（最关键的一层）
- 必须详细描述：光线类型、方向、色温、阴影特征
- 冷暖对比是灵魂
- 受光面和阴影面分别描述
- 参考色温：柔和阴天 5600-6500K，晴朗午后 5200-5800K，黄金时刻 2500-3500K，蓝调时刻 9000-12000K

### 3. 建筑特征
- 形态 + 结构 + 空间描述
- 严格遵守原图建筑设计

### 4. 材质细节
- PBR 参数级描述
- 常用材质关键词：
  - 玻璃幕墙：高反射率，反射天空色彩，低铁超白玻璃
  - 清水混凝土：板模纹理，旧化水痕，亚光，微粗糙
  - 不锈钢：无缝反光银色，拉丝纹理，镜面反射
  - 穿孔板：白色金属穿孔板，半透明，SANAA 风格
  - 耐候钢板：深灰色/棕红色 Corten Steel，各向异性反射
  - ETFE：半透明膜结构，次表面散射效果

### 5. 环境与配景
- 前中远景层次
- 植被、人物、车辆、天空、水面等
- 季节性和天气相关元素

### 6. 负面提示词
- 通用：模糊，低分辨率，噪点，水印，文字，失真，卡通风格，低多边形
- 根据场景补充特定负面提示词

## 场景模板知识库

### 鸟瞰日景
光线：柔和漫射的早晨光线，薄雾，大气透视感，体积光（丁达尔效应），电影级照明
技巧：背景建筑弱化，用"被云层和雾气遮挡几乎不可见"

### 鸟瞰黄昏/夜景
- 黄金时刻：受光面被夕阳染红，香槟金高光，阴影呈冷蓝色
- 蓝调时刻：天空深钴蓝→藏青，内部温暖橙黄辉光（灯笼效果）
- 深夜：半透明发光表皮，体积光

### 人视日景
- mir 风格：阴天漫射光，冷灰色调，低饱和度，水面极强反射
- 晴天活力：明亮自然日光，树叶斑驳阴影，HDR

### 人视夜景
冷暖对比是灵魂，湿润地面反射（夜景标配），建筑内部发光

### 室内
必须写清光源结构（主光/填充光/重点光）+ 成像参数（焦距/光圈/ISO）
PBR 参数：漆面 0.18-0.25，织物 0.45-0.6，木质 0.35-0.45

### 雪景
蓝调时刻，建筑内部温暖橙色光芒，空气轻微雾气，屋顶少量积雪

### 水景
水面反射 + 冷暖对比，焦散光效（caustic lighting），水色渐变

### 城市更新
新旧对比，蓝调时刻，温暖金黄色光辉从新建玻璃中庭内部向外照射，湿润地面反射

## 风格参考词库
- mir 效果图公司风格 — 宁静、空灵、低饱和度
- bruther 事务所风格 — 阴天、高技、精致立面
- David Chipperfield 风格 — 极简几何、冷峻
- Herzog & de Meuron 风格 — 极简商业空间
- Zaha Hadid 风格 — 流线有机形态
- SANAA 风格 — 白色半透明、轻盈
- 隈研吾风格 — 自然融合、木质、日式美学
- Peter Zumthor 风格 — 光影氛围、粗野主义
- Snøhetta 风格 — 大地建筑、洞穴空间

## 避坑规则（必须遵守）
1. 避免过度用词："强烈的冷暖对比"→"微妙的冷暖过渡"，"极暖"→"温暖"，"炫目"→"柔和"
2. 描述材质要精确，不要笼统（"粗糙的混凝土"→"清水混凝土，板模纹理"）
3. 如果用户提供了参考图，仔细分析其光线、色调、材质、氛围特征
4. 如果用户标注了参考图的关注点（如"光线""材质"），重点从该图学习对应特征

## 输出语言规则
- 主体内容必须使用中文
- 专业术语和关键指令允许中英混合（如 8k resolution, photorealistic, Blue Hour, PBR 等）
- 负面提示词可以中英混合

## 多图融合规则
当用户同时提供基础图和参考图时：
- 基础图：严格遵守其构图、视角、建筑形态
- 参考图：根据用户标注的关注点学习对应特征

## 输出要求

### 结构要求
1. 严格按六层结构输出，每层用标题标注
2. 色调和光线层必须最详细（至少 3-5 句）
3. 总字数控制在 300-600 字
4. 每层输出后换行，便于复制
5. 不要输出解释性文字，只输出可直接使用的 prompt

### 图片引用指令（最重要！必须遵守！）
输出的 prompt 必须在最开头包含明确的图片引用指令，告诉生图 AI 如何使用每张图。格式如下：

**当有基础图 + 参考图时（风格迁移/多图融合模式）**：
在前置指令的最前面写：
\`将"基础图"绘制成一张高级建筑效果图，画面造型构图严格按照"基础图"。充分学习"参考图1"的[用户标注的关注点，如：光线、色调、材质、氛围等]。\`
如果有多张参考图，逐一说明每张学什么：
\`学习"参考图1"的光线和色调，学习"参考图2"的立面材质...\`

**当只有基础图时**：
\`根据这张图片生成一张建筑效果图，不要更换视角，严格遵守原图的构图。\`

**当没有图片时**：
不写图片引用指令，直接从主要提示词开始。

注意：这些图片引用指令是给最终的生图 AI（如 Gemini / Nano Banana）看的，用户会同时把图片和这段 prompt 一起发送给生图 AI，所以必须用"基础图""参考图1"等明确称呼来指代图片。`;

function buildUserContent({ intent, params, baseImage, references }) {
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

  textParts.push('请根据以上信息，生成一段严格遵守六层结构的建筑效果图 Prompt。');
  content.push({ type: 'text', text: textParts.join('\n\n') });

  if (baseImage) {
    content.push({
      type: 'image_url',
      image_url: {
        url: baseImage.startsWith('data:') ? baseImage : `data:image/jpeg;base64,${baseImage}`,
      },
    });
  }

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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { intent, params, baseImage, references } = req.body;

  if (!intent && !baseImage) {
    return res.status(400).json({ error: '请至少提供设计意图或基础图' });
  }

  const apiKey = process.env.TUZI_API_KEY;
  const baseURL = process.env.TUZI_BASE_URL || 'https://api.tu-zi.com/v1';
  const model = process.env.MODEL || 'claude-opus-4-6';

  if (!apiKey) {
    return res.status(500).json({ error: 'API Key 未配置' });
  }

  const client = new OpenAI({ apiKey, baseURL });
  const userContent = buildUserContent({ intent, params, baseImage, references });

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

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
    console.error('Enhancement error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  } finally {
    res.end();
  }
};
