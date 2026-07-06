import type { NormalizedStoryboardShot, StoryboardProductionBibleInput, StoryboardStyle } from "./types";
import { compactText, readString, toRecord } from "./prompt-sanitizer";

function bibleMetadataValue(bible: StoryboardProductionBibleInput | null | undefined, keys: string[]) {
  return readString(toRecord(bible?.metadata), keys);
}

function detectEra(bible?: StoryboardProductionBibleInput | null) {
  return compactText(
    bibleMetadataValue(bible, ["era", "period", "time", "year"]) ||
    bible?.eraConstraints ||
    "production-bible era rules",
    180,
  );
}

function detectVisualStyle(bible?: StoryboardProductionBibleInput | null) {
  return compactText(
    bibleMetadataValue(bible, ["genre", "visualStyle", "style"]) ||
    bible?.visualStyle ||
    "realistic Chinese short-drama storyboard",
    180,
  );
}

export function resolveLightingStyle(input: {
  shot: NormalizedStoryboardShot;
  sceneText?: string;
  frameDescription: string;
  productionBible?: StoryboardProductionBibleInput | null;
}): StoryboardStyle {
  const evidence = [
    input.frameDescription,
    input.shot.source_text,
    input.shot.composition,
    input.sceneText,
    input.productionBible?.locationRules,
    input.productionBible?.sceneRules,
  ].filter(Boolean).join(" ");

  const isNight = /夜|晚上|夜晚|深夜|黑夜|night|midnight|dark/i.test(evidence);
  const isDay = /白天|日间|清晨|上午|下午|daylight|morning|afternoon/i.test(evidence);
  const isRain = /雨|暴雨|大雨|雨水|storm|rain|rainy|downpour/i.test(evidence);
  const isSnow = /雪|snow|snowy|blizzard/i.test(evidence);
  const hasHeadlights = /车灯|远光灯|前照灯|headlight|headlamp/i.test(evidence);
  const isIndoor = /室内|房间|客厅|卧室|医院|办公室|indoor|interior|room|hallway/i.test(evidence);
  const hasPractical = /灯泡|台灯|烛光|霓虹|路灯|lamp|candle|neon|streetlight/i.test(evidence);
  const hasFire = /火|火光|燃烧|flame|firelight|burning/i.test(evidence);

  const lighting: string[] = [];
  const atmosphere: string[] = [];

  if (isNight) {
    lighting.push("night lighting", "low-key lighting");
    atmosphere.push("dark atmosphere");
  } else if (isIndoor && isDay) {
    lighting.push("soft indoor daylight");
  } else if (isIndoor) {
    lighting.push("practical indoor lighting");
  } else if (isDay) {
    lighting.push("daylight-balanced realistic lighting");
  }

  if (isRain) {
    lighting.push("wet surface reflections");
    atmosphere.push("rain mist", "storm atmosphere");
  }
  if (isSnow) {
    atmosphere.push("cold air haze", "snow-muted atmosphere");
  }
  if (hasHeadlights) {
    lighting.push("headlight-dominated lighting", "strong backlight");
    atmosphere.push("wet-road reflections when surfaces are wet");
  }
  if (hasPractical) lighting.push("visible practical light sources");
  if (hasFire) {
    lighting.push("firelight contrast");
    atmosphere.push("smoke or heat haze only if already implied");
  }

  if (lighting.length === 0) {
    lighting.push("scene-motivated realistic lighting");
  }
  if (atmosphere.length === 0) {
    atmosphere.push(isIndoor ? "controlled interior atmosphere" : "grounded location atmosphere");
  }

  return {
    visual_style: detectVisualStyle(input.productionBible),
    lighting: Array.from(new Set(lighting)).join(", "),
    atmosphere: Array.from(new Set(atmosphere)).join(", "),
    era: detectEra(input.productionBible),
  };
}
