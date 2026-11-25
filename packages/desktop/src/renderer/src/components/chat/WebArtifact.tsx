import { ImageNode, LinkNode } from "markstream-react";
import { type ComponentProps, useState } from "react";
import { useSessionsStore } from "../../stores/sessions";
import { classifyMarkdownLink } from "./markdown-link";

function artifactUrl(session: string, path: string, preview = false): string {
  const parts = location.pathname.split("/").filter(Boolean);
  const prefix = parts[0] === "preview" && parts[1] ? "/preview/" + parts[1] : "";
  return prefix + "/api/artifact?" + new URLSearchParams({ session, path, preview: preview ? "1" : "0" });
}

function Artifact({ session, path, label, image }: { session: string; path: string; label: string; image: boolean }) {
  const [failed, setFailed] = useState(false);
  const preview = artifactUrl(session, path, true);
  const download = artifactUrl(session, path);
  return <span className="my-2 inline-flex max-w-full flex-col gap-2 align-top">
    {image && !failed && <a href={preview} target="_blank" rel="noopener noreferrer" data-tcode-artifact="1">
      <img src={preview} alt={label} loading="lazy" onError={() => setFailed(true)}
        className="block max-h-[360px] max-w-full rounded-lg object-contain" />
    </a>}
    <span className="flex flex-wrap items-center gap-3 text-sm">
      {image && <a href={preview} target="_blank" rel="noopener noreferrer" data-tcode-artifact="1">{label || "Preview"}</a>}
      <a href={download} download data-tcode-artifact="1" className="break-all underline">{image ? "Download" : label || "Download file"}</a>
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
