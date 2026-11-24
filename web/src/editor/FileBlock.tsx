import { useEffect, useState } from "react";
import { createFileBlockConfig, fileParse } from "@blocknote/core";
import { createReactBlockSpec, FileBlockWrapper } from "@blocknote/react";
import { Download, Eye, EyeOff } from "lucide-react";
import { fileUrl } from "../api";
import { LANG, t } from "../i18n";

type Kind = { label: string; short: string; color: string };
const KINDS: [RegExp, Kind][] = [
  [/\.(pptx?|odp|key)$/i, { label: "Presentation", short: "PPT", color: "#d9622b" }],
  [/\.(docx?|odt|rtf|pages)$/i, { label: "Text document", short: "DOC", color: "#2f6fd1" }],
  [/\.(xlsx?|ods|csv|numbers)$/i, { label: "Spreadsheet", short: "XLS", color: "#1f9d55" }],
  [/\.pdf$/i, { label: "PDF", short: "PDF", color: "#d64545" }],
  [/\.(zip|7z|rar|tar|gz|tgz)$/i, { label: "Archive", short: "ZIP", color: "#8a6d3b" }],
  [/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i, { label: "Image", short: "IMG", color: "#a855c7" }],
  [/\.(mp4|webm|mov|mkv|avi)$/i, { label: "Video", short: "VID", color: "#c2410c" }],
  [/\.(mp3|wav|flac|ogg|m4a)$/i, { label: "Audio", short: "MP3", color: "#0e8f8f" }],
  [/\.(pkt|pka|iso|ova|vmdk|cfg|txt|md|log|json|ya?ml)$/i, { label: "Text file", short: "TXT", color: "#6b7280" }],
];
export function fileKind(name: string): Kind & { ext: string } {
  const ext = (name.match(/\.([a-z0-9]{1,8})$/i)?.[1] || "").toUpperCase();
  const k = KINDS.find(([re]) => re.test(name))?.[1] || { label: "File", short: ext.slice(0, 4) || "FILE", color: "#6b7280" };
  return { ...k, ext };
}

export function formatSize(n: number): string {
  const u = LANG === "fr" ? ["o", "Ko", "Mo", "Go"] : ["B", "KB", "MB", "GB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  const s = i === 0 ? String(Math.round(v)) : v.toFixed(v >= 100 ? 0 : 1).replace(".", LANG === "fr" ? "," : ".");
  return `${s} ${u[i]}`;
}

const sizes = new Map<string, Promise<number | null>>();
/** The size of a stored file, from a HEAD request (cached for the session). */
function fileSize(url: string): Promise<number | null> {
  let p = sizes.get(url);
  if (!p) {
    p = fetch(url, { method: "HEAD" }).then((r) => (r.ok ? Number(r.headers.get("Content-Length")) || null : null)).catch(() => null);
    sizes.set(url, p);
  }
  return p;
}

function FileCard({ name, url }: { name: string; url: string }) {
  const href = fileUrl(url);
  const kind = fileKind(name || url);
  const [size, setSize] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);
  useEffect(() => { let on = true; setSize(null); if (href.startsWith("/") || href.startsWith(location.origin)) fileSize(href).then((s) => on && setSize(s)); return () => { on = false; }; }, [href]);
  const isPdf = kind.short === "PDF";
  return (
    <div className="cn-file" contentEditable={false}>
      <div className="cn-file-row">
        <a className="cn-file-main" href={href} target="_blank" rel="noopener noreferrer" draggable={false}>
          <span className="cn-file-badge" style={{ background: kind.color }}>{kind.short}</span>
          <span className="cn-file-info">
            <span className="cn-file-name">{name || href}</span>
            <span className="cn-file-meta">{[t(kind.label), size != null ? formatSize(size) : ""].filter(Boolean).join(" · ")}</span>
          </span>
        </a>
        {isPdf && (
          <button type="button" className="cn-file-btn" title={preview ? t("Hide preview") : t("Preview")} onClick={() => setPreview((v) => !v)}>
            {preview ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
        <a className="cn-file-btn" href={href} download={name || undefined} title={t("Download")} draggable={false}><Download size={16} /></a>
      </div>
      {isPdf && preview && <iframe className="cn-file-pdf" src={`${href}#toolbar=0&navpanes=0`} title={name} />}
    </div>
  );
}

export const FileBlock = createReactBlockSpec(createFileBlockConfig, {
  render: (props) => (
    <FileBlockWrapper {...props}>
      {props.block.props.url ? <FileCard name={props.block.props.name} url={props.block.props.url} /> : null}
    </FileBlockWrapper>
  ),
  parse: fileParse(),
  toExternalHTML: (props) => (props.block.props.url
    ? <a href={props.block.props.url}>{props.block.props.name || props.block.props.url}</a>
    : <p>{t("File")}</p>),
});
