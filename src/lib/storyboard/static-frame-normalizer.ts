import {
  CAMERA_MOVEMENT_PATTERNS,
  CONTINUOUS_ACTION_PATTERNS,
  compactText,
  hasPattern,
  sanitizePromptText,
} from "./prompt-sanitizer";

const ACTION_SPLIT_PATTERN =
  /然后|随后|接着|之后|最终|同时|再|并且|又|转而|\bthen\b|\bafterward\b|\bfinally\b|\band then\b|\bnext\b|\bmeanwhile\b/i;

function removeCameraMovement(text: string) {
  return text
    .replace(/镜头\s*(缓慢)?(推进|推近|拉远|摇移|跟拍|甩镜|环绕)[^，。.!?；;]*/g, "静态构图")
    .replace(/\b(camera\s*)?(dolly|tracking|pan|tilt|zoom|crane)\b[^,.;!?]*/gi, "static composition");
}

function normalizeDoorAction(text: string) {
  if (!/门/.test(text) || !/冲|跑|逃|离开|出去|进入/.test(text)) return text;
  return text
    .replace(/冲过去|跑过去|冲出|跑出|推开门跑出去|推开门离开/g, "站在门口，手靠近门把，身体前倾")
    .replace(/抓住门把手?[^，。.!?；;]*/g, "手抓住门把");
}

function normalizeGrabAction(text: string) {
  if (!/抓|握|攥/.test(text)) return text;
  return text.replace(/冲过去抓住|跑过去抓住/g, "身体前倾，手正抓住");
}

function removeActionProcessWords(text: string) {
  return text
    .replace(/开始|正在|不断|持续|一路|逐渐|慢慢|立刻|马上/g, "")
    .replace(/\b(starting to|keeps?|continues?|gradually|slowly)\b/gi, "");
}

export function normalizeStaticFrameDescription(input: {
  text: string;
  fallback?: string;
}) {
  const clean = sanitizePromptText(input.text || input.fallback || "");
  const firstSegment = clean
    .split(ACTION_SPLIT_PATTERN)
    .map((segment) => segment.trim())
    .filter(Boolean)[0] || clean;
  const normalized = compactText(
    removeActionProcessWords(
      normalizeGrabAction(
        normalizeDoorAction(
          removeCameraMovement(firstSegment),
        ),
      ),
    ),
    300,
  );

  return normalized || compactText(input.fallback || "single static storyboard key frame", 160);
}

export function isStaticFrameDescription(text: string) {
  return !hasPattern(text, CONTINUOUS_ACTION_PATTERNS) && !hasPattern(text, CAMERA_MOVEMENT_PATTERNS);
}
