export function splitUploadedAttachmentLine(text: string): { paths: string[]; text: string } {
  const end = text.indexOf("\n");
  const line = end === -1 ? text : text.slice(0, end);
  const empty = { paths: [], text };
  if (!line.startsWith("@")) return empty;
  const paths = line.slice(1).split(/ +@(?=(?:[a-z]:[\\/]|\/))/i);
  if (!paths.length || !paths.every(p => /^(?:[a-z]:[\\/]|\/).*[\\/]uploads[\\/][a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}-[^\\/]+$/i.test(p))) return empty;
  return { paths, text: end === -1 ? "" : text.slice(end + 1) };
}
