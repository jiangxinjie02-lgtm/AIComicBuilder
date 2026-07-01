import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { addImportLog } from "@/lib/import-utils";
import {
  analyzeScriptAssets,
  type AssetAgentAsset,
  type AssetAgentProject,
} from "@/lib/asset-agent/analyze-script-assets";

export const maxDuration = 300;

interface ImportedAsset {
  name: string;
  frequency: number;
  description: string;
  visualHint?: string;
  assetId?: string;
  category?: string;
  role?: string;
  roleKey?: string;
  episodes?: string[];
  prompt?: string;
  negativePrompt?: string;
  variants?: AssetAgentAsset["variants"];
  imageUrl?: string;
  history?: AssetAgentAsset["history"];
  mainImageName?: string;
  tags?: string[];
}

interface ImportedCharacter extends ImportedAsset {
  scope: "main" | "guest";
  faceTemplate?: AssetAgentAsset["faceTemplate"];
}

function toVisualHint(asset: AssetAgentAsset) {
  return asset.mainImageName || asset.tags[0] || asset.role || asset.name;
}

function isMainRole(asset: AssetAgentAsset) {
  return asset.roleKey === "maleLead" || asset.roleKey === "femaleLead" || /主角|男主|女主/.test(asset.role || "");
}

function mapCharacter(asset: AssetAgentAsset): ImportedCharacter {
  return {
    name: asset.name,
    frequency: asset.appearances || asset.score || 1,
    description: asset.description,
    visualHint: toVisualHint(asset),
    scope: isMainRole(asset) ? "main" : "guest",
    assetId: asset.id,
    category: asset.category,
    role: asset.role,
    roleKey: asset.roleKey,
    episodes: asset.episodes,
    prompt: asset.prompt,
    negativePrompt: asset.negativePrompt,
    variants: asset.variants,
    imageUrl: asset.imageUrl,
    history: asset.history,
    mainImageName: asset.mainImageName,
    tags: asset.tags,
    faceTemplate: asset.faceTemplate,
  };
}

function mapAsset(asset: AssetAgentAsset): ImportedAsset {
  return {
    name: asset.name,
    frequency: asset.appearances || asset.score || 1,
    description: asset.description,
    visualHint: toVisualHint(asset),
    assetId: asset.id,
    category: asset.category,
    role: asset.role,
    roleKey: asset.roleKey,
    episodes: asset.episodes,
    prompt: asset.prompt,
    negativePrompt: asset.negativePrompt,
    variants: asset.variants,
    imageUrl: asset.imageUrl,
    history: asset.history,
    mainImageName: asset.mainImageName,
    tags: asset.tags,
  };
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
    text?: string;
  };
  const text = String(body.text || "").trim();

  if (!text) {
    return NextResponse.json({ error: "No script text" }, { status: 400 });
  }

  await addImportLog(
    projectId,
    3,
    "running",
    "开始资产设定：使用资产 Agent 提取角色、物品、场景和音色"
  );

  let assetProject: AssetAgentProject;
  try {
    assetProject = analyzeScriptAssets({
      title: project.title,
      script: text,
      aspectRatio: "16:9",
      targetSize: "1536x1024",
      style: "真人实拍",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Asset agent failed";
    console.error("[ImportAssets] Asset agent failed:", err);
    await addImportLog(projectId, 3, "error", `资产设定失败: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const characters = assetProject.assets.characters.map(mapCharacter);
  const items = assetProject.assets.props.map(mapAsset);
  const environments = assetProject.assets.scenes.map(mapAsset);
  const voices = assetProject.assets.voices.map(mapAsset);
  const relationships: Array<{
    characterA: string;
    characterB: string;
    relationType: string;
    description?: string;
  }> = [];

  await addImportLog(
    projectId,
    3,
    "done",
    `资产设定完成，共 ${characters.length} 个角色、${items.length} 个物品、${environments.length} 个环境、${voices.length} 个音色`,
    {
      characters,
      relationships,
      items,
      environments,
      voices,
      assetAgent: {
        id: assetProject.id,
        settings: assetProject.settings,
        summary: assetProject.summary,
        stages: assetProject.stages,
      },
    }
  );

  return NextResponse.json({
    characters,
    relationships,
    items,
    environments,
    voices,
    assetAgent: {
      id: assetProject.id,
      settings: assetProject.settings,
      summary: assetProject.summary,
      stages: assetProject.stages,
    },
  });
}
