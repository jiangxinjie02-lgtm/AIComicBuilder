import { and, asc, eq } from "drizzle-orm";
import { db, ensureAssetLibraryTables } from "@/lib/db";
import {
  assets,
  characterAssets,
  characters,
  propAssets,
  sceneAssets,
} from "@/lib/db/schema";
import { id as genId } from "@/lib/id";

export type StoryAssetType = "character" | "scene" | "prop";

export interface ImportAssetDraft {
  name?: string;
  aliases?: string[] | string;
  frequency?: number;
  description?: string;
  visualHint?: string;
  confirmed?: boolean;
  assetId?: string;
  category?: string;
  role?: string;
  roleKey?: string;
  scope?: "main" | "guest";
  episodes?: string[];
  prompt?: string;
  negativePrompt?: string;
  variants?: unknown[];
  imageUrl?: string;
  history?: unknown[];
  mainImageName?: string;
  tags?: string[];
  faceTemplate?: unknown;
}

export interface StoryAssetPatch {
  name?: string;
  aliases?: string[] | string;
  importance?: number | string;
  description?: string;
  visualConstraints?: string;
  negativeConstraints?: string;
  firstAppearance?: string;
  confirmed?: boolean | number;
  referenceImage?: string | null;
  metadata?: Record<string, unknown> | null;
  character?: {
    characterId?: string | null;
    roleName?: string;
    age?: string;
    gender?: string;
    personality?: string;
    costume?: string;
    voice?: string;
    relationshipNotes?: string;
  };
  scene?: {
    sceneId?: string | null;
    locationType?: string;
    timeOfDay?: string;
    lighting?: string;
    weather?: string;
    layout?: string;
  };
  prop?: {
    propCategory?: string;
    ownerCharacterId?: string | null;
    sceneId?: string | null;
    state?: string;
    usageRules?: string;
  };
}

type AssetRow = typeof assets.$inferSelect;

function cleanText(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function jsonString(value: unknown) {
  return JSON.stringify(value ?? []);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeName(name: unknown) {
  return cleanText(name).replace(/\s+/g, " ");
}

function normalizeAliases(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => cleanText(item)).filter(Boolean))];
  }
  if (typeof value === "string") {
    const parsed = parseJson<unknown>(value, value);
    if (Array.isArray(parsed)) return normalizeAliases(parsed);
    return value
      .split(/[,\n，、]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function importanceLabel(score: number) {
  if (score >= 80) return "core";
  if (score >= 50) return "important";
  if (score >= 20) return "temporary";
  return "background";
}

export function importanceScore(value: unknown, draft?: ImportAssetDraft) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(100, Math.round(value)));
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized === "core") return 100;
    if (normalized === "important") return 70;
    if (normalized === "temporary") return 35;
    if (normalized === "background") return 10;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return importanceScore(numeric);
  }

  const frequency = Number(draft?.frequency ?? 0);
  const roleText = `${draft?.role ?? ""} ${draft?.roleKey ?? ""} ${draft?.scope ?? ""}`;
  if (/lead|main|主角|男主|女主|core/i.test(roleText)) return 100;
  if (frequency >= 10) return 80;
  if (frequency >= 5) return 60;
  if (frequency >= 2) return 35;
  return 15;
}

function typeFromTab(tab: "characters" | "items" | "environments" | StoryAssetType): StoryAssetType {
  if (tab === "characters") return "character";
  if (tab === "items") return "prop";
  if (tab === "environments") return "scene";
  return tab;
}

async function findExistingAsset(projectId: string, type: StoryAssetType, name: string, sourceAssetId?: string) {
  const existing = await db
    .select()
    .from(assets)
    .where(and(eq(assets.projectId, projectId), eq(assets.type, type)))
    .orderBy(asc(assets.createdAt));

  const normalizedName = name.toLowerCase();
  return existing.find((row) => {
    if (row.name.toLowerCase() === normalizedName) return true;
    const aliases = normalizeAliases(row.aliases);
    if (aliases.some((alias) => alias.toLowerCase() === normalizedName)) return true;
    const metadata = parseJson<Record<string, unknown>>(row.metadata, {});
    return Boolean(sourceAssetId && metadata.sourceAssetId === sourceAssetId);
  });
}

function buildMetadata(type: StoryAssetType, draft: ImportAssetDraft, previous?: AssetRow | null) {
  const previousMetadata = parseJson<Record<string, unknown>>(previous?.metadata, {});
  return {
    ...previousMetadata,
    sourceAssetId: draft.assetId || previousMetadata.sourceAssetId || "",
    category: draft.category || previousMetadata.category || type,
    role: draft.role || previousMetadata.role || "",
    roleKey: draft.roleKey || previousMetadata.roleKey || "",
    scope: draft.scope || previousMetadata.scope || "",
    frequency: Number(draft.frequency ?? previousMetadata.frequency ?? 0),
    episodes: draft.episodes || previousMetadata.episodes || [],
    prompt: draft.prompt || previousMetadata.prompt || "",
    negativePrompt: draft.negativePrompt || previousMetadata.negativePrompt || "",
    variants: draft.variants || previousMetadata.variants || [],
    imageHistory: draft.history || previousMetadata.imageHistory || [],
    mainImageName: draft.mainImageName || previousMetadata.mainImageName || "",
    tags: draft.tags || previousMetadata.tags || [],
    faceTemplate: draft.faceTemplate || previousMetadata.faceTemplate || null,
    importanceLabel: importanceLabel(importanceScore(undefined, draft)),
  };
}

async function syncSubtypeRow(
  assetId: string,
  type: StoryAssetType,
  draft: ImportAssetDraft,
  links?: { characterIdByName?: Map<string, string> },
) {
  if (type === "character") {
    const characterId = links?.characterIdByName?.get(normalizeName(draft.name).toLowerCase()) ?? null;
    await db
      .insert(characterAssets)
      .values({
        assetId,
        characterId,
        roleName: draft.role || draft.scope || "",
        costume: draft.visualHint || "",
        relationshipNotes: Array.isArray(draft.episodes) ? draft.episodes.join(", ") : "",
      })
      .onConflictDoUpdate({
        target: characterAssets.assetId,
        set: {
          characterId,
          roleName: draft.role || draft.scope || "",
          costume: draft.visualHint || "",
          relationshipNotes: Array.isArray(draft.episodes) ? draft.episodes.join(", ") : "",
        },
      });
    return;
  }

  if (type === "scene") {
    await db
      .insert(sceneAssets)
      .values({
        assetId,
        locationType: draft.role || draft.category || "",
        lighting: draft.visualHint || "",
        layout: draft.description || "",
      })
      .onConflictDoUpdate({
        target: sceneAssets.assetId,
        set: {
          locationType: draft.role || draft.category || "",
          lighting: draft.visualHint || "",
          layout: draft.description || "",
        },
      });
    return;
  }

  await db
    .insert(propAssets)
    .values({
      assetId,
      propCategory: draft.role || draft.category || "",
      state: draft.visualHint || "",
      usageRules: draft.description || "",
    })
    .onConflictDoUpdate({
      target: propAssets.assetId,
      set: {
        propCategory: draft.role || draft.category || "",
        state: draft.visualHint || "",
        usageRules: draft.description || "",
      },
    });
}

export async function upsertStoryAsset(
  projectId: string,
  type: StoryAssetType,
  draft: ImportAssetDraft,
  links?: { characterIdByName?: Map<string, string> },
) {
  ensureAssetLibraryTables();

  const name = normalizeName(draft.name);
  if (!name) return null;

  const existing = await findExistingAsset(projectId, type, name, draft.assetId);
  const now = new Date();
  const score = importanceScore(undefined, draft);
  const metadata = buildMetadata(type, draft, existing);
  const values = {
    projectId,
    type,
    name,
    aliases: jsonString(normalizeAliases(draft.aliases)),
    importance: score,
    description: cleanText(draft.description),
    visualConstraints: cleanText(draft.prompt || draft.visualHint || draft.description),
    negativeConstraints: cleanText(draft.negativePrompt),
    firstAppearance: Array.isArray(draft.episodes) ? draft.episodes[0] ?? "" : "",
    confirmed: draft.confirmed ? 1 : 0,
    referenceImage: draft.imageUrl || null,
    metadata,
    updatedAt: now,
  };

  let record: AssetRow;
  if (existing) {
    [record] = await db
      .update(assets)
      .set({
        ...values,
        version: (existing.version ?? 1) + 1,
      })
      .where(eq(assets.id, existing.id))
      .returning();
  } else {
    [record] = await db
      .insert(assets)
      .values({
        id: genId(),
        ...values,
        createdAt: now,
      })
      .returning();
  }

  await syncSubtypeRow(record.id, type, draft, links);
  return record;
}

export async function syncImportAssets(
  projectId: string,
  input: {
    characters?: ImportAssetDraft[];
    items?: ImportAssetDraft[];
    environments?: ImportAssetDraft[];
  },
  links?: { characterIdByName?: Map<string, string> },
) {
  const created: AssetRow[] = [];
  for (const draft of input.characters || []) {
    const row = await upsertStoryAsset(projectId, "character", draft, links);
    if (row) created.push(row);
  }
  for (const draft of input.items || []) {
    const row = await upsertStoryAsset(projectId, "prop", draft, links);
    if (row) created.push(row);
  }
  for (const draft of input.environments || []) {
    const row = await upsertStoryAsset(projectId, "scene", draft, links);
    if (row) created.push(row);
  }
  return created;
}

export async function listProjectAssets(projectId: string, type?: StoryAssetType) {
  ensureAssetLibraryTables();

  const rows = type
    ? await db
        .select()
        .from(assets)
        .where(and(eq(assets.projectId, projectId), eq(assets.type, type)))
        .orderBy(asc(assets.type), asc(assets.importance), asc(assets.name))
    : await db
        .select()
        .from(assets)
        .where(eq(assets.projectId, projectId))
        .orderBy(asc(assets.type), asc(assets.importance), asc(assets.name));

  return Promise.all(rows.map(enrichAsset));
}

async function enrichAsset(row: AssetRow) {
  const base = {
    ...row,
    aliases: normalizeAliases(row.aliases),
    importanceLabel: importanceLabel(row.importance ?? 0),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
  };

  if (row.type === "character") {
    const [detail] = await db
      .select()
      .from(characterAssets)
      .where(eq(characterAssets.assetId, row.id));
    return { ...base, detail };
  }
  if (row.type === "scene") {
    const [detail] = await db
      .select()
      .from(sceneAssets)
      .where(eq(sceneAssets.assetId, row.id));
    return { ...base, detail };
  }
  const [detail] = await db
    .select()
    .from(propAssets)
    .where(eq(propAssets.assetId, row.id));
  return { ...base, detail };
}

export async function assertAssetInProject(projectId: string, assetId: string) {
  ensureAssetLibraryTables();

  const [row] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.projectId, projectId)));
  return row ?? null;
}

export async function patchStoryAsset(projectId: string, assetId: string, patch: StoryAssetPatch) {
  ensureAssetLibraryTables();

  const existing = await assertAssetInProject(projectId, assetId);
  if (!existing) return null;

  const existingMetadata = parseJson<Record<string, unknown>>(existing.metadata, {});
  const metadata = patch.metadata === undefined
    ? existingMetadata
    : { ...existingMetadata, ...patch.metadata };

  const [updated] = await db
    .update(assets)
    .set({
      ...(patch.name !== undefined && { name: normalizeName(patch.name) }),
      ...(patch.aliases !== undefined && { aliases: jsonString(normalizeAliases(patch.aliases)) }),
      ...(patch.importance !== undefined && { importance: importanceScore(patch.importance) }),
      ...(patch.description !== undefined && { description: cleanText(patch.description) }),
      ...(patch.visualConstraints !== undefined && { visualConstraints: cleanText(patch.visualConstraints) }),
      ...(patch.negativeConstraints !== undefined && { negativeConstraints: cleanText(patch.negativeConstraints) }),
      ...(patch.firstAppearance !== undefined && { firstAppearance: cleanText(patch.firstAppearance) }),
      ...(patch.confirmed !== undefined && { confirmed: patch.confirmed ? 1 : 0 }),
      ...(patch.referenceImage !== undefined && { referenceImage: patch.referenceImage }),
      ...(patch.metadata !== undefined && { metadata }),
      version: (existing.version ?? 1) + 1,
      updatedAt: new Date(),
    })
    .where(eq(assets.id, assetId))
    .returning();

  if (updated.type === "character" && patch.character) {
    await db
      .insert(characterAssets)
      .values({ assetId, ...patch.character })
      .onConflictDoUpdate({ target: characterAssets.assetId, set: patch.character });
  } else if (updated.type === "scene" && patch.scene) {
    await db
      .insert(sceneAssets)
      .values({ assetId, ...patch.scene })
      .onConflictDoUpdate({ target: sceneAssets.assetId, set: patch.scene });
  } else if (updated.type === "prop" && patch.prop) {
    await db
      .insert(propAssets)
      .values({ assetId, ...patch.prop })
      .onConflictDoUpdate({ target: propAssets.assetId, set: patch.prop });
  }

  return enrichAsset(updated);
}

export async function deleteStoryAsset(projectId: string, assetId: string) {
  ensureAssetLibraryTables();

  const existing = await assertAssetInProject(projectId, assetId);
  if (!existing) return false;
  await db.delete(assets).where(eq(assets.id, assetId));
  return true;
}

export async function findCharacterIdByName(projectId: string) {
  const rows = await db.select().from(characters).where(eq(characters.projectId, projectId));
  return new Map(rows.map((row) => [row.name.toLowerCase().trim(), row.id]));
}

export { typeFromTab };
