"use client";

import { useEffect, useState, useCallback, useRef, use, useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import {
  Upload, FileText, Users, Layers, Sparkles,
  Loader2, Check, X, ArrowLeft, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api-fetch";
import { useModelStore } from "@/stores/model-store";
import { useProjectStore } from "@/stores/project-store";
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
}

interface ExtractedAsset {
  name: string;
  frequency: number;
  description: string;
  visualHint?: string;
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
  const tc = useTranslations("common");
  const textGuard = useModelGuard("text");
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const projectTitle = useProjectStore((s) => s.project?.title);
  const localLogSeq = useRef(0);
  const splitRunningRef = useRef(false);

  // Pipeline state
  const [currentStep, setCurrentStep] = useState<Step | 0>(0);
  const [stepStatus, setStepStatus] = useState<Record<Step, "idle" | "running" | "done" | "error">>({
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
  const [relationships, setRelationships] = useState<Array<{ characterA: string; characterB: string; relationType: string; description?: string }>>([]);

  // Step 3 result
  const [episodes, setEpisodes] = useState<SplitEpisode[]>([]);

  // History mode
  const [historyMode, setHistoryMode] = useState(false);
  const [selectedStep, setSelectedStep] = useState<Step | null>(null);
  const [activeAssetTab, setActiveAssetTab] = useState<"characters" | "items" | "environments" | "voices">("characters");

  // Load existing logs on mount
  useEffect(() => {
    async function loadLogs() {
      try {
        const res = await apiFetch(`/api/projects/${projectId}/import/logs`);
        const data = await res.json();
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
          const storyMeta = storyLog?.metadata as { text?: string; preview?: string } | undefined;
          const restoredText = storyMeta?.text || parseMeta?.text || storyMeta?.preview;
          if (restoredText) setFullText(restoredText);

          const assetLog = data.find((l: LogEntry) => l.step === 3 && l.status === "done" && l.metadata);
          const assetMeta = assetLog?.metadata as {
            characters?: ExtractedCharacter[];
            items?: ExtractedAsset[];
            environments?: ExtractedAsset[];
            relationships?: Array<{ characterA: string; characterB: string; relationType: string; description?: string }>;
          } | undefined;
          if (assetMeta?.characters) setCharacters(assetMeta.characters);
          if (assetMeta?.items) setItems(assetMeta.items);
          if (assetMeta?.environments) setEnvironments(assetMeta.environments);
          if (assetMeta?.relationships) setRelationships(assetMeta.relationships);

          const splitLog = data.find((l: LogEntry) => l.step === 4 && l.status === "done" && l.metadata);
          const splitMeta = splitLog?.metadata as { episodes?: SplitEpisode[] } | undefined;
          if (splitMeta?.episodes) setEpisodes(splitMeta.episodes);

          for (let s = 1; s <= 5; s++) {
            const stepLogs = data.filter((l: LogEntry) => l.step === s);
            const latestStepLog = stepLogs[stepLogs.length - 1];
            if (latestStepLog) {
              setStepStatus((prev) => ({ ...prev, [s]: latestStepLog.status }));
            }
          }
        }
      } catch {
        // No logs, fresh import
      }
    }
    loadLogs();
  }, [projectId]);

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
    setCharacters([]);
    setItems([]);
    setEnvironments([]);
    setRelationships([]);
    setEpisodes([]);
    setStepStatus({ 1: "idle", 2: "idle", 3: "idle", 4: "idle", 5: "idle" });
  }, [t]);

  // ── Step 1: Parse, then stop for story review ──
  async function startPipeline() {
    if (!file) return;
    if (!textGuard()) return;

    setHistoryMode(false);
    setSelectedStep(null);
    setLogs([]);
    setFullText("");
    setReviewIssues([]);
    setCharacters([]);
    setItems([]);
    setEnvironments([]);
    setRelationships([]);
    setEpisodes([]);
    storyReviewedRef.current = false;
    setStepStatus({ 1: "idle", 2: "idle", 3: "idle", 4: "idle", 5: "idle" });

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
        body: JSON.stringify({ text, modelConfig: getModelConfig() }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json() as {
        issues: StoryReviewIssue[];
        usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
      };
      setReviewIssues(data.issues || []);
      const usageParts = [
        typeof data.usage?.inputTokens === "number" ? `输入 ${data.usage.inputTokens}` : null,
        typeof data.usage?.outputTokens === "number" ? `输出 ${data.usage.outputTokens}` : null,
        typeof data.usage?.totalTokens === "number" ? `合计 ${data.usage.totalTokens}` : null,
      ].filter(Boolean);
      const usageSuffix = usageParts.length > 0 ? `，token：${usageParts.join(" / ")}` : "";
      addLog(2, "done", data.issues?.length ? `AI 剧情审阅完成，发现 ${data.issues.length} 个问题${usageSuffix}` : `AI 剧情审阅完成，未发现明显问题${usageSuffix}`);
      setStepStatus((prev) => ({ ...prev, 2: "idle" }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Review failed";
      addLog(2, "error", `AI 剧情审阅失败: ${msg}`);
      setStepStatus((prev) => ({ ...prev, 2: "error" }));
    }
  }

  function goToStep(step: Step) {
    setHistoryMode(false);
    setSelectedStep(null);
    setCurrentStep(step);

    if (step <= 2) {
      storyReviewedRef.current = false;
      setCharacters([]);
      setItems([]);
      setEnvironments([]);
      setRelationships([]);
      setEpisodes([]);
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
        metadata: { charCount: fullText.length, preview: fullText.slice(0, 2000), text: fullText },
      }),
    });
    setCurrentStep(3);
    setStepStatus((prev) => ({ ...prev, 2: "done" }));
    addLog(2, "done", `剧情审阅通过，共 ${fullText.length} 字`);
    await runCharacterExtract();
  }

  // ── Step 3: Asset setting foundation - character extraction ──
  async function runCharacterExtract() {
    if (!fullText) return;
    if (!storyReviewedRef.current && stepStatus[2] !== "done") {
      setCurrentStep(2);
      setStepStatus((prev) => ({ ...prev, 2: "idle", 3: "idle" }));
      return;
    }
    if (!textGuard()) return;

    setCurrentStep(3);
    setStepStatus((prev) => ({ ...prev, 3: "running" }));
    addLog(3, "running", "开始资产设定：提取角色、关系和主配角...");

    try {
      const res = await apiFetch(`/api/projects/${projectId}/import/characters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: fullText, modelConfig: getModelConfig() }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setCharacters(data.characters);
      setItems(data.items || []);
      setEnvironments(data.environments || []);
      setRelationships(data.relationships || []);
      const mainCount = data.characters.filter((c: ExtractedCharacter) => c.scope === "main").length;
      const guestCount = data.characters.length - mainCount;
      addLog(3, "done", `资产设定完成: ${mainCount} 个主角, ${guestCount} 个配角, ${(data.items || []).length} 个物品, ${(data.environments || []).length} 个环境`);
      setStepStatus((prev) => ({ ...prev, 3: "done" }));
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
      addLog(4, "done", `分集完成，共 ${data.episodes.length} 集`);
      setStepStatus((prev) => ({ ...prev, 4: "done" }));
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
          relationships,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      addLog(5, "done", `导入完成！创建了 ${data.characterCount} 个角色、${data.itemCount || 0} 个物品、${data.environmentCount || 0} 个环境和 ${data.episodes.length} 集`);
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

  function toggleScope(idx: number) {
    setCharacters((prev) =>
      prev.map((c, i) =>
        i === idx ? { ...c, scope: c.scope === "main" ? "guest" : "main" } : c
      )
    );
  }

  function updateEpisode(idx: number, field: keyof SplitEpisode, value: string) {
    setEpisodes((prev) =>
      prev.map((ep, i) => (i === idx ? { ...ep, [field]: value } : ep))
    );
  }

  function removeEpisode(idx: number) {
    setEpisodes((prev) => prev.filter((_, i) => i !== idx));
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
  const categoryLabel: Record<StoryReviewIssue["category"], string> = {
    prohibited: t("reviewCategoryProhibited"),
    logic: t("reviewCategoryLogic"),
    continuity: t("reviewCategoryContinuity"),
    setting: t("reviewCategorySetting"),
    other: t("reviewCategoryOther"),
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden bg-[--surface]">
      {/* Top: Steps navigation */}
      <div className="shrink-0 border-b border-[--border-subtle] bg-white px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
          <button
            onClick={() => router.push(`/${locale}/project/${projectId}/episodes`)}
            className="flex h-10 w-[180px] shrink-0 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-[--text-primary] transition-colors hover:bg-[--surface] hover:text-primary md:w-[220px]"
            title={projectTitle || t("title")}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="truncate">{projectTitle || t("title")}</span>
          </button>

          <div className="flex min-w-[660px] flex-1 gap-2">
            {STEPS.map(({ num, icon: Icon, label }) => {
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
          <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4">
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

            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] gap-4">
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

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
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

        {/* Asset setup review (characters, items, environments, voices placeholder) */}
        {showCharReview && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-bold text-[--text-primary]">
                  {t("reviewAssets")}
                </h3>
                <p className="mt-1 text-sm text-[--text-muted]">{t("reviewAssetsHint")}</p>
              </div>
              <Button onClick={runSplit} disabled={stepStatus[4] === "running"} className="rounded-xl">
                {stepStatus[4] === "running" && <Loader2 className="size-4 animate-spin" />}
                {t("confirmAndSplit")}
              </Button>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {([
                {
                  key: "characters" as const,
                  title: t("assetCharacters"),
                  count: characters.length,
                  summary: t("assetCharactersSummary", {
                    main: characters.filter((c) => c.scope === "main").length,
                    guest: characters.filter((c) => c.scope === "guest").length,
                  }),
                },
                {
                  key: "items" as const,
                  title: t("assetItems"),
                  count: items.length,
                  summary: t("assetItemsSummary", { count: items.length }),
                },
                {
                  key: "environments" as const,
                  title: t("assetEnvironments"),
                  count: environments.length,
                  summary: t("assetEnvironmentsSummary", { count: environments.length }),
                },
                {
                  key: "voices" as const,
                  title: t("assetVoices"),
                  count: 0,
                  summary: t("assetVoicesPlaceholder"),
                },
              ]).map((asset) => (
                <button
                  key={asset.key}
                  onClick={() => setActiveAssetTab(asset.key)}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    activeAssetTab === asset.key
                      ? "border-primary/40 bg-primary/5"
                      : "border-[--border-subtle] bg-white hover:border-[--border-hover]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-base font-bold text-[--text-primary]">{asset.title}</div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      asset.key === "voices" ? "bg-[--surface] text-[--text-muted]" : "bg-emerald-50 text-emerald-600"
                    }`}>
                      {asset.key === "voices" ? t("assetPending") : t("assetConfirmed", { count: asset.count })}
                    </span>
                  </div>
                  <div className="mt-3 rounded-lg bg-[--surface] px-3 py-1.5 text-xs text-[--text-muted]">
                    {asset.summary}
                  </div>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 rounded-xl border border-[--border-subtle] bg-white p-1.5">
              {([
                { key: "characters" as const, label: t("assetCharacters"), count: characters.length },
                { key: "items" as const, label: t("assetItems"), count: items.length },
                { key: "environments" as const, label: t("assetEnvironments"), count: environments.length },
                { key: "voices" as const, label: t("assetVoices"), count: 0 },
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
                    {tab.key === "voices" ? t("assetPending") : tab.count}
                  </span>
                </button>
              ))}
            </div>

            {activeAssetTab === "voices" && (
              <div className="rounded-xl border border-[--border-subtle] bg-white p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-bold text-[--text-primary]">{t("assetVoices")}</h4>
                    <p className="mt-1 text-sm text-[--text-muted]">{t("assetVoicesSetupHint")}</p>
                  </div>
                  <Button variant="outline" className="rounded-xl" disabled>
                    {t("assetSetup")}
                  </Button>
                </div>
              </div>
            )}

            {activeAssetTab === "characters" && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
                {characters.map((char, idx) => (
                <div
                  key={`${char.name}:${idx}`}
                  className="group relative overflow-hidden rounded-[14px] border border-[--border-subtle] bg-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5 hover:border-[--border-hover]"
                >
                  {/* Top accent strip */}
                  <div className={`h-1 w-full ${char.scope === "main" ? "bg-gradient-to-r from-blue-500 to-blue-400" : "bg-gradient-to-r from-purple-500 to-purple-400"}`} />
                  <div className="p-3.5">
                    {/* Avatar + Name */}
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
                    {/* Visual hint tag */}
                    {char.visualHint && (
                      <div className="mb-2 inline-block rounded-md bg-[--surface] px-2 py-0.5 text-[10px] font-medium text-[--text-muted]">
                        {char.visualHint}
                      </div>
                    )}
                    {/* Description */}
                    <p className="line-clamp-2 text-[11px] leading-relaxed text-[--text-muted]">{char.description}</p>
                  </div>
                  {/* Scope badge (floating, clickable) */}
                  <button
                    onClick={() => toggleScope(idx)}
                    className={`absolute right-3 top-3 rounded-[8px] px-2 py-0.5 text-[9px] font-bold tracking-wide transition-colors ${
                      char.scope === "main"
                        ? "bg-blue-50 text-blue-600 hover:bg-blue-100"
                        : "bg-purple-50 text-purple-600 hover:bg-purple-100"
                    }`}
                  >
                    {char.scope === "main" ? t("main") : t("guest")}
                  </button>
                </div>
                ))}
              </div>
            )}

            {(activeAssetTab === "items" || activeAssetTab === "environments") && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                {(activeAssetTab === "items" ? items : environments).map((asset, idx) => (
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

        {/* Episodes review (after step 3) */}
        {showEpReview && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-[--text-primary]">
                {t("reviewEpisodes")} ({episodes.length})
              </h3>
              <Button onClick={runGenerate} className="rounded-xl">
                {t("confirmAndGenerate")}
              </Button>
            </div>
            <p className="text-sm text-[--text-muted]">{t("reviewEpisodesHint")}</p>
            <div className="space-y-3">
              {episodes.map((ep, idx) => (
                <div
                  key={`${ep.title}:${idx}`}
                  className="rounded-xl border border-[--border-subtle] bg-white p-4"
                >
                  <div className="mb-2 flex items-center gap-3">
                    <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs font-semibold text-primary">
                      EP.{String(idx + 1).padStart(2, "0")}
                    </span>
                    <Input
                      value={ep.title}
                      onChange={(e) => updateEpisode(idx, "title", e.target.value)}
                      className="h-8 text-sm font-semibold"
                    />
                    <button
                      onClick={() => removeEpisode(idx)}
                      className="shrink-0 text-[--text-muted] hover:text-red-500"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="text-xs text-[--text-muted]">{ep.description}</p>
                  {ep.characters && ep.characters.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {ep.characters.map((name, charIdx) => {
                        const isMain = characters.some((c) => c.name === name && c.scope === "main");
                        return (
                          <span key={`${name}:${charIdx}`} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isMain ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"}`}>
                            {name}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {ep.keywords && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {ep.keywords.split(/[,，]/).map((kw) => kw.trim()).filter(Boolean).map((kw, kwIdx) => (
                        <span key={`${kw}:${kwIdx}`} className="rounded bg-primary/8 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
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
                      { key: "voices" as const, label: t("assetVoices"), count: 0 },
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
                          {tab.key === "voices" ? t("assetPending") : tab.count}
                        </span>
                      </button>
                    ))}
                  </div>

                  {activeAssetTab === "voices" && (
                    <div className="rounded-xl border border-[--border-subtle] bg-white p-5">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h4 className="text-sm font-bold text-[--text-primary]">{t("assetVoices")}</h4>
                          <p className="mt-1 text-sm text-[--text-muted]">{t("assetVoicesSetupHint")}</p>
                        </div>
                        <Button variant="outline" className="rounded-xl" disabled>
                          {t("assetSetup")}
                        </Button>
                      </div>
                    </div>
                  )}

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

                  {(activeAssetTab === "items" || activeAssetTab === "environments") && (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                      {(activeAssetTab === "items" ? (metaItems || items) : (metaEnvironments || environments)).map((asset, idx) => (
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
              {false && selectedStep === 3 && (metaCharacters || metaItems || metaEnvironments) && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2 rounded-xl border border-[--border-subtle] bg-white p-1.5">
                    {([
                      { key: "characters" as const, label: t("assetCharacters"), count: metaCharacters?.length || 0 },
                      { key: "items" as const, label: t("assetItems"), count: metaItems?.length || 0 },
                      { key: "environments" as const, label: t("assetEnvironments"), count: metaEnvironments?.length || 0 },
                      { key: "voices" as const, label: t("assetVoices"), count: 0 },
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
                          {tab.key === "voices" ? t("assetPending") : tab.count}
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

                  {(activeAssetTab === "items" || activeAssetTab === "environments") && (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                      {(activeAssetTab === "items" ? (metaItems || []) : (metaEnvironments || [])).map((asset, idx) => (
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

                  {activeAssetTab === "voices" && (
                    <div className="rounded-xl border border-[--border-subtle] bg-white p-5">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h4 className="text-sm font-bold text-[--text-primary]">{t("assetVoices")}</h4>
                          <p className="mt-1 text-sm text-[--text-muted]">{t("assetVoicesSetupHint")}</p>
                        </div>
                        <Button variant="outline" className="rounded-xl" disabled>
                          {t("assetSetup")}
                        </Button>
                      </div>
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

