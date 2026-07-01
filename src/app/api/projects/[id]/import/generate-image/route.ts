import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const maxDuration = 300;

type AssetCategory = "characters" | "props" | "scenes" | "voices" | string;

interface GenerateImageAsset {
  id?: string;
  assetId?: string;
  name?: string;
  category?: string;
  prompt?: string;
  negativePrompt?: string;
  faceTemplate?: {
    url?: string;
  } | null;
}

interface ProviderPayload {
  model: string;
  prompt: string;
  n: number;
  size: string;
  quality: string;
  output_format: "png";
  background: "opaque";
  metadata: {
    assetId: string;
    assetName: string;
    targetName: string;
    targetType: string;
    category: string;
    referenceImages: string[];
    projectId: string;
  };
}

interface GenerateImageBody {
  prompt?: string;
  negativePrompt?: string;
  category?: AssetCategory;
  size?: string;
  quality?: string;
  targetName?: string;
  targetType?: string;
  referenceImages?: string[];
  asset?: GenerateImageAsset;
}

const generatedDir = path.join(process.cwd(), "public", "generated");

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const userId = getUserIdFromRequest(request);

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as GenerateImageBody;
  const prompt = String(body.prompt || body.asset?.prompt || "").trim();
  if (!prompt) {
    return NextResponse.json({ error: "缺少生图提示词" }, { status: 400 });
  }

  const category = String(body.category || body.asset?.category || "");
  const referenceImages = [
    ...(Array.isArray(body.referenceImages) ? body.referenceImages : []),
    ...(body.asset?.faceTemplate?.url ? [body.asset.faceTemplate.url] : []),
  ].filter((url): url is string => Boolean(url));

  const payload: ProviderPayload = {
    model: getImageModel(),
    prompt: mergePromptWithNegative(
      prompt,
      body.negativePrompt || body.asset?.negativePrompt || defaultNegativePrompt(category),
    ),
    n: 1,
    size: normalizeImageSize(String(body.size || sizeForCategory(category))),
    quality: String(body.quality || process.env.JIMAPI_IMAGE_QUALITY || "high"),
    output_format: "png",
    background: "opaque",
    metadata: {
      assetId: body.asset?.id || body.asset?.assetId || "",
      assetName: body.asset?.name || "",
      targetName: body.targetName || body.asset?.name || "",
      targetType: body.targetType || "main",
      category,
      referenceImages,
      projectId,
    },
  };

  const result = await callImage2(payload);
  return NextResponse.json(result);
}

async function callImage2(payload: ProviderPayload) {
  const endpoint = getImageEndpoint();
  const apiKey = getImageApiKey();
  if (!endpoint || !apiKey) {
    return {
      provider: "mock",
      status: "skipped",
      imageUrl: makePlaceholderImage(payload),
      request: payload,
      message: "未配置 IMAGE2/JimAPI 生图密钥，已返回本地占位图。",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.IMAGE2_TIMEOUT_MS || 300000),
  );

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(stripMetadataForProvider(payload)),
    });

    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }

    if (!response.ok) {
      return {
        provider: "jimapi:image2",
        status: "error",
        request: payload,
        error: getProviderError(json) || `image2 returned HTTP ${response.status}`,
        raw: sanitizeProviderRaw(json),
      };
    }

    const extracted = await extractImageResult(json, payload);
    return {
      provider: "jimapi:image2",
      status: "succeeded",
      request: payload,
      imageUrl: extracted.imageUrl,
      savedPath: extracted.savedPath,
      raw: sanitizeProviderRaw(json),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "image2 request failed";
    return {
      provider: "jimapi:image2",
      status: "error",
      request: payload,
      error: error instanceof Error && error.name === "AbortError"
        ? `image2 生成超过 ${process.env.IMAGE2_TIMEOUT_MS || 300000}ms，已中断。`
        : message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getImageEndpoint() {
  if (process.env.JIMAPI_IMAGE_ENDPOINT) return process.env.JIMAPI_IMAGE_ENDPOINT;
  if (process.env.IMAGE2_ENDPOINT) return process.env.IMAGE2_ENDPOINT;
  const base = (process.env.JIMAPI_BASE_URL || "https://www.jimapi.com/v1").replace(/\/+$/, "");
  return `${base}/images/generations`;
}

function getImageApiKey() {
  return process.env.JIMAPI_API_KEY || process.env.IMAGE2_API_KEY || "";
}

function getImageModel() {
  const model = process.env.JIMAPI_IMAGE_MODEL || process.env.IMAGE2_MODEL || "gpt-image-2";
  return model === "image2" ? "gpt-image-2" : model;
}

function stripMetadataForProvider(payload: ProviderPayload) {
  const providerPayload = { ...payload } as Omit<ProviderPayload, "metadata"> & { metadata?: ProviderPayload["metadata"] };
  delete providerPayload.metadata;
  return providerPayload;
}

function getProviderError(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const nestedError = record.error;
  if (typeof nestedError === "string") return nestedError;
  if (nestedError && typeof nestedError === "object") {
    const message = (nestedError as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return typeof record.message === "string" ? record.message : "";
}

function sanitizeProviderRaw(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (key === "b64_json" || key === "image_base64" || key === "base64") return "[base64 omitted]";
    if (typeof item === "string" && item.length > 500) {
      if (/^[A-Za-z0-9+/=]+$/.test(item.slice(0, 80))) return `[base64 omitted: ${item.length} chars]`;
      return `${item.slice(0, 500)}...`;
    }
    return item;
  }));
}

function mergePromptWithNegative(prompt: string, negativePrompt: string) {
  const negative = String(negativePrompt || "").trim();
  if (!negative) return prompt;
  return `${prompt}\n\n【禁止项】${negative}`;
}

function normalizeImageSize(size: string) {
  const supported = new Set(["1024x1024", "1024x1536", "1536x1024", "auto"]);
  return supported.has(size) ? size : "1536x1024";
}

function sizeForCategory(category: string) {
  if (category === "characters") return "1536x1024";
  if (category === "props") return "1536x1024";
  if (category === "scenes") return "1536x1024";
  return "1024x1024";
}

async function extractImageResult(json: unknown, payload: ProviderPayload) {
  const directUrl = extractImageUrl(json);
  if (directUrl) return { imageUrl: directUrl, savedPath: "" };

  const b64 = extractImageBase64(json);
  if (!b64) return { imageUrl: "", savedPath: "" };

  const cleanB64 = b64.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(cleanB64, "base64");
  await fs.mkdir(generatedDir, { recursive: true });
  const safeAsset = slugify(
    payload.metadata.assetName || payload.metadata.assetId || payload.metadata.targetName || "asset",
  );
  const filename = `${Date.now()}_${safeAsset}.png`;
  const outputPath = path.join(generatedDir, filename);
  await fs.writeFile(outputPath, buffer);
  return {
    imageUrl: `/generated/${filename}`,
    savedPath: outputPath,
  };
}

function extractImageUrl(value: unknown): string {
  const record = asRecord(value);
  const candidates = [
    record.imageUrl,
    record.image_url,
    record.url,
    asRecord(record.output).url,
    asRecord(record.output).image_url,
    asRecord(asArray(record.data)[0]).url,
    asRecord(asArray(record.data)[0]).image_url,
    asRecord(asArray(record.images)[0]).url,
    asRecord(asArray(record.output)[0]).url,
    asRecord(record.result).url,
  ];

  const url = candidates.find((item): item is string => typeof item === "string" && item.length > 0);
  if (!url) return "";
  return url.startsWith("http") || url.startsWith("data:image/") || url.startsWith("/")
    ? url
    : "";
}

function extractImageBase64(value: unknown): string {
  const record = asRecord(value);
  const candidates = [
    record.b64_json,
    record.image_base64,
    record.base64,
    asRecord(asArray(record.data)[0]).b64_json,
    asRecord(asArray(record.data)[0]).image_base64,
    asRecord(asArray(record.images)[0]).b64_json,
    asRecord(asArray(record.images)[0]).base64,
    asRecord(asArray(record.output)[0]).b64_json,
    asRecord(asArray(record.output)[0]).image_base64,
    asRecord(record.result).b64_json,
    asRecord(record.result).image_base64,
  ];

  return candidates.find((item): item is string => typeof item === "string" && item.length > 0) || "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function defaultNegativePrompt(category: string) {
  const common = "字幕, 文字, logo, 水印, UI, 低清晰度, 畸形, 多余肢体, 错误透视";
  if (category === "props") return `${common}, 人物, 人手, 背景环境, 反光字样`;
  if (category === "scenes") return `${common}, 人物, 人影, 行人, 现代无关物件`;
  return `${common}, 多人, 角色重复, 五官变形, 服装不一致`;
}

function makePlaceholderImage(payload: ProviderPayload) {
  const label = payload.metadata.targetName || payload.metadata.assetName || payload.metadata.category || "image2";
  const promptPreview = escapeSvg(compactText(payload.prompt, 150));
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
    <defs>
      <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stop-color="#111827"/>
        <stop offset="52%" stop-color="#1f2937"/>
        <stop offset="100%" stop-color="#0f766e"/>
      </linearGradient>
    </defs>
    <rect width="1280" height="720" fill="url(#bg)"/>
    <rect x="72" y="72" width="1136" height="576" rx="22" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.22)"/>
    <text x="110" y="145" fill="#e5e7eb" font-family="Arial, sans-serif" font-size="42" font-weight="700">image2 未配置</text>
    <text x="110" y="205" fill="#93c5fd" font-family="Arial, sans-serif" font-size="30">${escapeSvg(label)}</text>
    <foreignObject x="110" y="250" width="1040" height="310">
      <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,sans-serif;color:#d1d5db;font-size:24px;line-height:1.55;">
        ${promptPreview}
      </div>
    </foreignObject>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function compactText(text: string, maxLength: number) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned;
}

function escapeSvg(text: string) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function slugify(value: string) {
  return String(value || "asset")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "asset";
}
