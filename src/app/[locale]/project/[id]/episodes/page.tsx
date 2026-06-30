"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  Check,
  ChevronDown,
  Download,
  FileUp,
  Layers,
  Loader2,
  Merge,
  Play,
  Plus,
  Upload,
  Users,
  X,
} from "lucide-react";
import { uploadUrl } from "@/lib/utils/upload-url";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EpisodeDialog } from "@/components/editor/episode-dialog";
import { useEpisodeStore, type Episode } from "@/stores/episode-store";
import { apiFetch } from "@/lib/api-fetch";
import Link from "next/link";

function stripEpisodePrefix(title: string) {
  return title
    .replace(
      /^\s*(第\s*[0-9０-９一二三四五六七八九十百千万两〇零]+\s*[集话話回]|EP\.?\s*\d+|Episode\s+\d+)\s*[:：.\-、,，]?\s*/i,
      ""
    )
    .trim();
}

function formatEpisodeChipLabel(episode: Episode) {
  const title = stripEpisodePrefix(episode.title?.trim() || "");
  return `E${episode.sequence}${title ? ` ${title}` : ""}`;
}

export default function EpisodesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const locale = useLocale();
  const t = useTranslations("episode");
  const tc = useTranslations("common");
  const {
    episodes,
    loading,
    fetchEpisodes,
    createEpisode,
    deleteEpisode,
    updateEpisode,
  } = useEpisodeStore();

  const [createOpen, setCreateOpen] = useState(false);
  const [editingEpisode, setEditingEpisode] = useState<Episode | null>(null);
  const [playingEpisode, setPlayingEpisode] = useState<Episode | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [mergedVideoUrl, setMergedVideoUrl] = useState<string | null>(null);
  const [episodeListOpen, setEpisodeListOpen] = useState(true);

  useEffect(() => {
    fetchEpisodes(projectId);
  }, [projectId, fetchEpisodes]);

  // Close video modal on Escape
  useEffect(() => {
    if (!playingEpisode) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPlayingEpisode(null);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [playingEpisode]);

  async function handleCreate(data: { title: string; description?: string; keywords?: string }) {
    await createEpisode(projectId, data);
    toast.success(t("created"));
  }

  async function handleEdit(data: { title: string; description?: string; keywords?: string }) {
    if (!editingEpisode) return;
    await updateEpisode(projectId, editingEpisode.id, data);
    setEditingEpisode(null);
  }

  async function handleDelete(episode: Episode) {
    if (episodes.length <= 1) {
      toast.error(t("cannotDeleteLast"));
      return;
    }
    if (!confirm(t("deleteConfirm"))) return;
    await deleteEpisode(projectId, episode.id);
  }

  const handlePlayVideo = useCallback((episode: Episode) => {
    setPlayingEpisode(episode);
  }, []);

  function toggleSelect(episode: Episode) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(episode.id)) next.delete(episode.id);
      else next.add(episode.id);
      return next;
    });
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  async function handleMerge() {
    if (selectedIds.size < 2) {
      toast.error(t("mergeMinTwo"));
      return;
    }
    setMerging(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/merge-episodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeIds: Array.from(selectedIds) }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Merge failed");
      }
      const data = await res.json();
      setMergedVideoUrl(data.videoUrl);
      toast.success(t("mergeSuccess"));
      exitSelectionMode();
    } catch (err) {
      console.error("Merge error:", err);
      toast.error(err instanceof Error ? err.message : t("mergeError"));
    } finally {
      setMerging(false);
    }
  }

  function episodeDetailHref(episode: Episode) {
    return `/${locale}/project/${projectId}/episodes/${episode.id}/script`;
  }

  function chipClassName(episode: Episode, selected: boolean, selectable: boolean) {
    const base =
      "inline-flex h-11 max-w-[360px] shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-all";
    if (selectionMode) {
      if (!selectable) {
        return `${base} cursor-not-allowed bg-black/[0.04] text-[--text-muted] opacity-45`;
      }
      return selected
        ? `${base} border border-primary/60 bg-primary/10 text-primary shadow-sm`
        : `${base} bg-black/[0.04] text-[--text-secondary] hover:bg-primary/8 hover:text-primary`;
    }

    return episode.finalVideoUrl
      ? `${base} bg-black/[0.04] text-[--text-secondary] hover:bg-primary/8 hover:text-primary`
      : `${base} bg-primary/8 text-primary hover:bg-primary/12`;
  }

  function renderEpisodeChip(episode: Episode) {
    const selected = selectedIds.has(episode.id);
    const selectable = !!episode.finalVideoUrl;
    const label = formatEpisodeChipLabel(episode);
    const content = (
      <>
        <span className="truncate">{label}</span>
        {selectionMode && selected ? (
          <Check className="h-4 w-4 shrink-0" />
        ) : episode.finalVideoUrl ? (
          <Check className="h-4 w-4 shrink-0 text-emerald-500" />
        ) : null}
      </>
    );

    if (selectionMode) {
      return (
        <button
          key={episode.id}
          type="button"
          disabled={!selectable}
          onClick={() => selectable && toggleSelect(episode)}
          className={chipClassName(episode, selected, selectable)}
          title={label}
        >
          {content}
        </button>
      );
    }

    return (
      <Link
        key={episode.id}
        href={episodeDetailHref(episode)}
        className={chipClassName(episode, false, selectable)}
        title={label}
      >
        {content}
      </Link>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-[--text-muted]">{tc("loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[--surface] p-6 pb-24 lg:pb-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/8">
            <Layers className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-[--text-primary]">
              {t("title")}
            </h2>
            <p className="text-xs text-[--text-muted]">
              {episodes.length} {t("count")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/${locale}/project/${projectId}/import`}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-[--border-subtle] bg-white px-3.5 py-2 text-sm font-medium text-[--text-secondary] shadow-sm transition-all hover:border-primary/20 hover:text-primary"
          >
            <FileUp className="h-4 w-4" />
            {t("importRecord")}
          </Link>
          <Link
            href={`/${locale}/project/${projectId}/characters`}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-[--border-subtle] bg-white px-3.5 py-2 text-sm font-medium text-[--text-secondary] shadow-sm transition-all hover:border-primary/20 hover:text-primary"
          >
            <Users className="h-4 w-4" />
            {t("characters")}
          </Link>
          <Button
            variant="outline"
            onClick={() => {
              if (selectionMode) {
                exitSelectionMode();
              } else {
                setSelectionMode(true);
              }
            }}
            className="rounded-[10px]"
            disabled={episodes.filter((e) => e.finalVideoUrl).length < 2}
          >
            <Merge className="mr-1.5 h-4 w-4" />
            {selectionMode ? t("mergeCancel") : t("mergeVideos")}
          </Button>
          <Button onClick={() => setCreateOpen(true)} className="rounded-[10px]">
            <Plus className="mr-1.5 h-4 w-4" />
            {t("create")}
          </Button>
        </div>
      </div>

      {/* Episode chips */}
      {episodes.length === 0 ? (
        <div className="flex min-h-[400px] flex-col items-center justify-center rounded-3xl border border-dashed border-[--border-subtle] bg-white/50 p-8 text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-accent/10">
            <Layers className="h-7 w-7 text-primary" />
          </div>
          <h3 className="font-display text-lg font-semibold text-[--text-primary]">
            {t("title")}
          </h3>
          <p className="mt-2 max-w-sm text-sm text-[--text-secondary]">
            {t("noEpisodes")}
          </p>
          <div className="mt-6 flex items-center gap-3">
            <Button onClick={() => setCreateOpen(true)} className="rounded-xl">
              <Plus className="mr-1.5 h-4 w-4" />
              {t("create")}
            </Button>
            <Link href={`/${locale}/project/${projectId}/import`}>
              <Button variant="outline" className="rounded-xl">
                <Upload className="mr-1.5 h-4 w-4" />
                {t("uploadScript")}
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <section className="rounded-lg border border-[--border-subtle] bg-white px-4 py-4">
            <div className="flex items-start gap-3">
              <span className="mt-3 shrink-0 text-sm font-semibold text-[--text-secondary]">
                分集:
              </span>
              <div className="relative min-w-0 flex-1">
                <div
                  className={`flex gap-2.5 ${
                    episodeListOpen
                      ? "max-h-[420px] flex-wrap overflow-y-auto pr-1"
                      : "h-11 flex-nowrap overflow-hidden"
                  }`}
                >
                  {episodes.map((episode) => renderEpisodeChip(episode))}
                </div>
                {!episodeListOpen && (
                  <div className="pointer-events-none absolute bottom-0 right-0 top-0 w-16 bg-gradient-to-r from-transparent to-white" />
                )}
              </div>
              <Button
                variant="outline"
                onClick={() => setEpisodeListOpen((open) => !open)}
                className="h-11 shrink-0 rounded-full border-primary/30 px-4 text-primary hover:border-primary/50 hover:bg-primary/8"
              >
                {episodeListOpen ? "收起" : `展开全部 ${episodes.length} 集`}
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${episodeListOpen ? "rotate-180" : ""}`}
                />
              </Button>
            </div>
          </section>

          {!selectionMode && (
            <button
              onClick={() => setCreateOpen(true)}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[--border-subtle] bg-white px-4 py-4 text-sm font-medium text-[--text-muted] transition-all hover:border-primary hover:bg-primary/[0.02] hover:text-primary"
            >
              <Plus className="h-4 w-4" />
              {t("create")}
            </button>
          )}
        </div>
      )}

      {/* Floating selection action bar */}
      {selectionMode && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-[--border-subtle] bg-white px-5 py-3 shadow-xl">
          <span className="text-sm font-medium text-[--text-secondary]">
            {t("mergeSelected", { count: selectedIds.size })}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={exitSelectionMode}
          >
            {t("mergeCancel")}
          </Button>
          <Button
            size="sm"
            disabled={selectedIds.size < 2 || merging}
            onClick={handleMerge}
          >
            {merging ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                {t("merging")}
              </>
            ) : (
              t("mergeConfirm")
            )}
          </Button>
        </div>
      )}

      {/* Create dialog */}
      <EpisodeDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
        mode="create"
      />

      {/* Edit dialog */}
      <EpisodeDialog
        open={!!editingEpisode}
        onOpenChange={(open) => { if (!open) setEditingEpisode(null); }}
        onSubmit={handleEdit}
        defaultValues={editingEpisode ? {
          title: editingEpisode.title,
          description: editingEpisode.description || "",
          keywords: editingEpisode.keywords || "",
        } : undefined}
        mode="edit"
      />

      {/* Video player modal */}
      {playingEpisode && playingEpisode.finalVideoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setPlayingEpisode(null)}
        >
          <div
            className="relative w-[90%] max-w-3xl overflow-hidden rounded-2xl bg-black shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setPlayingEpisode(null)}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition-colors hover:bg-white/30"
            >
              <X className="h-4 w-4" />
            </button>
            <video
              src={uploadUrl(playingEpisode.finalVideoUrl)}
              controls
              autoPlay
              className="w-full"
            />
            <div className="flex items-center justify-between bg-[#111] px-5 py-3">
              <span className="text-sm font-semibold text-white">{playingEpisode.title}</span>
              <span className="font-mono text-xs text-[#666]">
                EP.{String(playingEpisode.sequence).padStart(2, "0")}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Merged video preview + download modal */}
      {mergedVideoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setMergedVideoUrl(null)}
        >
          <div
            className="relative w-[90%] max-w-3xl overflow-hidden rounded-2xl bg-black shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setMergedVideoUrl(null)}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition-colors hover:bg-white/30"
            >
              <X className="h-4 w-4" />
            </button>
            <video
              src={uploadUrl(mergedVideoUrl)}
              controls
              autoPlay
              className="w-full"
            />
            <div className="flex items-center justify-between bg-[#111] px-5 py-3">
              <span className="text-sm font-semibold text-white">{t("mergeVideos")}</span>
              <a
                href={uploadUrl(mergedVideoUrl)}
                download
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
              >
                <Download className="h-3.5 w-3.5" />
                {t("downloadVideo")}
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
