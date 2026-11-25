const icons = import.meta.glob<string>("../../assets/file-types/*.svg", { eager: true, query: "?url", import: "default" });
const groups: Record<string, string[]> = {
  word: ["doc", "docx", "odt", "rtf"],
  pdf: ["pdf"], table: ["xls", "xlsx", "xlsm", "csv", "tsv", "ods"],
  powerpoint: ["ppt", "pptx", "odp"], zip: ["zip", "rar", "7z", "tar", "gz", "bz2"],
  image: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "tiff", "heic"],
  video: ["mp4", "mov", "mkv", "avi", "webm"], audio: ["mp3", "wav", "m4a", "flac", "ogg"],
  document: ["txt", "log"], markdown: ["md", "markdown"], svg: ["svg"],
  font: ["ttf", "otf", "woff", "woff2"], html: ["html", "htm"], css: ["css", "scss"],
  javascript: ["js", "jsx", "ts", "tsx", "mjs"], json: ["json", "jsonl"], python: ["py"],
  "adobe-illustrator": ["ai", "eps"], "adobe-photoshop": ["psd", "psb"],
};
export function fileName(path: string): string {
  let name = path.split(/[\\/]/).pop() || path;
  try { name = decodeURIComponent(name); } catch {}
  return /(?:^|[\\\\/])uploads[\\\\/]/i.test(path) ? name.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "") : name;
}
export function fileExtension(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}
export function FileTypeIcon({ path, className = "size-8" }: {path: string; className?: string}) {
  const ext = fileExtension(path);
  const kind = Object.entries(groups).find(([, values]) => values.includes(ext))?.[0] || "file";
  return <img src={icons["../../assets/file-types/" + kind + ".svg"]} className={className + " shrink-0 object-contain"} alt="" aria-hidden="true" />;
}
