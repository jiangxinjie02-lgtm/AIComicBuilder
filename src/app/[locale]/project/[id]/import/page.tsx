"use client";

import { useEffect, useState, useCallback, useRef, use, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import {
  Upload, FileText, Users, Layers, Sparkles,
  Loader2, Check, X, ArrowLeft, AlertCircle,
  ImageIcon, Images, Plus, ChevronDown, History, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api-fetch";
import { useModelStore } from "@/stores/model-store";
import { useModelGuard } from "@/hooks/use-model-guard";
import { toast } from "sonner";

const ACCEPTED = ".txt,.docx,.pdf,.md,.markdown";
const MAX_SIZE = 20 * 1024 * 1024;

interface ExtractedCharacter {
  name: string;
  frequency: number;
  description: string;
  visualHint?: string;
  scope: "main" | "guest";
  confirmed?: boolean;
  assetId?: string;
  role?: string;
  roleKey?: string;
  episodes?: string[];
  prompt?: string;
  negativePrompt?: string;
  variants?: AssetVariant[];
  imageUrl?: string;
  history?: Array<Record<string, unknown>>;
  mainImageName?: string;
  tags?: string[];
  faceTemplate?: { label?: string; url?: string; note?: string } | null;
}

interface AssetVariant {
  id?: string;
  name: string;
  description?: string;
  prompt?: string;
  imageUrl?: string;
  history?: Array<Record<string, unknown>>;
  editInstruction?: string;
}

interface ExtractedAsset {
  name: string;
  frequency: number;
  description: string;
  visualHint?: string;
  confirmed?: boolean;
  assetId?: string;
  category?: string;
  role?: string;
  roleKey?: string;
  episodes?: string[];
  prompt?: string;
  negativePrompt?: string;
  variants?: AssetVariant[];
  imageUrl?: string;
  history?: Array<Record<string, unknown>>;
  mainImageName?: string;
  tags?: string[];
  faceTemplate?: { label?: string; url?: string; note?: string } | null;
}

type AssetTab = "characters" | "items" | "environments" | "voices";
type WorkbenchAsset = ExtractedAsset & { scope?: "main" | "guest" };
type StepStatus = Record<Step, "idle" | "running" | "done" | "error">;

function getAssetKey(asset: WorkbenchAsset, index: number, tab: AssetTab) {
  return asset.assetId || `${tab}:${asset.name}:${index}`;
}

function formatEpisodeRefs(episodes?: string[]) {
  if (!episodes?.length) return "EP1";
  if (episodes.length <= 3) return episodes.join(", ");
  return `${episodes.slice(0, 2).join(", ")} +${episodes.length - 2}`;
}

interface SplitEpisode {
  title: string;
  description: string;
  keywords: string;
  idea: string;
  characters?: string[];
}

interface LogEntry {
  id: string;
  step: number;
  status: "running" | "done" | "error";
  message: string;
  metadata?: unknown;
  createdAt: string | number;
}

interface ImportDraftState {
  currentStep?: number;
  stepStatus?: Partial<Record<Step, "idle" | "running" | "done" | "error">>;
  fullText?: string | null;
  reviewIssues?: StoryReviewIssue[] | null;
  storyAnalysis?: StoryAssetAnalysis | null;
  characters?: ExtractedCharacter[] | null;
  items?: ExtractedAsset[] | null;
  environments?: ExtractedAsset[] | null;
  voices?: ExtractedAsset[] | null;
  relationships?: Array<{ characterA: string; characterB: string; relationType: string; description?: string }> | null;
  episodes?: SplitEpisode[] | null;
  confirmedEpisodeIndexes?: number[] | null;
}

interface StoryReviewIssue {
  category: "prohibited" | "logic" | "continuity" | "setting" | "other";
  severity: "high" | "medium" | "low";
  title: string;
  exactQuote: string;
  explanation: string;
  suggestion: string;
  replacement: string;
  replaceMode?: "first" | "all";
  applied?: boolean;
}

interface StoryAssetAnalysis {
  storyMeta?: {
    time?: string;
    background?: string;
    visualStyleBase?: string;
    genre?: string;
    locationBackground?: string;
  };
  assets?: {
    characters?: Array<{ name: string; role?: string; description?: string }>;
    scenes?: Array<{ name: string; type?: string; description?: string }>;
    props?: Array<{ name: string; type?: string; description?: string }>;
  };
}

type StoryAssetSectionKey = "characters" | "scenes" | "props";

type Step = 1 | 2 | 3 | 4 | 5;

const STEPS = [
  { num: 1 as Step, icon: FileText, label: "importStep.parse" },
  { num: 2 as Step, icon: AlertCircle, label: "importStep.review" },
  { num: 3 as Step, icon: Users, label: "importStep.characters" },
  { num: 4 as Step, icon: Layers, label: "importStep.split" },
  { num: 5 as Step, icon: Sparkles, label: "importStep.generate" },
] as const;

export default function ImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("import");
  const textGuard = useModelGuard("text");
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const localLogSeq = useRef(0);
  const splitRunningRef = useRef(false);
  const draftHydratedRef = useRef(false);
  const skipNextDraftSaveRef = useRef(false);
  const saveDraftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDraftPayloadRef = useRef<ImportDraftState | null>(null);
  const hasPendingDraftSaveRef = useRef(false);

  // Pipeline state
  const [currentStep, setCurrentStep] = useState<Step | 0>(0);
  const [stepStatus, setStepStatus] = useState<StepStatus>({
    1: "idle", 2: "idle", 3: "idle", 4: "idle", 5: "idle",
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const storyReviewedRef = useRef(false);

  // Step 0: Upload
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Step 1 result
  const [fullText, setFullText] = useState("");
  const [reviewIssues, setReviewIssues] = useState<StoryReviewIssue[]>([]);
  const [storyAnalysis, setStoryAnalysis] = useState<StoryAssetAnalysis | null>(null);
  const [selectedIssueIndexes, setSelectedIssueIndexes] = useState<Set<number>>(() => new Set());
  const [activeIssueIndex, setActiveIssueIndex] = useState<number | null>(null);
  const reviewTextRef = useRef<HTMLTextAreaElement>(null);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [findMatchIndex, setFindMatchIndex] = useState(0);

  // Step 2 result
  const [characters, setCharacters] = useState<ExtractedCharacter[]>([]);
  const [items, setItems] = useState<ExtractedAsset[]>([]);
  const [environments, setEnvironments] = useState<ExtractedAsset[]>([]);
  const [voices, setVoices] = useState<ExtractedAsset[]>([]);
  const [relationships, setRelationships] = useState<Array<{ characterA: string; characterB: string; relationType: string; description?: string }>>([]);

  // Step 3 result
  const [episodes, setEpisodes] = useState<SplitEpisode[]>([]);
  const [expandedEpisodeIndexes, setExpandedEpisodeIndexes] = useState<Set<number>>(() => new Set());
  const [confirmedEpisodeIndexes, setConfirmedEpisodeIndexes] = useState<Set<number>>(() => new Set());
  const [episodeDeleteIndex, setEpisodeDeleteIndex] = useState<number | null>(null);

  // History mode
  const [historyMode, setHistoryMode] = useState(false);
  const [selectedStep, setSelectedStep] = useState<Step | null>(null);
  const [activeAssetTab, setActiveAssetTab] = useState<AssetTab>("characters");
  const [activeAssetKey, setActiveAssetKey] = useState("");
  const [assetGeneratingTargets, setAssetGeneratingTargets] = useState<string[]>([]);
  const [assetUploadingTarget, setAssetUploadingTarget] = useState<string | null>(null);
  const [assetEditingTarget, setAssetEditingTarget] = useState<string | null>(null);

  const isAssetGenerating = useCallback(
    (targetKey: string) => assetGeneratingTargets.includes(targetKey),
    [assetGeneratingTargets],
  );
  const hasAssetGenerationInTab = useCallback(
    (tab: AssetTab) => assetGeneratingTargets.some((targetKey) => targetKey.startsWith(`${tab}:`)),
    [assetGeneratingTargets],
  );
  const isAssetGenerationBlocked = useCallback(
    (tab: AssetTab, assetIndex: number, variantIndex?: number) => {
      const targetKey = `${tab}:${assetIndex}:${variantIndex ?? "main"}`;
      return (
        assetGeneratingTargets.includes(targetKey)
        || assetGeneratingTargets.includes(`${tab}:category`)
        || assetGeneratingTargets.includes(`${tab}:${assetIndex}:variants`)
      );
    },
    [assetGeneratingTargets],
  );

  function beginAssetGenerating(targetKey: string) {
    setAssetGeneratingTargets((prev) => prev.includes(targetKey) ? prev : [...prev, targetKey]);
  }

  function endAssetGenerating(targetKey: string) {
    setAssetGeneratingTargets((prev) => prev.filter((item) => item !== targetKey));
  }

  const buildDraftPayload = useCallback((): ImportDraftState => ({
    currentStep,
    stepStatus,
    fullText,
    reviewIssues,
    storyAnalysis,
    characters,
    items,
    environments,
    voices,
    relationships,
    episodes,
    confirmedEpisodeIndexes: Array.from(confirmedEpisodeIndexes),
  }), [
    currentStep,
    stepStatus,
    fullText,
    reviewIssues,
    storyAnalysis,
    characters,
    items,
    environments,
    voices,
    relationships,
    episodes,
    confirmedEpisodeIndexes,
  ]);

  const saveDraft = useCallback(async (payload?: ImportDraftState) => {
    try {
      await apiFetch(`/api/projects/${projectId}/import/state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? buildDraftPayload()),
      });
      hasPendingDraftSaveRef.current = false;
    } catch (err) {
      console.error("Import draft save error:", err);
    }
  }, [buildDraftPayload, projectId]);

  const flushDraft = useCallback(() => {
    const payload = latestDraftPayloadRef.current;
    if (!payload || !hasPendingDraftSaveRef.current) return;
    const body = JSON.stringify(payload);
    const headers: HeadersInit = { "Content-Type": "application/json" };
    const userId = typeof window !== "undefined" ? localStorage.getItem("ai_comic_uid") : null;
    if (userId) headers["x-user-id"] = userId;

    fetch(`/api/projects/${projectId}/import/state`, {
      method: "PATCH",
      headers,
      body,
      keepalive: body.length < 60000,
    }).catch((err) => {
      console.error("Import draft flush error:", err);
    });
    hasPendingDraftSaveRef.current = false;
  }, [projectId]);

  const resetDraftPayload = useCallback((): ImportDraftState => ({
    currentStep: 0,
    stepStatus: { 1: "idle", 2: "idle", 3: "idle", 4: "idle", 5: "idle" },
    fullText: "",
    reviewIssues: [],
    storyAnalysis: null,
    characters: [],
    items: [],
    environments: [],
    voices: [],
    relationships: [],
    episodes: [],
    confirmedEpisodeIndexes: [],
  }), []);

  if (draftHydratedRef.current) {
    latestDraftPayloadRef.current = buildDraftPayload();
    hasPendingDraftSaveRef.current = true;
  }

  // Load existing draft/logs on mount
  useEffect(() => {
    async function loadDraftAndLogs() {
      try {
        const [draftRes, logsRes] = await Promise.all([
          apiFetch(`/api/projects/${projectId}/import/state`),
          apiFetch(`/api/projects/${projectId}/import/logs`),
        ]);
        const draft = (await draftRes.json()) as ImportDraftState | null;
        const data = await logsRes.json();
        if (data.length > 0) {
          setLogs(data);
          setHistoryMode(true);
          // Determine last completed step
          const doneSteps = data.filter((l: LogEntry) => l.status === "done").map((l: LogEntry) => l.step);
          const maxDone = Math.max(0, ...doneSteps) as Step | 0;
          setCurrentStep(maxDone);
          const parseLog = data.find((l: LogEntry) => l.step === 1 && l.status === "done" && l.metadata);
          const parseMeta = parseLog?.metadata as { text?: string } | undefined;
          const storyLog = data.find((l: LogEntry) => l.step === 2 && l.status === "done" && l.metadata);
          const storyMeta = storyLog?.metadata as { text?: string; preview?: string; storyAnalysis?: StoryAssetAnalysis | null } | undefined;
          const restoredText = storyMeta?.text || parseMeta?.text || storyMeta?.preview;
          if (restoredText) setFullText(restoredText);
          if (storyMeta?.storyAnalysis) setStoryAnalysis(storyMeta.storyAnalysis);

          const assetLog = data.find((l: LogEntry) => l.step === 3 && l.status === "done" && l.metadata);
          const assetMeta = assetLog?.metadata as {
            characters?: ExtractedCharacter[];
            items?: ExtractedAsset[];
            environments?: ExtractedAsset[];
            voices?: ExtractedAsset[];
            relationships?: Array<{ characterA: string; characterB: string; relationType: string; description?: string }>;
          } | undefined;
          if (assetMeta?.characters) setCharacters(assetMeta.characters);
          if (assetMeta?.items) setItems(assetMeta.items);
          if (assetMeta?.environments) setEnvironments(assetMeta.environments);
          if (assetMeta?.voices) setVoices(assetMeta.voices);
          if (assetMeta?.relationships) setRelationships(assetMeta.relationships);

          const splitLog = data.find((l: LogEntry) => l.step === 4 && l.status === "done" && l.metadata);
          const splitMeta = splitLog?.metadata as { episodes?: SplitEpisode[] } | undefined;
          if (splitMeta?.episodes) {
            setEpisodes(splitMeta.episodes);
            setExpandedEpisodeIndexes(new Set());
            setConfirmedEpisodeIndexes(new Set());
          }

          for (let s = 1; s <= 5; s++) {
            const stepLogs = data.filter((l: LogEntry) => l.step === s);
            const latestStepLog = stepLogs[stepLogs.length - 1];
            if (latestStepLog) {
              setStepStatus((prev) => ({ ...prev, [s]: latestStepLog.status }));
            }
          }
        }

        if (draft) {
          if (typeof draft.currentStep === "number") {
            setCurrentStep(Math.max(0, Math.min(5, draft.currentStep)) as Step | 0);
          }
          if (draft.stepStatus) {
            setStepStatus((prev) => ({ ...prev, ...draft.stepStatus }));
          }
          if (typeof draft.fullText === "string") setFullText(draft.fullText);
          if (Array.isArray(draft.reviewIssues)) setReviewIssues(draft.reviewIssues);
          if (draft.storyAnalysis !== undefined) setStoryAnalysis(draft.storyAnalysis ?? null);
          if (Array.isArray(draft.characters)) setCharacters(draft.characters);
          if (Array.isArray(draft.items)) setItems(draft.items);
          if (Array.isArray(draft.environments)) setEnvironments(draft.environments);
          if (Array.isArray(draft.voices)) setVoices(draft.voices);
          if (Array.isArray(draft.relationships)) setRelationships(draft.relationships);
          if (Array.isArray(draft.episodes)) {
            setEpisodes(draft.episodes);
            setExpandedEpisodeIndexes(new Set());
          }
          if (Array.isArray(draft.confirmedEpisodeIndexes)) {
            setConfirmedEpisodeIndexes(new Set(draft.confirmedEpisodeIndexes));
          }
          storyReviewedRef.current = draft.stepStatus?.[2] === "done";
        }
      } catch {
        // No draft/logs, fresh import
      } finally {
        draftHydratedRef.current = true;
      }
    }
    loadDraftAndLogs();
  }, [projectId]);

  useEffect(() => {
    if (!draftHydratedRef.current) return;
    if (skipNextDraftSaveRef.current) {
      skipNextDraftSaveRef.current = false;
      return;
    }
    latestDraftPayloadRef.current = buildDraftPayload();
    hasPendingDraftSaveRef.current = true;
    if (saveDraftTimerRef.current) clearTimeout(saveDraftTimerRef.current);
    saveDraftTimerRef.current = setTimeout(() => {
      saveDraft(latestDraftPayloadRef.current ?? undefined);
    }, 1000);
    return () => {
      if (saveDraftTimerRef.current) clearTimeout(saveDraftTimerRef.current);
    };
  }, [buildDraftPayload, saveDraft]);

  useEffect(() => {
    const handlePageHide = () => {
      if (saveDraftTimerRef.current) clearTimeout(saveDraftTimerRef.current);
      flushDraft();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") handlePageHide();
    };
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      if (saveDraftTimerRef.current) clearTimeout(saveDraftTimerRef.current);
      flushDraft();
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushDraft]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const addLog = useCallback((step: Step, status: LogEntry["status"], message: string) => {
    setLogs((prev) => [
      ...prev,
      { id: `local-${Date.now()}-${localLogSeq.current++}`, step, status, message, createdAt: Date.now() },
    ]);
  }, []);

  const handleFile = useCallback((f: File) => {
    if (f.size > MAX_SIZE) {
      toast.error(t("fileTooLarge"));
      return;
    }
    setFile(f);
    storyReviewedRef.current = false;
    setHistoryMode(false);
    setSelectedStep(null);
    setCurrentStep(0);
    setFullText("");
    setReviewIssues([]);
    setStoryAnalysis(null);
    setCharacters([]);
    setItems([]);
    setEnvironments([]);
    setVoices([]);
    setRelationships([]);
    setEpisodes([]);
    setExpandedEpisodeIndexes(new Set());
    setConfirmedEpisodeIndexes(new Set());
    setStepStatus({ 1: "idle", 2: "idle", 3: "idle", 4: "idle", 5: "idle" });
    void saveDraft(resetDraftPayload());
  }, [resetDraftPayload, saveDraft, t]);

  // ── Step 1: Parse, then stop for story review ──
  async function startPipeline() {
    if (!file) return;
    if (!textGuard()) return;

    setHistoryMode(false);
    setSelectedStep(null);
    setLogs([]);
    setFullText("");
    setReviewIssues([]);
    setStoryAnalysis(null);
    setCharacters([]);
    setItems([]);
    setEnvironments([]);
    setVoices([]);
    setRelationships([]);
    setEpisodes([]);
    setExpandedEpisodeIndexes(new Set());
    setConfirmedEpisodeIndexes(new Set());
    storyReviewedRef.current = false;
    setStepStatus({ 1: "idle", 2: "idle", 3: "idle", 4: "idle", 5: "idle" });
    await saveDraft(resetDraftPayload());

    // Clear old logs
    await apiFetch(`/api/projects/${projectId}/import/logs`, { method: "DELETE" });

    // Step 1: Parse
    setCurrentStep(1);
    setStepStatus((prev) => ({ ...prev, 1: "running" }));
    addLog(1, "running", `解析文件: ${file.name}`);

    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch(`/api/projects/${projectId}/import/parse`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setFullText(data.text);
      addLog(1, "done", `解析完成，共 ${data.charCount} 字`);
      setStepStatus((prev) => ({ ...prev, 1: "done" }));
      setCurrentStep(2);
      await saveDraft({
        ...resetDraftPayload(),
        currentStep: 2,
        stepStatus: { 1: "done", 2: "idle", 3: "idle", 4: "idle", 5: "idle" },
        fullText: data.text,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Parse failed";
      addLog(1, "error", `文件解析失败: ${msg}`);
      setStepStatus((prev) => ({ ...prev, 1: "error" }));
      return;
    }
  }

  // ── Step 2: AI story review, then human review gate ──
  async function runStoryReview(text: string = fullText) {
    if (!text.trim()) return;
    if (!textGuard()) return;

    setCurrentStep(2);
    setStepStatus((prev) => ({ ...prev, 2: "running" }));
    setReviewIssues([]);
    addLog(2, "running", "开始 AI 剧情审阅...");

    try {
      setSelectedIssueIndexes(new Set());
      setActiveIssueIndex(null);
      const res = await apiFetch(`/api/projects/${projectId}/import/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, modelConfig: getModelConfig(), reviewConcurrency: 3 }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json() as {
        issues: StoryReviewIssue[];
        storyAnalysis?: StoryAssetAnalysis | null;
        usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
      };
      setReviewIssues(data.issues || []);
      setStoryAnalysis(data.storyAnalysis || null);
      const usageParts = [
        typeof data.usage?.inputTokens === "number" ? `输入 ${data.usage.inputTokens}` : null,
        typeof data.usage?.outputTokens === "number" ? `输出 ${data.usage.outputTokens}` : null,
        typeof data.usage?.totalTokens === "number" ? `合计 ${data.usage.totalTokens}` : null,
      ].filter(Boolean);
      const usageSuffix = usageParts.length > 0 ? `，token：${usageParts.join(" / ")}` : "";
      addLog(2, "done", data.issues?.length ? `AI 剧情审阅完成，发现 ${data.issues.length} 个问题${usageSuffix}` : `AI 剧情审阅完成，未发现明显问题${usageSuffix}`);
      setStepStatus((prev) => ({ ...prev, 2: "idle" }));
      await saveDraft({
        ...buildDraftPayload(),
        currentStep: 2,
        stepStatus: { ...stepStatus, 1: "done", 2: "idle" },
        fullText: text,
        reviewIssues: data.issues || [],
        storyAnalysis: data.storyAnalysis || null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Review failed";
      addLog(2, "error", `AI 剧情审阅失败: ${msg}`);
      setStepStatus((prev) => ({ ...prev, 2: "error" }));
    }
  }

  function scrollAndSelectQuote(issue: StoryReviewIssue, index: number) {
    const textarea = reviewTextRef.current;
    if (!textarea || !issue.exactQuote) return;

    const pos = fullText.indexOf(issue.exactQuote);
    if (pos < 0) {
      toast.error(t("reviewQuoteMissing"));
      return;
    }

    const end = pos + issue.exactQuote.length;
    textarea.focus();
    textarea.setSelectionRange(pos, end);

    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight || "20") || 20;
    const linesBefore = textarea.value.slice(0, pos).split("\n").length - 1;
    const targetScrollTop = Math.max(0, linesBefore * lineHeight - textarea.clientHeight / 2);
    textarea.scrollTop = targetScrollTop;

    setActiveIssueIndex(index);
  }

  const findMatches = useMemo(() => {
    if (!findText) return [] as number[];
    const matches: number[] = [];
    let index = fullText.indexOf(findText);
    while (index >= 0) {
      matches.push(index);
      index = fullText.indexOf(findText, index + Math.max(findText.length, 1));
    }
    return matches;
  }, [findText, fullText]);

  function selectTextRange(start: number, length: number) {
    const textarea = reviewTextRef.current;
    if (!textarea) return;

    textarea.focus();
    textarea.setSelectionRange(start, start + length);

    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight || "20") || 20;
    const linesBefore = textarea.value.slice(0, start).split("\n").length - 1;
    textarea.scrollTop = Math.max(0, linesBefore * lineHeight - textarea.clientHeight / 2);
  }

  function findNextMatch() {
    if (findMatches.length === 0) {
      if (findText) toast.error("未找到匹配文本");
      return;
    }
    const nextIndex = findMatchIndex % findMatches.length;
    setFindMatchIndex(nextIndex + 1);
    selectTextRange(findMatches[nextIndex], findText.length);
  }

  function replaceCurrentMatch() {
    if (!findText) return;
    const textarea = reviewTextRef.current;
    const selectionStart = textarea?.selectionStart ?? -1;
    const selectionEnd = textarea?.selectionEnd ?? -1;
    const selectedText = selectionStart >= 0 && selectionEnd > selectionStart
      ? fullText.slice(selectionStart, selectionEnd)
      : "";
    const replaceAt = selectedText === findText
      ? selectionStart
      : findMatches[findMatchIndex > 0 ? Math.min(findMatchIndex - 1, findMatches.length - 1) : 0];

    if (replaceAt === undefined || replaceAt < 0) {
      toast.error("未找到匹配文本");
      return;
    }

    const nextText = fullText.slice(0, replaceAt) + replaceText + fullText.slice(replaceAt + findText.length);
    setFullText(nextText);
    requestAnimationFrame(() => selectTextRange(replaceAt, replaceText.length));
  }

  function replaceAllMatches() {
    if (!findText || findMatches.length === 0) {
      toast.error("未找到匹配文本");
      return;
    }
    setFullText((prev) => prev.split(findText).join(replaceText));
    setFindMatchIndex(0);
  }

  function applyStoryIssue(index: number) {
    const issue = reviewIssues[index];
    if (!issue || issue.applied) return;
    if (!fullText.includes(issue.exactQuote)) {
      toast.error(t("reviewQuoteMissing"));
      return;
    }
    setFullText((prev) => issue.replaceMode === "all"
      ? prev.split(issue.exactQuote).join(issue.replacement)
      : prev.replace(issue.exactQuote, issue.replacement)
    );
    setReviewIssues((prev) => prev.map((item, idx) => idx === index ? { ...item, applied: true } : item));
    setSelectedIssueIndexes((prev) => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
  }

  function applyStoryIssueIndexes(indexes: number[]) {
    const targets = new Set(indexes);
    let nextText = fullText;
    const nextIssues = reviewIssues.map((issue, index) => {
      if (!targets.has(index) || issue.applied || !nextText.includes(issue.exactQuote)) return issue;
      nextText = issue.replaceMode === "all"
        ? nextText.split(issue.exactQuote).join(issue.replacement)
        : nextText.replace(issue.exactQuote, issue.replacement);
      return { ...issue, applied: true };
    });
    setFullText(nextText);
    setReviewIssues(nextIssues);
    setSelectedIssueIndexes((prev) => {
      const next = new Set(prev);
      indexes.forEach((index) => next.delete(index));
      return next;
    });
  }

  function applySelectedStoryIssues() {
    const indexes = Array.from(selectedIssueIndexes)
      .filter((index) => {
        const issue = reviewIssues[index];
        return issue && !issue.applied && fullText.includes(issue.exactQuote);
      })
      .sort((a, b) => a - b);
    if (indexes.length === 0) {
      toast.error(t("reviewQuoteMissing"));
      return;
    }
    applyStoryIssueIndexes(indexes);
  }

  function applyAllStoryIssues() {
    applyStoryIssueIndexes(reviewIssues.map((_, index) => index));
  }

  function toggleIssueSelection(index: number) {
    setSelectedIssueIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  function toggleAllIssueSelection() {
    const selectableIndexes = reviewIssues
      .map((issue, index) => ({ issue, index }))
      .filter(({ issue }) => !issue.applied && fullText.includes(issue.exactQuote))
      .map(({ index }) => index);
    const allSelected = selectableIndexes.length > 0 && selectableIndexes.every((index) => selectedIssueIndexes.has(index));

    setSelectedIssueIndexes(allSelected ? new Set() : new Set(selectableIndexes));
  }

  async function confirmStoryReview() {
    if (!fullText.trim()) return;
    storyReviewedRef.current = true;
    await apiFetch(`/api/projects/${projectId}/import/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        step: 2,
        status: "done",
        message: `剧情审阅通过，共 ${fullText.length} 字`,
        metadata: { charCount: fullText.length, preview: fullText.slice(0, 2000), text: fullText, storyAnalysis },
      }),
    });
    setCurrentStep(3);
    setStepStatus((prev) => ({ ...prev, 2: "done" }));
    addLog(2, "done", `剧情审阅通过，共 ${fullText.length} 字`);
    await saveDraft({
      ...buildDraftPayload(),
      currentStep: 3,
      stepStatus: { ...stepStatus, 2: "done" },
      fullText,
      reviewIssues,
      storyAnalysis,
    });
    await runCharacterExtract();
  }

  function ensureEditableStoryAnalysis(): StoryAssetAnalysis {
    return {
      storyMeta: storyAnalysis?.storyMeta || {},
      assets: {
        characters: storyAnalysis?.assets?.characters || [],
        scenes: storyAnalysis?.assets?.scenes || [],
        props: storyAnalysis?.assets?.props || [],
      },
    };
  }

  function updateStoryMetaField(field: keyof NonNullable<StoryAssetAnalysis["storyMeta"]>, value: string) {
    setStoryAnalysis((prev) => ({
      ...(prev || {}),
      storyMeta: {
        ...(prev?.storyMeta || {}),
        [field]: value,
      },
      assets: prev?.assets || { characters: [], scenes: [], props: [] },
    }));
  }

  function updateStoryAssetItem(section: StoryAssetSectionKey, index: number, patch: Record<string, string>) {
    setStoryAnalysis((prev) => {
      const base = prev || ensureEditableStoryAnalysis();
      const assets = {
        characters: base.assets?.characters || [],
        scenes: base.assets?.scenes || [],
        props: base.assets?.props || [],
      };
      const list = [...assets[section]];
      list[index] = { ...list[index], ...patch };
      return { ...base, assets: { ...assets, [section]: list } };
    });
  }

  function addStoryAssetItem(section: StoryAssetSectionKey) {
    setStoryAnalysis((prev) => {
      const base = prev || ensureEditableStoryAnalysis();
      const assets = {
        characters: base.assets?.characters || [],
        scenes: base.assets?.scenes || [],
        props: base.assets?.props || [],
      };
      const blank =
        section === "characters"
          ? { name: "", role: "配角", description: "" }
          : { name: "", type: section === "scenes" ? "场景空间" : "剧情道具", description: "" };
      return { ...base, assets: { ...assets, [section]: [...assets[section], blank] } };
    });
  }

  function removeStoryAssetItem(section: StoryAssetSectionKey, index: number) {
    setStoryAnalysis((prev) => {
      if (!prev) return prev;
      const assets = {
        characters: prev.assets?.characters || [],
        scenes: prev.assets?.scenes || [],
        props: prev.assets?.props || [],
      };
      return {
        ...prev,
        assets: {
          ...assets,
          [section]: assets[section].filter((_, itemIndex) => itemIndex !== index),
        },
      };
    });
  }

  // ── Step 3: Asset setting foundation - character extraction ──
  async function runCharacterExtract() {
    if (!fullText) return;
    if (!storyReviewedRef.current && stepStatus[2] !== "done") {
      setCurrentStep(2);
      setStepStatus((prev) => ({ ...prev, 2: "idle", 3: "idle" }));
      return;
    }
    setCurrentStep(3);
    setStepStatus((prev) => ({ ...prev, 3: "running" }));
    addLog(3, "running", "开始资产设定：提取角色、物品、场景和音色...");

    try {
      const res = await apiFetch(`/api/projects/${projectId}/import/characters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: fullText, storyAnalysis }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setCharacters(data.characters);
      setItems(data.items || []);
      setEnvironments(data.environments || []);
      setVoices(data.voices || []);
      setRelationships(data.relationships || []);
      const mainCount = data.characters.filter((c: ExtractedCharacter) => c.scope === "main").length;
      const guestCount = data.characters.length - mainCount;
      addLog(3, "done", `资产设定完成: ${mainCount} 个主角, ${guestCount} 个配角, ${(data.items || []).length} 个物品, ${(data.environments || []).length} 个环境, ${(data.voices || []).length} 个音色`);
      setStepStatus((prev) => ({ ...prev, 3: "done" }));
      await saveDraft({
        ...buildDraftPayload(),
        currentStep: 3,
        stepStatus: { ...stepStatus, 3: "done" },
        characters: data.characters,
        items: data.items || [],
        environments: data.environments || [],
        voices: data.voices || [],
        relationships: data.relationships || [],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Extract failed";
      addLog(3, "error", `资产设定失败: ${msg}`);
      setStepStatus((prev) => ({ ...prev, 3: "error" }));
      return;
    }
  }

  // ── Step 3 only: Retry character extraction / asset setting ──
  async function retryCharacterExtract() {
    if (!fullText) return;
    await runCharacterExtract();
  }

  // ── Step 4: Split (triggered by user after reviewing asset settings) ──
  async function runSplit() {
    if (splitRunningRef.current || stepStatus[4] === "running") return;
    const assets = [...characters, ...items, ...environments, ...voices];
    const unconfirmedAssets = assets.filter((asset) => asset.confirmed === false);
    if (!assets.length || unconfirmedAssets.length > 0) {
      toast.error(`请先确认全部资产（${assets.length - unconfirmedAssets.length}/${assets.length}）`);
      return;
    }

    splitRunningRef.current = true;
    setCurrentStep(4);
    setStepStatus((prev) => ({ ...prev, 4: "running" }));
    addLog(4, "running", "开始自动分集...");

    try {
      const res = await apiFetch(`/api/projects/${projectId}/import/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: fullText,
          allCharacters: characters.map((c) => ({ name: c.name, scope: c.scope })),
          allItems: items.map((item) => ({ name: item.name })),
          allEnvironments: environments.map((env) => ({ name: env.name })),
          modelConfig: getModelConfig(),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setEpisodes(data.episodes);
      setExpandedEpisodeIndexes(new Set());
      setConfirmedEpisodeIndexes(new Set());
      addLog(4, "done", `分集完成，共 ${data.episodes.length} 集`);
      setStepStatus((prev) => ({ ...prev, 4: "done" }));
      await saveDraft({
        ...buildDraftPayload(),
        currentStep: 4,
        stepStatus: { ...stepStatus, 4: "done" },
        episodes: data.episodes,
        confirmedEpisodeIndexes: [],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Split failed";
      addLog(4, "error", `分集失败: ${msg}`);
      setStepStatus((prev) => ({ ...prev, 4: "error" }));
    } finally {
      splitRunningRef.current = false;
    }
  }

  // ── Step 5: Generate (triggered by user after reviewing episodes) ──
  async function runGenerate() {
    if (episodes.length === 0 || confirmedEpisodeIndexes.size !== episodes.length) {
      toast.error(t("confirmAllEpisodesRequired"));
      return;
    }

    setCurrentStep(5);
    setStepStatus((prev) => ({ ...prev, 5: "running" }));
    addLog(5, "running", `创建 ${episodes.length} 集和角色...`);

    try {
      const res = await apiFetch(`/api/projects/${projectId}/import/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodes,
          characters,
          items,
          environments,
          voices,
          relationships,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      addLog(5, "done", `导入完成！创建了 ${data.characterCount} 个角色、${data.itemCount || 0} 个物品、${data.environmentCount || 0} 个环境、${data.voiceCount || 0} 个音色和 ${data.episodes.length} 集`);
      setStepStatus((prev) => ({ ...prev, 5: "done" }));
      toast.success(t("complete"));
      setTimeout(() => {
        router.push(`/${locale}/project/${projectId}/episodes`);
      }, 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generate failed";
      addLog(5, "error", `创建失败: ${msg}`);
      setStepStatus((prev) => ({ ...prev, 5: "error" }));
    }
  }

  // Retry handler for any failed step
  function retryStep() {
    const failedStep = ([1, 2, 3, 4, 5] as Step[]).find((s) => stepStatus[s] === "error");
    if (!failedStep) return;
    switch (failedStep) {
      case 1: // Re-run full pipeline (need file again)
        startPipeline();
        break;
      case 2:
        runStoryReview();
        break;
      case 3:
        retryCharacterExtract();
        break;
      case 4:
        runSplit();
        break;
      case 5:
        runGenerate();
        break;
    }
  }

  function updateEpisode(idx: number, field: keyof SplitEpisode, value: string) {
    setEpisodes((prev) =>
      prev.map((ep, i) => (i === idx ? { ...ep, [field]: value } : ep))
    );
    setConfirmedEpisodeIndexes((prev) => {
      if (!prev.has(idx)) return prev;
      const next = new Set(prev);
      next.delete(idx);
      return next;
    });
  }

  function removeEpisode(idx: number) {
    setEpisodes((prev) => prev.filter((_, i) => i !== idx));
    setExpandedEpisodeIndexes((prev) => {
      const next = new Set<number>();
      prev.forEach((index) => {
        if (index < idx) next.add(index);
        if (index > idx) next.add(index - 1);
      });
      return next;
    });
    setConfirmedEpisodeIndexes((prev) => {
      const next = new Set<number>();
      prev.forEach((index) => {
        if (index < idx) next.add(index);
        if (index > idx) next.add(index - 1);
      });
      return next;
    });
    setEpisodeDeleteIndex(null);
  }

  function toggleEpisodeExpanded(idx: number) {
    setExpandedEpisodeIndexes((prev) => {
      if (prev.has(idx)) return new Set();
      return new Set([idx]);
    });
  }

  function confirmEpisode(idx: number) {
    setConfirmedEpisodeIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  }

  function confirmAllEpisodes() {
    setConfirmedEpisodeIndexes(new Set(episodes.map((_, index) => index)));
  }

  function goToStep(step: Step) {
    if (step === 1 && (stepStatus[2] === "done" || currentStep >= 3)) return;

    setHistoryMode(false);
    setSelectedStep(null);
    setCurrentStep(step);

    if (step <= 2) {
      storyReviewedRef.current = false;
      setCharacters([]);
      setItems([]);
      setEnvironments([]);
      setVoices([]);
      setRelationships([]);
      setEpisodes([]);
      setExpandedEpisodeIndexes(new Set());
      setConfirmedEpisodeIndexes(new Set());
      setStepStatus((prev) => ({
        ...prev,
        2: "idle",
        3: "idle",
        4: "idle",
        5: "idle",
      }));
      return;
    }

    if (step === 3) {
      setEpisodes([]);
      setExpandedEpisodeIndexes(new Set());
      setConfirmedEpisodeIndexes(new Set());
      setStepStatus((prev) => ({
        ...prev,
        3: prev[3] === "idle" ? "done" : prev[3],
        4: "idle",
        5: "idle",
      }));
      return;
    }

    if (step === 4) {
      setStepStatus((prev) => ({
        ...prev,
        4: prev[4] === "idle" ? "done" : prev[4],
        5: "idle",
      }));
    }
  }

  const stepIcon = (status: string) => {
    switch (status) {
      case "running": return <Loader2 className="h-4 w-4 animate-spin" />;
      case "done": return <Check className="h-4 w-4" />;
      case "error": return <AlertCircle className="h-4 w-4" />;
      default: return null;
    }
  };

  const stepColor = (status: string, selected: boolean) => {
    const base = (() => {
      switch (status) {
        case "running": return "border-primary/30 bg-primary/5 text-primary";
        case "done": return "border-transparent bg-[--surface] text-[--text-primary]";
        case "error": return "border-red-300 bg-red-50 text-red-500";
        default: return "border-transparent bg-[--surface] text-[--text-muted]";
      }
    })();
    if (selected) return base + " !bg-primary/10 !border-primary/40 !text-primary shadow-sm";
    return base;
  };

  const showStoryReview = currentStep === 2 && stepStatus[1] === "done" && stepStatus[2] !== "done" && !historyMode;
  const showCharReview = stepStatus[3] === "done" && stepStatus[4] === "idle" && !historyMode;
  const showEpReview = stepStatus[4] === "done" && stepStatus[5] === "idle" && !historyMode;
  const hideParseStep = stepStatus[2] === "done" || currentStep >= 3;
  const visibleSteps = hideParseStep ? STEPS.filter(({ num }) => num !== 1) : STEPS;
  const reviewRunning = stepStatus[2] === "running";
  const unappliedIssueCount = reviewIssues.filter((issue) => !issue.applied).length;
  const selectableIssueIndexes = reviewIssues
    .map((issue, index) => ({ issue, index }))
    .filter(({ issue }) => !issue.applied && fullText.includes(issue.exactQuote))
    .map(({ index }) => index);
  const selectedApplicableIssueCount = selectableIssueIndexes.filter((index) => selectedIssueIndexes.has(index)).length;
  const allSelectableIssuesSelected = selectableIssueIndexes.length > 0
    && selectableIssueIndexes.every((index) => selectedIssueIndexes.has(index));
  const severityLabel: Record<StoryReviewIssue["severity"], string> = {
    high: t("severityHigh"),
    medium: t("severityMedium"),
    low: t("severityLow"),
  };

  const activeAssetList = useMemo<WorkbenchAsset[]>(() => {
    if (activeAssetTab === "characters") return characters;
    if (activeAssetTab === "items") return items;
    if (activeAssetTab === "environments") return environments;
    return voices;
  }, [activeAssetTab, characters, items, environments, voices]);
  const activeAssetIndex = activeAssetList.findIndex((asset, index) =>
    getAssetKey(asset, index, activeAssetTab) === activeAssetKey
  );
  const activeWorkbenchAsset = activeAssetIndex >= 0 ? activeAssetList[activeAssetIndex] : activeAssetList[0];
  const activeWorkbenchAssetIndex = activeAssetIndex >= 0 ? activeAssetIndex : activeAssetList.length ? 0 : -1;
  const activeWorkbenchKey = activeWorkbenchAssetIndex >= 0
    ? getAssetKey(activeWorkbenchAsset, activeWorkbenchAssetIndex, activeAssetTab)
    : "";

  useEffect(() => {
    if (!activeAssetList.length) {
      if (activeAssetKey) setActiveAssetKey("");
      return;
    }
    const exists = activeAssetList.some((asset, index) => getAssetKey(asset, index, activeAssetTab) === activeAssetKey);
    if (!exists) {
      setActiveAssetKey(getAssetKey(activeAssetList[0], 0, activeAssetTab));
    }
  }, [activeAssetKey, activeAssetList, activeAssetTab]);

  function updateActiveWorkbenchAsset(patch: Partial<WorkbenchAsset>) {
    if (activeWorkbenchAssetIndex < 0) return;
    if (activeAssetTab === "characters") {
      setCharacters((prev) => prev.map((asset, index) => index === activeWorkbenchAssetIndex ? { ...asset, ...patch } as ExtractedCharacter : asset));
    } else if (activeAssetTab === "items") {
      setItems((prev) => prev.map((asset, index) => index === activeWorkbenchAssetIndex ? { ...asset, ...patch } : asset));
    } else if (activeAssetTab === "environments") {
      setEnvironments((prev) => prev.map((asset, index) => index === activeWorkbenchAssetIndex ? { ...asset, ...patch } : asset));
    } else {
      setVoices((prev) => prev.map((asset, index) => index === activeWorkbenchAssetIndex ? { ...asset, ...patch } : asset));
    }
  }

  function getAssetSetter(tab: AssetTab): Dispatch<SetStateAction<WorkbenchAsset[]>> {
    if (tab === "characters") return setCharacters as Dispatch<SetStateAction<WorkbenchAsset[]>>;
    if (tab === "items") return setItems as Dispatch<SetStateAction<WorkbenchAsset[]>>;
    if (tab === "environments") return setEnvironments as Dispatch<SetStateAction<WorkbenchAsset[]>>;
    return setVoices as Dispatch<SetStateAction<WorkbenchAsset[]>>;
  }

  function assetCategoryForTab(tab: AssetTab) {
    if (tab === "items") return "props";
    if (tab === "environments") return "scenes";
    return tab;
  }

  function sizeForAssetTab(tab: AssetTab) {
    return tab === "voices" ? "1024x1024" : "1536x1024";
  }

  function makeHistoryEntry(result: Record<string, unknown>) {
    return {
      at: new Date().toISOString(),
      provider: result.provider,
      status: result.status,
      imageUrl: result.imageUrl || "",
    };
  }

  function makeManualHistoryEntry(result: Record<string, unknown>, note: string) {
    return {
      at: new Date().toISOString(),
      provider: result.provider || "manual-upload",
      status: result.status || "succeeded",
      imageUrl: result.imageUrl || "",
      note,
    };
  }

  function formatHistoryTime(value: unknown) {
    if (typeof value !== "string") return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function getHistoryLabel(entry: Record<string, unknown>) {
    const provider = typeof entry.provider === "string" ? entry.provider : "history";
    const status = typeof entry.status === "string" ? entry.status : "";
    const instruction = typeof entry.editInstruction === "string" ? entry.editInstruction : "";
    const note = typeof entry.note === "string" ? entry.note : "";
    return instruction || note || `${provider}${status ? ` · ${status}` : ""}`;
  }

  function patchWorkbenchAsset(
    tab: AssetTab,
    assetIndex: number,
    patcher: (asset: WorkbenchAsset) => WorkbenchAsset,
  ) {
    const setter = getAssetSetter(tab);
    setter((prev) => prev.map((asset, index) => index === assetIndex ? patcher(asset) : asset));
  }

  async function generateWorkbenchAsset(
    tab: AssetTab,
    assetIndex: number,
    variantIndex?: number,
    options: { quiet?: boolean; keepBusy?: boolean; referenceImages?: string[] } = {},
  ) {
    if (tab === "voices") return false;
    const sourceList = tab === "characters" ? characters : tab === "items" ? items : environments;
    const asset = sourceList[assetIndex] as WorkbenchAsset | undefined;
    if (!asset) return false;

    const variant = typeof variantIndex === "number" ? asset.variants?.[variantIndex] : undefined;
    const target = variant || asset;
    const prompt = target.prompt || asset.prompt || "";
    if (!prompt.trim()) {
      toast.error(t("assetPromptMissing"));
      return false;
    }

    const targetKey = `${tab}:${assetIndex}:${variantIndex ?? "main"}`;
    if (!options.keepBusy) beginAssetGenerating(targetKey);

    try {
      const res = await apiFetch(`/api/projects/${projectId}/import/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: assetCategoryForTab(tab),
          asset,
          prompt,
          negativePrompt: asset.negativePrompt,
          size: sizeForAssetTab(tab),
          targetName: target.name,
          targetType: variant ? "variant" : "main",
          referenceImages: [
            ...(options.referenceImages || []),
            ...(asset.faceTemplate?.url ? [asset.faceTemplate.url] : []),
          ],
        }),
      });
      const result = await res.json();
      if (result.status === "error") throw new Error(result.error || "image2 生成失败");

      patchWorkbenchAsset(tab, assetIndex, (current) => {
        const historyEntry = makeHistoryEntry(result);
        if (typeof variantIndex === "number") {
          const variants = [...(current.variants || [])];
          const currentVariant = variants[variantIndex];
          if (!currentVariant) return current;
          variants[variantIndex] = {
            ...currentVariant,
            imageUrl: result.imageUrl || "",
            history: [historyEntry, ...(currentVariant.history || [])],
          };
          return { ...current, variants };
        }
        return {
          ...current,
          imageUrl: result.imageUrl || "",
          history: [historyEntry, ...(current.history || [])],
        };
      });

      if (!options.quiet) toast.success(t("assetGenerateSuccess", { name: target.name || asset.name }));
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "image2 生成失败";
      patchWorkbenchAsset(tab, assetIndex, (current) => {
        const failedEntry = {
          at: new Date().toISOString(),
          provider: "jimapi:image2",
          status: "failed",
          error: msg,
        };
        if (typeof variantIndex === "number") {
          const variants = [...(current.variants || [])];
          const currentVariant = variants[variantIndex];
          if (!currentVariant) return current;
          variants[variantIndex] = {
            ...currentVariant,
            history: [failedEntry, ...(currentVariant.history || [])],
          };
          return { ...current, variants };
        }
        return {
          ...current,
          history: [failedEntry, ...(current.history || [])],
        };
      });
      if (!options.quiet) toast.error(msg);
      return false;
    } finally {
      if (!options.keepBusy) endAssetGenerating(targetKey);
    }
  }

  async function downloadWorkbenchImage(imageUrl: string, filenameBase: string) {
    const filename = `${slugifyFileName(filenameBase || "image")}.png`;
    try {
      const res = await fetch(imageUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`download failed: ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      triggerDownload(objectUrl, filename);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      triggerDownload(imageUrl, filename);
    }
  }

  function triggerDownload(href: string, filename: string) {
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    link.rel = "noreferrer";
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function slugifyFileName(value: string) {
    return String(value || "image")
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "image";
  }

  async function generateActiveWorkbenchAsset(variantIndex?: number) {
    if (activeWorkbenchAssetIndex < 0) return;
    await generateWorkbenchAsset(activeAssetTab, activeWorkbenchAssetIndex, variantIndex);
  }

  async function generateActiveWorkbenchVariantsFromMain() {
    if (activeWorkbenchAssetIndex < 0 || activeAssetTab === "voices") return;
    const asset = activeWorkbenchAsset;
    if (!asset?.imageUrl) {
      toast.error("请先生成或上传主图");
      return;
    }
    const variants = asset.variants || [];
    if (!variants.length) return;

    const variantsTargetKey = `${activeAssetTab}:${activeWorkbenchAssetIndex}:variants`;
    beginAssetGenerating(variantsTargetKey);
    let successCount = 0;
    for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
      const ok = await generateWorkbenchAsset(activeAssetTab, activeWorkbenchAssetIndex, variantIndex, {
        quiet: true,
        keepBusy: true,
        referenceImages: [asset.imageUrl],
      });
      if (ok) successCount += 1;
    }
    endAssetGenerating(variantsTargetKey);
    toast.success(`已生成 ${successCount}/${variants.length} 个变体`);
  }

  async function uploadWorkbenchImage(file: File, variantIndex?: number) {
    if (activeWorkbenchAssetIndex < 0 || activeAssetTab === "voices") return;
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }
    const targetKey = `${activeAssetTab}:${activeWorkbenchAssetIndex}:${variantIndex ?? "main"}`;
    setAssetUploadingTarget(targetKey);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("targetType", typeof variantIndex === "number" ? "variant" : "main");
      formData.append("targetName", typeof variantIndex === "number"
        ? activeWorkbenchAsset?.variants?.[variantIndex]?.name || ""
        : activeWorkbenchAsset?.name || "");

      const res = await apiFetch(`/api/projects/${projectId}/import/upload-image`, {
        method: "POST",
        body: formData,
      });
      const result = await res.json();
      if (result.status === "error") throw new Error(result.error || "上传失败");

      patchWorkbenchAsset(activeAssetTab, activeWorkbenchAssetIndex, (current) => {
        const historyEntry = makeManualHistoryEntry(result, "手动上传");
        if (typeof variantIndex === "number") {
          const variants = [...(current.variants || [])];
          const currentVariant = variants[variantIndex];
          if (!currentVariant) return current;
          variants[variantIndex] = {
            ...currentVariant,
            imageUrl: result.imageUrl || "",
            history: [historyEntry, ...(currentVariant.history || [])],
          };
          return { ...current, variants };
        }
        return {
          ...current,
          imageUrl: result.imageUrl || "",
          history: [historyEntry, ...(current.history || [])],
        };
      });

      toast.success("图片已上传");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "上传失败");
    } finally {
      setAssetUploadingTarget(null);
    }
  }

  function updateVariantEditInstruction(variantIndex: number, editInstruction: string) {
    if (activeWorkbenchAssetIndex < 0) return;
    patchWorkbenchAsset(activeAssetTab, activeWorkbenchAssetIndex, (current) => {
      const variants = [...(current.variants || [])];
      const currentVariant = variants[variantIndex];
      if (!currentVariant) return current;
      variants[variantIndex] = { ...currentVariant, editInstruction };
      return { ...current, variants };
    });
  }

  async function editWorkbenchVariant(variantIndex: number) {
    if (activeWorkbenchAssetIndex < 0 || activeAssetTab === "voices") return;
    const asset = activeWorkbenchAsset;
    const variant = asset?.variants?.[variantIndex];
    if (!asset || !variant) return;
    if (!variant.imageUrl) {
      toast.error("请先生成或上传变体图");
      return;
    }
    const editInstruction = String(variant.editInstruction || "").trim();
    if (!editInstruction) {
      toast.error("请先填写改图要求");
      return;
    }

    const targetKey = `${activeAssetTab}:${activeWorkbenchAssetIndex}:${variantIndex}`;
    setAssetEditingTarget(targetKey);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/import/edit-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: variant.imageUrl,
          editPrompt: editInstruction,
          prompt: variant.prompt || asset.prompt || "",
          negativePrompt: asset.negativePrompt,
          category: assetCategoryForTab(activeAssetTab),
          asset,
          size: sizeForAssetTab(activeAssetTab),
          targetName: variant.name,
          targetType: "variant-edit",
        }),
      });
      const result = await res.json();
      if (result.status === "error") throw new Error(result.error || "改图失败");

      patchWorkbenchAsset(activeAssetTab, activeWorkbenchAssetIndex, (current) => {
        const variants = [...(current.variants || [])];
        const currentVariant = variants[variantIndex];
        if (!currentVariant) return current;
        const historyEntry = {
          ...makeHistoryEntry(result),
          editInstruction,
          sourceImageUrl: currentVariant.imageUrl || "",
        };
        variants[variantIndex] = {
          ...currentVariant,
          imageUrl: result.imageUrl || currentVariant.imageUrl,
          editInstruction: "",
          history: [historyEntry, ...(currentVariant.history || [])],
        };
        return { ...current, variants };
      });

      toast.success("变体已改图");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "改图失败";
      patchWorkbenchAsset(activeAssetTab, activeWorkbenchAssetIndex, (current) => {
        const variants = [...(current.variants || [])];
        const currentVariant = variants[variantIndex];
        if (!currentVariant) return current;
        variants[variantIndex] = {
          ...currentVariant,
          history: [{
            at: new Date().toISOString(),
            provider: "jimapi:image-edit",
            status: "failed",
            editInstruction,
            error: msg,
          }, ...(currentVariant.history || [])],
        };
        return { ...current, variants };
      });
      toast.error(msg);
    } finally {
      setAssetEditingTarget(null);
    }
  }

  async function generateCurrentAssetTab() {
    if (activeAssetTab === "voices") return;
    const tab = activeAssetTab;
    const list = tab === "characters" ? characters : tab === "items" ? items : environments;
    if (!list.length) return;
    const categoryTargetKey = `${tab}:category`;
    beginAssetGenerating(categoryTargetKey);

    let successCount = 0;
    for (let assetIndex = 0; assetIndex < list.length; assetIndex += 1) {
      if (await generateWorkbenchAsset(tab, assetIndex, undefined, { quiet: true, keepBusy: true })) successCount += 1;
      const variants = list[assetIndex].variants || [];
      for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
        if (await generateWorkbenchAsset(tab, assetIndex, variantIndex, { quiet: true, keepBusy: true })) successCount += 1;
      }
    }

    toast.success(t("assetGenerateBatchSuccess", { count: successCount }));
    endAssetGenerating(categoryTargetKey);
  }

  function assetTabInfo(tab: AssetTab) {
    if (tab === "characters") return { label: t("assetCharacters"), count: characters.length };
    if (tab === "items") return { label: t("assetItems"), count: items.length };
    if (tab === "environments") return { label: t("assetEnvironments"), count: environments.length };
    return { label: t("assetVoices"), count: voices.length };
  }

  function makeBlankAsset(tab: AssetTab): WorkbenchAsset {
    const label = assetTabInfo(tab).label;
    const nextIndex = (tab === "characters"
      ? characters.length
      : tab === "items"
        ? items.length
        : tab === "environments"
          ? environments.length
          : voices.length) + 1;
    const name = `新${label}${nextIndex}`;
    return {
      name,
      frequency: 1,
      description: "",
      visualHint: name,
      confirmed: false,
      assetId: `manual-${tab}-${Date.now()}`,
      category: assetCategoryForTab(tab),
      role: tab === "characters" ? "自定义角色" : label,
      roleKey: "manual",
      episodes: [],
      prompt: "",
      negativePrompt: tab === "voices" ? "" : "",
      variants: [],
      imageUrl: "",
      history: [],
      mainImageName: name,
      tags: ["手动添加"],
      ...(tab === "characters" ? { scope: "guest" as const } : {}),
    };
  }

  function addWorkbenchAsset(tab: AssetTab) {
    const asset = makeBlankAsset(tab);
    const key = getAssetKey(asset, tab === "characters"
      ? characters.length
      : tab === "items"
        ? items.length
        : tab === "environments"
          ? environments.length
          : voices.length, tab);
    if (tab === "characters") {
      setCharacters((prev) => [...prev, asset as ExtractedCharacter]);
    } else if (tab === "items") {
      setItems((prev) => [...prev, asset]);
    } else if (tab === "environments") {
      setEnvironments((prev) => [...prev, asset]);
    } else {
      setVoices((prev) => [...prev, asset]);
    }
    setActiveAssetTab(tab);
    setActiveAssetKey(key);
    toast.success(`已添加${assetTabInfo(tab).label}`);
  }

  function confirmAllWorkbenchAssets() {
    setCharacters((prev) => prev.map((asset) => ({ ...asset, confirmed: true })));
    setItems((prev) => prev.map((asset) => ({ ...asset, confirmed: true })));
    setEnvironments((prev) => prev.map((asset) => ({ ...asset, confirmed: true })));
    setVoices((prev) => prev.map((asset) => ({ ...asset, confirmed: true })));
    toast.success("已一键确定全部资产");
  }

  function getAssetPreviewLabel(asset: WorkbenchAsset, tab: AssetTab) {
    if (tab === "voices") return t("assetVoicePrompt");
    return asset.mainImageName || asset.visualHint || asset.name;
  }
  const categoryLabel: Record<StoryReviewIssue["category"], string> = {
    prohibited: t("reviewCategoryProhibited"),
    logic: t("reviewCategoryLogic"),
    continuity: t("reviewCategoryContinuity"),
    setting: t("reviewCategorySetting"),
    other: t("reviewCategoryOther"),
  };
  const reviewAssetSections = [
    {
      key: "characters",
      label: "人物",
      icon: Users,
      items: storyAnalysis?.assets?.characters || [],
      roleField: "role",
      getSubText: (item: { role?: string; description?: string }) => item.role || item.description || "角色资产",
    },
    {
      key: "scenes",
      label: "场景",
      icon: Layers,
      items: storyAnalysis?.assets?.scenes || [],
      roleField: "type",
      getSubText: (item: { type?: string; description?: string }) => item.type || item.description || "环境资产",
    },
    {
      key: "props",
      label: "物品",
      icon: ImageIcon,
      items: storyAnalysis?.assets?.props || [],
      roleField: "type",
      getSubText: (item: { type?: string; description?: string }) => item.type || item.description || "道具资产",
    },
  ];
  const reviewAssetTotal = reviewAssetSections.reduce((sum, section) => sum + section.items.length, 0);
  const storyMetaRows = [
    ["time", "时间", storyAnalysis?.storyMeta?.time],
    ["background", "背景", storyAnalysis?.storyMeta?.background],
    ["visualStyleBase", "风格", storyAnalysis?.storyMeta?.visualStyleBase],
  ] as const;

  const confirmedEpisodeCount = confirmedEpisodeIndexes.size;
  const allEpisodesConfirmed = episodes.length > 0 && confirmedEpisodeCount === episodes.length;
  const episodeConfirmProgress = t("episodeConfirmProgress", {
    confirmed: confirmedEpisodeCount,
    total: episodes.length,
  });
  const episodePendingDelete = episodeDeleteIndex === null ? null : episodes[episodeDeleteIndex];
  const allWorkbenchAssets = [...characters, ...items, ...environments, ...voices];
  const confirmedAssetCount = allWorkbenchAssets.filter((asset) => asset.confirmed !== false).length;
  const allAssetsConfirmed = allWorkbenchAssets.length > 0 && confirmedAssetCount === allWorkbenchAssets.length;
  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden bg-[--surface]">
      {/* Top: Steps navigation */}
      <div className="shrink-0 border-b border-[--border-subtle] bg-white px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
          <button
            onClick={() => router.push(`/${locale}`)}
            className="flex h-10 w-[180px] shrink-0 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-[--text-primary] transition-colors hover:bg-[--surface] hover:text-primary md:w-[220px]"
            title="返回项目"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="truncate">返回项目</span>
          </button>

          <div className="flex min-w-[760px] flex-1 gap-2">
            {visibleSteps.map(({ num, icon: Icon, label }) => {
              const isClickable = stepStatus[num] !== "idle" || currentStep >= num;
              const isSelected = selectedStep === num;
              return (
                <button
                  key={num}
                  disabled={!isClickable}
                  onClick={() => {
                    if (!isClickable) return;
                    goToStep(num);
                  }}
                  className={`relative flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 text-left transition-all duration-200 ${stepColor(stepStatus[num], isSelected)} ${isClickable ? "cursor-pointer hover:bg-primary/5" : ""}`}
                >
                  {isSelected && (
                    <div className="absolute inset-x-3 bottom-0 h-[3px] rounded-t-full bg-primary" />
                  )}
                  <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                    stepStatus[num] === "done"
                      ? isSelected ? "bg-primary/15 text-primary" : "bg-emerald-100 text-emerald-600"
                      : stepStatus[num] === "running" ? "bg-primary/15"
                      : stepStatus[num] === "error" ? "bg-red-100"
                      : "bg-white"
                  }`}>
                    {stepIcon(stepStatus[num]) || <Icon className="h-4 w-4" />}
                  </div>
                  <span className="truncate text-xs font-medium xl:text-sm">{t(label)}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => router.push(`/${locale}/project/${projectId}/episodes`)}
              className="relative flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-transparent bg-[--surface] px-2.5 text-left text-[--text-primary] transition-all duration-200 hover:bg-primary/5 hover:text-primary"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white">
                <Layers className="h-4 w-4" />
              </div>
              <span className="truncate text-xs font-medium xl:text-sm">分集管理</span>
            </button>
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="flex flex-1 flex-col overflow-y-auto p-6">
        {/* Upload area (only when no step started) */}
        {currentStep === 0 && !historyMode && (
          <div className="mx-auto w-full max-w-xl space-y-6">
            {/* Drop zone */}
            <div
              className={`relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 transition-colors ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : file
                    ? "border-emerald-300 bg-emerald-50/50"
                    : "border-[--border-subtle] bg-white"
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
              onClick={() => inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED}
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
              />
              {file ? (
                <div className="flex items-center gap-3">
                  <FileText className="h-10 w-10 text-emerald-500" />
                  <div>
                    <p className="text-sm font-medium text-[--text-primary]">{file.name}</p>
                    <p className="text-xs text-[--text-muted]">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                    className="ml-2 flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/5"
                  >
                    <X className="h-3.5 w-3.5 text-[--text-muted]" />
                  </button>
                </div>
              ) : (
                <>
                  <Upload className="mb-3 h-10 w-10 text-[--text-muted]" />
                  <p className="text-sm font-medium text-[--text-primary]">{t("dropHint")}</p>
                  <p className="mt-1 text-xs text-[--text-muted]">{t("supportedFormats")}</p>
                </>
              )}
            </div>

            <Button
              onClick={startPipeline}
              disabled={!file}
              className="w-full rounded-xl"
              size="lg"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {t("startImport")}
            </Button>
          </div>
        )}

        {/* Story review gate (AI review, then human approval) */}
        {showStoryReview && (
          <div className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-lg font-bold text-[--text-primary]">
                  {t("reviewStory")}
                </h3>
                <p className="mt-1 text-sm text-[--text-muted]">
                  {t("reviewStoryHint")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-[--text-muted]">
                  {fullText.length.toLocaleString()} chars
                </span>
                <Button
                  variant="outline"
                  onClick={() => runStoryReview()}
                  disabled={reviewRunning || !fullText.trim()}
                  className="rounded-xl"
                >
                  {reviewRunning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {reviewIssues.length > 0 ? t("rerunStoryReview") : t("runStoryReview")}
                </Button>
                <Button onClick={confirmStoryReview} disabled={reviewRunning} className="rounded-xl">
                  {t("confirmStoryReview")}
                </Button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-[minmax(520px,1fr)_300px_360px] gap-4">
              <div className="flex min-h-0 flex-col rounded-xl border border-[--border-subtle] bg-white">
                <div className="flex flex-wrap items-center gap-2 border-b border-[--border-subtle] p-3">
                  <Input
                    value={findText}
                    onChange={(e) => {
                      setFindText(e.target.value);
                      setFindMatchIndex(0);
                    }}
                    placeholder="查找文本"
                    className="h-8 min-w-40 flex-1 rounded-lg"
                  />
                  <Input
                    value={replaceText}
                    onChange={(e) => setReplaceText(e.target.value)}
                    placeholder="替换为"
                    className="h-8 min-w-40 flex-1 rounded-lg"
                  />
                  <span className="min-w-16 text-center text-xs text-[--text-muted]">
                    {findText ? `${findMatches.length} 处` : ""}
                  </span>
                  <Button variant="outline" size="sm" onClick={findNextMatch} disabled={!findText}>
                    查找下一个
                  </Button>
                  <Button variant="outline" size="sm" onClick={replaceCurrentMatch} disabled={!findText}>
                    替换
                  </Button>
                  <Button variant="outline" size="sm" onClick={replaceAllMatches} disabled={!findText}>
                    全部替换
                  </Button>
                </div>
                <div className="min-h-0 flex-1 p-3">
                <Textarea
                  ref={reviewTextRef}
                  value={fullText}
                  onChange={(e) => setFullText(e.target.value)}
                  className="h-[60vh] resize-none border-0 bg-transparent font-mono text-sm leading-relaxed shadow-none focus-visible:ring-0"
                />
                </div>
              </div>

              <div className="flex min-h-0 flex-col rounded-xl border border-[--border-subtle] bg-white">
                <div className="flex items-center justify-between border-b border-[--border-subtle] p-3">
                  <div>
                    <div className="text-sm font-semibold text-[--text-primary]">资产</div>
                    <div className="text-xs text-[--text-muted]">
                      {reviewRunning ? "AI 正在解析资产" : `共 ${reviewAssetTotal} 个资产草稿`}
                    </div>
                  </div>
                  <span className="rounded-full bg-[--surface] px-2 py-0.5 text-xs font-semibold text-[--text-muted]">
                    AI
                  </span>
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                  {reviewRunning && (
                    <div className="flex items-center gap-2 rounded-lg bg-primary/5 p-3 text-sm text-primary">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      正在解析人物、场景和物品
                    </div>
                  )}

                  {!reviewRunning && !storyAnalysis && (
                    <div className="rounded-lg bg-emerald-50 p-3 text-sm leading-relaxed text-emerald-700">
                      点击“AI 审阅”后，这里会显示人物、场景、物品和统一故事设定。
                    </div>
                  )}

                  {!reviewRunning && storyAnalysis && (
                    <div className="rounded-lg border border-[--border-subtle] bg-[--surface] p-3">
                      <div className="mb-2 text-xs font-bold text-[--text-secondary]">故事设定</div>
                      <div className="space-y-2">
                        {storyMetaRows.map(([field, label, value]) => (
                          <div key={field} className="space-y-1">
                            <label className="text-[10px] font-semibold text-[--text-muted]">{label}</label>
                            <Textarea
                              value={value || ""}
                              onChange={(e) => updateStoryMetaField(field, e.target.value)}
                              className="min-h-16 resize-none rounded-lg bg-white text-xs leading-relaxed"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!reviewRunning && reviewAssetSections.map((section) => {
                    const Icon = section.icon;
                    return (
                      <div key={section.key} className="rounded-lg border border-[--border-subtle]">
                        <div className="flex items-center justify-between border-b border-[--border-subtle] px-3 py-2">
                          <div className="flex items-center gap-2 text-sm font-semibold text-[--text-primary]">
                            <Icon className="h-4 w-4 text-primary" />
                            {section.label}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-[--text-muted]">{section.items.length}</span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => addStoryAssetItem(section.key as StoryAssetSectionKey)}
                              className="h-7 px-2"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <div className="max-h-44 overflow-y-auto p-2">
                          {section.items.length === 0 ? (
                            <div className="rounded-md border border-dashed border-[--border-subtle] p-3 text-center text-xs text-[--text-muted]">
                              暂无{section.label}
                            </div>
                          ) : (
                            section.items.map((item, index) => (
                              <div key={`${section.key}:${index}`} className="mb-2 space-y-1.5 rounded-md bg-[--surface] p-2 last:mb-0">
                                <div className="flex items-center gap-1.5">
                                  <Input
                                    value={item.name || ""}
                                    onChange={(e) => updateStoryAssetItem(section.key as StoryAssetSectionKey, index, { name: e.target.value })}
                                    placeholder={`${section.label}名称`}
                                    className="h-8 min-w-0 flex-1 rounded-lg bg-white text-xs font-semibold"
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => removeStoryAssetItem(section.key as StoryAssetSectionKey, index)}
                                    className="h-8 w-8 shrink-0 p-0"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                                <Input
                                  value={(section.roleField === "role" ? (item as { role?: string }).role : (item as { type?: string }).type) || ""}
                                  onChange={(e) => updateStoryAssetItem(section.key as StoryAssetSectionKey, index, { [section.roleField]: e.target.value })}
                                  placeholder={section.roleField === "role" ? "角色定位" : "类型"}
                                  className="h-8 rounded-lg bg-white text-xs"
                                />
                                <Textarea
                                  value={item.description || ""}
                                  onChange={(e) => updateStoryAssetItem(section.key as StoryAssetSectionKey, index, { description: e.target.value })}
                                  placeholder="描述"
                                  className="min-h-16 resize-none rounded-lg bg-white text-xs leading-relaxed"
                                />
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[--border-subtle] bg-white">
                <div className="flex items-center justify-between border-b border-[--border-subtle] p-3">
                  <div>
                    <div className="text-sm font-semibold text-[--text-primary]">{t("aiReviewIssues")}</div>
                    <div className="text-xs text-[--text-muted]">
                      {reviewRunning
                        ? t("aiReviewRunning")
                        : `${t("aiReviewIssueCount", { count: reviewIssues.length })} · 已选 ${selectedApplicableIssueCount}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={toggleAllIssueSelection}
                      disabled={reviewRunning || selectableIssueIndexes.length === 0}
                    >
                      {allSelectableIssuesSelected ? "取消全选" : "全选"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={applySelectedStoryIssues}
                      disabled={reviewRunning || selectedApplicableIssueCount === 0}
                    >
                      替换选中
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={applyAllStoryIssues}
                      disabled={reviewRunning || unappliedIssueCount === 0}
                    >
                      {t("applyAllSuggestions")}
                    </Button>
                  </div>
                </div>

                <div className="max-h-[60vh] min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                  {reviewRunning && (
                    <div className="flex items-center gap-2 rounded-lg bg-primary/5 p-3 text-sm text-primary">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("aiReviewRunning")}
                    </div>
                  )}

                  {!reviewRunning && reviewIssues.length === 0 && (
                    <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
                      {t("aiReviewNotStarted")}
                    </div>
                  )}

                  {!reviewRunning && reviewIssues.map((issue, idx) => {
                    const isSelected = selectedIssueIndexes.has(idx);
                    const canApply = !issue.applied && fullText.includes(issue.exactQuote);
                    return (
                      <div
                        key={`${issue.exactQuote}:${idx}`}
                        className={`rounded-lg border p-3 transition-colors ${
                          activeIssueIndex === idx
                            ? "border-primary bg-primary/10"
                            : isSelected
                              ? "border-primary bg-primary/5"
                              : "border-[--border-subtle]"
                        }`}
                        onClick={() => scrollAndSelectQuote(issue, idx)}
                      >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={!canApply}
                              onChange={() => toggleIssueSelection(idx)}
                              onClick={(e) => e.stopPropagation()}
                              className="h-4 w-4 rounded border-[--border-subtle] accent-primary"
                            />
                            <span className="rounded bg-[--surface] px-1.5 py-0.5 text-[10px] font-semibold text-[--text-muted]">#{idx}</span>
                            <div className="text-sm font-semibold text-[--text-primary]">{issue.title}</div>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] font-medium">
                            <span className={`rounded px-1.5 py-0.5 ${
                              issue.severity === "high" ? "bg-red-50 text-red-600" :
                              issue.severity === "medium" ? "bg-amber-50 text-amber-600" :
                              "bg-blue-50 text-blue-600"
                            }`}>
                              {severityLabel[issue.severity]}
                            </span>
                            <span className="rounded bg-[--surface] px-1.5 py-0.5 text-[--text-muted]">
                              {categoryLabel[issue.category]}
                            </span>
                            {issue.applied && (
                              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-600">
                                已替换
                              </span>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            applyStoryIssue(idx);
                          }}
                          disabled={issue.applied || !canApply}
                        >
                          {issue.applied ? t("appliedSuggestion") : t("applySuggestion")}
                        </Button>
                      </div>
                      <div className="space-y-2 text-xs">
                        <div>
                          <div className="mb-1 font-medium text-[--text-secondary]">{t("originalText")}</div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              scrollAndSelectQuote(issue, idx);
                            }}
                            className="w-full rounded bg-red-50/70 p-2 text-left text-red-900 transition-colors hover:bg-red-100"
                          >
                            {issue.exactQuote}
                          </button>
                        </div>
                        <div>
                          <div className="mb-1 font-medium text-[--text-secondary]">{t("replacementText")}</div>
                          <div className="rounded bg-emerald-50 p-2 text-emerald-900">#{idx} {issue.replacement}</div>
                        </div>
                        {issue.explanation && (
                          <p className="leading-relaxed text-[--text-muted]">{issue.explanation}</p>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Asset setup review */}
        {showCharReview && (
          <div className="flex h-[calc(100vh-150px)] min-h-[660px] flex-col gap-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="font-display text-lg font-bold text-[--text-primary]">
                  {t("reviewAssets")}
                </h3>
                <p className="mt-1 text-sm text-[--text-muted]">{t("reviewAssetsHint")}</p>
              </div>
              <div className="flex items-center gap-3">
                <div className={`text-xs font-semibold ${allAssetsConfirmed ? "text-emerald-600" : "text-amber-600"}`}>
                  资产确认 {confirmedAssetCount}/{allWorkbenchAssets.length}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={confirmAllWorkbenchAssets}
                  disabled={allWorkbenchAssets.length === 0 || allAssetsConfirmed}
                  className="rounded-xl"
                >
                  <Check className="size-4" />
                  一键全部确定
                </Button>
                <Button
                  onClick={runSplit}
                  disabled={stepStatus[4] === "running" || !allAssetsConfirmed}
                  className="rounded-xl"
                >
                  {stepStatus[4] === "running" && <Loader2 className="size-4 animate-spin" />}
                  {t("confirmAndSplit")}
                </Button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-[270px_minmax(0,1fr)] overflow-hidden rounded-xl border border-[--border-subtle] bg-white shadow-sm">
              <aside className="flex min-h-0 flex-col border-r border-[--border-subtle] bg-[--surface]">
                <div className="flex h-12 items-center justify-between border-b border-[--border-subtle] px-3">
                  <div className="text-sm font-bold text-[--text-primary]">{t("assetTypes")}</div>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-[--text-muted]">
                    {characters.length + items.length + environments.length + voices.length}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 border-b border-[--border-subtle] p-2">
                  {(["characters", "items", "environments", "voices"] as AssetTab[]).map((tab) => {
                    const info = assetTabInfo(tab);
                    return (
                      <button
                        key={tab}
                        onClick={() => setActiveAssetTab(tab)}
                        className={`group relative rounded-lg border p-2 pr-9 text-left transition-colors ${
                          activeAssetTab === tab
                            ? "border-primary/50 bg-primary/10 text-primary"
                            : "border-[--border-subtle] bg-white text-[--text-primary] hover:border-[--border-hover]"
                        }`}
                      >
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            addWorkbenchAsset(tab);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            event.stopPropagation();
                            addWorkbenchAsset(tab);
                          }}
                          className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md border text-[--text-muted] transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary ${
                            activeAssetTab === tab ? "border-primary/30 bg-white/70 text-primary" : "border-[--border-subtle] bg-[--surface]"
                          }`}
                          aria-label={`添加${info.label}`}
                        >
                          <Plus className="size-3.5" />
                        </span>
                        <div className="text-xs font-bold">{info.label}</div>
                        <div className="mt-1 text-[10px] text-[--text-muted]">{info.count}</div>
                      </button>
                    );
                  })}
                </div>
                <div className="flex h-10 items-center justify-between border-b border-[--border-subtle] px-3">
                  <div className="text-xs font-bold text-[--text-secondary]">{assetTabInfo(activeAssetTab).label}</div>
                  <span className="text-[10px] text-[--text-muted]">{assetTabInfo(activeAssetTab).count}</span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {activeAssetList.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[--border-subtle] bg-white p-4 text-center text-xs text-[--text-muted]">
                      {t("assetEmpty")}
                    </div>
                  ) : (
                    activeAssetList.map((asset, index) => {
                      const key = getAssetKey(asset, index, activeAssetTab);
                      const isActive = key === activeWorkbenchKey;
                      return (
                        <button
                          key={key}
                          onClick={() => setActiveAssetKey(key)}
                          className={`mb-1.5 grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border p-2 text-left transition-colors ${
                            isActive
                              ? "border-primary/50 bg-primary/8"
                              : "border-transparent bg-white hover:border-[--border-hover]"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-bold text-[--text-primary]">{asset.name}</span>
                            <span className="mt-0.5 block truncate text-[10px] text-[--text-muted]">
                              {(asset.role || asset.visualHint || assetTabInfo(activeAssetTab).label)} · {formatEpisodeRefs(asset.episodes)}
                            </span>
                          </span>
                          <span className={`h-2 w-2 rounded-full ${asset.confirmed === false ? "bg-amber-400" : "bg-emerald-500"}`} />
                        </button>
                      );
                    })
                  )}
                </div>
              </aside>

              <section className="min-h-0 overflow-y-auto p-4">
                {activeWorkbenchAsset ? (
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-bold uppercase text-primary">{assetTabInfo(activeAssetTab).label}{t("assetConfigSuffix")}</div>
                        <h4 className="mt-1 truncate text-xl font-bold text-[--text-primary]">{activeWorkbenchAsset.name}</h4>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(activeWorkbenchAsset.tags || []).slice(0, 4).map((tag) => (
                            <span key={tag} className="rounded-full bg-[--surface] px-2 py-0.5 text-[10px] font-medium text-[--text-muted]">
                              {tag}
                            </span>
                          ))}
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                            {formatEpisodeRefs(activeWorkbenchAsset.episodes)}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateActiveWorkbenchAsset({ confirmed: activeWorkbenchAsset.confirmed === false })}
                        className={`flex h-11 shrink-0 items-center gap-2 rounded-xl border px-4 text-sm font-bold transition-colors ${
                          activeWorkbenchAsset.confirmed !== false
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                        }`}
                      >
                        <Check className="size-4" />
                        {activeWorkbenchAsset.confirmed !== false ? "已确认" : "确认资产"}
                      </button>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="grid min-h-[520px] gap-3 rounded-xl border border-[--border-subtle] bg-white p-3">
                        <div className="grid gap-3 rounded-xl border border-[--border-subtle] bg-[--surface] p-3">
                          <div className="grid gap-1">
                            <div className="text-xs font-bold text-[--text-secondary]">{t("assetDescription")}</div>
                            <p className="text-xs leading-relaxed text-[--text-muted]">{activeWorkbenchAsset.description || "-"}</p>
                          </div>
                          {activeAssetTab === "characters" && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => updateActiveWorkbenchAsset({ scope: activeWorkbenchAsset.scope === "main" ? "guest" : "main" })}
                                className={`rounded-lg px-2 py-1 text-xs font-bold ${
                                  activeWorkbenchAsset.scope === "main"
                                    ? "bg-blue-50 text-blue-600"
                                    : "bg-purple-50 text-purple-600"
                                }`}
                              >
                                {activeWorkbenchAsset.scope === "main" ? t("main") : t("guest")}
                              </button>
                              <span className="text-xs text-[--text-muted]">{activeWorkbenchAsset.role || ""}</span>
                            </div>
                          )}
                        </div>

                        <div className="grid gap-2">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-[--text-secondary]">
                              {activeAssetTab === "voices" ? t("assetVoicePrompt") : t("assetPrompt")}
                            </label>
                            <span className="text-[10px] text-[--text-muted]">{t("assetCustomEdit")}</span>
                          </div>
                          <Textarea
                            value={activeWorkbenchAsset.prompt || ""}
                            onChange={(event) => updateActiveWorkbenchAsset({ prompt: event.target.value })}
                            className="min-h-[320px] flex-1 resize-y rounded-xl bg-white font-mono text-xs leading-relaxed"
                          />
                        </div>

                        {activeAssetTab !== "voices" && (
                          <div className="grid gap-2">
                            <label className="text-xs font-bold text-[--text-secondary]">{t("assetNegativePrompt")}</label>
                            <Textarea
                              value={activeWorkbenchAsset.negativePrompt || ""}
                              onChange={(event) => updateActiveWorkbenchAsset({ negativePrompt: event.target.value })}
                              className="min-h-20 resize-y rounded-xl bg-white text-xs leading-relaxed"
                            />
                          </div>
                        )}
                      </div>

                      <div className="grid min-h-[520px] content-start gap-3 rounded-xl border border-[--border-subtle] bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold text-[--text-secondary]">{t("assetMainImageName")}</div>
                            <Input
                              value={getAssetPreviewLabel(activeWorkbenchAsset, activeAssetTab)}
                              onChange={(event) => updateActiveWorkbenchAsset({ mainImageName: event.target.value, visualHint: event.target.value })}
                              disabled={activeAssetTab === "voices"}
                              className="mt-1 h-9 rounded-lg text-xs font-semibold"
                            />
                          </div>
                          {activeAssetTab !== "voices" && (
                            <div className="flex shrink-0 flex-wrap justify-end gap-2 pt-5">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={Boolean(assetUploadingTarget)}
                                className="relative overflow-hidden rounded-lg"
                              >
                                {assetUploadingTarget === `${activeAssetTab}:${activeWorkbenchAssetIndex}:main` ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Upload className="size-3.5" />
                                )}
                                上传主图
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="absolute inset-0 cursor-pointer opacity-0"
                                  onChange={(event) => {
                                    const selectedFile = event.target.files?.[0];
                                    event.target.value = "";
                                    if (selectedFile) void uploadWorkbenchImage(selectedFile);
                                  }}
                                />
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => generateActiveWorkbenchAsset()}
                                disabled={isAssetGenerationBlocked(activeAssetTab, activeWorkbenchAssetIndex)}
                                className="rounded-lg"
                              >
                                {isAssetGenerating(`${activeAssetTab}:${activeWorkbenchAssetIndex}:main`) ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <ImageIcon className="size-3.5" />
                                )}
                                {activeWorkbenchAsset.imageUrl ? t("assetRegenerateMain") : t("assetGenerateMain")}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={generateCurrentAssetTab}
                                disabled={hasAssetGenerationInTab(activeAssetTab)}
                                className="rounded-lg"
                              >
                                {isAssetGenerating(`${activeAssetTab}:category`) ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Images className="size-3.5" />
                                )}
                                {t("assetGenerateCurrentType")}
                              </Button>
                            </div>
                          )}
                        </div>

                        <div className="relative flex aspect-[16/10] min-h-[360px] items-center justify-center overflow-hidden rounded-xl border border-[--border-subtle] bg-[--surface]">
                          {activeWorkbenchAsset.imageUrl ? (
                            <>
                              <Button
                                type="button"
                                size="icon"
                                variant="secondary"
                                className="absolute right-3 top-3 z-10 h-8 w-8 rounded-lg bg-white/90 shadow-sm hover:bg-white"
                                title="下载图片"
                                onClick={() => downloadWorkbenchImage(
                                  activeWorkbenchAsset.imageUrl || "",
                                  getAssetPreviewLabel(activeWorkbenchAsset, activeAssetTab),
                                )}
                              >
                                <Download className="size-4" />
                              </Button>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={activeWorkbenchAsset.imageUrl} alt={activeWorkbenchAsset.name} className="h-full w-full object-contain" />
                            </>
                          ) : (
                            <div className="grid gap-1 text-center">
                              <div className="text-sm font-bold text-[--text-primary]">
                                {activeAssetTab === "voices" ? activeWorkbenchAsset.name : t("assetNoImage")}
                              </div>
                              <div className="text-xs text-[--text-muted]">{activeWorkbenchAsset.role || assetTabInfo(activeAssetTab).label}</div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3 border-t border-[--border-subtle] pt-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-bold text-[--text-primary]">{t("assetVariants")}</div>
                          <div className="text-xs text-[--text-muted]">
                            {activeAssetTab === "voices" ? t("assetVoiceVariantsHint") : t("assetImageVariantsHint")}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {activeAssetTab !== "voices" && (
                            <Button
                              size="sm"
                              onClick={generateActiveWorkbenchVariantsFromMain}
                              disabled={
                                !activeWorkbenchAsset.imageUrl
                                || !activeWorkbenchAsset.variants?.length
                                || isAssetGenerationBlocked(activeAssetTab, activeWorkbenchAssetIndex)
                              }
                              className="rounded-lg"
                            >
                              {isAssetGenerating(`${activeAssetTab}:${activeWorkbenchAssetIndex}:variants`) ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Images className="size-3.5" />
                              )}
                              批量生成变体
                            </Button>
                          )}
                          <span className="rounded-full bg-[--surface] px-2 py-0.5 text-xs font-semibold text-[--text-muted]">
                            {activeWorkbenchAsset.variants?.length || 0}
                          </span>
                        </div>
                      </div>
                      {activeWorkbenchAsset.variants?.length ? (
                        <div className="grid gap-4 lg:grid-cols-2">
                          {activeWorkbenchAsset.variants.map((variant, index) => (
                            <div key={variant.id || `${variant.name}:${index}`} className="flex min-h-[180px] flex-col rounded-xl border border-[--border-subtle] bg-white p-4">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-bold text-[--text-primary]">{variant.name}</div>
                                  {variant.description && (
                                    <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-[--text-muted]">{variant.description}</p>
                                  )}
                                </div>
                                {variant.imageUrl && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600">OK</span>}
                              </div>
                              {variant.imageUrl && (
                                <div className="relative mt-2 overflow-hidden rounded-lg border border-[--border-subtle] bg-[--surface]">
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="secondary"
                                    className="absolute right-2 top-2 z-10 h-7 w-7 rounded-md bg-white/90 shadow-sm hover:bg-white"
                                    title="下载图片"
                                    onClick={() => downloadWorkbenchImage(
                                      variant.imageUrl || "",
                                      `${activeWorkbenchAsset.name}-${variant.name}`,
                                    )}
                                  >
                                    <Download className="size-3.5" />
                                  </Button>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={variant.imageUrl} alt={variant.name} className="h-56 w-full object-contain" />
                                </div>
                              )}
                              {activeAssetTab !== "voices" && (
                                <div className="mt-auto grid gap-3 pt-4">
                                  <div className="flex flex-wrap items-center justify-end gap-2">
                                    <Button
                                      size="xs"
                                      variant="outline"
                                      disabled={Boolean(assetUploadingTarget)}
                                      className="relative overflow-hidden"
                                    >
                                      {assetUploadingTarget === `${activeAssetTab}:${activeWorkbenchAssetIndex}:${index}` ? (
                                        <Loader2 className="size-3 animate-spin" />
                                      ) : (
                                        <Upload className="size-3" />
                                      )}
                                      上传
                                      <input
                                        type="file"
                                        accept="image/*"
                                        className="absolute inset-0 cursor-pointer opacity-0"
                                        onChange={(event) => {
                                          const selectedFile = event.target.files?.[0];
                                          event.target.value = "";
                                          if (selectedFile) void uploadWorkbenchImage(selectedFile, index);
                                        }}
                                      />
                                    </Button>
                                    <Button
                                      size="xs"
                                      variant="outline"
                                      onClick={() => generateActiveWorkbenchAsset(index)}
                                      disabled={isAssetGenerationBlocked(activeAssetTab, activeWorkbenchAssetIndex, index)}
                                    >
                                      {isAssetGenerating(`${activeAssetTab}:${activeWorkbenchAssetIndex}:${index}`) ? (
                                        <Loader2 className="size-3 animate-spin" />
                                      ) : (
                                        <ImageIcon className="size-3" />
                                      )}
                                      {variant.imageUrl ? t("assetRegenerateVariant") : t("assetGenerateVariant")}
                                    </Button>
                                  </div>

                                  <div className="grid gap-2 rounded-lg border border-[--border-subtle] bg-[--surface] p-2">
                                    <Textarea
                                      value={variant.editInstruction || ""}
                                      onChange={(event) => updateVariantEditInstruction(index, event.target.value)}
                                      placeholder="输入变体改图要求，例如：换成深色外套，表情更疲惫，保持同一人物"
                                      className="min-h-20 resize-y rounded-lg bg-white text-xs leading-relaxed"
                                    />
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[10px] text-[--text-muted]">基于当前变体图进行修改</span>
                                      <Button
                                        size="xs"
                                        onClick={() => editWorkbenchVariant(index)}
                                        disabled={Boolean(assetEditingTarget) || !variant.imageUrl || !variant.editInstruction?.trim()}
                                      >
                                        {assetEditingTarget === `${activeAssetTab}:${activeWorkbenchAssetIndex}:${index}` ? (
                                          <Loader2 className="size-3 animate-spin" />
                                        ) : (
                                          <Sparkles className="size-3" />
                                        )}
                                        变体改图
                                      </Button>
                                    </div>
                                  </div>

                                  {variant.history?.length ? (
                                    <details className="rounded-lg border border-[--border-subtle] bg-white px-2 py-1.5">
                                      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-semibold text-[--text-secondary]">
                                        <History className="size-3" />
                                        历史 {variant.history.length}
                                      </summary>
                                      <div className="mt-2 grid max-h-36 gap-1 overflow-y-auto">
                                        {variant.history.slice(0, 8).map((entry, historyIndex) => (
                                          <button
                                            key={`${entry.at || historyIndex}:${historyIndex}`}
                                            type="button"
                                            onClick={() => {
                                              const historyImageUrl = typeof entry.imageUrl === "string" ? entry.imageUrl : "";
                                              if (!historyImageUrl) return;
                                              patchWorkbenchAsset(activeAssetTab, activeWorkbenchAssetIndex, (current) => {
                                                const variants = [...(current.variants || [])];
                                                const currentVariant = variants[index];
                                                if (!currentVariant) return current;
                                                variants[index] = { ...currentVariant, imageUrl: historyImageUrl };
                                                return { ...current, variants };
                                              });
                                            }}
                                            className="grid gap-0.5 rounded border border-transparent px-2 py-1 text-left text-[10px] hover:border-[--border-hover] hover:bg-[--surface]"
                                          >
                                            <span className="truncate font-medium text-[--text-primary]">{getHistoryLabel(entry)}</span>
                                            <span className="truncate text-[--text-muted]">{formatHistoryTime(entry.at)}</span>
                                          </button>
                                        ))}
                                      </div>
                                    </details>
                                  ) : null}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-[--border-subtle] bg-[--surface] p-4 text-center text-xs text-[--text-muted]">
                          {t("assetNoVariants")}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-[--border-subtle] text-sm text-[--text-muted]">
                    {t("assetEmpty")}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        {/* Episodes review (after step 3) */}
        {showEpReview && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-bold text-[--text-primary]">
                  {t("reviewEpisodes")} ({episodes.length})
                </h3>
                <p className="mt-1 text-sm text-[--text-muted]">{t("reviewEpisodesHint")}</p>
                <div className="mt-2 text-xs font-semibold text-[--text-secondary]">
                  {episodeConfirmProgress}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  onClick={confirmAllEpisodes}
                  disabled={episodes.length === 0 || allEpisodesConfirmed}
                  className="rounded-xl"
                >
                  <Check className="size-4" />
                  {t("confirmAllEpisodes")}
                </Button>
                <Button
                  onClick={runGenerate}
                  disabled={!allEpisodesConfirmed || stepStatus[5] === "running"}
                  className="rounded-xl"
                >
                  {stepStatus[5] === "running" && <Loader2 className="size-4 animate-spin" />}
                  {t("confirmAndGenerate")}
                </Button>
              </div>
            </div>
            <div className="space-y-3">
              {episodes.map((ep, idx) => {
                const isExpanded = expandedEpisodeIndexes.has(idx);
                const isConfirmed = confirmedEpisodeIndexes.has(idx);
                const keywords = ep.keywords.split(/[,，]/).map((kw) => kw.trim()).filter(Boolean);

                return (
                  <div
                    key={`${ep.title}:${idx}`}
                    className={`overflow-hidden rounded-xl border bg-white transition-colors ${
                      isConfirmed ? "border-emerald-200" : "border-[--border-subtle]"
                    }`}
                  >
                    <div className="flex items-center gap-3 p-4">
                      <button
                        type="button"
                        onClick={() => toggleEpisodeExpanded(idx)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[--border-subtle] text-[--text-muted] transition-colors hover:border-[--border-hover] hover:text-[--text-primary]"
                        aria-label={isExpanded ? t("collapseEpisode") : t("expandEpisode")}
                      >
                        <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      </button>
                      <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs font-semibold text-primary">
                        EP.{String(idx + 1).padStart(2, "0")}
                      </span>
                      <Input
                        value={ep.title}
                        onChange={(e) => updateEpisode(idx, "title", e.target.value)}
                        className="h-8 min-w-0 text-sm font-semibold"
                      />
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        isConfirmed ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
                      }`}>
                        {isConfirmed ? t("episodeConfirmed") : t("episodePendingConfirm")}
                      </span>
                      <Button
                        variant={isConfirmed ? "outline" : "default"}
                        size="sm"
                        onClick={() => confirmEpisode(idx)}
                        className="shrink-0 rounded-lg"
                      >
                        <Check className="size-3.5" />
                        {isConfirmed ? t("cancelEpisodeConfirm") : t("confirmEpisode")}
                      </Button>
                      <button
                        onClick={() => setEpisodeDeleteIndex(idx)}
                        className="shrink-0 rounded-lg p-1.5 text-[--text-muted] transition-colors hover:bg-red-50 hover:text-red-500"
                        aria-label={t("removeEpisode")}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="max-h-[340px] overflow-y-auto border-t border-[--border-subtle] bg-[--surface] p-4">
                        <div className="grid gap-4 pr-1">
                        <div className="grid gap-2 md:grid-cols-2">
                          <label className="grid gap-1">
                            <span className="text-xs font-bold text-[--text-secondary]">{t("episodeDescription")}</span>
                            <Textarea
                              value={ep.description}
                              onChange={(e) => updateEpisode(idx, "description", e.target.value)}
                              className="h-24 resize-none overflow-y-auto rounded-lg bg-white text-xs leading-relaxed"
                            />
                          </label>
                          <label className="grid gap-1">
                            <span className="text-xs font-bold text-[--text-secondary]">{t("episodeKeywords")}</span>
                            <Textarea
                              value={ep.keywords}
                              onChange={(e) => updateEpisode(idx, "keywords", e.target.value)}
                              className="h-24 resize-none overflow-y-auto rounded-lg bg-white text-xs leading-relaxed"
                            />
                          </label>
                        </div>
                        <label className="grid gap-1">
                          <span className="text-xs font-bold text-[--text-secondary]">{t("episodeIdea")}</span>
                          <Textarea
                            value={ep.idea}
                            onChange={(e) => updateEpisode(idx, "idea", e.target.value)}
                            className="h-36 resize-none overflow-y-auto rounded-lg bg-white font-mono text-xs leading-relaxed"
                          />
                        </label>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <div className="mb-2 text-xs font-bold text-[--text-secondary]">{t("episodeCharacters")}</div>
                            {ep.characters && ep.characters.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {ep.characters.map((name, charIdx) => {
                                  const isMain = characters.some((c) => c.name === name && c.scope === "main");
                                  return (
                                    <span key={`${name}:${charIdx}`} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isMain ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"}`}>
                                      {name}
                                    </span>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="rounded-lg border border-dashed border-[--border-subtle] bg-white p-3 text-xs text-[--text-muted]">
                                {t("episodeNoCharacters")}
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="mb-2 text-xs font-bold text-[--text-secondary]">{t("episodeKeywordsPreview")}</div>
                            {keywords.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {keywords.map((kw, kwIdx) => (
                                  <span key={`${kw}:${kwIdx}`} className="rounded bg-primary/8 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                    {kw}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <div className="rounded-lg border border-dashed border-[--border-subtle] bg-white p-3 text-xs text-[--text-muted]">
                                {t("episodeNoKeywords")}
                              </div>
                            )}
                          </div>
                        </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <Dialog open={episodeDeleteIndex !== null} onOpenChange={(open) => !open && setEpisodeDeleteIndex(null)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("removeEpisodeConfirmTitle")}</DialogTitle>
                  <DialogDescription>
                    {t("removeEpisodeConfirmDesc", {
                      episode: episodePendingDelete
                        ? `EP.${String((episodeDeleteIndex ?? 0) + 1).padStart(2, "0")} - ${episodePendingDelete.title}`
                        : "",
                    })}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>
                    {t("cancelRemoveEpisode")}
                  </DialogClose>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      if (episodeDeleteIndex !== null) removeEpisode(episodeDeleteIndex);
                    }}
                  >
                    {t("confirmRemoveEpisode")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {/* Logs panel */}
        {(currentStep > 0 || historyMode) && !showStoryReview && !showCharReview && !showEpReview && (() => {
          const filteredLogs = selectedStep
            ? logs.filter((l) => l.step === selectedStep)
            : logs;

          // Extract metadata from the "done" log of the selected step
          const stepDoneLog = selectedStep
            ? logs.find((l) => l.step === selectedStep && l.status === "done" && l.metadata)
            : null;
          const meta = stepDoneLog?.metadata as Record<string, unknown> | null;
          const metaCharacters = meta?.characters as ExtractedCharacter[] | undefined;
          const metaItems = meta?.items as ExtractedAsset[] | undefined;
          const metaEnvironments = meta?.environments as ExtractedAsset[] | undefined;
          const metaVoices = meta?.voices as ExtractedAsset[] | undefined;
          const metaEpisodes = meta?.episodes as SplitEpisode[] | undefined;

          // For step 4, also show characters from step 3
          const step3DoneLog = (selectedStep === 4)
            ? logs.find((l) => l.step === 3 && l.status === "done" && l.metadata)
            : null;
          const step3Meta = step3DoneLog?.metadata as Record<string, unknown> | null;
          const step3Characters = step3Meta?.characters as ExtractedCharacter[] | undefined;

          return (
            <div className="space-y-4">
              {selectedStep === 3 && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2 rounded-xl border border-[--border-subtle] bg-white p-1.5">
                    {([
                      { key: "characters" as const, label: t("assetCharacters"), count: metaCharacters?.length || characters.length },
                      { key: "items" as const, label: t("assetItems"), count: metaItems?.length || items.length },
                      { key: "environments" as const, label: t("assetEnvironments"), count: metaEnvironments?.length || environments.length },
                      { key: "voices" as const, label: t("assetVoices"), count: metaVoices?.length || voices.length },
                    ]).map((tab) => (
                      <button
                        key={tab.key}
                        onClick={() => setActiveAssetTab(tab.key)}
                        className={`flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${
                          activeAssetTab === tab.key
                            ? "bg-primary text-white"
                            : "text-[--text-muted] hover:bg-[--surface] hover:text-[--text-primary]"
                        }`}
                      >
                        <span>{tab.label}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                          activeAssetTab === tab.key
                            ? "bg-white/20 text-white"
                            : "bg-[--surface] text-[--text-muted]"
                        }`}>
                          {tab.count}
                        </span>
                      </button>
                    ))}
                  </div>

                  {activeAssetTab === "characters" && (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
                      {(metaCharacters || characters).map((char, idx) => (
                        <div
                          key={`${char.name}:${idx}`}
                          className="group relative overflow-hidden rounded-[14px] border border-[--border-subtle] bg-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5 hover:border-[--border-hover]"
                        >
                          <div className={`h-1 w-full ${char.scope === "main" ? "bg-gradient-to-r from-blue-500 to-blue-400" : "bg-gradient-to-r from-purple-500 to-purple-400"}`} />
                          <div className="p-3.5">
                            <div className="mb-2.5 flex items-center gap-2.5">
                              <div
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-sm font-bold text-white"
                                style={{ background: `linear-gradient(135deg, hsl(${(char.name.charCodeAt(0) * 37) % 360}, 45%, 45%), hsl(${(char.name.charCodeAt(0) * 37) % 360}, 50%, 55%))` }}
                              >
                                {char.name.charAt(0)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[13px] font-bold text-[--text-primary]">{char.name}</div>
                                <div className="flex items-center gap-1.5 text-[10px] text-[--text-muted]">
                                  <span>{t("frequency")} {char.frequency}</span>
                                  {char.visualHint && (
                                    <>
                                      <span className="h-[3px] w-[3px] rounded-full bg-[#ddd]" />
                                      <span className="truncate">{char.visualHint}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            {char.visualHint && (
                              <div className="mb-2 inline-block rounded-md bg-[--surface] px-2 py-0.5 text-[10px] font-medium text-[--text-muted]">
                                {char.visualHint}
                              </div>
                            )}
                            <p className="line-clamp-2 text-[11px] leading-relaxed text-[--text-muted]">{char.description}</p>
                          </div>
                          <span className={`absolute right-3 top-3 rounded-[8px] px-2 py-0.5 text-[9px] font-bold tracking-wide ${
                            char.scope === "main" ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"
                          }`}>
                            {char.scope === "main" ? t("main") : t("guest")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {(activeAssetTab === "items" || activeAssetTab === "environments" || activeAssetTab === "voices") && (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                      {(activeAssetTab === "items" ? (metaItems || items) : activeAssetTab === "environments" ? (metaEnvironments || environments) : (metaVoices || voices)).map((asset, idx) => (
                        <div
                          key={`${asset.name}:${idx}`}
                          className="rounded-[14px] border border-[--border-subtle] bg-white p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5 hover:border-[--border-hover]"
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-[13px] font-bold text-[--text-primary]">{asset.name}</div>
                              <div className="text-[10px] text-[--text-muted]">{t("frequency")} {asset.frequency}</div>
                            </div>
                            {asset.visualHint && (
                              <span className="shrink-0 rounded-md bg-[--surface] px-2 py-0.5 text-[10px] font-medium text-[--text-muted]">
                                {asset.visualHint}
                              </span>
                            )}
                          </div>
                          <p className="line-clamp-4 text-[11px] leading-relaxed text-[--text-muted]">{asset.description}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold text-[--text-secondary]">
                  {t("processLog")}
                  {selectedStep && (
                    <span className="ml-2 text-xs font-normal text-[--text-muted]">
                      — {t(STEPS[selectedStep - 1].label)}
                    </span>
                  )}
                </h3>
                {selectedStep && (
                  <button
                    onClick={() => setSelectedStep(null)}
                    className="text-xs text-primary hover:underline"
                  >
                    {t("showAll")}
                  </button>
                )}
              </div>

              <div className="rounded-xl border border-[--border-subtle] bg-white p-4">
                <div className="max-h-[30vh] space-y-1.5 overflow-y-auto font-mono text-xs">
                  {filteredLogs.map((log, idx) => (
                    <div key={`${log.id}:${idx}`} className="flex items-start gap-2">
                      <span
                        className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                          log.status === "done"
                            ? "bg-emerald-500"
                            : log.status === "error"
                              ? "bg-red-500"
                              : "bg-amber-400"
                        }`}
                      />
                      {!selectedStep && (
                        <span className="shrink-0 text-[--text-muted]">[Step {log.step}]</span>
                      )}
                      <span className={log.status === "error" ? "text-red-500" : "text-[--text-primary]"}>
                        {log.message}
                      </span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </div>

              {/* Retry button when a step has failed */}
              {([1, 2, 3, 4, 5] as Step[]).some((s) => stepStatus[s] === "error") && !historyMode && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={retryStep}
                  className="self-start"
                >
                  <AlertCircle className="mr-1.5 h-3.5 w-3.5" />
                  {t("retry")}
                </Button>
              )}

              {/* Step 3 metadata: asset setup */}
              {false && selectedStep === 3 && (metaCharacters || metaItems || metaEnvironments || metaVoices) && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2 rounded-xl border border-[--border-subtle] bg-white p-1.5">
                    {([
                      { key: "characters" as const, label: t("assetCharacters"), count: metaCharacters?.length || 0 },
                      { key: "items" as const, label: t("assetItems"), count: metaItems?.length || 0 },
                      { key: "environments" as const, label: t("assetEnvironments"), count: metaEnvironments?.length || 0 },
                      { key: "voices" as const, label: t("assetVoices"), count: metaVoices?.length || 0 },
                    ]).map((tab) => (
                      <button
                        key={tab.key}
                        onClick={() => setActiveAssetTab(tab.key)}
                        className={`flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${
                          activeAssetTab === tab.key
                            ? "bg-primary text-white"
                            : "text-[--text-muted] hover:bg-[--surface] hover:text-[--text-primary]"
                        }`}
                      >
                        <span>{tab.label}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                          activeAssetTab === tab.key
                            ? "bg-white/20 text-white"
                            : "bg-[--surface] text-[--text-muted]"
                        }`}>
                          {tab.count}
                        </span>
                      </button>
                    ))}
                  </div>

                  {activeAssetTab === "characters" && (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
                      {(metaCharacters || []).map((char, idx) => (
                        <div
                          key={`${char.name}:${idx}`}
                          className="group relative overflow-hidden rounded-[14px] border border-[--border-subtle] bg-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5 hover:border-[--border-hover]"
                        >
                          <div className={`h-1 w-full ${char.scope === "main" ? "bg-gradient-to-r from-blue-500 to-blue-400" : "bg-gradient-to-r from-purple-500 to-purple-400"}`} />
                          <div className="p-3.5">
                            <div className="mb-2.5 flex items-center gap-2.5">
                              <div
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-sm font-bold text-white"
                                style={{ background: `linear-gradient(135deg, hsl(${(char.name.charCodeAt(0) * 37) % 360}, 45%, 45%), hsl(${(char.name.charCodeAt(0) * 37) % 360}, 50%, 55%))` }}
                              >
                                {char.name.charAt(0)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[13px] font-bold text-[--text-primary]">{char.name}</div>
                                <div className="flex items-center gap-1.5 text-[10px] text-[--text-muted]">
                                  <span>{t("frequency")} {char.frequency}</span>
                                  {char.visualHint && (
                                    <>
                                      <span className="h-[3px] w-[3px] rounded-full bg-[#ddd]" />
                                      <span className="truncate">{char.visualHint}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            {char.visualHint && (
                              <div className="mb-2 inline-block rounded-md bg-[--surface] px-2 py-0.5 text-[10px] font-medium text-[--text-muted]">
                                {char.visualHint}
                              </div>
                            )}
                            <p className="line-clamp-2 text-[11px] leading-relaxed text-[--text-muted]">{char.description}</p>
                          </div>
                          <span className={`absolute right-3 top-3 rounded-[8px] px-2 py-0.5 text-[9px] font-bold tracking-wide ${
                            char.scope === "main" ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"
                          }`}>
                            {char.scope === "main" ? t("main") : t("guest")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {(activeAssetTab === "items" || activeAssetTab === "environments" || activeAssetTab === "voices") && (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                      {(activeAssetTab === "items" ? (metaItems || []) : activeAssetTab === "environments" ? (metaEnvironments || []) : (metaVoices || [])).map((asset, idx) => (
                        <div
                          key={`${asset.name}:${idx}`}
                          className="rounded-[14px] border border-[--border-subtle] bg-white p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5 hover:border-[--border-hover]"
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-[13px] font-bold text-[--text-primary]">{asset.name}</div>
                              <div className="text-[10px] text-[--text-muted]">{t("frequency")} {asset.frequency}</div>
                            </div>
                            {asset.visualHint && (
                              <span className="shrink-0 rounded-md bg-[--surface] px-2 py-0.5 text-[10px] font-medium text-[--text-muted]">
                                {asset.visualHint}
                              </span>
                            )}
                          </div>
                          <p className="line-clamp-4 text-[11px] leading-relaxed text-[--text-muted]">{asset.description}</p>
                        </div>
                      ))}
                    </div>
                  )}

                </div>
              )}
              {/* Step 4 metadata: episodes */}
              {selectedStep === 4 && metaEpisodes && metaEpisodes.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-medium text-[--text-secondary]">
                    {t("reviewEpisodes")} ({metaEpisodes.length})
                  </h4>
                  <div className="space-y-2">
                    {metaEpisodes.map((ep, idx) => (
                      <div key={`${ep.title}:${idx}`} className="rounded-xl border border-[--border-subtle] bg-white p-3">
                        <div className="mb-1 flex items-center gap-2">
                          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                            EP.{String(idx + 1).padStart(2, "0")}
                          </span>
                          <span className="text-sm font-semibold text-[--text-primary]">{ep.title}</span>
                        </div>
                        <p className="text-xs text-[--text-muted]">{ep.description}</p>
                        {ep.characters && ep.characters.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {ep.characters.map((name, charIdx) => {
                              const isMain = step3Characters?.some((c) => c.name === name && c.scope === "main");
                              return (
                                <span key={`${name}:${charIdx}`} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isMain ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"}`}>
                                  {name}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {historyMode && (
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setHistoryMode(false);
                      setSelectedStep(null);
                      setCurrentStep(0);
                      storyReviewedRef.current = false;
                      setStepStatus({ 1: "idle", 2: "idle", 3: "idle", 4: "idle", 5: "idle" });
                    }}
                  >
                    {t("newImport")}
                  </Button>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

