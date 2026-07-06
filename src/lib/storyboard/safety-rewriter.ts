import { compactText } from "./prompt-sanitizer";

export const EXPLICIT_GORE_PATTERNS = [
  /鲜血|血肉|断肢|内脏|骨折外露|血泊|满身是血|血流/,
  /\b(blood|bloody|gore|graphic injury|mutilation|severed limb|open wound|viscera)\b/i,
];

const IMPACT_PATTERNS = [
  /撞向|撞飞|碾过|砍中|刺中|枪击|爆头|击穿|砸死/,
  /\b(hit by|crash into|run over|stabbed|shot|beheaded|impact moment)\b/i,
];

const DEATH_PATTERNS = [
  /死亡|死去|尸体|断气|彻底垂下|失去生命/,
  /\b(death|dead body|corpse|dies?|lifeless)\b/i,
];

const BODY_INJURY_PATTERNS = [
  /伤口|创口|肢体|断裂|撕裂|骨头|内伤/,
  /\b(wound|injury|broken bone|torn flesh|limb injury)\b/i,
];

export function hasHighRiskViolence(text: string) {
  return [...EXPLICIT_GORE_PATTERNS, ...IMPACT_PATTERNS, ...DEATH_PATTERNS, ...BODY_INJURY_PATTERNS]
    .some((pattern) => pattern.test(text));
}

export function rewriteUnsafeVisuals(text: string) {
  let rewritten = compactText(text, 320);
  const rewrites: string[] = [];

  if (IMPACT_PATTERNS.some((pattern) => pattern.test(rewritten))) {
    rewritten = rewritten
      .replace(/被?撞飞|撞向|碾过|砍中|刺中|枪击|爆头|击穿|砸死/g, "处在危险发生前后的克制关键瞬间")
      .replace(/\b(hit by|crash into|run over|stabbed|shot|beheaded|impact moment)\b/gi, "restrained pre-impact or aftermath key moment");
    rewrites.push("impact process softened into pre-impact or aftermath key moment");
  }

  if (EXPLICIT_GORE_PATTERNS.some((pattern) => pattern.test(rewritten))) {
    rewritten = rewritten
      .replace(/鲜血|血肉|断肢|内脏|血泊|满身是血|血流/g, "暗红色压迫感")
      .replace(/\b(blood|bloody|gore|graphic injury|mutilation|severed limb|open wound|viscera)\b/gi, "non-graphic dark red visual tension");
    rewrites.push("explicit gore softened into non-graphic visual tension");
  }

  if (DEATH_PATTERNS.some((pattern) => pattern.test(rewritten))) {
    rewritten = rewritten
      .replace(/死亡|死去|尸体|断气|彻底垂下|失去生命/g, "失去意识的克制画面")
      .replace(/\b(death|dead body|corpse|dies?|lifeless)\b/gi, "restrained loss-of-consciousness mood");
    rewrites.push("death process softened into restrained loss-of-consciousness mood");
  }

  if (BODY_INJURY_PATTERNS.some((pattern) => pattern.test(rewritten))) {
    rewritten = rewritten
      .replace(/伤口|创口|肢体|断裂|撕裂|骨头|内伤/g, "非血腥受伤暗示")
      .replace(/\b(wound|injury|broken bone|torn flesh|limb injury)\b/gi, "non-graphic injury implication");
    rewrites.push("graphic injury details softened");
  }

  if (rewrites.length > 0 && !/no visible gore|无明显血腥|non-graphic/i.test(rewritten)) {
    rewritten = `${rewritten}, non-graphic, no visible gore`;
  }

  return {
    text: compactText(rewritten, 320),
    rewrites,
  };
}
