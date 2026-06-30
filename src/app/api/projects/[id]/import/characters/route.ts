import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createLanguageModel, extractJSON, supportsOpenAIJsonMode } from "@/lib/ai/ai-sdk";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { addImportLog, chunkText } from "@/lib/import-utils";

export const maxDuration = 300;

interface ExtractedChar {
  name: string;
  frequency: number;
  description: string;
  visualHint?: string;
}

interface ExtractedRelation {
  characterA: string;
  characterB: string;
  relationType: string;
  description?: string;
}

interface ExtractedItem {
  name: string;
  frequency: number;
  description: string;
  visualHint?: string;
}

interface ExtractedEnvironment {
  name: string;
  frequency: number;
  description: string;
  visualHint?: string;
}

const IMPORT_ASSET_SYSTEM = `You are a senior production bible editor, character designer, prop designer, and environment art director.
Extract reusable core assets from the script for later visual consistency.

Extract THREE asset categories:
1. characters: named people or personified beings that need stable visual identity.
2. items: important props, weapons, documents, vehicles, symbolic objects, tools, or recurring physical objects.
3. environments: recurring or important locations, rooms, buildings, outdoor spaces, fantasy/sci-fi settings, or atmosphere-defining spaces.

Rules:
- Output in the same language as the source text.
- Do not include generic one-off objects unless they affect plot, composition, or continuity.
- Merge obvious aliases and duplicates.
- Give every asset a production-ready visual description.
- visualHint must be a short 2-6 word identifier.
- Character descriptions should include appearance, costume, colors, and role impression.
- Item descriptions should include material, color, shape, scale, state, and narrative function.
- Environment descriptions should include layout, era/style, lighting, palette, atmosphere, and iconic visual elements.

Return ONLY valid JSON with this shape:
{
  "characters": [
    { "name": "name", "frequency": 5, "description": "visual bible description", "visualHint": "short tag" }
  ],
  "relationships": [
    { "characterA": "name", "characterB": "name", "relationType": "family|ally|enemy|romance|authority|neutral|other", "description": "short relation note" }
  ],
  "items": [
    { "name": "name", "frequency": 3, "description": "prop visual bible description", "visualHint": "short tag" }
  ],
  "environments": [
    { "name": "name", "frequency": 4, "description": "environment visual bible description", "visualHint": "short tag" }
  ]
}`;

function buildImportAssetPrompt(textChunk: string): string {
  return `Extract reusable production assets from this script chunk.

--- TEXT ---
${textChunk}
--- END ---

Return ONLY valid JSON.`;
}

function parseAssetExtract(text: string) {
  const parsed = JSON.parse(extractJSON(text));
  if (Array.isArray(parsed)) {
    return {
      chars: parsed as ExtractedChar[],
      rels: [] as ExtractedRelation[],
      items: [] as ExtractedItem[],
      environments: [] as ExtractedEnvironment[],
    };
  }
  return {
    chars: (parsed.characters || []) as ExtractedChar[],
    rels: (parsed.relationships || []) as ExtractedRelation[],
    items: (parsed.items || []) as ExtractedItem[],
    environments: (parsed.environments || parsed.locations || []) as ExtractedEnvironment[],
  };
}

function getFriendlyModelError(err: unknown, config: ProviderConfig): string {
  const error = err as {
    message?: string;
    statusCode?: number;
    lastError?: { statusCode?: number; responseHeaders?: Record<string, string> };
  };
  const statusCode = error.statusCode ?? error.lastError?.statusCode;
  const requestId = error.lastError?.responseHeaders?.["x-api-request-id"];

  if (statusCode === 503) {
    return `模型 ${config.modelId} 调用失败：中转站返回 503，当前没有可用渠道、额度不足，或模型 ID 与中转站不匹配。请在设置里换一个可用文本模型，或确认中转站后台是否支持这个模型。${requestId ? ` Request ID: ${requestId}` : ""}`;
  }

  return err instanceof Error ? err.message : "Unknown error";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const userId = getUserIdFromRequest(request);

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    text: string;
    modelConfig: { text: ProviderConfig | null };
  };

  const textModelConfig = body.modelConfig?.text;
  if (!textModelConfig) {
    return NextResponse.json({ error: "No text model" }, { status: 400 });
  }

  const chunks = chunkText(body.text);
  const model = createLanguageModel(textModelConfig);

  await addImportLog(
    projectId, 3, "running",
    `开始资产设定：提取角色、物品、环境，共 ${chunks.length} 块`
  );

  // Concurrent extraction from all chunks
  let chunkResults: Array<{ chars: ExtractedChar[]; rels: ExtractedRelation[]; items: ExtractedItem[]; environments: ExtractedEnvironment[] }>;
  try {
    chunkResults = await Promise.all(
      chunks.map(async (chunk, idx) => {
        await addImportLog(
          projectId, 3, "running",
          `正在处理第 ${idx + 1}/${chunks.length} 块...`
        );

        const jsonMode = supportsOpenAIJsonMode(textModelConfig)
          ? { openai: { response_format: { type: "json_object" } } }
          : undefined;
        const result = await generateText({
          model,
          system: IMPORT_ASSET_SYSTEM,
          prompt: buildImportAssetPrompt(chunk),
          providerOptions: jsonMode,
        });

        try {
          return parseAssetExtract(result.text);
        } catch {
          console.error(`[ImportChars] Chunk ${idx + 1} JSON parse failed. Raw:\n${result.text.slice(0, 500)}...`);
          await addImportLog(
            projectId, 3, "running",
            `第 ${idx + 1} 块 JSON 解析失败，正在重试...`
          );
          const retry = await generateText({
            model,
            system: IMPORT_ASSET_SYSTEM,
            prompt: buildImportAssetPrompt(chunk) + "\n\nIMPORTANT: Return COMPLETE, VALID JSON.",
            providerOptions: jsonMode,
          });
          return parseAssetExtract(retry.text);
        }
      })
    );
  } catch (err) {
    const msg = getFriendlyModelError(err, textModelConfig);
    console.error("[ImportChars] Character extraction failed:", err);
    await addImportLog(projectId, 3, "error", `资产设定失败: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Merge & deduplicate characters by name, sum frequencies
  const charMap = new Map<string, ExtractedChar>();
  const itemMap = new Map<string, ExtractedItem>();
  const envMap = new Map<string, ExtractedEnvironment>();
  const allRelations: ExtractedRelation[] = [];

  function mergeAsset<T extends { name: string; frequency: number; description: string; visualHint?: string }>(
    map: Map<string, T>,
    asset: T
  ) {
    const key = asset.name.toLowerCase().trim();
    if (!key) return;
    const existing = map.get(key);
    if (existing) {
      existing.frequency += asset.frequency || 1;
      if ((asset.description || "").length > (existing.description || "").length) {
        existing.description = asset.description;
      }
      if (!existing.visualHint && asset.visualHint) {
        existing.visualHint = asset.visualHint;
      }
    } else {
      map.set(key, { ...asset, frequency: asset.frequency || 1 });
    }
  }

  for (const { chars, rels, items, environments } of chunkResults) {
    for (const c of chars) {
      mergeAsset(charMap, c);
    }
    for (const item of items) mergeAsset(itemMap, item);
    for (const env of environments) mergeAsset(envMap, env);
    allRelations.push(...rels);
  }

  const merged = [...charMap.values()].sort((a, b) => b.frequency - a.frequency);
  const items = [...itemMap.values()].sort((a, b) => b.frequency - a.frequency);
  const environments = [...envMap.values()].sort((a, b) => b.frequency - a.frequency);

  // Classify: frequency >= 2 = main, else guest
  const result = merged.map((c) => ({
    ...c,
    scope: c.frequency >= 2 ? ("main" as const) : ("guest" as const),
  }));

  // Deduplicate relationships
  const relSet = new Set<string>();
  const uniqueRelations = allRelations.filter((r) => {
    const key = [r.characterA, r.characterB].sort().join("↔");
    if (relSet.has(key)) return false;
    relSet.add(key);
    return true;
  });

  await addImportLog(
    projectId, 3, "done",
    `资产设定完成，共 ${result.length} 个角色、${items.length} 个物品、${environments.length} 个环境，${uniqueRelations.length} 个关系`,
    { characters: result, relationships: uniqueRelations, items, environments }
  );

  return NextResponse.json({ characters: result, relationships: uniqueRelations, items, environments });
}

