import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().default(""),
  title: text("title").notNull(),
  idea: text("idea").default(""),
  script: text("script").default(""),
  outline: text("outline").default(""),
  status: text("status", {
    enum: ["draft", "processing", "completed"],
  })
    .notNull()
    .default("draft"),
  finalVideoUrl: text("final_video_url"),
  generationMode: text('generation_mode', { enum: ['keyframe', 'reference'] }).notNull().default('keyframe'),
  useProjectPrompts: integer("use_project_prompts").notNull().default(0),
  colorPalette: text("color_palette").default(""),
  worldSetting: text("world_setting").default(""),
  targetDuration: integer("target_duration").default(0),
  bgmUrl: text("bgm_url").default(""),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const episodes = sqliteTable("episodes", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  sequence: integer("sequence").notNull(),
  idea: text("idea").default(""),
  script: text("script").default(""),
  outline: text("outline").default(""),
  status: text("status", {
    enum: ["draft", "processing", "completed"],
  })
    .notNull()
    .default("draft"),
  generationMode: text("generation_mode", { enum: ["keyframe", "reference"] })
    .notNull()
    .default("keyframe"),
  description: text("description").default(""),
  keywords: text("keywords").default(""),
  scriptHash: text("script_hash").default(""),
  colorPalette: text("color_palette").default(""),
  targetDuration: integer("target_duration").default(0),
  bgmUrl: text("bgm_url").default(""),
  finalVideoUrl: text("final_video_url"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const characters = sqliteTable("characters", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").default(""),
  visualHint: text("visual_hint").default(""),
  referenceImage: text("reference_image"),
  referenceImageHistory: text("reference_image_history").default("[]"),
  scope: text("scope", { enum: ["main", "guest"] }).notNull().default("main"),
  performanceStyle: text("performance_style").default(""),
  heightCm: integer("height_cm").default(0),
  bodyType: text("body_type").default("average"),
  isStale: integer("is_stale").notNull().default(0),
  episodeId: text("episode_id").references(() => episodes.id, {
    onDelete: "cascade",
  }),
});

export const episodeCharacters = sqliteTable("episode_characters", {
  id: text("id").primaryKey(),
  episodeId: text("episode_id")
    .notNull()
    .references(() => episodes.id, { onDelete: "cascade" }),
  characterId: text("character_id")
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),
});

export const storyboardVersions = sqliteTable("storyboard_versions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  versionNum: integer("version_num").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  episodeId: text("episode_id").references(() => episodes.id, {
    onDelete: "cascade",
  }),
});

export const scenes = sqliteTable("scenes", {
  id: text("id").primaryKey(),
  episodeId: text("episode_id")
    .notNull()
    .references(() => episodes.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull().default(""),
  description: text("description").default(""),
  lighting: text("lighting").default(""),
  colorPalette: text("color_palette").default(""),
  sequence: integer("sequence").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * Unified per-shot asset table.
 * One row = one generated artifact (image prompt+file, or video file) bound
 * to a specific shot via shot_id. The `type` column discriminates which
 * generation mode it belongs to:
 *   - 'first_frame' / 'last_frame'  → keyframe mode image assets
 *   - 'reference'                   → reference mode image assets
 *   - 'keyframe_video'              → keyframe mode video output
 *   - 'reference_video'             → reference mode video output
 *
 * Versioning: regenerating the same asset inserts a new row with
 * (asset_version + 1, is_active=1) and flips the previous active row to
 * is_active=0. Active row = "current"; older rows = history.
 *
 * Two modes coexist freely on the same shot — they live in different rows
 * with different `type` values and never collide.
 */
export const shotAssets = sqliteTable("shot_assets", {
  id: text("id").primaryKey(),
  shotId: text("shot_id")
    .notNull()
    .references(() => shots.id, { onDelete: "cascade" }),
  type: text("type", {
    enum: [
      "first_frame",
      "last_frame",
      "reference",
      "keyframe_video",
      "reference_video",
    ],
  }).notNull(),
  sequenceInType: integer("sequence_in_type").notNull().default(0),
  assetVersion: integer("asset_version").notNull().default(1),
  isActive: integer("is_active").notNull().default(1),
  prompt: text("prompt").notNull().default(""),
  fileUrl: text("file_url"),
  status: text("status", {
    enum: ["pending", "generating", "completed", "failed"],
  })
    .notNull()
    .default("pending"),
  characters: text("characters"), // JSON array
  modelProvider: text("model_provider"),
  modelId: text("model_id"),
  meta: text("meta"), // JSON
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const shots = sqliteTable("shots", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  prompt: text("prompt").default(""),
  motionScript: text("motion_script"),
  cameraDirection: text("camera_direction").default("static"),
  duration: integer("duration").notNull().default(10),
  videoScript: text("video_script"),
  videoPrompt: text("video_prompt"),
  transitionIn: text("transition_in").default("cut"),
  transitionOut: text("transition_out").default("cut"),
  episodeId: text("episode_id").references(() => episodes.id, {
    onDelete: "cascade",
  }),
  versionId: text("version_id").references(() => storyboardVersions.id, {
    onDelete: "cascade",
  }),
  sceneId: text("scene_id"),
  compositionGuide: text("composition_guide").default(""),
  focalPoint: text("focal_point").default(""),
  depthOfField: text("depth_of_field").default("medium"),
  soundDesign: text("sound_design").default(""),
  musicCue: text("music_cue").default(""),
  costumeOverrides: text("costume_overrides").default(""),
  isStale: integer("is_stale").notNull().default(0),
  status: text("status", {
    enum: ["pending", "generating", "completed", "failed"],
  })
    .notNull()
    .default("pending"),
});

export const dialogues = sqliteTable("dialogues", {
  id: text("id").primaryKey(),
  shotId: text("shot_id")
    .notNull()
    .references(() => shots.id, { onDelete: "cascade" }),
  characterId: text("character_id")
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  audioUrl: text("audio_url"),
  sequence: integer("sequence").notNull().default(0),
  startRatio: text("start_ratio").default("0"),
  endRatio: text("end_ratio").default("1"),
});

export const importLogs = sqliteTable("import_logs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  step: integer("step").notNull(),
  status: text("status", { enum: ["running", "done", "error"] })
    .notNull()
    .default("running"),
  message: text("message").notNull().default(""),
  metadata: text("metadata", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const importStates = sqliteTable("import_states", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  currentStep: integer("current_step").notNull().default(0),
  stepStatus: text("step_status", { mode: "json" }),
  fullText: text("full_text").default(""),
  reviewIssues: text("review_issues", { mode: "json" }),
  storyAnalysis: text("story_analysis", { mode: "json" }),
  characters: text("characters", { mode: "json" }),
  items: text("items", { mode: "json" }),
  environments: text("environments", { mode: "json" }),
  voices: text("voices", { mode: "json" }),
  relationships: text("relationships", { mode: "json" }),
  episodes: text("episodes", { mode: "json" }),
  confirmedEpisodeIndexes: text("confirmed_episode_indexes", { mode: "json" }),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const scripts = sqliteTable("scripts", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  episodeId: text("episode_id").references(() => episodes.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull().default(""),
  sourceFilename: text("source_filename").default(""),
  sourceType: text("source_type").default(""),
  language: text("language").default(""),
  contentHash: text("content_hash").default(""),
  rawText: text("raw_text").notNull().default(""),
  cleanedText: text("cleaned_text").default(""),
  status: text("status", {
    enum: ["uploaded", "cleaning", "chunked", "parsed", "failed"],
  })
    .notNull()
    .default("uploaded"),
  metadata: text("metadata", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const scriptChunks = sqliteTable("script_chunks", {
  id: text("id").primaryKey(),
  scriptId: text("script_id")
    .notNull()
    .references(() => scripts.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  episodeId: text("episode_id").references(() => episodes.id, {
    onDelete: "set null",
  }),
  sceneId: text("scene_id").references(() => scenes.id, {
    onDelete: "set null",
  }),
  chunkIndex: integer("chunk_index").notNull(),
  episodeIndex: integer("episode_index").default(0),
  sceneIndex: integer("scene_index").default(0),
  text: text("text").notNull(),
  startIndex: integer("start_index").notNull().default(0),
  endIndex: integer("end_index").notNull().default(0),
  overlapBefore: integer("overlap_before").notNull().default(0),
  overlapAfter: integer("overlap_after").notNull().default(0),
  status: text("status", {
    enum: ["pending", "parsed", "reviewed", "failed"],
  })
    .notNull()
    .default("pending"),
  metadata: text("metadata", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const complianceReports = sqliteTable("compliance_reports", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  scriptId: text("script_id").references(() => scripts.id, {
    onDelete: "cascade",
  }),
  chunkId: text("chunk_id").references(() => scriptChunks.id, {
    onDelete: "set null",
  }),
  riskLevel: text("risk_level", {
    enum: ["none", "low", "medium", "high", "critical"],
  })
    .notNull()
    .default("low"),
  riskType: text("risk_type").notNull().default(""),
  sourceText: text("source_text").notNull().default(""),
  reason: text("reason").notNull().default(""),
  suggestion: text("suggestion").notNull().default(""),
  needHumanReview: integer("need_human_review").notNull().default(0),
  status: text("status", {
    enum: ["open", "accepted", "resolved", "ignored"],
  })
    .notNull()
    .default("open"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["character", "scene", "prop"] }).notNull(),
  name: text("name").notNull(),
  aliases: text("aliases").notNull().default("[]"),
  importance: integer("importance").notNull().default(0),
  description: text("description").notNull().default(""),
  visualConstraints: text("visual_constraints").notNull().default(""),
  negativeConstraints: text("negative_constraints").notNull().default(""),
  firstAppearance: text("first_appearance").notNull().default(""),
  firstAppearanceChunkId: text("first_appearance_chunk_id").references(
    () => scriptChunks.id,
    { onDelete: "set null" },
  ),
  confirmed: integer("confirmed").notNull().default(0),
  referenceImage: text("reference_image"),
  version: integer("version").notNull().default(1),
  metadata: text("metadata", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const assetCandidates = sqliteTable("asset_candidates", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  scriptId: text("script_id").references(() => scripts.id, {
    onDelete: "cascade",
  }),
  chunkId: text("chunk_id").references(() => scriptChunks.id, {
    onDelete: "cascade",
  }),
  episodeId: text("episode_id").references(() => episodes.id, {
    onDelete: "set null",
  }),
  sceneId: text("scene_id").references(() => scenes.id, {
    onDelete: "set null",
  }),
  assetType: text("asset_type", {
    enum: ["character", "scene", "prop"],
  }).notNull(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull().default(""),
  aliases: text("aliases", { mode: "json" }),
  role: text("role").notNull().default(""),
  description: text("description").notNull().default(""),
  evidenceText: text("evidence_text").notNull().default(""),
  confidence: integer("confidence").notNull().default(50),
  source: text("source", {
    enum: ["ai", "local", "rule", "manual"],
  })
    .notNull()
    .default("ai"),
  status: text("status", {
    enum: ["candidate", "merged", "rejected", "confirmed"],
  })
    .notNull()
    .default("candidate"),
  mergedAssetId: text("merged_asset_id").references(() => assets.id, {
    onDelete: "set null",
  }),
  metadata: text("metadata", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const assetOccurrences = sqliteTable("asset_occurrences", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  assetId: text("asset_id")
    .notNull()
    .references(() => assets.id, { onDelete: "cascade" }),
  scriptId: text("script_id").references(() => scripts.id, {
    onDelete: "set null",
  }),
  chunkId: text("chunk_id").references(() => scriptChunks.id, {
    onDelete: "set null",
  }),
  episodeId: text("episode_id").references(() => episodes.id, {
    onDelete: "set null",
  }),
  sceneId: text("scene_id").references(() => scenes.id, {
    onDelete: "set null",
  }),
  candidateId: text("candidate_id").references(() => assetCandidates.id, {
    onDelete: "set null",
  }),
  occurrenceType: text("occurrence_type", {
    enum: ["mention", "appearance", "state_change", "ownership", "location"],
  })
    .notNull()
    .default("mention"),
  evidenceText: text("evidence_text").notNull().default(""),
  importance: integer("importance").notNull().default(0),
  metadata: text("metadata", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const assetVariants = sqliteTable("asset_variants", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  assetId: text("asset_id")
    .notNull()
    .references(() => assets.id, { onDelete: "cascade" }),
  sourceCandidateId: text("source_candidate_id").references(
    () => assetCandidates.id,
    { onDelete: "set null" },
  ),
  sourceOccurrenceId: text("source_occurrence_id").references(
    () => assetOccurrences.id,
    { onDelete: "set null" },
  ),
  variantType: text("variant_type").notNull().default("default"),
  name: text("name").notNull(),
  state: text("state").notNull().default(""),
  lockedTraits: text("locked_traits", { mode: "json" }),
  changedTraits: text("changed_traits", { mode: "json" }),
  visualConstraints: text("visual_constraints").notNull().default(""),
  negativeConstraints: text("negative_constraints").notNull().default(""),
  referenceImage: text("reference_image"),
  status: text("status", {
    enum: ["draft", "generated", "reviewing", "approved", "rejected", "locked"],
  })
    .notNull()
    .default("draft"),
  metadata: text("metadata", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const characterAssets = sqliteTable("character_assets", {
  assetId: text("asset_id")
    .primaryKey()
    .references(() => assets.id, { onDelete: "cascade" }),
  characterId: text("character_id").references(() => characters.id, {
    onDelete: "set null",
  }),
  roleName: text("role_name").default(""),
  age: text("age").default(""),
  gender: text("gender").default(""),
  personality: text("personality").default(""),
  costume: text("costume").default(""),
  voice: text("voice").default(""),
  relationshipNotes: text("relationship_notes").default(""),
});

export const sceneAssets = sqliteTable("scene_assets", {
  assetId: text("asset_id")
    .primaryKey()
    .references(() => assets.id, { onDelete: "cascade" }),
  sceneId: text("scene_id").references(() => scenes.id, {
    onDelete: "set null",
  }),
  locationType: text("location_type").default(""),
  timeOfDay: text("time_of_day").default(""),
  lighting: text("lighting").default(""),
  weather: text("weather").default(""),
  layout: text("layout").default(""),
});

export const propAssets = sqliteTable("prop_assets", {
  assetId: text("asset_id")
    .primaryKey()
    .references(() => assets.id, { onDelete: "cascade" }),
  propCategory: text("prop_category").default(""),
  ownerCharacterId: text("owner_character_id").references(() => characters.id, {
    onDelete: "set null",
  }),
  sceneId: text("scene_id").references(() => scenes.id, {
    onDelete: "set null",
  }),
  state: text("state").default(""),
  usageRules: text("usage_rules").default(""),
});

export const productionBibles = sqliteTable("production_bibles", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  episodeId: text("episode_id").references(() => episodes.id, {
    onDelete: "set null",
  }),
  sourceScriptId: text("source_script_id").references(() => scripts.id, {
    onDelete: "set null",
  }),
  version: integer("version").notNull().default(1),
  title: text("title").notNull().default(""),
  worldSetting: text("world_setting").notNull().default(""),
  visualStyle: text("visual_style").notNull().default(""),
  eraConstraints: text("era_constraints").notNull().default(""),
  locationRules: text("location_rules").notNull().default(""),
  characterRules: text("character_rules").notNull().default(""),
  sceneRules: text("scene_rules").notNull().default(""),
  propRules: text("prop_rules").notNull().default(""),
  positivePromptTemplate: text("positive_prompt_template")
    .notNull()
    .default(""),
  negativePromptTemplate: text("negative_prompt_template")
    .notNull()
    .default(""),
  complianceRules: text("compliance_rules").notNull().default(""),
  status: text("status", { enum: ["draft", "active", "archived"] })
    .notNull()
    .default("draft"),
  isActive: integer("is_active").notNull().default(0),
  metadata: text("metadata", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const shotSpecs = sqliteTable("shot_specs", {
  id: text("id").primaryKey(),
  shotId: text("shot_id").references(() => shots.id, { onDelete: "set null" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  episodeId: text("episode_id").references(() => episodes.id, {
    onDelete: "cascade",
  }),
  sceneId: text("scene_id").references(() => scenes.id, {
    onDelete: "set null",
  }),
  scriptChunkId: text("script_chunk_id").references(() => scriptChunks.id, {
    onDelete: "set null",
  }),
  sequence: integer("sequence").notNull().default(0),
  duration: integer("duration").notNull().default(10),
  characters: text("characters").notNull().default("[]"),
  sceneAssetId: text("scene_asset_id").references(() => assets.id, {
    onDelete: "set null",
  }),
  propAssetIds: text("prop_asset_ids").notNull().default("[]"),
  shotType: text("shot_type").notNull().default(""),
  cameraAngle: text("camera_angle").notNull().default(""),
  cameraMovement: text("camera_movement").notNull().default(""),
  action: text("action").notNull().default(""),
  emotion: text("emotion").notNull().default(""),
  dialogue: text("dialogue").notNull().default(""),
  voiceover: text("voiceover").notNull().default(""),
  continuityIn: text("continuity_in").notNull().default(""),
  continuityOut: text("continuity_out").notNull().default(""),
  positivePrompt: text("positive_prompt").notNull().default(""),
  negativePrompt: text("negative_prompt").notNull().default(""),
  status: text("status", {
    enum: ["draft", "ready", "generating", "completed", "failed"],
  })
    .notNull()
    .default("draft"),
  version: integer("version").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const storyboardFrames = sqliteTable("storyboard_frames", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  episodeId: text("episode_id").references(() => episodes.id, {
    onDelete: "cascade",
  }),
  sceneId: text("scene_id").references(() => scenes.id, {
    onDelete: "set null",
  }),
  shotId: text("shot_id").references(() => shots.id, { onDelete: "cascade" }),
  shotSpecId: text("shot_spec_id").references(() => shotSpecs.id, {
    onDelete: "set null",
  }),
  frameIndex: integer("frame_index").notNull().default(0),
  imageUrl: text("image_url"),
  prompt: text("prompt").notNull().default(""),
  negativePrompt: text("negative_prompt").notNull().default(""),
  status: text("status", {
    enum: ["pending", "generating", "completed", "failed"],
  })
    .notNull()
    .default("pending"),
  modelProvider: text("model_provider"),
  modelId: text("model_id"),
  metadata: text("metadata", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const promptTemplates = sqliteTable("prompt_templates", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  promptKey: text("prompt_key").notNull(),
  slotKey: text("slot_key"),
  scope: text("scope", { enum: ["global", "project"] }).notNull().default("global"),
  projectId: text("project_id"),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const promptVersions = sqliteTable("prompt_versions", {
  id: text("id").primaryKey(),
  templateId: text("template_id")
    .notNull()
    .references(() => promptTemplates.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const promptPresets = sqliteTable("prompt_presets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  userId: text("user_id"),
  promptKey: text("prompt_key").notNull(),
  slots: text("slots", { mode: "json" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const characterRelations = sqliteTable("character_relations", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  characterAId: text("character_a_id")
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),
  characterBId: text("character_b_id")
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),
  relationType: text("relation_type").notNull().default("neutral"),
  description: text("description").default(""),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const characterCostumes = sqliteTable("character_costumes", {
  id: text("id").primaryKey(),
  characterId: text("character_id")
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("default"),
  description: text("description").default(""),
  referenceImage: text("reference_image"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const moodBoardImages = sqliteTable("mood_board_images", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  imageUrl: text("image_url").notNull(),
  annotation: text("annotation").default(""),
  extractedStyle: text("extracted_style").default(""),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const shotActions = sqliteTable("shot_actions", {
  id: text("id").primaryKey(),
  shotId: text("shot_id")
    .notNull()
    .references(() => shots.id, { onDelete: "cascade" }),
  characterId: text("character_id"),
  bodyPart: text("body_part").default("full_body"),
  motion: text("motion").notNull().default(""),
  startTime: text("start_time").default("0"),
  endTime: text("end_time").default("0"),
  intensity: text("intensity").default("normal"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const promptAbTests = sqliteTable("prompt_ab_tests", {
  id: text("id").primaryKey(),
  promptKey: text("prompt_key").notNull(),
  variantA: text("variant_a").notNull(),
  variantB: text("variant_b").notNull(),
  shotId: text("shot_id"),
  resultAUrl: text("result_a_url"),
  resultBUrl: text("result_b_url"),
  preferred: text("preferred"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  type: text("type", {
    enum: [
      "script_outline",
      "script_parse",
      "character_extract",
      "character_image",
      "shot_split",
      "frame_generate",
      "video_generate",
      "video_assemble",
    ],
  }).notNull(),
  status: text("status", {
    enum: ["pending", "running", "completed", "failed"],
  })
    .notNull()
    .default("pending"),
  payload: text("payload", { mode: "json" }),
  result: text("result", { mode: "json" }),
  error: text("error"),
  retries: integer("retries").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  scheduledAt: integer("scheduled_at", { mode: "timestamp" }),
  episodeId: text("episode_id").references(() => episodes.id, {
    onDelete: "cascade",
  }),
});

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().default(""),
  name: text("name").notNull(),
  category: text("category", {
    enum: ["script_outline", "script_generate", "script_parse", "character_extract", "shot_split", "keyframe_prompts", "video_prompts", "ref_image_prompts", "ref_video_prompts"],
  }).notNull(),
  platform: text("platform", {
    enum: ["bailian", "dify", "coze"],
  }).notNull().default("bailian"),
  appId: text("app_id").notNull(),
  apiKey: text("api_key").notNull(),
  description: text("description").default(""),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const agentBindings = sqliteTable("agent_bindings", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  category: text("category", {
    enum: ["script_outline", "script_generate", "script_parse", "character_extract", "shot_split", "keyframe_prompts", "video_prompts", "ref_image_prompts", "ref_video_prompts"],
  }).notNull(),
  agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
});
