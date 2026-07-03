import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, episodes, characters, episodeCharacters, characterRelations } from "@/lib/db/schema";
import { eq, and, max } from "drizzle-orm";
import { id as genId } from "@/lib/id";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { addImportLog } from "@/lib/import-utils";
import { findCharacterIdByName, syncImportAssets } from "@/lib/story-assets";

export const maxDuration = 60;

interface EpisodeData {
  title: string;
  description: string;
  keywords: string;
  idea: string;
  characters?: string[];
}

interface CharacterData {
  name: string;
  scope: "main" | "guest";
  description: string;
  visualHint?: string;
  visualConstraints?: string;
  frequency?: number;
  confirmed?: boolean;
  assetId?: string;
  role?: string;
  roleKey?: string;
  episodes?: string[];
  prompt?: string;
  negativePrompt?: string;
  variants?: unknown[];
  imageUrl?: string;
  history?: unknown[];
  mainImageName?: string;
  tags?: string[];
  faceTemplate?: unknown;
  promptMetadata?: unknown;
}

interface AssetData {
  name: string;
  frequency: number;
  description: string;
  visualHint?: string;
  visualConstraints?: string;
  confirmed?: boolean;
  assetId?: string;
  category?: string;
  role?: string;
  roleKey?: string;
  episodes?: string[];
  prompt?: string;
  negativePrompt?: string;
  variants?: unknown[];
  imageUrl?: string;
  history?: unknown[];
  mainImageName?: string;
  tags?: string[];
  faceTemplate?: unknown;
  promptMetadata?: unknown;
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
    episodes: EpisodeData[];
    characters: CharacterData[];
    items?: AssetData[];
    environments?: AssetData[];
    voices?: AssetData[];
    relationships?: Array<{
      characterA: string;
      characterB: string;
      relationType: string;
      description?: string;
    }>;
  };

  await addImportLog(
    projectId, 5, "running",
    `开始创建 ${body.episodes.length} 集、${body.characters.length} 个角色、${body.items?.length || 0} 个物品、${body.environments?.length || 0} 个环境、${body.voices?.length || 0} 个音色`
  );

  // 1. Create all characters (main + guest), build name→id map
  const charIdByName = new Map<string, string>();
  for (const char of body.characters) {
    const charId = genId();
    await db.insert(characters).values({
      id: charId,
      projectId,
      name: char.name,
      description: char.description,
      visualHint: char.visualHint ?? "",
      scope: char.scope,
      episodeId: null, // all characters are project-level now
    });
    charIdByName.set(char.name.toLowerCase().trim(), charId);
  }

  // 1b. Create character relationships
  if (body.relationships?.length) {
    for (const rel of body.relationships) {
      const aId = charIdByName.get(rel.characterA.toLowerCase().trim());
      const bId = charIdByName.get(rel.characterB.toLowerCase().trim());
      if (aId && bId && aId !== bId) {
        try {
          await db.insert(characterRelations).values({
            id: genId(),
            projectId,
            characterAId: aId,
            characterBId: bId,
            relationType: rel.relationType || "neutral",
            description: rel.description || "",
          });
        } catch {
          // skip duplicates
        }
      }
    }
  }

  await addImportLog(
    projectId, 5, "running",
    `已创建 ${body.characters.length} 个角色${body.relationships?.length ? `和 ${body.relationships.length} 个关系` : ""}`
  );

  const persistedAssetRows = await syncImportAssets(
    projectId,
    {
      characters: body.characters,
      items: body.items || [],
      environments: body.environments || [],
    },
    { characterIdByName: await findCharacterIdByName(projectId) }
  );

  await addImportLog(
    projectId, 5, "running",
    `已写入资产库：人物 ${body.characters.length}、道具 ${body.items?.length || 0}、场景 ${body.environments?.length || 0}`
  );

  // 2. Create episodes
  const [seqResult] = await db
    .select({ maxSeq: max(episodes.sequence) })
    .from(episodes)
    .where(eq(episodes.projectId, projectId));

  let seq = (seqResult?.maxSeq ?? 0) + 1;

  const created = [];
  for (const ep of body.episodes) {
    const [row] = await db
      .insert(episodes)
      .values({
        id: genId(),
        projectId,
        title: ep.title,
        description: ep.description || "",
        keywords: ep.keywords || "",
        idea: ep.idea || "",
        sequence: seq++,
      })
      .returning();
    created.push(row);
  }

  // 3. Create episode_characters relations
  let relationCount = 0;
  for (let i = 0; i < body.episodes.length; i++) {
    const epData = body.episodes[i];
    const episodeId = created[i]?.id;
    if (!episodeId || !epData.characters) continue;

    for (const charName of epData.characters) {
      const charId = charIdByName.get(charName.toLowerCase().trim());
      if (!charId) continue;
      await db.insert(episodeCharacters).values({
        id: genId(),
        episodeId,
        characterId: charId,
      });
      relationCount++;
    }
  }

  await addImportLog(
    projectId, 5, "done",
    `导入完成！创建了 ${body.characters.length} 个角色和 ${created.length} 集（${relationCount} 个角色分配）`,
    {
      episodeCount: created.length,
      characterCount: body.characters.length,
      itemCount: body.items?.length || 0,
      environmentCount: body.environments?.length || 0,
      voiceCount: body.voices?.length || 0,
      assetCount: persistedAssetRows.length,
      items: body.items || [],
      environments: body.environments || [],
      voices: body.voices || [],
      assetIds: persistedAssetRows.map((asset) => ({
        id: asset.id,
        type: asset.type,
        name: asset.name,
      })),
    }
  );

  return NextResponse.json({
    episodes: created,
    characterCount: body.characters.length,
    itemCount: body.items?.length || 0,
    environmentCount: body.environments?.length || 0,
    voiceCount: body.voices?.length || 0,
    assetCount: persistedAssetRows.length,
  }, { status: 201 });
}

