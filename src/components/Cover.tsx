import { useState } from "react";
import { BookOpen, Images, Newspaper, ListOrdered, FileText, FileType2 } from "lucide-react";
import type { Item, LoadedItem } from "@/domain/models/types";
import { ITEM_TYPE_LABEL } from "@/domain/models/types";
import { getUnits } from "@/domain/policies/units";
import { joinRel } from "@/domain/policies/naming";
import { thumbnailUrl, useThumbVersion } from "@/services/content/thumbnails";

export const TYPE_ICON = {
  book: BookOpen,
  photo_album: Images,
  blog: Newspaper,
  article_series: ListOrdered,
  document: FileText,
  pdf: FileType2,
} as const;

/** Flat palettes — no 3D, no spine, no perspective (technical design §13.2). */
const PALETTES: Array<{ bg: string; fg: string; accent: string }> = [
  { bg: "#164f47", fg: "#eef3ef", accent: "#7fa89c" },
  { bg: "#efe9dc", fg: "#2b3330", accent: "#9b8f74" },
  { bg: "#dfe7e2", fg: "#1f3a34", accent: "#5d7f74" },
  { bg: "#2e3a37", fg: "#f1efe8", accent: "#a6b5ae" },
  { bg: "#e8e3d6", fg: "#3b2f25", accent: "#a0705a" },
  { bg: "#d7e1e6", fg: "#22323b", accent: "#5f7c8c" },
  { bg: "#f3f1ec", fg: "#25302d", accent: "#6e7773" },
  { bg: "#3d5a52", fg: "#f4f2ea", accent: "#c9d7cf" },
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function paletteFor(id: string) {
  return PALETTES[hash(id) % PALETTES.length];
}

function coverImage(it: LoadedItem): { rel: string; version: string } | null {
  const m: Item = it.meta;
  if (m.coverPath) return { rel: joinRel(it.dir, m.coverPath), version: m.updatedAt };
  if (m.type === "photo_album") {
    const first = getUnits(m)[0];
    if (first) return { rel: joinRel(it.dir, first.path), version: first.updatedAt };
  }
  return null;
}

/** Generated typographic cover. Variants keep a calm, flat look. */
function Generated({ item }: { item: Item }) {
  const p = paletteFor(item.id);
  const variant = hash(item.id + "v") % 4;
  const Icon = TYPE_ICON[item.type];
  const isLatin = /^[\x00-\x7f]+$/.test(item.title);
  return (
    <div className={`lf-cover-gen v${variant} ${isLatin ? "latin" : "cjk"}`} style={{ background: p.bg, color: p.fg }}>
      <div className="lf-cover-title">{item.title}</div>
      {item.type === "article_series" && <div className="lf-cover-sub">（系列）</div>}
      <svg className="lf-cover-art" viewBox="0 0 200 120" preserveAspectRatio="none" aria-hidden="true">
        {variant === 0 && Array.from({ length: 7 }, (_, i) => <circle key={i} cx="210" cy="140" r={40 + i * 16} fill="none" stroke={p.accent} strokeWidth="0.8" opacity={0.7} />)}
        {variant === 1 && <path d="M0 90 C40 60 70 100 110 75 S170 60 200 70 L200 120 L0 120Z" fill={p.accent} opacity="0.45" />}
        {variant === 2 && <line x1="20" y1="20" x2="70" y2="20" stroke={p.accent} strokeWidth="1" />}
        {variant === 3 && <path d="M0 100 L60 60 L100 85 L150 40 L200 75 L200 120 L0 120Z" fill={p.accent} opacity="0.35" />}
      </svg>
      <Icon className="lf-cover-icon" size={14} strokeWidth={1.4} />
    </div>
  );
}

export function Cover({ item, size = "md" }: { item: LoadedItem; size?: "sm" | "md" | "lg" }) {
  useThumbVersion();
  const img = coverImage(item);
  const [failed, setFailed] = useState(false);
  const url = img && !failed ? thumbnailUrl(img.rel, img.version, size === "lg" ? 900 : 480) : "";
  return (
    <div className={`lf-cover ${size}`} aria-label={`${item.meta.title}（${ITEM_TYPE_LABEL[item.meta.type]}）封面`}>
      {url ? (
        <>
          <img src={url} alt="" draggable={false} onError={() => setFailed(true)} />
          {item.meta.type !== "photo_album" || item.meta.coverPath ? null : <div className="lf-cover-photo-title">{item.meta.title}</div>}
        </>
      ) : (
        <Generated item={item.meta} />
      )}
    </div>
  );
}
