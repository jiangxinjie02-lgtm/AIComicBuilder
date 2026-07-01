type AssetCategory = "characters" | "props" | "scenes" | "voices";

interface AnalyzeScriptAssetsInput {
  title: string;
  script: string;
  aspectRatio?: string;
  targetSize?: string;
  style?: string;
}

interface FaceTemplate {
  label: string;
  url: string;
  note: string;
}

export interface AssetAgentVariant {
  name: string;
  description?: string;
  prompt?: string;
  imageUrl?: string;
  history?: Array<Record<string, unknown>>;
}

export interface AssetAgentAsset {
  id: string;
  category: AssetCategory;
  name: string;
  mainImageName?: string;
  role?: string;
  roleKey?: string;
  faceTemplate?: FaceTemplate | null;
  tags: string[];
  status: "draft";
  confirmed: boolean;
  score: number;
  appearances: number;
  episodes: string[];
  description: string;
  prompt: string;
  negativePrompt: string;
  variants: AssetAgentVariant[];
  imageUrl: string;
  history: Array<Record<string, unknown>>;
}

export interface AssetAgentProject {
  id: string;
  title: string;
  sourceLength: number;
  createdAt: string;
  settings: {
    aspectRatio: string;
    targetSize: string;
    style: string;
  };
  summary: {
    output: string;
    scriptLength: number;
    lineCount: number;
    counts: {
      characters: number;
      props: number;
      scenes: number;
      voices: number;
    };
    note: string;
  };
  assets: {
    characters: AssetAgentAsset[];
    props: AssetAgentAsset[];
    scenes: AssetAgentAsset[];
    voices: AssetAgentAsset[];
  };
  stages: Array<{
    id: string;
    label: string;
    status: "completed" | "review" | "pending";
    metrics: string[];
  }>;
}

interface SceneBucket {
  heading: string;
  rawHeading: string;
  timeTags: string[];
  lines: string[];
  index: number;
}

interface CharacterSeed {
  name: string;
  score: number;
  role: string;
  explicitRole?: string;
  contexts: string[];
}

interface NamedSeed {
  name: string;
  score: number;
  type: string;
  contexts: string[];
  times?: string[];
}

const LEAD_FACE_TEMPLATES: Record<string, FaceTemplate> = {
  maleLead: {
    label: "男主脸型模板：陆铮",
    url: "/templates/male-lead-luzheng.jpg",
    note: "固定窄长脸型、清晰下颌线、浓眉、挺直鼻梁和克制唇形",
  },
  femaleLead: {
    label: "女主脸型模板：沈念",
    url: "/templates/female-lead-shennian.png",
    note: "固定鹅蛋脸、小巧下颌、大眼、柔和有形、挺鼻和自然唇形",
  },
};

const BANNED_CHARACTER_NAMES = new Set([
  "时间",
  "地点",
  "场景",
  "镜头",
  "内景",
  "外景",
  "旁白",
  "字幕",
  "音效",
  "音乐",
  "特写",
  "全景",
  "中景",
  "近景",
  "道具",
  "服装",
  "动作",
  "画面",
  "黑屏",
  "转场",
  "人物",
  "角色",
  "剧名",
  "主题",
  "正文",
  "大纲",
  "众人",
  "所有人",
  "工作人员",
  "系统",
  "系统音",
  "男主",
  "女主",
  "男配",
  "女配",
  "主角",
  "配角",
  "反派",
  "男人",
  "女人",
  "女孩",
  "男孩",
  "老人",
  "孩子",
  "医生",
  "护士",
  "警察",
  "士兵",
  "丧尸",
]);

const PROP_KEYWORDS: Array<{ keyword: string; type: string }> = [
  { keyword: "重卡", type: "车辆" },
  { keyword: "卡车", type: "车辆" },
  { keyword: "汽车", type: "车辆" },
  { keyword: "轿车", type: "车辆" },
  { keyword: "摩托", type: "车辆" },
  { keyword: "枪", type: "武器" },
  { keyword: "手枪", type: "武器" },
  { keyword: "步枪", type: "武器" },
  { keyword: "刀", type: "武器" },
  { keyword: "剑", type: "武器" },
  { keyword: "匕首", type: "武器" },
  { keyword: "弓", type: "武器" },
  { keyword: "钥匙", type: "随身物品" },
  { keyword: "手机", type: "电子设备" },
  { keyword: "电脑", type: "电子设备" },
  { keyword: "芯片", type: "电子设备" },
  { keyword: "录音笔", type: "电子设备" },
  { keyword: "对讲机", type: "电子设备" },
  { keyword: "地图", type: "文件" },
  { keyword: "文件", type: "文件" },
  { keyword: "照片", type: "文件" },
  { keyword: "信", type: "文件" },
  { keyword: "合同", type: "文件" },
  { keyword: "戒指", type: "饰品" },
  { keyword: "项链", type: "饰品" },
  { keyword: "玉佩", type: "饰品" },
  { keyword: "令牌", type: "标识物" },
  { keyword: "箱", type: "容器" },
  { keyword: "背包", type: "容器" },
  { keyword: "药", type: "医疗物资" },
  { keyword: "针剂", type: "医疗物资" },
  { keyword: "医疗箱", type: "医疗物资" },
  { keyword: "面具", type: "服饰" },
  { keyword: "制服", type: "服饰" },
  { keyword: "外套", type: "服饰" },
  { keyword: "炸药", type: "危险品" },
  { keyword: "炸弹", type: "危险品" },
  { keyword: "手电", type: "工具" },
  { keyword: "手电筒", type: "工具" },
  { keyword: "工具箱", type: "工具" },
  { keyword: "遥控器", type: "工具" },
  { keyword: "水箱", type: "物资" },
  { keyword: "物资箱", type: "物资" },
  { keyword: "罐头", type: "物资" },
];

const SCENE_KEYWORDS: Array<{ keyword: string; type: string }> = [
  { keyword: "医院楼顶", type: "医疗场景" },
  { keyword: "医院", type: "医疗场景" },
  { keyword: "学校", type: "公共建筑" },
  { keyword: "教室", type: "公共建筑" },
  { keyword: "公司", type: "办公场景" },
  { keyword: "办公室", type: "办公场景" },
  { keyword: "客厅", type: "居住空间" },
  { keyword: "卧室", type: "居住空间" },
  { keyword: "厨房", type: "居住空间" },
  { keyword: "地下室", type: "封闭空间" },
  { keyword: "仓库", type: "工业空间" },
  { keyword: "工厂", type: "工业空间" },
  { keyword: "厂房", type: "工业空间" },
  { keyword: "实验室", type: "科研空间" },
  { keyword: "基地", type: "据点" },
  { keyword: "天台", type: "屋顶空间" },
  { keyword: "楼顶", type: "屋顶空间" },
  { keyword: "走廊", type: "过渡空间" },
  { keyword: "街道", type: "城市外景" },
  { keyword: "公路", type: "道路" },
  { keyword: "高速服务区", type: "道路" },
  { keyword: "高速", type: "道路" },
  { keyword: "车站", type: "交通场景" },
  { keyword: "码头", type: "交通场景" },
  { keyword: "机场", type: "交通场景" },
  { keyword: "商场", type: "商业空间" },
  { keyword: "超市", type: "商业空间" },
  { keyword: "酒吧", type: "商业空间" },
  { keyword: "餐厅", type: "商业空间" },
  { keyword: "酒店", type: "住宿空间" },
  { keyword: "旅馆", type: "住宿空间" },
  { keyword: "警局", type: "公共机构" },
  { keyword: "牢房", type: "禁闭空间" },
  { keyword: "森林", type: "自然外景" },
  { keyword: "荒野", type: "自然外景" },
  { keyword: "城堡", type: "幻想建筑" },
  { keyword: "避难所", type: "据点" },
  { keyword: "营地", type: "据点" },
  { keyword: "广场", type: "公共空间" },
];

export function analyzeScriptAssets(input: AnalyzeScriptAssetsInput): AssetAgentProject {
  const aspectRatio = input.aspectRatio || "16:9";
  const targetSize = input.targetSize || "1536x1024";
  const style = input.style || "真人实拍";
  const normalized = normalizeScript(input.script);
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const episodes = extractEpisodes(normalized);
  const sceneBuckets = collectSceneBuckets(lines);
  const characterSeeds = collectCharacterSeeds(lines, normalized);
  const characterNames = characterSeeds.map((seed) => seed.name);
  const propSeeds = collectPropSeeds(lines, normalized, characterNames);
  const sceneSeeds = collectSceneSeeds(sceneBuckets, lines, normalized, characterNames);

  const settings = { aspectRatio, targetSize, style };
  const characters = characterSeeds.slice(0, 80).map((seed, index) =>
    makeCharacterAsset(seed, index, normalized, episodes, settings)
  );
  const props = propSeeds.slice(0, 120).map((seed, index) =>
    makePropAsset(seed, index, normalized, episodes, settings)
  );
  const scenes = sceneSeeds.slice(0, 120).map((seed, index) =>
    makeSceneAsset(seed, index, normalized, episodes, settings)
  );
  const voices = characters.map((character, index) =>
    makeVoiceAsset(character, index, normalized, episodes)
  );

  return {
    id: `proj_${Date.now()}`,
    title: input.title || "未命名剧本",
    sourceLength: normalized.length,
    createdAt: new Date().toISOString(),
    settings,
    summary: buildSummary(normalized, characters, props, scenes, voices, episodes),
    assets: { characters, props, scenes, voices },
    stages: [
      {
        id: "script",
        label: "剧本解析",
        status: "completed",
        metrics: [`剧本 ${normalized.length} 字`, `${episodes.length || 1} 集/段`, `${sceneBuckets.length} 个场景段`],
      },
      {
        id: "assets",
        label: "资产设定",
        status: "review",
        metrics: [`角色 ${characters.length}`, `物品 ${props.length}`, `场景 ${scenes.length}`, `音色 ${voices.length}`],
      },
      {
        id: "generation",
        label: "设定图生成",
        status: "pending",
        metrics: ["等待确认后批量生图"],
      },
    ],
  };
}

function normalizeScript(script: string) {
  return String(script || "")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractEpisodes(text: string) {
  const chineseMatches = [...text.matchAll(/第\s*([0-9一二两三四五六七八九十百]+)\s*[集幕场章]/g)];
  const epMatches = [...text.matchAll(/\bEP\s*0*([0-9]{1,3})\b/gi)];
  const ids = [
    ...chineseMatches.map((match) => `EP${toArabic(match[1]) || match[1]}`),
    ...epMatches.map((match) => `EP${Number(match[1])}`),
  ];
  return [...new Set(ids)].slice(0, 100);
}

function collectSceneBuckets(lines: string[]) {
  const buckets: SceneBucket[] = [];
  let current: SceneBucket | null = null;

  for (const line of lines) {
    if (isSceneHeading(line)) {
      current = {
        heading: cleanSceneName(line),
        rawHeading: line,
        timeTags: extractTimeTags(line),
        lines: [],
        index: buckets.length + 1,
      };
      buckets.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }

  if (!buckets.length) {
    buckets.push({
      heading: "主要叙事空间",
      rawHeading: "主要叙事空间",
      timeTags: [],
      lines: lines.slice(0, 160),
      index: 1,
    });
  }

  return buckets;
}

function collectCharacterSeeds(lines: string[], text: string) {
  const score = new Map<string, number>();
  const contexts = new Map<string, string[]>();
  const explicitRoles = new Map<string, string>();

  for (const line of lines) {
    const rolePrefix = line.match(/^(男主|女主|男配|女配|反派|主角)[：:\s]+([\u4e00-\u9fa5A-Za-z0-9·]{2,12})/);
    if (rolePrefix) {
      const name = cleanCharacterName(rolePrefix[2]);
      if (isLikelyCharacterName(name)) {
        const role = normalizeRole(rolePrefix[1]);
        bump(score, name, role.includes("主") ? 40 : 22);
        remember(contexts, name, line);
        explicitRoles.set(name, role);
      }
    }

    const castLine = line.match(/(?:人物|角色|主要角色|出场人物)[：:]\s*(.{2,120})$/);
    if (castLine) {
      const names = castLine[1].split(/[、，,/\s]+/).map((item) => cleanCharacterName(item)).filter(Boolean);
      for (const name of names) {
        if (isLikelyCharacterName(name)) {
          bump(score, name, 5);
          remember(contexts, name, line);
        }
      }
    }

    const dialogue = line.match(/^([\u4e00-\u9fa5A-Za-z0-9·]{2,12})\s*[：:]\s*(.{1,180})$/);
    if (dialogue) {
      const name = cleanCharacterName(dialogue[1]);
      const body = dialogue[2];
      if (isLikelyCharacterName(name)) {
        const explicitRole = explicitRoleFromText(body);
        bump(score, name, explicitRole ? 16 : 4);
        remember(contexts, name, body);
        if (explicitRole) explicitRoles.set(name, explicitRole);
      }
    }

    const inlineRole = line.match(/([\u4e00-\u9fa5A-Za-z0-9·]{2,12})[（(]?(男主|女主|男配|女配|反派|主角)[）)]?/);
    if (inlineRole) {
      const name = cleanCharacterName(inlineRole[1]);
      if (isLikelyCharacterName(name)) {
        const role = normalizeRole(inlineRole[2]);
        bump(score, name, role.includes("主") ? 28 : 14);
        remember(contexts, name, line);
        explicitRoles.set(name, role);
      }
    }
  }

  for (const name of [...score.keys()]) {
    const count = countOccurrences(text, name);
    score.set(name, (score.get(name) || 0) + count);
  }

  const ranked = [...score.entries()]
    .filter(([name, value]) => value >= 4 && isProperCharacterAssetName(name))
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({
      name,
      score: value,
      role: "",
      explicitRole: explicitRoles.get(name),
      contexts: contexts.get(name) || [],
    }));

  const seeds = assignCharacterRoles(ranked);
  return seeds.length ? seeds : [{ name: "主角", score: 1, role: "主角", contexts: [] }];
}

function collectPropSeeds(lines: string[], text: string, characterNames: string[]) {
  const characterNameSet = new Set(characterNames);
  const seedMap = new Map<string, NamedSeed>();

  for (const line of lines) {
    for (const item of PROP_KEYWORDS) {
      if (!line.includes(item.keyword)) continue;
      const names = [item.keyword, ...extractNamesAroundKeyword(line, item.keyword)]
        .map(normalizePropName)
        .filter((name) => isProperPropAssetName(name) && !looksLikeCharacterName(name, characterNameSet));
      const usableNames = names.length ? names : [item.keyword];
      for (const name of usableNames) {
        mergeSeed(seedMap, {
          name,
          type: item.type,
          score: 4 + countOccurrences(text, name),
          contexts: [line],
        });
      }
    }
  }

  return dedupeNamedSeeds([...seedMap.values()])
    .sort((a, b) => b.score - a.score)
    .slice(0, 120);
}

function collectSceneSeeds(
  sceneBuckets: SceneBucket[],
  lines: string[],
  text: string,
  characterNames: string[]
) {
  const characterNameSet = new Set(characterNames);
  const seedMap = new Map<string, NamedSeed>();

  for (const bucket of sceneBuckets) {
    const name = normalizeSceneName(bucket.heading, characterNameSet);
    if (isProperSceneAssetName(name)) {
      mergeSeed(seedMap, {
        name,
        type: inferSceneType(name),
        score: 10 + bucket.lines.length,
        contexts: [bucket.rawHeading, ...bucket.lines.slice(0, 4)],
        times: bucket.timeTags,
      });
    }
  }

  for (const line of lines) {
    for (const item of SCENE_KEYWORDS) {
      if (!line.includes(item.keyword)) continue;
      const names = [item.keyword, ...extractNamesAroundKeyword(line, item.keyword)]
        .map((name) => normalizeSceneName(name, characterNameSet))
        .filter(isProperSceneAssetName);
      const usableNames = names.length ? names : [item.keyword];
      for (const name of usableNames) {
        mergeSeed(seedMap, {
          name,
          type: item.type,
          score: 3 + countOccurrences(text, name),
          contexts: [line],
          times: extractTimeTags(line),
        });
      }
    }
  }

  if (seedMap.size > 1) {
    seedMap.delete("主要叙事空间");
  }

  return dedupeNamedSeeds([...seedMap.values()])
    .sort((a, b) => b.score - a.score)
    .slice(0, 120);
}

function makeCharacterAsset(
  seed: CharacterSeed,
  index: number,
  text: string,
  episodes: string[],
  settings: Required<Pick<AnalyzeScriptAssetsInput, "aspectRatio" | "targetSize" | "style">>
): AssetAgentAsset {
  const snippets = findSnippets(text, seed.name);
  const joined = snippets.concat(seed.contexts).join(" ");
  const gender = inferGender(seed.name, joined);
  const age = inferAge(joined);
  const temperament = inferTemperament(joined);
  const epRefs = inferEpisodeRefs(text, seed.name, episodes);
  const description = compactText(seed.contexts.concat(snippets).join(" "), 220);
  const roleKey = roleKeyFromRole(seed.role);
  const faceTemplate = LEAD_FACE_TEMPLATES[roleKey] || null;
  const faceConstraint = faceTemplate
    ? [
        "【脸型模板约束】",
        `参考图：${faceTemplate.label}（${faceTemplate.url}）。${faceTemplate.note}。`,
        "生成主图与全部变体时，脸型、五官、眉眼鼻唇比例、骨相和面部辨识度必须严格保持模板一致；多个变体只允许改变发型、服装、妆造强弱和剧情状态，不改变脸型与五官。",
        "",
      ]
    : [];
  const prompt = [
    "【整体美学】",
    `${settings.style}摄影质感，自然皮肤毛孔与织物纹理，影棚柔光，35mm 胶片质地，统一剧集视觉风格。`,
    "",
    "【画面规格】",
    `人物三视图角色设定图，“${seed.name}”。${settings.aspectRatio}，${settings.targetSize}，纯白背景，平视视角。单一角色，画面中不出现其他人物。左侧为面部近景，右侧为正面、侧面、背面三视图，全身比例准确。`,
    "",
    ...faceConstraint,
    "【角色档案】",
    `姓名：${seed.name}。身份：${seed.role}。${gender}，${age}。性格气质：${temperament}。剧本依据：${description || "根据剧本主要出场信息生成。"} `,
    "",
    "【一致性约束】",
    "所有视图保持同一人物，发型、服装、肤色、身材比例完全一致；不出现字幕、文字、Logo、水印、UI；不裁切头顶或脚部。",
  ].join("\n");

  return {
    id: `char_${index + 1}_${slugify(seed.name)}`,
    category: "characters",
    name: seed.name,
    mainImageName: `${seed.name}主形象三视图`,
    role: seed.role,
    roleKey,
    faceTemplate,
    tags: [seed.role, gender, age].filter(Boolean),
    status: "draft",
    confirmed: false,
    score: seed.score,
    appearances: seed.score,
    episodes: epRefs,
    description: description || `${seed.name} 是剧本中需要建立一致视觉形象的角色。`,
    prompt,
    negativePrompt: defaultNegativePrompt("characters"),
    variants: suggestCharacterVariants(seed.name, seed.role, snippets, faceTemplate),
    imageUrl: "",
    history: [],
  };
}

function makePropAsset(
  seed: NamedSeed,
  index: number,
  text: string,
  episodes: string[],
  settings: Required<Pick<AnalyzeScriptAssetsInput, "aspectRatio" | "targetSize" | "style">>
): AssetAgentAsset {
  const snippets = findSnippets(text, seed.name);
  const epRefs = inferEpisodeRefs(text, seed.name, episodes);
  const description = compactText(seed.contexts.concat(snippets).join(" "), 180);
  const prompt = [
    "【整体美学】",
    `${settings.style}摄影质感，真实材质细节，柔和棚拍光，35mm 胶片质地。`,
    "",
    "【画面规格】",
    `物品设定图，“${seed.name}”。${settings.aspectRatio}，${settings.targetSize}，完整物品展示，单个主体，居中构图，纯白背景，正面视角，必要时附侧面/背面小视图，清晰展示轮廓、材质、磨损与表面纹理。`,
    "",
    "【物品档案】",
    `名称：${seed.name}。类型：${seed.type}。剧本依据：${description || "由剧本中的道具关键词与上下文抽取。"} `,
    "",
    "【限制】",
    "不出现持握者、手、人物、人影、背景环境；不出现字幕、文字、Logo、水印、UI。",
  ].join("\n");

  return {
    id: `prop_${index + 1}_${slugify(seed.name)}`,
    category: "props",
    name: seed.name,
    mainImageName: `${seed.name}物品主图`,
    role: seed.type,
    tags: [seed.type],
    status: "draft",
    confirmed: false,
    score: seed.score,
    appearances: seed.score,
    episodes: epRefs,
    description: description || `${seed.name} 是剧本中反复出现或具有叙事功能的物品。`,
    prompt,
    negativePrompt: defaultNegativePrompt("props"),
    variants: [],
    imageUrl: "",
    history: [],
  };
}

function makeSceneAsset(
  seed: NamedSeed,
  index: number,
  text: string,
  episodes: string[],
  settings: Required<Pick<AnalyzeScriptAssetsInput, "aspectRatio" | "targetSize" | "style">>
): AssetAgentAsset {
  const snippets = findSnippets(text, seed.name);
  const epRefs = inferEpisodeRefs(text, seed.name, episodes);
  const description = compactText(seed.contexts.concat(snippets).join(" "), 220);
  const times = Array.isArray(seed.times) ? seed.times : [];
  const prompt = [
    "【整体美学】",
    `${settings.style}摄影质感，电影级布光，空间纹理真实，冷暖对比克制，35mm 胶片颗粒，Cinematic。`,
    "",
    "【画面规格】",
    `场景环境设定图，“${seed.name}”。${settings.aspectRatio}，${settings.targetSize}，宽银幕构图，大全景，平视视角，空间完整，建筑结构、陈设、光源关系清晰。`,
    "",
    "【环境档案】",
    `名称：${seed.name}。类型：${seed.type}。剧本依据：${description || "根据剧本地点与场景段落生成。"} `,
    "",
    "【限制】",
    "不出现字幕、文字、Logo、水印；不出现人物、人影、行人；不出现现代无关物件。",
  ].join("\n");

  return {
    id: `scene_${index + 1}_${slugify(seed.name)}`,
    category: "scenes",
    name: seed.name,
    mainImageName: `${seed.name}场景主图`,
    role: seed.type,
    tags: [seed.type, ...times.map((time) => `${time}景`)].filter(Boolean),
    status: "draft",
    confirmed: false,
    score: seed.score,
    appearances: seed.score,
    episodes: epRefs,
    description: description || `${seed.name} 是剧本中需要建立空间一致性的场景。`,
    prompt,
    negativePrompt: defaultNegativePrompt("scenes"),
    variants: suggestSceneVariants(seed.name, times, prompt),
    imageUrl: "",
    history: [],
  };
}

function makeVoiceAsset(character: AssetAgentAsset, index: number, text: string, episodes: string[]): AssetAgentAsset {
  const snippets = findSnippets(text, character.name).join(" ");
  const gender = character.tags.find((tag) => tag === "男性" || tag === "女性") || inferGender(character.name, snippets);
  const age = character.tags.find((tag) => tag.includes("岁") || tag.includes("青年") || tag.includes("中年")) || inferAge(snippets);
  const temperament = inferTemperament(snippets);
  const prompt = [
    "【音色定位】",
    `${character.name}：${gender}，${age}，${character.role || "角色"}。声线要贴合人物身份与剧本处境。`,
    "",
    "【声音质感】",
    `${temperament}。普通话自然，气息真实，避免播音腔和夸张表演。`,
    "",
    "【表演方向】",
    "对白以人物当下目标为核心，语速、停顿、重音随情绪变化；保留生活化口吻，避免过度戏剧化。",
  ].join("\n");

  return {
    id: `voice_${index + 1}_${slugify(character.name)}`,
    category: "voices",
    name: `${character.name}音色`,
    role: character.name,
    tags: [gender, age, character.role || ""].filter(Boolean),
    status: "draft",
    confirmed: false,
    score: character.score,
    appearances: character.appearances,
    episodes: inferEpisodeRefs(text, character.name, episodes),
    description: `${character.name} 的配音/音色设定，用于后续对白制作保持一致。`,
    prompt,
    negativePrompt: "",
    variants: [
      { name: "日常对白", description: "自然、克制、贴近生活的基础版本。" },
      { name: "情绪爆发", description: "压力升高时的更强气息与重音。" },
      { name: "低声独白", description: "适合内心活动和近距离对白。" },
    ],
    imageUrl: "",
    history: [],
  };
}

function buildSummary(
  text: string,
  characters: AssetAgentAsset[],
  props: AssetAgentAsset[],
  scenes: AssetAgentAsset[],
  voices: AssetAgentAsset[],
  episodes: string[]
) {
  const lines = text.split("\n").filter(Boolean);
  return {
    output: `${episodes.length || 1} 集/段`,
    scriptLength: text.length,
    lineCount: lines.length,
    counts: {
      characters: characters.length,
      props: props.length,
      scenes: scenes.length,
      voices: voices.length,
    },
    note: "规则 Agent 已完成第一轮抽取，请在人审后批量调用 image2 生成设定图。",
  };
}

function isSceneHeading(line: string) {
  return (
    /^(第\s*[0-9一二两三四五六七八九十百]+\s*场|场景|地点|内景|外景|INT\.?|EXT\.?)/i.test(line) ||
    /[日夜晨昏]\s*[内外]$/.test(line) ||
    /^[0-9]+[.、]\s*.{2,24}(内|外|日|夜)$/.test(line)
  );
}

function cleanSceneName(line: string) {
  return cleanAssetName(
    line
      .replace(/^(第\s*[0-9一二两三四五六七八九十百]+\s*场|场景|地点|内景|外景|INT\.?|EXT\.?)[：:\s-]*/i, "")
      .replace(/[日夜晨昏]\s*[内外]?$/g, "")
      .replace(/^[0-9]+[.、]\s*/, "")
  );
}

function extractTimeTags(line: string) {
  const tags: string[] = [];
  if (/日|白天|清晨|早晨|上午|中午|午后/.test(line)) tags.push("日");
  if (/夜|晚上|深夜|凌晨/.test(line)) tags.push("夜");
  if (/雨|暴雨|下雨/.test(line)) tags.push("雨");
  if (/雪|暴雪|下雪/.test(line)) tags.push("雪");
  if (/雾|烟雾/.test(line)) tags.push("雾");
  return [...new Set(tags)];
}

function assignCharacterRoles(ranked: Array<Omit<CharacterSeed, "role">>) {
  let maleLeadIndex = ranked.findIndex((seed) => seed.explicitRole === "男主角");
  let femaleLeadIndex = ranked.findIndex((seed) => seed.explicitRole === "女主角");

  if (maleLeadIndex < 0) {
    maleLeadIndex = ranked.findIndex((seed) => /男主|丈夫|先生|哥哥|弟弟|父亲|军官|警官|队长|少年|他/.test(`${seed.name} ${seed.contexts.join(" ")}`));
  }
  if (femaleLeadIndex < 0) {
    femaleLeadIndex = ranked.findIndex((seed, index) =>
      index !== maleLeadIndex && /女主|妻子|小姐|姐姐|妹妹|母亲|姑娘|少女|她/.test(`${seed.name} ${seed.contexts.join(" ")}`)
    );
  }
  if (maleLeadIndex < 0 && femaleLeadIndex < 0 && ranked[0]) maleLeadIndex = 0;
  if (femaleLeadIndex < 0) femaleLeadIndex = ranked.findIndex((_, index) => index !== maleLeadIndex);

  return ranked.map((seed, index): CharacterSeed => {
    let role = seed.explicitRole || "";
    if (!role && index === maleLeadIndex) role = "男主角";
    if (!role && index === femaleLeadIndex) role = "女主角";
    if (!role) role = inferSupportRole(seed.name, seed.contexts);
    return { ...seed, role };
  });
}

function inferSupportRole(name: string, contexts: string[]) {
  const joined = `${name} ${contexts.join(" ")}`;
  if (/反派|敌人|仇人|背叛|阴谋/.test(joined)) return "反派角色";
  if (/男|父|哥|弟|军|警|先生|丈夫|他/.test(joined)) return "男配角";
  if (/女|母|姐|妹|小姐|妻子|她/.test(joined)) return "女配角";
  return "配角";
}

function explicitRoleFromText(text: string) {
  if (/男主/.test(text)) return "男主角";
  if (/女主/.test(text)) return "女主角";
  if (/男配|男反/.test(text)) return "男配角";
  if (/女配|女反/.test(text)) return "女配角";
  if (/反派/.test(text)) return "反派角色";
  if (/主角/.test(text)) return "主角";
  return "";
}

function normalizeRole(role: string) {
  if (/男主/.test(role)) return "男主角";
  if (/女主/.test(role)) return "女主角";
  if (/男配/.test(role)) return "男配角";
  if (/女配/.test(role)) return "女配角";
  if (/反派/.test(role)) return "反派角色";
  return "主角";
}

function roleKeyFromRole(role: string) {
  if (/男主/.test(role)) return "maleLead";
  if (/女主/.test(role)) return "femaleLead";
  if (/男配/.test(role)) return "maleSupport";
  if (/女配/.test(role)) return "femaleSupport";
  if (/主角/.test(role)) return "mainLead";
  return "";
}

function cleanCharacterName(name: string) {
  return cleanAssetName(String(name || "")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/^(前世|年轻|老年|少年|少女|小)/, "")
    .replace(/(os|vo|OS|VO|若干|数名|多人|一行人|等人)$/i, ""));
}

function isLikelyCharacterName(name: string) {
  const value = cleanCharacterName(name);
  if (value.length < 2 || value.length > 8) return false;
  if (BANNED_CHARACTER_NAMES.has(value)) return false;
  if (!/^[\u4e00-\u9fa5A-Za-z0-9·]+$/.test(value)) return false;
  if (looksLikeSceneOrAction(value) || looksLikePropName(value)) return false;
  return true;
}

function isProperCharacterAssetName(name: string) {
  const value = cleanCharacterName(name);
  if (!isLikelyCharacterName(value)) return false;
  if (/^(这时|此时|突然|镜头|画面|声音|电话|消息|系统提示|正文|大纲)$/.test(value)) return false;
  return true;
}

function normalizePropName(name: string) {
  return cleanAssetName(name)
    .replace(/^(一把|一支|一个|一辆|这辆|那辆|把|将|用|拿|拿起|握着|掏出|取出|举起|递出|打开|放下|装着|带着|开着|驾驶)/, "")
    .replace(/(放在|放到|拿到|递给|交给|扔进|丢进|放进|放入|放上|用来|用于|冲进|来到|进入|走进|呼救|求救|上|里|中|内|旁|前|后|的时候).*$/, "");
}

function normalizeSceneName(name: string, characterNameSet = new Set<string>()) {
  let cleaned = cleanAssetName(name)
    .replace(/^(一间|一个|一座|这间|那间|这座|那座|来到|回到|进入|走进|冲进|离开|赶往|开着|驾驶)/, "")
    .replace(/(门口|里面|外面|之中|附近).*$/, "$1");
  for (const characterName of characterNameSet) {
    cleaned = cleaned.replaceAll(characterName, "");
  }
  if (/(把|将|放在|放到|来到|进入|走进|冲进|开着|驾驶|用|拿|呼救|求救)/.test(cleaned) || cleaned.length > 14) {
    const keyword = findLongestKeyword(cleaned, SCENE_KEYWORDS.map((item) => item.keyword));
    if (keyword) return keyword;
  }
  return cleanAssetName(cleaned);
}

function cleanAssetName(value: string) {
  return String(value || "")
    .replace(/[“”"「」『』《》【】]/g, "")
    .replace(/[，。！？；、,.!?;]+/g, " ")
    .replace(/\s+/g, "")
    .replace(/^[\d第集场幕章节：:\-.、]+/g, "")
    .replace(/[：:].*$/g, "")
    .trim()
    .slice(0, 24);
}

function extractNamesAroundKeyword(line: string, keyword: string) {
  const names: string[] = [];
  const pattern = new RegExp(`[\\u4e00-\\u9fa5A-Za-z0-9·]{0,6}${escapeRegExp(keyword)}[\\u4e00-\\u9fa5A-Za-z0-9·]{0,4}`, "g");
  for (const match of line.matchAll(pattern)) {
    if (match[0]) names.push(match[0]);
  }
  return [...new Set(names)];
}

function findLongestKeyword(value: string, keywords: string[]) {
  return [...keywords]
    .sort((a, b) => b.length - a.length)
    .find((keyword) => value.includes(keyword)) || "";
}

function mergeSeed(map: Map<string, NamedSeed>, incoming: NamedSeed) {
  const key = incoming.name.toLowerCase();
  const existing = map.get(key);
  if (!existing) {
    map.set(key, { ...incoming, contexts: incoming.contexts.slice(0, 6), times: incoming.times || [] });
    return;
  }
  existing.score += incoming.score;
  existing.contexts = [...new Set([...existing.contexts, ...incoming.contexts])].slice(0, 8);
  existing.times = [...new Set([...(existing.times || []), ...(incoming.times || [])])];
}

function dedupeNamedSeeds(seeds: NamedSeed[]) {
  const sorted = [...seeds].sort((a, b) => {
    const scoreDelta = b.score - a.score;
    if (scoreDelta) return scoreDelta;
    return b.name.length - a.name.length;
  });
  const results: NamedSeed[] = [];
  for (const seed of sorted) {
    const duplicate = results.some((existing) =>
      existing.name === seed.name ||
      (existing.name.includes(seed.name) && seed.name.length <= 4) ||
      (seed.name.includes(existing.name) && existing.name.length <= 4)
    );
    if (!duplicate) results.push(seed);
  }
  return results;
}

function looksLikeCharacterName(name: string, characterNameSet: Set<string>) {
  for (const characterName of characterNameSet) {
    if (!characterName) continue;
    if (name === characterName) return true;
    if (name.includes(characterName)) return true;
    if (characterName.includes(name) && name.length >= 2) return true;
  }
  return false;
}

function looksLikePropName(name: string) {
  return PROP_KEYWORDS.some((item) => name.includes(item.keyword));
}

function isProperPropAssetName(name: string) {
  const value = cleanAssetName(name);
  if (!value || value.length < 2 || value.length > 12) return false;
  if (looksLikeSceneOrAction(value)) return false;
  return PROP_KEYWORDS.some((item) => value.includes(item.keyword));
}

function isProperSceneAssetName(name: string) {
  const value = cleanAssetName(name);
  if (!value || value.length < 2 || value.length > 14) return false;
  if (looksLikeSceneOrAction(value) || looksLikeNonScene(value)) return false;
  return SCENE_KEYWORDS.some((item) => value.includes(item.keyword)) || /空间|房间|大厅|屋顶|据点|广场|营地/.test(value);
}

function inferSceneType(name: string) {
  return SCENE_KEYWORDS.find((item) => name.includes(item.keyword))?.type || "场景空间";
}

function looksLikeSceneOrAction(name: string) {
  return /(说道|看到|看见|来到|走进|离开|发现|开始|继续|突然|已经|正在|冲进|转身|拿起|放下|打开|关闭)/.test(name);
}

function looksLikeNonScene(name: string) {
  return /(时候|身边|眼前|心里|手里|声音|电话|镜头|画面|男人|女人|孩子)$/.test(name);
}

function inferGender(name: string, context: string) {
  if (/(女性|女人|女主|女配|妻子|母亲|小姐|姐姐|妹妹|姑娘|少女|她)/.test(`${name} ${context}`)) return "女性";
  if (/(男性|男人|男主|男配|丈夫|父亲|先生|哥哥|弟弟|军官|警官|他)/.test(`${name} ${context}`)) return "男性";
  return "性别未定";
}

function inferAge(context: string) {
  if (/(老人|老年|爷爷|奶奶|六十|七十|白发)/.test(context)) return "老年";
  if (/(中年|四十|五十|父亲|母亲)/.test(context)) return "中年";
  if (/(少年|少女|学生|十七|十八|孩子)/.test(context)) return "少年";
  if (/(青年|二十|三十|年轻|24岁|26岁|30岁)/.test(context)) return "青年";
  return "年龄未定";
}

function inferTemperament(context: string) {
  const traits: string[] = [];
  if (/(冷静|克制|沉稳|理性|镇定)/.test(context)) traits.push("冷静克制");
  if (/(慌|怕|恐惧|害怕|紧张)/.test(context)) traits.push("紧张敏感");
  if (/(温柔|善良|照顾|关心)/.test(context)) traits.push("温和细腻");
  if (/(强硬|愤怒|暴躁|命令|威严)/.test(context)) traits.push("强势有压迫感");
  if (/(疲惫|虚弱|病|受伤)/.test(context)) traits.push("疲惫脆弱");
  return traits.slice(0, 2).join("，") || "自然真实，情绪层次克制";
}

function suggestCharacterVariants(name: string, role: string, snippets: string[], faceTemplate: FaceTemplate | null) {
  const joined = snippets.join(" ");
  const faceLock = faceTemplate
    ? `严格参考${faceTemplate.label}，锁定脸型、五官、眉眼鼻唇比例和骨相；`
    : "锁定脸型、五官、眉眼鼻唇比例和骨相；";
  const variants: AssetAgentVariant[] = [
    {
      name: `${name}基础三视图`,
      description: "主形象版本，面部近景加正面、侧面、背面三视图。",
      prompt: `人物三视图设定图，${name}，${role}，基础主形象，纯白背景，面部近景加全身正侧背三视图，${faceLock}保持人物一致。`,
    },
    {
      name: `${name}日常造型`,
      description: "生活化服装，适合常规对白和室内戏。",
      prompt: `人物三视图设定图，${name}，日常服装版本，${faceLock}只改变发型和着装，纯白背景。`,
    },
    {
      name: `${name}外出造型`,
      description: "适合室外行动戏份，服装更便于移动。",
      prompt: `人物三视图设定图，${name}，外出行动服装版本，${faceLock}只改变发型和着装，纯白背景。`,
    },
    {
      name: `${name}情绪状态`,
      description: "用于关键情绪戏，只调整表情、妆发和疲惫程度。",
      prompt: `人物三视图设定图，${name}，情绪状态版本，表情更有剧情压力，${faceLock}只改变妆发和状态，纯白背景。`,
    },
  ];
  if (/(制服|军装|警服|白大褂|校服)/.test(joined)) {
    variants.push({
      name: `${name}制服版本`,
      description: "保留主体外貌，仅替换为剧本指定制服造型。",
      prompt: `人物三视图设定图，${name}，剧本指定制服版本，${faceLock}只改变制服和发型，纯白背景。`,
    });
  }
  if (/(受伤|病|疲惫|崩溃)/.test(joined)) {
    variants.push({
      name: `${name}受伤疲惫版本`,
      description: "保持角色一致，仅调整妆发、表情和身体状态。",
      prompt: `人物三视图设定图，${name}，受伤疲惫状态，妆发略凌乱，${faceLock}保持主体一致，纯白背景。`,
    });
  }
  if (/男主|女主|主角/.test(role)) return variants.slice(0, Math.max(4, variants.length));
  return variants.slice(0, Math.min(3, variants.length));
}

function suggestSceneVariants(name: string, times: string[], basePrompt: string) {
  const normalizedTimes = [...new Set(times || [])];
  if (normalizedTimes.length < 2) return [];
  return normalizedTimes.map((time) => ({
    name: `${name}${time}变体`,
    description: `同一场景的${time}版本，空间结构、陈设和镜头方位不变。`,
    prompt: `${basePrompt}\n\n【变体要求】${time}版本。保持同一空间结构、主要陈设、镜头高度和镜头方位一致，只改变自然光/灯光、天气氛围和时间段。`,
    imageUrl: "",
    history: [],
  }));
}

function inferEpisodeRefs(text: string, name: string, episodes: string[]) {
  if (!episodes.length) return ["EP1"];
  const refs: string[] = [];
  const chunks = splitEpisodeChunks(text, episodes);
  for (const chunk of chunks) {
    if (chunk.text.includes(name)) refs.push(chunk.id);
  }
  return [...new Set(refs)].slice(0, 20);
}

function splitEpisodeChunks(text: string, episodes: string[]) {
  const matches = [...text.matchAll(/第\s*([0-9一二两三四五六七八九十百]+)\s*[集幕场章]/g)];
  if (!matches.length) return [{ id: episodes[0] || "EP1", text }];
  return matches.map((match, index) => {
    const start = match.index || 0;
    const end = matches[index + 1]?.index || text.length;
    const id = `EP${toArabic(match[1]) || match[1]}`;
    return { id, text: text.slice(start, end) };
  });
}

function findSnippets(text: string, keyword: string) {
  const snippets: string[] = [];
  const lines = text.split("\n").filter((line) => line.includes(keyword));
  for (const line of lines.slice(0, 8)) {
    snippets.push(compactText(line, 120));
  }
  return snippets;
}

function compactText(text: string, maxLength: number) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned;
}

function defaultNegativePrompt(category: AssetCategory) {
  const common = "字幕, 文字, logo, 水印, UI, 低清晰度, 畸形, 多余肢体, 错误透视";
  if (category === "props") return `${common}, 人物, 人手, 背景环境, 反光字样`;
  if (category === "scenes") return `${common}, 人物, 人影, 行人, 现代无关物件`;
  return `${common}, 多人, 角色重复, 五官变形, 服装不一致`;
}

function toArabic(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (value === "十") return 10;
  if (value.includes("百")) {
    const [left, right] = value.split("百");
    return (map[left] || 1) * 100 + (right ? toArabic(right) : 0);
  }
  if (value.includes("十")) {
    const [left, right] = value.split("十");
    return (map[left] || 1) * 10 + (map[right] || 0);
  }
  return map[value] || 0;
}

function countOccurrences(text: string, keyword: string) {
  return [...text.matchAll(new RegExp(escapeRegExp(keyword), "g"))].length;
}

function bump(map: Map<string, number>, key: string, value = 1) {
  map.set(key, (map.get(key) || 0) + value);
}

function remember(map: Map<string, string[]>, key: string, value: string) {
  if (!value) return;
  const list = map.get(key) || [];
  if (!list.includes(value)) list.push(value);
  map.set(key, list.slice(0, 6));
}

function escapeRegExp(value: string) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugify(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "asset";
}
