import { ImageNode, LinkNode } from "markstream-react";
import { type ComponentProps, useEffect, useState } from "react";
import { FileTypeIcon, fileName, fileExtension } from "../ui/FileTypeIcon";
import { DownloadIcon } from "../icons";
import { useScopedLanguage } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import { classifyMarkdownLink } from "./markdown-link";

function artifactUrl(session: string, path: string, mode: "download" | "preview" | "thumb" | "meta" = "download"): string {
  const parts = location.pathname.split("/").filter(Boolean);
  const prefix = parts[0] === "preview" && parts[1] ? "/preview/" + parts[1] : "";
  return prefix + "/api/artifact?" + new URLSearchParams({ session, path, preview: mode === "preview" ? "1" : "0", thumb: mode === "thumb" ? "1" : "0", meta: mode === "meta" ? "1" : "0" });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
export function Artifact({ session, path, label, image }: { session: string; path: string; label: string; image: boolean }) {
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState<number | null>(null);
  const language = useScopedLanguage();
  const preview = artifactUrl(session, path, "preview");
  const thumb = artifactUrl(session, path, "thumb");
  const download = artifactUrl(session, path);
  const meta = artifactUrl(session, path, "meta");
  const name = fileName(path);
  const downloadLabel = language === "zh" ? "\u4e0b\u8f09" : "Download";
  useEffect(() => {
    const controller = new AbortController();
    fetch(meta, { credentials: "same-origin", signal: controller.signal }).then(r => r.ok ? r.json() : null)
      .then(data => { if (typeof data?.size === "number") setSize(data.size); }).catch(() => {});
    return () => controller.abort();
  }, [meta]);
  return <span data-artifact-card="1" className="my-2 inline-flex w-[280px] max-w-full flex-col overflow-hidden rounded-xl border border-border bg-surface align-top">
    {image && !failed && <a href={preview} target="_blank" rel="noopener noreferrer" data-tcode-artifact="1"
      className="block overflow-hidden bg-black/5 dark:bg-white/5">
      <img src={thumb} alt={label} loading="lazy" onError={() => setFailed(true)}
        className="block max-h-[180px] w-full object-contain" />
    </a>}
    <span className="flex min-w-0 items-center gap-2 px-2.5 py-2">
      <FileTypeIcon path={path} className="size-9" />
      <span className="min-w-0 flex-1">
        <a href={image ? preview : download} download={image ? undefined : ""} target={image ? "_blank" : undefined}
          rel={image ? "noopener noreferrer" : undefined} data-tcode-artifact="1" title={name}
          className="block truncate text-[13px] font-medium text-ink no-underline">{name}</a>
        <span className="block text-[11px] text-ink-dim">{fileExtension(path).toUpperCase() || "FILE"}{size !== null ? " \u00b7 " + formatBytes(size) : ""}</span>
      </span>
      <a href={download} download data-tcode-artifact="1" aria-label={downloadLabel} title={downloadLabel}
        className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-dim hover:bg-black/5 hover:text-ink dark:hover:bg-white/10">
        <DownloadIcon size={18} />
      </a>
    </span>
  </span>;
}

export function ArtifactLink(props: ComponentProps<typeof LinkNode>) {
  const session = useSessionsStore(s => s.activeSessionId);
  const link = classifyMarkdownLink(props.node.href);
  if (window.pi || !session || link.kind !== "file" || props.node.loading) return <LinkNode {...props} />;
  const image = /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(link.target);
  return <Artifact key={link.target} session={session} path={link.target} label={props.node.text} image={image} />;
}

export function ArtifactImage(props: ComponentProps<typeof ImageNode>) {
  const session = useSessionsStore(s => s.activeSessionId);
  const link = classifyMarkdownLink(props.node.src);
  if (window.pi || !session || link.kind !== "file" || props.node.loading) return <ImageNode {...props} />;
  return <Artifact key={link.target} session={session} path={link.target} label={props.node.alt} image />;
}
