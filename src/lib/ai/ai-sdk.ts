import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { splitConfiguredKeys } from "./key-pool";

export interface ProviderConfig {
  protocol: string;
  baseUrl: string;
  apiKey: string;
  secretKey?: string;
  modelId: string;
}

export function createLanguageModel(config: ProviderConfig): LanguageModel {
  switch (config.protocol) {
    case "openai": {
      const provider = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || undefined,
      });
      return provider.chat(config.modelId);
    }
    case "gemini": {
      const provider = createGoogleGenerativeAI({
        apiKey: config.apiKey,
      });
      return provider(config.modelId);
    }
    default:
      throw new Error(`Unsupported protocol: ${config.protocol}`);
  }
}

function firstConfiguredApiKey(apiKeysEnv: string[], labelPrefix: string) {
  return splitConfiguredKeys({ apiKey: "", apiKeysEnv, labelPrefix })[0]?.apiKey ?? "";
}

export function resolveLanguageModelConfig(config?: ProviderConfig | null): ProviderConfig | null {
  if (config?.apiKey) return config;

  if (process.env.OPENAI_API_KEYS || process.env.OPENAI_API_KEY) {
    const apiKey = firstConfiguredApiKey(["OPENAI_API_KEYS", "OPENAI_API_KEY"], "openai");
    if (apiKey) {
      return {
        protocol: "openai",
        baseUrl: process.env.OPENAI_BASE_URL || "",
        apiKey,
        modelId: process.env.OPENAI_MODEL || "gpt-4o",
      };
    }
  }

  if (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY) {
    const apiKey = firstConfiguredApiKey(["GEMINI_API_KEYS", "GEMINI_API_KEY"], "gemini");
    if (apiKey) {
      return {
        protocol: "gemini",
        baseUrl: process.env.GEMINI_BASE_URL || "",
        apiKey,
        modelId: process.env.GEMINI_MODEL || "gemini-2.0-flash",
      };
    }
  }

  return null;
}

export function supportsOpenAIJsonMode(config: ProviderConfig): boolean {
  if (config.protocol !== "openai") return false;
  const modelId = config.modelId.toLowerCase();
  return /^(gpt-|o\d|chatgpt-)/.test(modelId);
}

/**
 * Strip markdown code fences from AI response if present.
 */
export function extractJSON(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = match ? match[1].trim() : text.trim();
  // Remove control characters that break JSON.parse (except \n \r \t)
  const cleaned = raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
  if (cleaned.startsWith("{") || cleaned.startsWith("[")) return cleaned;

  const start = cleaned.search(/[\[{]/);
  if (start < 0) return cleaned;

  const open = cleaned[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return cleaned.slice(start, i + 1);
    }
  }

  return cleaned.slice(start);
}
