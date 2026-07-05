export type AssetPromptType = "character" | "prop" | "scene";
export type AssetVisualMode =
  | "character_turnaround"
  | "character_single"
  | "prop_white_background"
  | "scene_reference";

type BindingKind = "asset_bound" | "variant_bound" | "constraint_default" | "system_generated";

export interface CompiledVisualSlot {
  source: string;
  value: string;
  binding: BindingKind;
  required?: boolean;
  repaired?: boolean;
  repairNote?: string;
}

export interface AssetVisualSchema {
  identity?: Record<string, unknown> | null;
  appearance?: Record<string, unknown> | null;
  clothing?: {
    top?: unknown;
    bottom?: unknown;
    shoes?: unknown;
    outerwear?: unknown;
    accessories?: unknown;
  } | null;
  prop?: Record<string, unknown> | null;
  scene?: Record<string, unknown> | null;
  constraints?: {
    era?: unknown;
    genre?: unknown;
    mustHave?: unknown;
    mustNotHave?: unknown;
  } | null;
}

export interface AssetPromptAsset {
  id?: string | null;
  type: AssetPromptType;
  name: string;
  role?: string | null;
  category?: string | null;
  prompt?: string | null;
  description?: string | null;
  visualHint?: string | null;
  visualConstraints?: string | null;
  negativeConstraints?: string | null;
  tags?: string[] | null;
  sceneAssetId?: string | null;
  visualSchema?: AssetVisualSchema | null;
  faceTemplate?: { label?: string | null; url?: string | null; note?: string | null } | null;
}

export interface AssetPromptVariant {
  id?: string | null;
  name?: string | null;
  variantType?: string | null;
  state?: string | null;
  description?: string | null;
  prompt?: string | null;
  visualConstraints?: string | null;
  negativeConstraints?: string | null;
  editInstruction?: string | null;
  lockedTraits?: unknown;
  changedTraits?: unknown;
  visualSchema?: Partial<AssetVisualSchema> | null;
}

export interface AssetVisualSpec {
  mode?: AssetVisualMode;
  aspectRatio?: string | null;
  size?: string | null;
  background?: "pure_white" | "transparent" | "simple" | "environment";
  layout?: string | null;
}

export interface AssetStyleSpec {
  style?: string | null;
  lighting?: string | null;
  camera?: string | null;
  texture?: string | null;
  era?: string | null;
  eraConstraint?: string | null;
  genre?: string | null;
  forbiddenVisualElements?: string[] | null;
  mustHave?: string[] | null;
  mustNotHave?: string[] | null;
}

export interface AssetCompilerInput {
  asset: AssetPromptAsset;
  variant: AssetPromptVariant | null;
  visual_spec: AssetVisualSpec;
  style_spec: AssetStyleSpec;
}

export interface AssetCompilerIR {
  compiler: {
    name: "asset_prompt_compiler";
    version: "v2";
    mode: "schema_bound_final_prompt";
  };
  asset_type: AssetPromptType;
  asset_id: string;
  variant_id: string;
  bindings: {
    character_asset_id: string | null;
    character_variant_id: string | null;
    scene_asset_id: string | null;
    prop_asset_id: string | null;
    binding_rule: string;
  };
  identity: Record<string, CompiledVisualSlot>;
  appearance: Record<string, CompiledVisualSlot>;
  clothing: {
    top?: CompiledVisualSlot;
    bottom?: CompiledVisualSlot;
    shoes?: CompiledVisualSlot;
    outerwear?: CompiledVisualSlot;
    accessories?: CompiledVisualSlot;
  };
  prop: Record<string, CompiledVisualSlot>;
  scene: Record<string, CompiledVisualSlot>;
  pose_layout: Record<string, CompiledVisualSlot>;
  style: Record<string, CompiledVisualSlot>;
  constraints: {
    era: string;
    genre: string;
    must_have: string[];
    visual_must_not_have: string[];
    system_rules: string[];
  };
}

export interface ValidationReport {
  passed: boolean;
  errors: string[];
  warnings: string[];
  repairs: string[];
  system_rules: string[];
}

export interface BuiltAssetPrompt {
  compiler_input: AssetCompilerInput;
  compiler_ir: AssetCompilerIR;
  compiled_final_prompt: string;
  compiled_negative_prompt: string;
  validation_report: ValidationReport;
  // Compatibility aliases for older callers. New code should use the four fields above.
  structured_prompt: AssetCompilerIR;
  prompt: string;
  negative_prompt: string;
}

const NARRATIVE_PATTERNS = [
  /重生/,
  /复仇/,
  /换嫁/,
  /冲喜/,
  /婚姻/,
  /结婚/,
  /离婚/,
  /新婚/,
  /前世/,
  /今生/,
  /剧情/,
  /剧本/,
  /台词/,
  /对白/,
  /未来/,
  /命运/,
  /转身嫁/,
  /故事/,
  /情节/,
  /第\d+集/,
  /episode/i,
];

const ANCIENT_FORBIDDEN = [
  "hanfu",
  "ancient costume",
  "traditional Chinese robe",
  "period drama costume",
  "fantasy clothing",
  "wuxia costume",
  "xianxia costume",
  "flowing ceremonial dress",
  "imperial robe",
  "palace costume",
  "wide-sleeved robe",
  "hair sticks",
  "ancient hairstyle",
  "发簪",
  "汉服",
  "古装",
  "仙侠",
  "武侠",
  "宫廷服饰",
  "长袍广袖",
];

const FUTURE_OR_MODERN_TECH_FORBIDDEN = [
  "smartphone",
  "modern LED screen",
  "LED billboard",
  "laptop",
  "tablet computer",
  "QR code",
  "contemporary logo",
  "modern luxury car",
  "futuristic technology",
  "neon cyberpunk lighting",
];

const SYSTEM_RULES = {
  noStory: "Do not infer story events, relationships, dialogue, revenge, rebirth, marriage, or timeline details.",
  noCostumeInvention: "Do not invent clothing outside compiled clothing slots.",
  respectBindings: "All rendered visual details must come from asset/variant schema slots or constraint defaults.",
};

export function buildAssetImagePrompt(input: {
  asset: AssetPromptAsset;
  variant?: AssetPromptVariant | null;
  visualSpec?: AssetVisualSpec | null;
  styleSpec?: AssetStyleSpec | null;
}): BuiltAssetPrompt {
  const assetType = normalizeAssetType(input.asset.type);
  const compilerInput: AssetCompilerInput = {
    asset: input.asset,
    variant: input.variant ?? null,
    visual_spec: {
      ...defaultAssetVisualSpec(assetType),
      ...(input.visualSpec ?? {}),
    },
    style_spec: {
      ...defaultAssetStyleSpec(),
      ...(input.styleSpec ?? {}),
    },
  };
  const compilerIR = assetType === "character"
    ? buildCharacterCompilerIR(compilerInput)
    : assetType === "prop"
      ? buildPropCompilerIR(compilerInput)
      : buildSceneCompilerIR(compilerInput);
  const validationReport = validateCompilerIR(compilerIR);
  const compiledFinalPrompt = compileFinalPrompt(compilerIR);
  const compiledNegativePrompt = compileNegativePrompt(compilerIR);

  return {
    compiler_input: compilerInput,
    compiler_ir: compilerIR,
    compiled_final_prompt: compiledFinalPrompt,
    compiled_negative_prompt: compiledNegativePrompt,
    validation_report: validationReport,
    structured_prompt: compilerIR,
    prompt: compiledFinalPrompt,
    negative_prompt: compiledNegativePrompt,
  };
}

export function categoryToAssetType(category: string): AssetPromptType {
  if (category === "characters" || category === "character") return "character";
  if (category === "props" || category === "items" || category === "prop") return "prop";
  return "scene";
}

export function defaultAssetVisualSpec(assetType: AssetPromptType, size?: string | null): AssetVisualSpec {
  if (assetType === "character") {
    return {
      mode: "character_turnaround",
      aspectRatio: "16:9",
      size: size || "1536x1024",
      background: "pure_white",
      layout: "left close-up portrait, right front side back full-body turnaround",
    };
  }
  if (assetType === "prop") {
    return {
      mode: "prop_white_background",
      aspectRatio: "16:9",
      size: size || "1536x1024",
      background: "pure_white",
      layout: "single centered prop, orthographic catalog view",
    };
  }
  return {
    mode: "scene_reference",
    aspectRatio: "16:9",
    size: size || "1536x1024",
    background: "environment",
    layout: "wide empty environment reference, no characters",
  };
}

export function defaultAssetStyleSpec(): AssetStyleSpec {
  return {
    style: "realistic live-action photography",
    lighting: "studio soft light",
    camera: "eye-level, 35mm film feel",
    texture: "natural skin texture, fabric texture, realistic material detail",
    genre: "realistic Chinese short-drama asset reference",
  };
}

export function buildPromptAnchoredFinalPrompt(input: {
  sourcePrompt?: string | null;
  compiledPrompt: string;
  category: string;
  targetName?: string | null;
  mode?: "main" | "variant" | "edit";
}) {
  const sourcePrompt = normalizeAuthoritativePrompt(input.sourcePrompt);
  const compiledPrompt = clean(input.compiledPrompt);
  const relationRules = promptRelationRules(input.category, input.mode);

  if (!sourcePrompt) {
    return [relationRules, compiledPrompt].filter(Boolean).join("\n\n");
  }

  return [
    `AUTHORITATIVE USER IMAGE PROMPT FOR ${input.targetName || "ASSET"}:`,
    "The following Chinese image prompt is the highest-priority source. The generated asset must strongly match it, not a generic studio portrait or default catalog item.",
    sourcePrompt,
    "PROMPT-IMAGE ALIGNMENT RULES:",
    relationRules,
    "SECONDARY STRUCTURAL GUARDRAILS:",
    "Use the compiled guardrails only when they do not conflict with the authoritative user prompt.",
    compiledPrompt,
  ].filter(Boolean).join("\n\n");
}

function normalizeAuthoritativePrompt(prompt: unknown) {
  const text = clean(prompt)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > 8000 ? `${text.slice(0, 8000).trim()}\n...` : text;
}

function promptRelationRules(category: string, mode?: "main" | "variant" | "edit") {
  const base = [
    "Follow every explicit visual fact in the authoritative prompt: overall aesthetic, era/world style, identity, profession, role profile, clothing, props, environment, layout, and exclusions.",
    "If a profession, faction, survival state, medical role, engineer role, commander role, villain role, or scene function is mentioned, make it visibly readable through outfit, accessories, material wear, posture, color, and asset details.",
    "Do not replace specified roles or styles with generic modern studio clothing, casual jeans, plain black shirts, business portraits, beauty-shot defaults, or unrelated clean catalog imagery unless the authoritative prompt explicitly asks for them.",
  ];
  if (category === "characters") {
    return [
      ...base,
      "For character assets, the face/template identity lock is mandatory, but clothing, accessories, makeup intensity, and state must still reflect the character profile and the script's overall aesthetic.",
      mode === "variant"
        ? "For variants, preserve the same face and identity while making the variant state clearly visible."
        : "",
    ].filter(Boolean).join("\n");
  }
  if (category === "props" || category === "items") {
    return [
      ...base,
      "For prop assets, the object must visibly reflect its script function, material, era, usage marks, and world style.",
    ].join("\n");
  }
  if (category === "scenes") {
    return [
      ...base,
      "For scene assets, architecture, set dressing, lighting, weathering, and scale must visibly match the script world style.",
    ].join("\n");
  }
  return base.join("\n");
}

function buildCharacterCompilerIR(input: AssetCompilerInput): AssetCompilerIR {
  const asset = input.asset;
  const variant = input.variant;
  const visualSpec = input.visual_spec;
  const styleSpec = input.style_spec;
  const stableText = stableVisualText(asset, variant);
  const tags = asset.tags ?? [];
  const constraints = compileConstraints("character", asset, variant, styleSpec, stableText);
  const gender = pickGender(tags, stableText);
  const age = pickAge(tags, stableText);
  const identity = {
    subject: slot(characterSubject(gender, age), "system.identity.subject", "system_generated", true),
    name: slot(asset.name, "asset.name", "asset_bound", true),
    gender: slot(gender, "asset.tags|asset.visualConstraints", "asset_bound"),
    age_range: slot(age, "asset.tags|asset.visualConstraints", "asset_bound"),
    role_identity: slot(asset.role || asset.category || "", "asset.role", "asset_bound"),
    variant: slot(variant?.name || variant?.variantType || "base character sheet", "variant.name", variant ? "variant_bound" : "system_generated"),
  };
  const appearance = {
    hairstyle: compileTextSlot({
      schemaValue: schemaValue(asset, variant, "appearance", "hairstyle"),
      fallbackText: stableText,
      hints: ["发型", "头发", "短发", "长发", "盘发", "辫子"],
      defaultValue: eraDefaultHairstyle(constraints.era),
      source: "appearance.hairstyle",
      constraints,
    }),
    face_shape: compileTextSlot({
      schemaValue: schemaValue(asset, variant, "appearance", "face_shape") ?? schemaValue(asset, variant, "appearance", "faceShape"),
      fallbackText: stableText,
      hints: ["脸型", "五官", "眉眼", "鼻", "唇", "骨相"],
      defaultValue: faceTemplateText(asset),
      source: "appearance.face_shape",
      constraints,
    }),
    skin_tone: compileTextSlot({
      schemaValue: schemaValue(asset, variant, "appearance", "skin_tone") ?? schemaValue(asset, variant, "appearance", "skinTone"),
      fallbackText: stableText,
      hints: ["肤色", "皮肤"],
      defaultValue: "natural Chinese skin tone",
      source: "appearance.skin_tone",
      constraints,
    }),
    body_proportion: compileTextSlot({
      schemaValue: schemaValue(asset, variant, "appearance", "body_proportion") ?? schemaValue(asset, variant, "appearance", "bodyProportion"),
      fallbackText: stableText,
      hints: ["身高", "体型", "身材", "比例"],
      defaultValue: "accurate full-body proportions",
      source: "appearance.body_proportion",
      constraints,
    }),
    expression: slot("neutral calm expression for reusable character reference", "system.character_asset.expression", "system_generated"),
  };
  const clothing = compileCharacterClothing(asset, variant, stableText, constraints);
  return {
    compiler: { name: "asset_prompt_compiler", version: "v2", mode: "schema_bound_final_prompt" },
    asset_type: "character",
    asset_id: clean(asset.id),
    variant_id: clean(variant?.id),
    bindings: bindingsFor("character", asset, variant),
    identity,
    appearance,
    clothing,
    prop: {},
    scene: {},
    pose_layout: {
      background: slot("pure white background", "visual_spec.background", "system_generated", true),
      layout: slot(visualSpec.layout || "left close-up portrait, right front side back full-body turnaround", "visual_spec.layout", "system_generated", true),
      camera: slot("eye-level front-facing studio reference", "visual_spec.camera", "system_generated", true),
      framing: slot("full body visible with complete head and feet inside the frame", "visual_spec.framing", "system_generated", true),
      consistency: slot("same face, same hairstyle, same clothing, same skin tone, same body shape in every view", "compiler.consistency_rule", "system_generated", true),
    },
    style: compileStyle(styleSpec, visualSpec),
    constraints: {
      era: constraints.era,
      genre: constraints.genre,
      must_have: uniq([
        "single character only",
        "pure white background",
        "left close-up portrait",
        "right front view full body",
        "right side view full body",
        "right back view full body",
        "eye-level camera",
        "accurate full-body proportions",
        "consistent face, hairstyle, clothing, skin tone, body shape across all views",
        ...arrayFrom(styleSpec.mustHave),
      ]),
      visual_must_not_have: uniq([
        ...constraints.visual_must_not_have,
        "extra people",
        "story scene background",
        "unrelated environment props",
        "cropped head",
        "cropped feet",
        "dramatic action pose",
      ]),
      system_rules: uniq([
        ...constraints.system_rules,
        SYSTEM_RULES.noCostumeInvention,
      ]),
    },
  };
}

function buildPropCompilerIR(input: AssetCompilerInput): AssetCompilerIR {
  const asset = input.asset;
  const variant = input.variant;
  const visualSpec = input.visual_spec;
  const styleSpec = input.style_spec;
  const stableText = stableVisualText(asset, variant);
  const constraints = compileConstraints("prop", asset, variant, styleSpec, stableText);
  return {
    compiler: { name: "asset_prompt_compiler", version: "v2", mode: "schema_bound_final_prompt" },
    asset_type: "prop",
    asset_id: clean(asset.id),
    variant_id: clean(variant?.id),
    bindings: bindingsFor("prop", asset, variant),
    identity: {
      name: slot(asset.name, "asset.name", "asset_bound", true),
      category: slot(asset.role || asset.category || "prop", "asset.role", "asset_bound"),
      variant: slot(variant?.name || "base prop", "variant.name", variant ? "variant_bound" : "system_generated"),
    },
    appearance: {},
    clothing: {},
    prop: {
      shape_material: compileTextSlot({
        schemaValue: schemaValue(asset, variant, "prop", "shape_material") ?? schemaValue(asset, variant, "prop", "shapeMaterial"),
        fallbackText: stableText,
        hints: ["形状", "材质", "颜色", "纹理", "磨损"],
        defaultValue: "stable prop shape, material, color, scale, and surface texture",
        source: "prop.shape_material",
        constraints,
      }),
      condition: compileTextSlot({
        schemaValue: schemaValue(asset, variant, "prop", "condition"),
        fallbackText: stableText,
        hints: ["状态", "磨损", "破旧", "崭新"],
        defaultValue: variant?.state || "base reusable prop state",
        source: "prop.condition",
        constraints,
      }),
    },
    scene: {},
    pose_layout: {
      background: slot("pure white background", "visual_spec.background", "system_generated", true),
      layout: slot(visualSpec.layout || "single centered prop, orthographic catalog view", "visual_spec.layout", "system_generated", true),
      camera: slot("eye-level product reference", "visual_spec.camera", "system_generated"),
      framing: slot("entire prop visible inside the frame", "visual_spec.framing", "system_generated", true),
    },
    style: compileStyle(styleSpec, visualSpec),
    constraints: {
      era: constraints.era,
      genre: constraints.genre,
      must_have: uniq(["single reusable prop asset", "pure white background", "entire object visible", ...arrayFrom(styleSpec.mustHave)]),
      visual_must_not_have: uniq([...constraints.visual_must_not_have, "people", "hands", "scene background", "holder", "reflected lettering"]),
      system_rules: uniq([...constraints.system_rules, "Do not invent a human interaction or usage scene."]),
    },
  };
}

function buildSceneCompilerIR(input: AssetCompilerInput): AssetCompilerIR {
  const asset = input.asset;
  const variant = input.variant;
  const visualSpec = input.visual_spec;
  const styleSpec = input.style_spec;
  const stableText = stableVisualText(asset, variant);
  const constraints = compileConstraints("scene", asset, variant, styleSpec, stableText);
  return {
    compiler: { name: "asset_prompt_compiler", version: "v2", mode: "schema_bound_final_prompt" },
    asset_type: "scene",
    asset_id: clean(asset.id),
    variant_id: clean(variant?.id),
    bindings: bindingsFor("scene", asset, variant),
    identity: {
      name: slot(asset.name, "asset.name", "asset_bound", true),
      category: slot(asset.role || asset.category || "scene environment", "asset.role", "asset_bound"),
      variant: slot(variant?.name || "base scene reference", "variant.name", variant ? "variant_bound" : "system_generated"),
    },
    appearance: {},
    clothing: {},
    prop: {},
    scene: {
      environment_design: compileTextSlot({
        schemaValue: schemaValue(asset, variant, "scene", "environment_design") ?? schemaValue(asset, variant, "scene", "environmentDesign"),
        fallbackText: stableText,
        hints: ["空间", "建筑", "陈设", "布局", "光源", "年代"],
        defaultValue: "stable empty environment layout, architecture, key furniture, lighting direction",
        source: "scene.environment_design",
        constraints,
      }),
    },
    pose_layout: {
      background: slot("environment reference, no characters", "visual_spec.background", "system_generated", true),
      layout: slot(visualSpec.layout || "wide empty environment reference", "visual_spec.layout", "system_generated", true),
      camera: slot("eye-level wide shot", "visual_spec.camera", "system_generated"),
      framing: slot("complete reusable scene layout", "visual_spec.framing", "system_generated", true),
    },
    style: compileStyle(styleSpec, visualSpec),
    constraints: {
      era: constraints.era,
      genre: constraints.genre,
      must_have: uniq(["empty reusable scene reference", "stable layout", "clear architecture and key set dressing", ...arrayFrom(styleSpec.mustHave)]),
      visual_must_not_have: uniq([...constraints.visual_must_not_have, "people", "characters", "crowds", "subtitles"]),
      system_rules: uniq([...constraints.system_rules, "Do not render plot action or dramatic event."]),
    },
  };
}

function compileCharacterClothing(
  asset: AssetPromptAsset,
  variant: AssetPromptVariant | null,
  stableText: string,
  constraints: { era: string; genre: string; visual_must_not_have: string[]; system_rules: string[] },
): AssetCompilerIR["clothing"] {
  return {
    top: compileTextSlot({
      schemaValue: schemaValue(asset, variant, "clothing", "top"),
      fallbackText: stableText,
      hints: ["上衣", "衬衫", "制服", "外套", "衣", "袄"],
      defaultValue: eraDefaultClothing(constraints.era).top,
      source: "clothing.top",
      constraints,
      required: true,
    }),
    bottom: compileTextSlot({
      schemaValue: schemaValue(asset, variant, "clothing", "bottom"),
      fallbackText: stableText,
      hints: ["下装", "裤", "裙"],
      defaultValue: eraDefaultClothing(constraints.era).bottom,
      source: "clothing.bottom",
      constraints,
      required: true,
    }),
    shoes: compileTextSlot({
      schemaValue: schemaValue(asset, variant, "clothing", "shoes"),
      fallbackText: stableText,
      hints: ["鞋", "靴"],
      defaultValue: eraDefaultClothing(constraints.era).shoes,
      source: "clothing.shoes",
      constraints,
      required: true,
    }),
    outerwear: compileTextSlot({
      schemaValue: schemaValue(asset, variant, "clothing", "outerwear"),
      fallbackText: stableText,
      hints: ["外套", "大衣", "夹克", "罩衫"],
      defaultValue: eraDefaultClothing(constraints.era).outerwear,
      source: "clothing.outerwear",
      constraints,
    }),
    accessories: compileTextSlot({
      schemaValue: schemaValue(asset, variant, "clothing", "accessories"),
      fallbackText: stableText,
      hints: ["轮椅", "拐杖", "眼镜", "帽", "发饰", "配饰", "包"],
      defaultValue: eraDefaultClothing(constraints.era).accessories,
      source: "clothing.accessories",
      constraints,
    }),
  };
}

function compileTextSlot(input: {
  schemaValue: unknown;
  fallbackText: string;
  hints: string[];
  defaultValue: string;
  source: string;
  constraints: { era: string; genre: string; visual_must_not_have: string[] };
  required?: boolean;
}): CompiledVisualSlot {
  const schemaText = visualSlotText(input.schemaValue);
  const picked = schemaText || pickByHints(input.fallbackText, input.hints);
  const source = schemaText
    ? `asset_variant_schema.${input.source}`
    : picked
      ? `asset.visualConstraints.${input.source}`
      : `constraint_injection.${input.source}`;
  const binding: BindingKind = schemaText ? "variant_bound" : picked ? "asset_bound" : "constraint_default";
  const sanitized = sanitizeVisualText(picked || input.defaultValue);
  const repaired = repairEraConflict(sanitized, input.defaultValue, input.constraints);
  return {
    ...slot(repaired.value, source, repaired.repaired ? "constraint_default" : binding, input.required),
    repaired: repaired.repaired || undefined,
    repairNote: repaired.repairNote,
  };
}

function compileConstraints(
  assetType: AssetPromptType,
  asset: AssetPromptAsset,
  variant: AssetPromptVariant | null,
  styleSpec: AssetStyleSpec,
  stableText: string,
) {
  const era = inferEraConstraint([
    styleSpec.eraConstraint,
    styleSpec.era,
    asset.visualSchema?.constraints?.era,
    variant?.visualSchema?.constraints?.era,
    stableText,
  ]);
  const genre = sanitizeVisualText(styleSpec.genre || asset.visualSchema?.constraints?.genre || "realistic Chinese short-drama asset reference");
  const visualMustNotHave = uniq([
    ...commonNegative(),
    ...eraForbiddenElements(era),
    ...arrayFrom(styleSpec.forbiddenVisualElements),
    ...arrayFrom(styleSpec.mustNotHave),
    ...arrayFrom(asset.visualSchema?.constraints?.mustNotHave),
    ...arrayFrom(variant?.visualSchema?.constraints?.mustNotHave),
    ...splitConstraintText(asset.negativeConstraints),
    ...splitConstraintText(variant?.negativeConstraints),
  ]);
  const typeRule = assetType === "character"
    ? SYSTEM_RULES.noCostumeInvention
    : assetType === "scene"
      ? "Do not turn the reusable scene reference into a plot frame."
      : "Do not turn the reusable prop reference into a held-object story frame.";
  return {
    era,
    genre: genre || "realistic Chinese short-drama asset reference",
    visual_must_not_have: visualMustNotHave,
    system_rules: uniq([SYSTEM_RULES.noStory, SYSTEM_RULES.respectBindings, typeRule]),
  };
}

function compileStyle(styleSpec: AssetStyleSpec, visualSpec: AssetVisualSpec): Record<string, CompiledVisualSlot> {
  return {
    visual_style: slot(styleSpec.style || "realistic live-action photography", "style_spec.style", "system_generated", true),
    lighting: slot(styleSpec.lighting || "studio soft light", "style_spec.lighting", "system_generated"),
    camera: slot(styleSpec.camera || "eye-level, 35mm film feel", "style_spec.camera", "system_generated"),
    texture: slot(styleSpec.texture || "natural skin texture, fabric texture", "style_spec.texture", "system_generated"),
    size: slot(visualSpec.size || "", "visual_spec.size", "system_generated"),
    aspect_ratio: slot(visualSpec.aspectRatio || "", "visual_spec.aspect_ratio", "system_generated"),
  };
}

function validateCompilerIR(ir: AssetCompilerIR): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const repairs = collectSlots(ir)
    .filter((slotItem) => slotItem.slot.repaired)
    .map((slotItem) => `${slotItem.path}: ${slotItem.slot.repairNote || "auto-repaired"}`);
  if (!clean(ir.constraints.genre)) errors.push("genre is empty");
  if (!clean(ir.constraints.era)) warnings.push("era is empty; compiler should inject an era default");
  const positiveText = collectSlots(ir).map((item) => item.slot.value).join(" ").toLowerCase();
  const forbiddenInPositive = ir.constraints.visual_must_not_have
    .filter((item) => item && containsForbiddenTerm(positiveText, item));
  if (forbiddenInPositive.length) {
    errors.push(`visual forbidden elements leaked into positive prompt: ${uniq(forbiddenInPositive).join(", ")}`);
  }
  if (ir.asset_type === "character") {
    for (const key of ["top", "bottom", "shoes"] as const) {
      if (!ir.clothing[key]?.value) errors.push(`missing required clothing slot: ${key}`);
    }
  }
  return {
    passed: errors.length === 0,
    errors,
    warnings,
    repairs,
    system_rules: ir.constraints.system_rules,
  };
}

function compileFinalPrompt(ir: AssetCompilerIR) {
  if (ir.asset_type === "character") return compileCharacterFinalPrompt(ir);
  if (ir.asset_type === "prop") return compilePropFinalPrompt(ir);
  return compileSceneFinalPrompt(ir);
}

function compileCharacterFinalPrompt(ir: AssetCompilerIR) {
  return [
    `${slotValue(ir.identity.subject)}, ${slotValue(ir.identity.age_range)}, ${slotValue(ir.identity.role_identity)}`.replace(/\s+,/g, ","),
    `Asset reference sheet for ${slotValue(ir.identity.name) || "the character"}, ${ir.constraints.genre}, ${ir.constraints.era}.`,
    `Appearance: ${joinValues([
      ir.appearance.face_shape,
      ir.appearance.skin_tone,
      ir.appearance.body_proportion,
      ir.appearance.hairstyle,
      ir.appearance.expression,
    ])}.`,
    `Clothing: ${joinValues([
      ir.clothing.top,
      ir.clothing.bottom,
      ir.clothing.shoes,
      ir.clothing.outerwear,
      ir.clothing.accessories,
    ])}.`,
    `Layout: ${joinValues([
      ir.pose_layout.background,
      ir.pose_layout.layout,
      ir.pose_layout.camera,
      ir.pose_layout.framing,
      ir.pose_layout.consistency,
    ])}.`,
    `Style: ${joinValues([
      ir.style.visual_style,
      ir.style.lighting,
      ir.style.camera,
      ir.style.texture,
      ir.style.aspect_ratio,
      ir.style.size,
    ])}.`,
    `Required visual constraints: ${ir.constraints.must_have.join(", ")}.`,
  ].filter((line) => clean(line).replace(/[,. ]/g, "")).join("\n");
}

function compilePropFinalPrompt(ir: AssetCompilerIR) {
  return [
    `Reusable prop asset reference for ${slotValue(ir.identity.name) || "the prop"}, ${slotValue(ir.identity.category)}, ${ir.constraints.genre}, ${ir.constraints.era}.`,
    `Prop design: ${joinValues([ir.prop.shape_material, ir.prop.condition])}.`,
    `Layout: ${joinValues([ir.pose_layout.background, ir.pose_layout.layout, ir.pose_layout.camera, ir.pose_layout.framing])}.`,
    `Style: ${joinValues([ir.style.visual_style, ir.style.lighting, ir.style.texture, ir.style.aspect_ratio, ir.style.size])}.`,
    `Required visual constraints: ${ir.constraints.must_have.join(", ")}.`,
  ].filter(Boolean).join("\n");
}

function compileSceneFinalPrompt(ir: AssetCompilerIR) {
  return [
    `Reusable empty scene environment reference for ${slotValue(ir.identity.name) || "the scene"}, ${slotValue(ir.identity.category)}, ${ir.constraints.genre}, ${ir.constraints.era}.`,
    `Environment design: ${joinValues([ir.scene.environment_design])}.`,
    `Layout: ${joinValues([ir.pose_layout.background, ir.pose_layout.layout, ir.pose_layout.camera, ir.pose_layout.framing])}.`,
    `Style: ${joinValues([ir.style.visual_style, ir.style.lighting, ir.style.texture, ir.style.aspect_ratio, ir.style.size])}.`,
    `Required visual constraints: ${ir.constraints.must_have.join(", ")}.`,
  ].filter(Boolean).join("\n");
}

function compileNegativePrompt(ir: AssetCompilerIR) {
  return renderNegativePrompt(ir.constraints.visual_must_not_have);
}

function bindingsFor(assetType: AssetPromptType, asset: AssetPromptAsset, variant: AssetPromptVariant | null) {
  const assetId = clean(asset.id) || "unbound_asset";
  const variantId = clean(variant?.id) || "base_variant";
  return {
    character_asset_id: assetType === "character" ? assetId : null,
    character_variant_id: assetType === "character" ? variantId : null,
    scene_asset_id: clean(asset.sceneAssetId) || (assetType === "scene" ? assetId : null),
    prop_asset_id: assetType === "prop" ? assetId : null,
    binding_rule: "IR-only binding: final prompt uses compiled visual values, while validator enforces binding provenance.",
  };
}

function stableVisualText(asset: AssetPromptAsset, variant?: AssetPromptVariant | null) {
  return [
    asset.prompt,
    asset.description,
    asset.visualConstraints,
    asset.visualHint,
    variant?.visualConstraints,
    variant?.description,
    variant?.state,
    variant?.editInstruction,
    compactChangedTraits(variant?.lockedTraits),
    compactChangedTraits(variant?.changedTraits),
  ].map((value) => sanitizeVisualText(value)).filter(Boolean).join("; ");
}

function sanitizeVisualText(value: unknown, maxLength = 420) {
  const text = clean(value)
    .replace(/\s+/g, " ")
    .split(/[。.!！？?]/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !NARRATIVE_PATTERNS.some((pattern) => pattern.test(sentence)))
    .join("; ");
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function schemaValue(
  asset: AssetPromptAsset,
  variant: AssetPromptVariant | null,
  group: keyof AssetVisualSchema,
  key: string,
) {
  const variantGroup = variant?.visualSchema?.[group];
  const assetGroup = asset.visualSchema?.[group];
  const variantValue = variantGroup && typeof variantGroup === "object" ? (variantGroup as Record<string, unknown>)[key] : undefined;
  const assetValue = assetGroup && typeof assetGroup === "object" ? (assetGroup as Record<string, unknown>)[key] : undefined;
  return variantValue ?? assetValue;
}

function visualSlotText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return sanitizeVisualText(value);
  if (typeof value === "number" || typeof value === "boolean") return sanitizeVisualText(String(value));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.value != null) return sanitizeVisualText(record.value);
    return sanitizeVisualText(Object.values(record).filter(Boolean).join("; "));
  }
  return "";
}

function repairEraConflict(value: string, defaultValue: string, constraints: { era: string; visual_must_not_have: string[] }) {
  const lower = value.toLowerCase();
  const conflict = constraints.visual_must_not_have.some((item) => lower.includes(item.toLowerCase()));
  return conflict
    ? {
        value: defaultValue,
        repaired: true,
        repairNote: `replaced era-conflicting value "${value}" with "${defaultValue}"`,
      }
    : { value, repaired: false, repairNote: undefined };
}

function pickByHints(text: string, hints: string[]) {
  return text
    .split(/[;；。.\n]/)
    .map((part) => part.trim())
    .find((part) => hints.some((hint) => part.includes(hint))) || "";
}

function pickGender(tags: string[], text: string) {
  const joined = `${tags.join(" ")} ${text}`;
  if (/女性|女人|女主|女孩|少女|姑娘/.test(joined)) return "female";
  if (/男性|男人|男主|男孩|少年/.test(joined)) return "male";
  return "";
}

function pickAge(tags: string[], text: string) {
  const joined = `${tags.join(" ")} ${text}`;
  if (/儿童|小孩|孩子/.test(joined)) return "child";
  if (/少年|少女|学生|年轻|青年/.test(joined)) return "young adult";
  if (/中年/.test(joined)) return "middle-aged";
  if (/老人|老年/.test(joined)) return "elderly";
  const match = joined.match(/\d{1,2}\s*岁/);
  return match?.[0] ?? "";
}

function characterSubject(gender: string, age: string) {
  const ageText = age === "young adult" ? "young " : age ? `${age} ` : "";
  if (gender === "female") return `Chinese ${ageText}woman`.replace(/\s+/g, " ").trim();
  if (gender === "male") return `Chinese ${ageText}man`.replace(/\s+/g, " ").trim();
  return `Chinese ${ageText}person`.replace(/\s+/g, " ").trim();
}

function faceTemplateText(asset: AssetPromptAsset) {
  if (!asset.faceTemplate) return "consistent face shape and facial features";
  return sanitizeVisualText([asset.faceTemplate.label, asset.faceTemplate.note].filter(Boolean).join("; "));
}

function inferEraConstraint(values: unknown[]) {
  const joined = values.map((value) => clean(value)).filter(Boolean).join(" ");
  const explicitYear = joined.match(/(19[0-9]{2}|20[0-9]{2})\s*年?/);
  if (explicitYear) return `${explicitYear[1]} China`;
  if (/末世|废土|末日|灾变|丧尸|避难所|重卡|荒凉/i.test(joined)) return "post-apocalyptic wasteland China";
  if (/八十年代|80年代|1980年代|1980s/i.test(joined)) return "1980s China";
  if (/七十年代|70年代|1970年代|1970s/i.test(joined)) return "1970s China";
  if (/九十年代|90年代|1990年代|1990s/i.test(joined)) return "1990s China";
  if (/民国/.test(joined)) return "Republican-era China";
  if (/古代|唐代|宋代|明代|清代|汉代|古风|仙侠|武侠/.test(joined)) return "historical China";
  if (/现代|当代|现实/.test(joined)) return "contemporary realistic China";
  return "realistic modern/civilian China unless asset schema explicitly states otherwise";
}

function eraForbiddenElements(era: string) {
  if (isHistoricalEra(era)) return FUTURE_OR_MODERN_TECH_FORBIDDEN;
  if (isLate20thCenturyChina(era)) return [...ANCIENT_FORBIDDEN, ...FUTURE_OR_MODERN_TECH_FORBIDDEN];
  if (/modern|contemporary|civilian|现实|现代|当代/i.test(era)) return ANCIENT_FORBIDDEN;
  return ANCIENT_FORBIDDEN;
}

function isHistoricalEra(era: string) {
  return /historical|ancient|唐|宋|明|清|汉|古代|古风|仙侠|武侠/i.test(era);
}

function isLate20thCenturyChina(era: string) {
  return /19[5-9][0-9]|1970|1980|1990|70s|80s|90s|七十年代|八十年代|九十年代/i.test(era);
}

function eraDefaultClothing(era: string) {
  if (/post-apocalyptic|wasteland|末世|废土/i.test(era)) {
    return {
      top: "post-apocalyptic survival workwear or tactical jacket, weathered fabric, practical layered clothing",
      bottom: "post-apocalyptic cargo pants or durable work trousers with utility details",
      shoes: "worn tactical boots or heavy-duty survival boots",
      outerwear: "dusty survival jacket, tactical vest, or reinforced workwear outer layer if needed",
      accessories: "survival utility belt, medical pouch, radio, gloves, or practical faction accessories only when fitting the role",
    };
  }
  if (/1983|1980|80s|八十年代/i.test(era)) {
    return {
      top: "1980s China plain civilian blouse or shirt, simple modern cut, cotton fabric",
      bottom: "1980s China simple trousers or modest knee-length skirt, civilian everyday styling",
      shoes: "1980s China plain cloth shoes or low leather shoes",
      outerwear: "simple 1980s civilian jacket if outerwear is needed",
      accessories: "simple 1980s civilian accessories only when explicitly defined",
    };
  }
  if (/1970|70s|七十年代/i.test(era)) {
    return {
      top: "1970s China plain civilian shirt or work jacket, simple modern cut",
      bottom: "1970s China straight trousers or plain skirt",
      shoes: "plain cloth shoes",
      outerwear: "simple work jacket only if outerwear is needed",
      accessories: "simple 1970s civilian accessories only when explicitly defined",
    };
  }
  if (/1990|90s|九十年代/i.test(era)) {
    return {
      top: "1990s China plain civilian blouse, shirt, or simple jacket",
      bottom: "1990s China simple trousers or skirt",
      shoes: "plain low shoes",
      outerwear: "simple 1990s jacket only if outerwear is needed",
      accessories: "simple 1990s civilian accessories only when explicitly defined",
    };
  }
  return {
    top: "plain realistic civilian top, modern cut",
    bottom: "plain realistic civilian trousers or skirt",
    shoes: "plain realistic low shoes",
    outerwear: "simple civilian outerwear only if needed",
    accessories: "simple realistic civilian accessories only when explicitly defined",
  };
}

function eraDefaultHairstyle(era: string) {
  if (/post-apocalyptic|wasteland|末世|废土/i.test(era)) return "practical post-apocalyptic hairstyle with realistic dust or fatigue when fitting the role";
  if (/1983|1980|80s|八十年代/i.test(era)) return "simple 1980s China everyday hairstyle";
  return "realistic everyday hairstyle consistent across all views";
}

function containsForbiddenTerm(text: string, term: string) {
  const lowerTerm = term.toLowerCase().trim();
  if (!lowerTerm) return false;
  if (/^[a-z0-9 ]+$/i.test(lowerTerm)) {
    const escaped = lowerTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(text);
  }
  return text.includes(lowerTerm);
}

function collectSlots(ir: AssetCompilerIR) {
  const groups = {
    identity: ir.identity,
    appearance: ir.appearance,
    clothing: ir.clothing,
    prop: ir.prop,
    scene: ir.scene,
    pose_layout: ir.pose_layout,
    style: ir.style,
  };
  return Object.entries(groups).flatMap(([groupName, group]) =>
    Object.entries(group).map(([key, slotItem]) => ({
      path: `${groupName}.${key}`,
      slot: slotItem as CompiledVisualSlot,
    })),
  ).filter((item) => item.slot);
}

function slotValue(slotItem?: CompiledVisualSlot) {
  return clean(slotItem?.value);
}

function joinValues(values: Array<CompiledVisualSlot | undefined>) {
  return values.map(slotValue).filter(Boolean).join(", ");
}

function arrayFrom(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => sanitizeVisualText(item)).filter(Boolean);
  return splitConstraintText(value);
}

function splitConstraintText(value: unknown) {
  return String(value ?? "")
    .split(/[,，;；\n]/)
    .map((item) => sanitizeVisualText(item))
    .filter(Boolean);
}

function compactChangedTraits(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function commonNegative() {
  return [
    "text",
    "logo",
    "watermark",
    "UI",
    "subtitle",
    "caption",
    "extra limbs",
    "extra fingers",
    "distorted anatomy",
    "low resolution",
  ];
}

function renderNegativePrompt(values: unknown[]) {
  return uniq(values.flatMap((value) => String(value ?? "").split(/[,，\n]/)))
    .map((item) => sanitizeVisualText(item))
    .filter(Boolean)
    .join(", ");
}

function slot(value: unknown, source: string, binding: BindingKind, required = false): CompiledVisualSlot {
  return {
    source,
    value: sanitizeVisualText(value),
    binding,
    required,
  };
}

function normalizeAssetType(type: AssetPromptType): AssetPromptType {
  return type === "character" || type === "prop" || type === "scene" ? type : "character";
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function uniq(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
