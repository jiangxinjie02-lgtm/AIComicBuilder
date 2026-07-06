import { id as genId } from "@/lib/id";

export type StoryboardAssetType = "character" | "scene" | "prop";
export type StoryboardValidationSeverity = "error" | "warning";
export type StoryboardFrameStatus = "ready" | "needs_review" | "invalid";

export interface StoryboardAssetInput {
  id: string;
  type: StoryboardAssetType;
  name: string;
  description?: string | null;
  visualConstraints?: string | null;
  negativeConstraints?: string | null;
  referenceImage?: string | null;
}

export interface StoryboardAssetVariantInput {
  id: string;
  assetId: string;
  name?: string | null;
  variantType?: string | null;
  state?: string | null;
  lockedTraits?: unknown;
  changedTraits?: unknown;
  visualConstraints?: string | null;
  negativeConstraints?: string | null;
  referenceImage?: string | null;
  status?: string | null;
}

export interface StoryboardVisualAssetInput {
  asset_id?: string | null;
  assetId?: string | null;
  variant_id?: string | null;
  variantId?: string | null;
  url?: string | null;
  imageUrl?: string | null;
  fileUrl?: string | null;
  referenceImage?: string | null;
  role?: string | null;
  status?: string | null;
}

export interface StoryboardProductionBibleInput {
  title?: string | null;
  worldSetting?: string | null;
  visualStyle?: string | null;
  eraConstraints?: string | null;
  locationRules?: string | null;
  characterRules?: string | null;
  sceneRules?: string | null;
  propRules?: string | null;
  positivePromptTemplate?: string | null;
  negativePromptTemplate?: string | null;
  complianceRules?: string | null;
  metadata?: unknown;
}

export interface StoryboardBoundAsset {
  asset_type: StoryboardAssetType;
  asset_id: string;
  variant_id: string;
  name: string;
  variant_name: string;
  reference_image: string;
  visual_summary: string;
}

export interface StoryboardAssetBindings {
  characters: StoryboardBoundAsset[];
  scene: StoryboardBoundAsset | null;
  props: StoryboardBoundAsset[];
}

export interface StoryboardValidationIssue {
  severity: StoryboardValidationSeverity;
  code: string;
  message: string;
  field?: string;
  suggestion?: string;
}

export interface StoryboardValidationReport {
  validator: "storyboard_prompt_validator_v1";
  valid: boolean;
  status: StoryboardFrameStatus;
  errors: StoryboardValidationIssue[];
  warnings: StoryboardValidationIssue[];
  auto_fixes: string[];
}

export interface StoryboardFrameSpec {
  frame_id: string;
  shot_id: string;
  episode_id: string;
  scene_id: string;
  frame_description: string;
  composition: string;
  camera: {
    shot_size: string;
    angle: string;
    movement_metadata: string;
    static_view: string;
  };
  asset_bindings: StoryboardAssetBindings;
  dialogue_metadata: {
    dialogue: string;
    voiceover: string;
  };
  sound_metadata: {
    sound: string;
    duration: string;
  };
  positive_prompt: string;
  negative_prompt: string;
  generation_params: {
    frame_role: "storyboard";
    reference_images: string[];
    reference_labels: string[];
    aspect_ratio: string;
    quality: string;
    seed_policy: string;
  };
  validation: StoryboardValidationReport;
  status: StoryboardFrameStatus;
}

export interface StoryboardCompilerInput {
  locked_shots: unknown[];
  assets?: unknown[];
  assetVariants?: unknown[];
  visualAssets?: unknown[];
  productionBible?: StoryboardProductionBibleInput | null;
  generationParams?: Partial<StoryboardFrameSpec["generation_params"]>;
}

export interface StoryboardCompilerResult {
  compiler: "storyboard_prompt_compiler_v1";
  storyboard_frames: StoryboardFrameSpec[];
  summary: {
    total: number;
    ready: number;
    needs_review: number;
    invalid: number;
    errors: number;
    warnings: number;
  };
}

interface NormalizedShotRef {
  asset_id: string;
  variant_id: string;
}

interface NormalizedShot {
  shot_id: string;
  episode_id: string;
  scene_id: string;
  shot_type: string;
  frame_description: string;
  action: string;
  emotion: string;
  composition: string;
  camera: {
    shot_size: string;
    angle: string;
    movement: string;
    composition: string;
  };
  characters: NormalizedShotRef[];
  scene_asset: NormalizedShotRef | null;
  props: NormalizedShotRef[];
  dialogue: string;
  voiceover: string;
  sound: string;
  duration: string;
  lock_status: string;
}

interface CompilerLookup {
  assetsById: Map<string, StoryboardAssetInput>;
  variantsById: Map<string, StoryboardAssetVariantInput>;
  variantsByAssetId: Map<string, StoryboardAssetVariantInput[]>;
  visualAssets: StoryboardVisualAssetInput[];
}

const VISUAL_NEGATIVE_TERMS = [
  "extra people",
  "unbound characters",
  "subtitles",
  "captions",
  "dialogue text",
  "sound effect text",
  "on-screen text",
  "logo",
  "watermark",
  "UI",
  "timer",
  "video controls",
  "explicit gore",
  "graphic injury",
  "visible blood",
  "mutilation",
  "severed limbs",
  "corpse close-up",
  "hanfu",
  "ancient costume",
  "fantasy clothing",
  "modern neon tech",
  "LED screen",
  "smartphone",
  "cropped head",
  "cropped feet",
  "distorted hands",
];

const HIGH_RISK_PATTERNS = [
  /被撞飞|撞飞|撞向|碾过|鲜血|血红|血肉|断肢|内脏|去死|彻底垂下|死亡|尸体/,
  /\b(hit by|crash into|blood|bloody|gore|graphic injury|corpse|dead body|mutilation)\b/i,
];

const SOUND_PATTERNS = [
  /音效|雨声|雨刷器|轮胎摩擦|尖锐声|声音|配音|旁白/,
  /\bSFX\b|\bsound effect\b|\baudio cue\b|\brain sound\b|\bvoiceover\b/i,
];

const DURATION_PATTERNS = [
  /\d+\s*(秒|分钟)/,
  /\b\d+\s*(s|sec|secs|second|seconds|min|mins|minute|minutes)\b/i,
];

const DIALOGUE_PATTERNS = [
  /台词|对白|字幕|字幕条|尖叫道|喊道|说道|说：|喊：|尖叫：/,
  /\bsubtitle\b|\bcaption\b|\bdialogue\b|\bsays\b|\bshouts\b|\bscreams\b/i,
];

const CONTINUOUS_ACTION_PATTERNS = [
  /然后|随后|接着|之后|最终|同时|扬长而去|被撞飞.*摔|撞向.*摔/,
  /\bthen\b|\bafterward\b|\bfinally\b|\band then\b|\bdrives away\b|\bfalls?.+gets?\b/i,
];

const CAMERA_MOVEMENT_PATTERNS = [
  /运镜|推进|拉远|摇移|跟拍|甩镜|环绕/,
  /\bdolly\b|\btracking\b|\bpan\b|\btilt\b|\bzoom\b|\bcrane\b|\bcamera movement\b/i,
];

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function compact(value: unknown, maxLength = 420) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeAsset(value: unknown): StoryboardAssetInput | null {
  const record = toRecord(value);
  const id = readString(record, ["id", "asset_id", "assetId"]);
  const type = readString(record, ["type", "asset_type", "assetType"]);
  const name = readString(record, ["name", "asset_name", "assetName"]);
  if (!id || !name || (type !== "character" && type !== "scene" && type !== "prop")) return null;
  return {
    id,
    type,
    name,
    description: readString(record, ["description"]),
    visualConstraints: readString(record, ["visualConstraints", "visual_constraints"]),
    negativeConstraints: readString(record, ["negativeConstraints", "negative_constraints"]),
    referenceImage: readString(record, ["referenceImage", "reference_image", "imageUrl", "fileUrl"]),
  };
}

function normalizeVariant(value: unknown): StoryboardAssetVariantInput | null {
  const record = toRecord(value);
  const id = readString(record, ["id", "variant_id", "variantId"]);
  const assetId = readString(record, ["assetId", "asset_id"]);
  if (!id || !assetId) return null;
  return {
    id,
    assetId,
    name: readString(record, ["name", "variant_name", "variantName"]),
    variantType: readString(record, ["variantType", "variant_type"]),
    state: readString(record, ["state"]),
    lockedTraits: record.lockedTraits ?? record.locked_traits,
    changedTraits: record.changedTraits ?? record.changed_traits,
    visualConstraints: readString(record, ["visualConstraints", "visual_constraints"]),
    negativeConstraints: readString(record, ["negativeConstraints", "negative_constraints"]),
    referenceImage: readString(record, ["referenceImage", "reference_image", "imageUrl", "fileUrl"]),
    status: readString(record, ["status"]),
  };
}

function normalizeVisualAsset(value: unknown): StoryboardVisualAssetInput | null {
  const record = toRecord(value);
  const assetId = readString(record, ["asset_id", "assetId"]);
  const url = readString(record, ["url", "imageUrl", "fileUrl", "referenceImage", "reference_image"]);
  if (!assetId || !url) return null;
  return {
    asset_id: assetId,
    variant_id: readString(record, ["variant_id", "variantId"]),
    url,
    role: readString(record, ["role", "type"]),
    status: readString(record, ["status"]),
  };
}

function buildLookup(input: StoryboardCompilerInput): CompilerLookup {
  const normalizedAssets = (input.assets ?? []).map(normalizeAsset).filter((asset): asset is StoryboardAssetInput => Boolean(asset));
  const normalizedVariants = (input.assetVariants ?? [])
    .map(normalizeVariant)
    .filter((variant): variant is StoryboardAssetVariantInput => Boolean(variant));
  const variantsByAssetId = new Map<string, StoryboardAssetVariantInput[]>();
  for (const variant of normalizedVariants) {
    const list = variantsByAssetId.get(variant.assetId) ?? [];
    list.push(variant);
    variantsByAssetId.set(variant.assetId, list);
  }

  return {
    assetsById: new Map(normalizedAssets.map((asset) => [asset.id, asset])),
    variantsById: new Map(normalizedVariants.map((variant) => [variant.id, variant])),
    variantsByAssetId,
    visualAssets: (input.visualAssets ?? [])
      .map(normalizeVisualAsset)
      .filter((asset): asset is StoryboardVisualAssetInput => Boolean(asset)),
  };
}

function chooseBaseVariant(assetId: string, lookup: CompilerLookup) {
  const variants = lookup.variantsByAssetId.get(assetId) ?? [];
  return variants.find((variant) => variant.variantType === "default")
    ?? variants.find((variant) => /default|base|基础/i.test(`${variant.name ?? ""} ${variant.variantType ?? ""}`))
    ?? variants.find((variant) => /locked|approved|generated/i.test(variant.status ?? ""))
    ?? variants[0]
    ?? null;
}

function normalizeShotRef(value: unknown, lookup: CompilerLookup): NormalizedShotRef | null {
  if (typeof value === "string") {
    const variant = chooseBaseVariant(value, lookup);
    return { asset_id: value, variant_id: variant?.id ?? "" };
  }

  const record = toRecord(value);
  const assetId = readString(record, ["asset_id", "assetId", "id"]);
  if (!assetId) return null;
  const explicitVariantId = readString(record, ["variant_id", "variantId"]);
  const variant = explicitVariantId ? lookup.variantsById.get(explicitVariantId) : chooseBaseVariant(assetId, lookup);
  return {
    asset_id: assetId,
    variant_id: variant?.id ?? explicitVariantId,
  };
}

function normalizeShotRefArray(value: unknown, lookup: CompilerLookup) {
  const values = Array.isArray(value) ? value : [];
  return values
    .map((item) => normalizeShotRef(item, lookup))
    .filter((item): item is NormalizedShotRef => Boolean(item));
}

function readStringArray(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value.map((item) => String(item ?? "").trim()).filter(Boolean);
    if (typeof value === "string" && value.trim()) {
      const trimmed = value.trim();
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) return parsed.map((item) => String(item ?? "").trim()).filter(Boolean);
        } catch {
          return [];
        }
      }
      return trimmed.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function normalizeCamera(value: unknown, record: Record<string, unknown>) {
  const camera = toRecord(value);
  return {
    shot_size: readString(camera, ["shot_size", "shotSize", "size"]) || readString(record, ["shot_type", "shotType", "shot_size", "shotSize"]),
    angle: readString(camera, ["angle", "cameraAngle"]) || readString(record, ["camera_angle", "cameraAngle"]),
    movement: readString(camera, ["movement", "cameraMovement"]) || readString(record, ["camera_movement", "cameraMovement", "cameraDirection"]),
    composition: readString(camera, ["composition", "compositionGuide"]) || readString(record, ["composition", "compositionGuide"]),
  };
}

function normalizeLockedShot(value: unknown, index: number, lookup: CompilerLookup): NormalizedShot {
  const record = toRecord(value);
  const camera = normalizeCamera(record.camera, record);
  const characterLegacyIds = readStringArray(record, ["character_asset_ids", "characterAssetIds", "character_ids", "characterIds"]);
  const propLegacyIds = readStringArray(record, ["prop_asset_ids", "propAssetIds", "prop_ids", "propIds"]);
  const action = readString(record, ["action", "motionScript", "motion_script"]);
  const prompt = readString(record, ["frame_description", "frameDescription", "startFrame", "prompt", "source_text", "sourceText"]);
  const sceneAsset = normalizeShotRef(record.scene_asset ?? record.sceneAsset, lookup)
    ?? normalizeShotRef(readString(record, ["scene_asset_id", "sceneAssetId"]), lookup);

  return {
    shot_id: readString(record, ["shot_id", "shotId", "id"]) || `shot_${String(index + 1).padStart(3, "0")}`,
    episode_id: readString(record, ["episode_id", "episodeId"]),
    scene_id: readString(record, ["scene_id", "sceneId"]),
    shot_type: readString(record, ["shot_type", "shotType", "shot_role", "shotRole"]),
    frame_description: prompt || action,
    action,
    emotion: readString(record, ["emotion", "focalPoint"]),
    composition: readString(record, ["composition", "compositionGuide"]) || camera.composition,
    camera,
    characters: [
      ...normalizeShotRefArray(record.characters, lookup),
      ...characterLegacyIds.map((assetId) => ({ asset_id: assetId, variant_id: chooseBaseVariant(assetId, lookup)?.id ?? "" })),
    ],
    scene_asset: sceneAsset,
    props: [
      ...normalizeShotRefArray(record.props, lookup),
      ...propLegacyIds.map((assetId) => ({ asset_id: assetId, variant_id: chooseBaseVariant(assetId, lookup)?.id ?? "" })),
    ],
    dialogue: readString(record, ["dialogue", "dialogues"]),
    voiceover: readString(record, ["voiceover", "voiceOver"]),
    sound: readString(record, ["sound", "soundDesign", "sound_design", "sound_effects", "soundEffects", "musicCue", "music_cue"]),
    duration: readString(record, ["duration"]),
    lock_status: readString(record, ["lock_status", "lockStatus"]),
  };
}

function extractMetadataGenre(bible?: StoryboardProductionBibleInput | null) {
  const metadata = toRecord(bible?.metadata);
  const genre = readString(metadata, ["genre", "styleGenre", "storyGenre"]);
  return compact(genre || bible?.visualStyle || "realistic Chinese short-drama storyboard", 160);
}

function extractEra(bible?: StoryboardProductionBibleInput | null) {
  const metadata = toRecord(bible?.metadata);
  const era = readString(metadata, ["era", "period", "time", "year"]);
  return compact(era || bible?.eraConstraints || "period-accurate China, no modern drift", 180);
}

function stripDialogueAndStageText(text: string) {
  return text
    .replace(/\[[^\]]*(音效|SFX|sound)[^\]]*\]/gi, " ")
    .replace(/【[^】]*(音效|SFX|sound)[^】]*】/gi, " ")
    .replace(/[^。！？.!?]{0,16}(说|喊|尖叫|低声|怒吼)[：:][^。！？.!?]+[。！？.!?]?/g, " ")
    .replace(/[“"][^”"]{2,80}[”"]/g, " ");
}

function compressToStaticMoment(text: string) {
  const stripped = stripDialogueAndStageText(compact(text, 520));
  const parts = stripped
    .split(/然后|随后|接着|之后|最终|同时|\bthen\b|\bafterward\b|\bfinally\b|\band then\b/i)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[0] || stripped;
}

function softenHighRiskFrame(text: string) {
  const value = compressToStaticMoment(text);
  if (!HIGH_RISK_PATTERNS.some((pattern) => pattern.test(value))) return compact(value, 300);
  return "A tense non-graphic aftermath key frame: rain-soaked roadside, the character at the edge of muddy water, blurred vision and oppressive dark red atmosphere, no visible gore, no explicit impact moment";
}

function bindingReferenceImage(assetId: string, variantId: string, lookup: CompilerLookup) {
  const visualExact = lookup.visualAssets.find((asset) =>
    (asset.asset_id || asset.assetId) === assetId &&
    (asset.variant_id || asset.variantId || "") === variantId &&
    (asset.url || asset.imageUrl || asset.fileUrl || asset.referenceImage)
  );
  if (visualExact) return visualExact.url || visualExact.imageUrl || visualExact.fileUrl || visualExact.referenceImage || "";

  const variant = variantId ? lookup.variantsById.get(variantId) : null;
  if (variant?.referenceImage) return variant.referenceImage;

  const asset = lookup.assetsById.get(assetId);
  if (asset?.referenceImage) return asset.referenceImage;

  const visualAsset = lookup.visualAssets.find((item) =>
    (item.asset_id || item.assetId) === assetId &&
    (item.url || item.imageUrl || item.fileUrl || item.referenceImage)
  );
  return visualAsset?.url || visualAsset?.imageUrl || visualAsset?.fileUrl || visualAsset?.referenceImage || "";
}

function describeTraits(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return compact(value, 180);
  if (Array.isArray(value)) return compact(value.map((item) => String(item)).join(", "), 180);
  if (typeof value === "object") {
    return compact(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => `${key}: ${String(item)}`)
        .join(", "),
      180,
    );
  }
  return "";
}

function bindAsset(ref: NormalizedShotRef, expectedType: StoryboardAssetType, lookup: CompilerLookup): StoryboardBoundAsset {
  const asset = lookup.assetsById.get(ref.asset_id);
  const variant = ref.variant_id ? lookup.variantsById.get(ref.variant_id) : chooseBaseVariant(ref.asset_id, lookup);
  const referenceImage = bindingReferenceImage(ref.asset_id, variant?.id ?? ref.variant_id, lookup);
  const summary = [
    asset?.description,
    asset?.visualConstraints,
    variant?.state,
    variant?.visualConstraints,
    describeTraits(variant?.lockedTraits),
    describeTraits(variant?.changedTraits),
  ].filter(Boolean).join("; ");

  return {
    asset_type: asset?.type ?? expectedType,
    asset_id: ref.asset_id,
    variant_id: variant?.id ?? ref.variant_id,
    name: asset?.name ?? ref.asset_id,
    variant_name: variant?.name ?? "base_variant",
    reference_image: referenceImage,
    visual_summary: compact(summary, 320),
  };
}

function buildBindings(shot: NormalizedShot, lookup: CompilerLookup): StoryboardAssetBindings {
  return {
    characters: shot.characters.map((ref) => bindAsset(ref, "character", lookup)),
    scene: shot.scene_asset ? bindAsset(shot.scene_asset, "scene", lookup) : null,
    props: shot.props.map((ref) => bindAsset(ref, "prop", lookup)),
  };
}

function staticCamera(shot: NormalizedShot) {
  const shotSize = shot.camera.shot_size || shot.shot_type || "storyboard key frame";
  const angle = shot.camera.angle || "eye-level";
  const composition = shot.composition || shot.camera.composition || "clear readable single-frame composition";
  return {
    shot_size: shotSize,
    angle,
    movement_metadata: shot.camera.movement,
    static_view: `${shotSize}, ${angle}, ${composition}, frozen single key moment`,
  };
}

function buildComposition(shot: NormalizedShot, frameDescription: string) {
  return compact(shot.composition || shot.camera.composition || `${shot.shot_type || "single"} composition focused on: ${frameDescription}`, 260);
}

function bindingLine(label: string, binding: StoryboardBoundAsset | null) {
  if (!binding) return "";
  const traits = binding.visual_summary ? ` Visual identity: ${binding.visual_summary}.` : "";
  return `${label}: ${binding.name}, variant ${binding.variant_name}. Use its supplied reference image as strict visual identity.${traits}`;
}

function buildPositivePrompt(input: {
  shot: NormalizedShot;
  frameDescription: string;
  composition: string;
  camera: StoryboardFrameSpec["camera"];
  bindings: StoryboardAssetBindings;
  bible?: StoryboardProductionBibleInput | null;
}) {
  const genre = extractMetadataGenre(input.bible);
  const era = extractEra(input.bible);
  const style = compact(input.bible?.visualStyle || "realistic live-action Chinese short-drama still, natural lighting, cinematic production design", 240);
  const characterLines = input.bindings.characters.map((binding, index) => bindingLine(`Character ${index + 1}`, binding));
  const propLines = input.bindings.props.map((binding, index) => bindingLine(`Prop ${index + 1}`, binding));
  const actionMoment = softenHighRiskFrame(input.shot.action || input.frameDescription);
  const emotion = input.shot.emotion ? `Visible emotion: ${compact(input.shot.emotion, 120)}.` : "";
  const bibleTemplate = compact(input.bible?.positivePromptTemplate, 240);

  return [
    "Storyboard key frame image, one static still frame, not a video prompt.",
    `Genre and era: ${genre}; ${era}.`,
    `Style: ${style}.`,
    bibleTemplate && `Production visual rule: ${bibleTemplate}.`,
    `Static frame: ${input.frameDescription}.`,
    `Key action moment: ${actionMoment}.`,
    emotion,
    `Composition: ${input.composition}.`,
    `Camera: ${input.camera.static_view}.`,
    bindingLine("Scene", input.bindings.scene),
    ...characterLines,
    ...propLines,
    "Use all supplied reference images as authoritative visual references for character identity, wardrobe, scene design, and props.",
    "No subtitles, no captions, no dialogue text, no sound effect text, no UI.",
  ].filter(Boolean).join("\n");
}

function buildNegativePrompt(input: {
  bindings: StoryboardAssetBindings;
  bible?: StoryboardProductionBibleInput | null;
}) {
  const bindingNegatives = [
    input.bindings.scene?.visual_summary,
    ...input.bindings.characters.map((binding) => binding.visual_summary),
    ...input.bindings.props.map((binding) => binding.visual_summary),
  ].join(" ");
  const bibleNegative = compact(input.bible?.negativePromptTemplate, 260);
  const extraNegatives = /1980|1983|八十|80年代|1980s/i.test(`${extractEra(input.bible)} ${bindingNegatives}`)
    ? ["contemporary fashion", "modern car interior screens", "modern street signage", "ancient hairstyle"]
    : [];

  return unique([
    ...VISUAL_NEGATIVE_TERMS,
    ...extraNegatives,
    bibleNegative,
  ]).join(", ");
}

function issue(
  severity: StoryboardValidationSeverity,
  code: string,
  message: string,
  field?: string,
  suggestion?: string,
): StoryboardValidationIssue {
  return { severity, code, message, field, suggestion };
}

function matchesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function hasReferenceImages(bindings: StoryboardAssetBindings) {
  const all = [
    ...bindings.characters,
    ...(bindings.scene ? [bindings.scene] : []),
    ...bindings.props,
  ];
  return all.every((binding) => Boolean(binding.reference_image));
}

export function validateStoryboardFrame(frame: Omit<StoryboardFrameSpec, "validation" | "status">): StoryboardValidationReport {
  const errors: StoryboardValidationIssue[] = [];
  const warnings: StoryboardValidationIssue[] = [];
  const autoFixes: string[] = [];
  const positive = frame.positive_prompt;
  const frameText = frame.frame_description;

  if (matchesAny(positive, SOUND_PATTERNS)) {
    errors.push(issue("error", "sound_metadata_in_positive_prompt", "Positive prompt contains sound or audio wording.", "positive_prompt", "Move sound effects to sound_metadata only."));
  }
  if (matchesAny(positive, DURATION_PATTERNS)) {
    errors.push(issue("error", "duration_in_positive_prompt", "Positive prompt contains duration wording.", "positive_prompt", "Keep duration only in sound_metadata or later video generation."));
  }
  if (matchesAny(positive, DIALOGUE_PATTERNS)) {
    errors.push(issue("error", "dialogue_or_subtitle_in_positive_prompt", "Positive prompt contains dialogue, subtitles, or speech wording.", "positive_prompt", "Keep dialogue in dialogue_metadata only."));
  }
  if (matchesAny(frameText, CONTINUOUS_ACTION_PATTERNS)) {
    warnings.push(issue("warning", "frame_description_continuous_action", "frame_description may contain multiple continuous actions.", "frame_description", "Compress the shot into one static key moment."));
  }
  if (matchesAny(positive, CAMERA_MOVEMENT_PATTERNS)) {
    errors.push(issue("error", "camera_movement_in_positive_prompt", "Positive prompt contains camera movement wording.", "positive_prompt", "Keep camera movement as metadata and compile only a static view."));
  }
  if (!hasReferenceImages(frame.asset_bindings)) {
    errors.push(issue("error", "missing_asset_reference_image", "One or more bound assets do not have a reference image.", "asset_bindings", "Generate or attach asset reference images before storyboard image generation."));
  }
  if (matchesAny(positive, HIGH_RISK_PATTERNS)) {
    errors.push(issue("error", "explicit_gore_or_graphic_injury", "Positive prompt still contains explicit violence or gore wording.", "positive_prompt", "Use a softened non-graphic aftermath key frame."));
  }
  if (!frameText || frameText.length < 8) {
    errors.push(issue("error", "missing_static_frame_description", "frame_description is missing or too short.", "frame_description", "Provide one concrete static visual sentence."));
  }

  if (matchesAny(frameText, HIGH_RISK_PATTERNS)) {
    autoFixes.push("Softened high-risk violence into non-graphic storyboard aftermath language.");
  }
  if (frame.camera.movement_metadata) {
    autoFixes.push("Moved camera movement out of positive_prompt and kept it as movement_metadata.");
  }
  if (frame.dialogue_metadata.dialogue || frame.dialogue_metadata.voiceover) {
    autoFixes.push("Moved dialogue and voiceover out of positive_prompt and kept them as metadata.");
  }
  if (frame.sound_metadata.sound || frame.sound_metadata.duration) {
    autoFixes.push("Moved sound and duration out of positive_prompt and kept them as metadata.");
  }

  const status: StoryboardFrameStatus = errors.length > 0 ? "invalid" : warnings.length > 0 ? "needs_review" : "ready";
  return {
    validator: "storyboard_prompt_validator_v1",
    valid: errors.length === 0,
    status,
    errors,
    warnings,
    auto_fixes: unique(autoFixes),
  };
}

export function compileStoryboardFrames(input: StoryboardCompilerInput): StoryboardCompilerResult {
  const lookup = buildLookup(input);
  const lockedShots = input.locked_shots
    .map((shot, index) => normalizeLockedShot(shot, index, lookup))
    .filter((shot) => !shot.lock_status || shot.lock_status === "locked");

  const storyboardFrames = lockedShots.map((shot): StoryboardFrameSpec => {
    const frameDescription = softenHighRiskFrame(shot.frame_description || shot.action);
    const composition = buildComposition(shot, frameDescription);
    const camera = staticCamera(shot);
    const bindings = buildBindings(shot, lookup);
    const positivePrompt = buildPositivePrompt({
      shot,
      frameDescription,
      composition,
      camera,
      bindings,
      bible: input.productionBible,
    });
    const negativePrompt = buildNegativePrompt({ bindings, bible: input.productionBible });
    const referenceBindings = [
      ...bindings.characters,
      ...(bindings.scene ? [bindings.scene] : []),
      ...bindings.props,
    ];
    const frameBase = {
      frame_id: `frame_${genId()}`,
      shot_id: shot.shot_id,
      episode_id: shot.episode_id,
      scene_id: shot.scene_id,
      frame_description: frameDescription,
      composition,
      camera,
      asset_bindings: bindings,
      dialogue_metadata: {
        dialogue: shot.dialogue,
        voiceover: shot.voiceover,
      },
      sound_metadata: {
        sound: shot.sound,
        duration: shot.duration,
      },
      positive_prompt: positivePrompt,
      negative_prompt: negativePrompt,
      generation_params: {
        frame_role: "storyboard" as const,
        reference_images: unique(referenceBindings.map((binding) => binding.reference_image)),
        reference_labels: referenceBindings.map((binding) => binding.name),
        aspect_ratio: input.generationParams?.aspect_ratio ?? "16:9",
        quality: input.generationParams?.quality ?? "hd",
        seed_policy: input.generationParams?.seed_policy ?? "deterministic_by_shot_id",
      },
    };
    const validation = validateStoryboardFrame(frameBase);
    return {
      ...frameBase,
      validation,
      status: validation.status,
    };
  });

  return {
    compiler: "storyboard_prompt_compiler_v1",
    storyboard_frames: storyboardFrames,
    summary: {
      total: storyboardFrames.length,
      ready: storyboardFrames.filter((frame) => frame.status === "ready").length,
      needs_review: storyboardFrames.filter((frame) => frame.status === "needs_review").length,
      invalid: storyboardFrames.filter((frame) => frame.status === "invalid").length,
      errors: storyboardFrames.reduce((sum, frame) => sum + frame.validation.errors.length, 0),
      warnings: storyboardFrames.reduce((sum, frame) => sum + frame.validation.warnings.length, 0),
    },
  };
}
