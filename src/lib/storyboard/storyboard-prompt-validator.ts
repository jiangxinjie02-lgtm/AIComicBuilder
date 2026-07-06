import type { StoryboardFrameSpec, StoryboardValidationIssue, StoryboardValidationReport } from "./types";
import { activeAssetCount } from "./active-asset-selector";
import {
  CAMERA_MOVEMENT_PATTERNS,
  CONTINUOUS_ACTION_PATTERNS,
  DIALOGUE_PATTERNS,
  DURATION_PATTERNS,
  SOUND_PATTERNS,
  VIDEO_STAGE_PATTERNS,
  containsDirtyPromptMarks,
  hasPattern,
} from "./prompt-sanitizer";
import { EXPLICIT_GORE_PATTERNS } from "./safety-rewriter";

function issue(
  severity: "error" | "warning",
  code: string,
  message: string,
  field?: string,
  suggestion?: string,
): StoryboardValidationIssue {
  return { severity, code, message, field, suggestion };
}

function activeIds(frame: StoryboardFrameSpec) {
  return new Set([
    ...frame.active_assets.characters.map((asset) => asset.asset_id),
    ...(frame.active_assets.scene ? [frame.active_assets.scene.asset_id] : []),
    ...frame.active_assets.props.map((asset) => asset.asset_id),
  ]);
}

function allReferenceImagesPresent(frame: StoryboardFrameSpec) {
  const refs = [
    ...frame.active_assets.characters.map((asset) => asset.reference_image_url),
    ...(frame.active_assets.scene ? [frame.active_assets.scene.reference_image_url] : []),
    ...frame.active_assets.props.map((asset) => asset.reference_image_url),
  ];
  return refs.length > 0 && refs.every(Boolean);
}

function sceneReferenceImagePresent(frame: StoryboardFrameSpec) {
  return Boolean(frame.active_assets.scene?.reference_image_url);
}

function frameLooksAbstract(text: string) {
  return /剧情|关系|命运|意识|感觉到|明白|回忆|伏笔|plot|story|relationship|realizes?|understands?/i.test(text);
}

function positiveVisualBody(prompt: string) {
  return prompt.split(/\n(?:Safety constraints|Exclude):/i)[0] || prompt;
}

function lightingMismatch(frame: StoryboardFrameSpec) {
  const text = `${frame.frame_description} ${frame.composition}`.toLowerCase();
  const lighting = frame.style.lighting.toLowerCase();
  const atmosphere = frame.style.atmosphere.toLowerCase();
  if (/夜|night|dark/.test(text) && !/night|low-key|dark/.test(lighting)) return "night_scene_without_night_lighting";
  if (/雨|暴雨|storm|rain/.test(text) && !/wet|rain|storm/.test(`${lighting} ${atmosphere}`)) return "rain_scene_without_rain_atmosphere";
  if (/车灯|headlight|headlamp/.test(text) && !/headlight|backlight/.test(lighting)) return "headlight_scene_without_headlight_lighting";
  return "";
}

export function validateStoryboardPrompt(
  frame: StoryboardFrameSpec,
  context?: { allAssetIds?: string[] },
): StoryboardValidationReport {
  const errors: StoryboardValidationIssue[] = [];
  const warnings: StoryboardValidationIssue[] = [];
  const positive = frame.positive_prompt;
  const visualPositive = positiveVisualBody(positive);

  if (!frame.subject.description || !frame.subject.asset_id) {
    errors.push(issue("error", "missing_subject", "Frame subject is missing or unclear.", "subject", "Bind a visible subject asset before storyboard generation."));
  }
  if (!frame.frame_description || frame.frame_description.length < 6) {
    errors.push(issue("error", "missing_frame_description", "frame_description is missing.", "frame_description", "Provide one concrete static visual moment."));
  }
  if (!sceneReferenceImagePresent(frame)) {
    errors.push(issue("error", "missing_scene_reference_image", "Scene reference image is missing.", "active_assets.scene.reference_image_url", "Attach or generate a scene reference image."));
  }
  if (!allReferenceImagesPresent(frame)) {
    errors.push(issue("error", "missing_active_asset_reference", "One or more active assets lack reference images.", "active_assets", "Only locked/generated assets with reference images should enter storyboard generation."));
  }
  if (hasPattern(visualPositive, SOUND_PATTERNS)) {
    errors.push(issue("error", "sound_in_positive_prompt", "Positive prompt contains sound or audio words.", "positive_prompt", "Move sound effect to metadata only."));
  }
  if (hasPattern(visualPositive, DURATION_PATTERNS)) {
    errors.push(issue("error", "duration_in_positive_prompt", "Positive prompt contains duration.", "positive_prompt", "Move duration to metadata only."));
  }
  if (hasPattern(visualPositive, DIALOGUE_PATTERNS)) {
    errors.push(issue("error", "dialogue_in_positive_prompt", "Positive prompt contains dialogue, speaker, or subtitle words.", "positive_prompt", "Move dialogue to metadata only."));
  }
  if (hasPattern(visualPositive, CONTINUOUS_ACTION_PATTERNS)) {
    errors.push(issue("error", "continuous_action_in_positive_prompt", "Positive prompt contains multiple sequential actions.", "positive_prompt", "Keep one static key moment."));
  }
  if (hasPattern(visualPositive, CAMERA_MOVEMENT_PATTERNS)) {
    errors.push(issue("error", "camera_movement_in_positive_prompt", "Positive prompt contains camera movement.", "positive_prompt", "Keep only static composition."));
  }
  if (hasPattern(visualPositive, EXPLICIT_GORE_PATTERNS)) {
    errors.push(issue("error", "explicit_gore_in_positive_prompt", "Positive prompt contains explicit gore or graphic injury.", "positive_prompt", "Use restrained non-graphic safety wording."));
  }

  const active = activeIds(frame);
  for (const assetId of context?.allAssetIds ?? []) {
    if (active.has(assetId)) continue;
    if (assetId && visualPositive.includes(assetId)) {
      errors.push(issue("error", "unbound_asset_referenced", `Positive prompt references unbound asset_id ${assetId}.`, "positive_prompt", "Only active_assets may be referenced."));
    }
  }

  const assetCount = activeAssetCount(frame.active_assets);
  if (assetCount > 4) warnings.push(issue("warning", "too_many_active_assets", "Frame uses more than 4 active assets.", "active_assets", "Reduce to only visible subject, one scene, and key props."));
  if (frame.active_assets.characters.length > 2) warnings.push(issue("warning", "too_many_characters", "Frame uses more than 2 characters.", "active_assets.characters", "Split crowd/reaction into separate shots if needed."));
  if (frame.active_assets.props.length > 3) warnings.push(issue("warning", "too_many_props", "Frame uses more than 3 props.", "active_assets.props", "Keep only visible key props."));
  if (frame.frame_description.length < 18 || frameLooksAbstract(frame.frame_description)) {
    warnings.push(issue("warning", "weak_frame_description", "frame_description is short or abstract.", "frame_description", "Rewrite as a concrete visible still frame."));
  }
  if (!frame.subject.asset_id) {
    warnings.push(issue("warning", "unclear_subject", "Subject is not tied to an asset.", "subject", "Select the visible main character, prop, or scene asset."));
  }
  const mismatch = lightingMismatch(frame);
  if (mismatch) {
    warnings.push(issue("warning", mismatch, "Lighting style may not match scene cues.", "style.lighting", "Resolve lighting from time/weather/light source."));
  }
  if (containsDirtyPromptMarks(visualPositive)) {
    warnings.push(issue("warning", "dirty_prompt_marks", "Prompt still contains script marks or wrong-stage words.", "positive_prompt", "Run prompt sanitizer before compiling."));
  }
  if (hasPattern(visualPositive, VIDEO_STAGE_PATTERNS)) {
    warnings.push(issue("warning", "video_stage_wording", "Prompt contains video-stage wording.", "positive_prompt", "Use storyboard image wording only."));
  }

  return {
    status: errors.length > 0 ? "invalid" : warnings.length > 0 ? "needs_review" : "valid",
    errors,
    warnings,
  };
}
