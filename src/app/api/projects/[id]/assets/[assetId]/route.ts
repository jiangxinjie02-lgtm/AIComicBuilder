import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import {
  assertAssetInProject,
  deleteStoryAsset,
  patchStoryAsset,
} from "@/lib/story-assets";
import { and, eq } from "drizzle-orm";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> },
) {
  const { id: projectId, assetId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const asset = await assertAssetInProject(projectId, assetId);
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [row] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.projectId, projectId), eq(assets.id, assetId)));

  return NextResponse.json(row);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> },
) {
  const { id: projectId, assetId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const updated = await patchStoryAsset(projectId, assetId, body);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> },
) {
  const { id: projectId, assetId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const deleted = await deleteStoryAsset(projectId, assetId);
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
