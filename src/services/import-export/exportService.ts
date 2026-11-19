/**
 * Export (spec §4.3, technical design §11.2). Exports always go to a location
 * the user picks; sources (Markdown, imported PDFs) are never modified.
 */
import katexCss from "katex/dist/katex.min.css?raw";
import { repo, backend } from "@/app/backend";
import type { ContentUnit, Item, LoadedItem, Post, SeriesItem, UUID } from "@/domain/models/types";
import { getUnits, blogTimeline, orderedSeries } from "@/domain/policies/units";
import { baseName, dirName, extOf, joinRel, resolveRef, slugify, stem, uniqueFileName } from "@/domain/policies/naming";
import { markdownToHast, hastToHtml, imageRefs } from "@/components/markdown/pipeline";
import { SONG_FONT_STACK } from "@/domain/policies/defaults";

const katexFonts = import.meta.glob("/node_modules/katex/dist/fonts/*.woff2", { query: "?url", import: "default", eager: true }) as Record<string, string>;

export interface ExportResult {
  target: string;
  files: number;
  warnings: string[];
}

export interface TextUnitSource {
  unit: ContentUnit;
  title: string;
  text: string;
  /** workspace-relative path of the .md */
  path: string;
}

export async function loadTexts(item: LoadedItem, units?: ContentUnit[]): Promise<TextUnitSource[]> {
  const list = (units ?? getUnits(item.meta)).filter((u) => u.type !== "photo");
  const out: TextUnitSource[] = [];
  for (const u of list) {
    const path = joinRel(item.dir, u.path);
    out.push({ unit: u, title: u.title, text: await repo.fs.readText(path), path });
  }
  return out;
}

/** Ordered text units for an item as it should be exported. */
export function exportOrder(item: Item): ContentUnit[] {
  if (item.type === "article_series") return orderedSeries(item.data.articles, item.data.groups ?? []);
  if (item.type === "blog") {
    const tl = blogTimeline(item.data.posts);
    return [...tl.published, ...tl.drafts];
  }
  return getUnits(item);
}

function safeName(s: string) {
  return slugify(s, 60) || "export";
}

// ------------------------------------------------------------------ asset collection

class AssetCollector {
  /** item-relative-to-workspace path -> export-relative name */
  map = new Map<string, string>();
  names = new Set<string>();
  warnings: string[] = [];
  constructor(private prefix = "assets") {}
  add(wsPath: string): string {
    const hit = this.map.get(wsPath);
    if (hit) return hit;
    const name = uniqueFileName(stem(wsPath), extOf(wsPath) || "bin", this.names);
    this.names.add(name);
    const rel = `${this.prefix}/${name}`;
    this.map.set(wsPath, rel);
    return rel;
  }
  async copyAll(targetDir: string): Promise<number> {
    let n = 0;
    if (!this.map.size) return 0;
    await backend.ext.exportMkdir(backend.platform.joinAbs(targetDir, this.prefix));
    for (const [src, rel] of this.map) {
      try {
        await backend.ext.exportCopyFromWs(src, backend.platform.joinAbs(targetDir, rel.split("/").join(sep())));
        n++;
      } catch {
        this.warnings.push(`缺少图片：${src}`);
      }
    }
    return n;
  }
}

function sep() {
  return backend.platform.kind === "tauri" && navigator.userAgent.includes("Windows") ? "\\" : "/";
}
function abs(dir: string, ...parts: string[]) {
  return parts.reduce((d, p) => backend.platform.joinAbs(d, p), dir);
}

function renderHtml(src: TextUnitSource, scopeDir: string, assets: AssetCollector, depthPrefix = ""): string {
  const tree = markdownToHast(src.text, {
    resolveImage: (s) => {
      const rel = resolveRef(src.path, s, scopeDir);
      return rel ? depthPrefix + assets.add(rel) : null;
    },
    resolveLink: () => null,
  });
  return hastToHtml(tree);
}

// ------------------------------------------------------------------ HTML

export const EXPORT_CSS = `
:root{--ink:#17211f;--muted:#6e7773;--accent:#164f47;--rule:#e3e8e4;--paper:#fcfbf8}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:${SONG_FONT_STACK};font-size:17px;line-height:1.9;-webkit-font-smoothing:antialiased}
main{max-width:760px;margin:0 auto;padding:64px 32px 120px}
h1,h2,h3,h4{color:var(--accent);line-height:1.4;font-weight:700}
h1{font-size:1.9em;margin:1.2em 0 .8em}h2{font-size:1.45em;margin:1.6em 0 .6em}h3{font-size:1.2em}
p{margin:.6em 0}a{color:#2c6b8a}
blockquote{margin:1em 0;padding:.2em 1.2em;border-left:3px solid #c9d7cf;color:#4d5a55}
img{max-width:100%;height:auto;display:block;margin:1em auto}
pre{background:#f1f2f0;padding:12px 16px;border-radius:4px;overflow:auto;font-size:.88em;line-height:1.6}
code{font-family:"Cascadia Mono",Consolas,monospace;font-size:.9em}
:not(pre)>code{background:#f1f2f0;padding:.1em .35em;border-radius:3px}
table{border-collapse:collapse;margin:1em 0;width:100%}th,td{border:1px solid var(--rule);padding:6px 10px}th{background:#f1f2f0}
hr{border:none;border-top:1px solid var(--rule);margin:2em 0}
.katex-display{overflow-x:auto;overflow-y:hidden;padding:.3em 0}
.lf-img-blocked{display:inline-block;padding:2px 8px;border:1px dashed #cfd6d1;color:var(--muted);font-size:.85em}
nav.toc{border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);padding:12px 0;margin:24px 0 48px}
nav.toc ol{margin:0;padding-left:1.4em}nav.toc li{margin:.2em 0}
nav.pager{display:flex;justify-content:space-between;gap:16px;margin-top:64px;padding-top:16px;border-top:1px solid var(--rule);font-size:.92em}
.meta{color:var(--muted);font-size:.9em}
.chapter{page-break-before:always}
.post-list{list-style:none;padding:0}.post-list li{margin:0 0 1.2em}.post-list .date{color:var(--muted);font-size:.85em;margin-right:.8em}
footer.site{color:var(--muted);font-size:.8em;text-align:center;margin:80px 0 24px}
`;

async function writeKatex(targetDir: string): Promise<void> {
  const dir = abs(targetDir, "katex");
  await backend.ext.exportMkdir(abs(dir, "fonts"));
  await backend.ext.exportWriteText(abs(dir, "katex.min.css"), katexCss);
  for (const [path, url] of Object.entries(katexFonts)) {
    try {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      await backend.ext.exportWriteBytes(abs(dir, "fonts", baseName(path)), bytes);
    } catch {
      /* fonts are optional — KaTeX falls back to system fonts */
    }
  }
}

function page(title: string, body: string, cssPrefix = ""): string {
  const esc = escapeHtml(title);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc}</title>
<link rel="stylesheet" href="${cssPrefix}katex/katex.min.css">
<link rel="stylesheet" href="${cssPrefix}style.css">
<meta name="generator" content="Leafor">
</head><body><main>
${body}
</main><footer class="site">由 Leafor 导出 · ${new Date().toLocaleDateString()}</footer></body></html>
`;
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

async function pickDir(title: string): Promise<string | null> {
  return backend.platform.pickExportDir(title);
}

/** Create `<parent>/<name>` (unique-ish) for an export bundle. */
async function bundleDir(parent: string, name: string): Promise<string> {
  const dir = abs(parent, `${safeName(name)}-${new Date().toISOString().slice(0, 10)}`);
  await backend.ext.exportMkdir(dir);
  return dir;
}

/** Single unit, or a whole item as one HTML page (book/document/series merged). */
export async function exportHtml(itemId: UUID, unitId?: UUID): Promise<ExportResult | null> {
  const it = repo.requireItem(itemId);
  const parent = await pickDir("选择 HTML 导出位置");
  if (!parent) return null;
  const units = unitId ? getUnits(it.meta).filter((u) => u.id === unitId) : exportOrder(it.meta);
  const texts = await loadTexts(it, units);
  const title = unitId ? units[0].title : it.meta.title;
  const dir = await bundleDir(parent, title);
  const assets = new AssetCollector();
  let body = "";
  if (!unitId && texts.length > 1) {
    body += `<h1>${escapeHtml(it.meta.title)}</h1>${it.meta.author ? `<p class="meta">${escapeHtml(it.meta.author)}</p>` : ""}`;
    body += `<nav class="toc"><ol>${texts.map((t, i) => `<li><a href="#u${i + 1}">${escapeHtml(t.title)}</a></li>`).join("")}</ol></nav>`;
    body += texts.map((t, i) => `<section class="chapter" id="u${i + 1}">${renderHtml(t, it.dir, assets)}</section>`).join("\n");
  } else body = texts.map((t) => renderHtml(t, it.dir, assets)).join("\n");
  await backend.ext.exportWriteText(abs(dir, "index.html"), page(title, body));
  await backend.ext.exportWriteText(abs(dir, "style.css"), EXPORT_CSS);
  await writeKatex(dir);
  const n = await assets.copyAll(dir);
  return { target: dir, files: n + 2, warnings: assets.warnings };
}

/** Series: index + one page per article with previous/next navigation (P1). */
export async function exportSeriesSite(itemId: UUID): Promise<ExportResult | null> {
  const it = repo.requireItem(itemId);
  const m = it.meta as SeriesItem;
  const parent = await pickDir("选择系列导出位置");
  if (!parent) return null;
  const dir = await bundleDir(parent, m.title);
  const assets = new AssetCollector();
  const groups = m.data.groups ?? [];
  const texts = await loadTexts(it, orderedSeries(m.data.articles, groups));
  const file = (i: number) => `${String(i + 1).padStart(2, "0")}.html`;
  let toc = `<h1>${escapeHtml(m.title)}</h1>${m.summary ? `<p class="meta">${escapeHtml(m.summary)}</p>` : ""}<nav class="toc"><ol>`;
  let lastGroup: string | null | undefined;
  texts.forEach((t, i) => {
    const g = (t.unit as { groupId?: string | null }).groupId ?? null;
    if (g !== lastGroup && g) toc += `</ol><h3>${escapeHtml(groups.find((x) => x.id === g)?.title ?? "")}</h3><ol start="${i + 1}">`;
    lastGroup = g;
    toc += `<li><a href="${file(i)}">${escapeHtml(t.title)}</a></li>`;
  });
  toc += "</ol></nav>";
  await backend.ext.exportWriteText(abs(dir, "index.html"), page(m.title, toc));
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    const nav = `<nav class="pager"><span>${i > 0 ? `<a href="${file(i - 1)}">← ${escapeHtml(texts[i - 1].title)}</a>` : ""}</span><a href="index.html">目录</a><span>${i < texts.length - 1 ? `<a href="${file(i + 1)}">${escapeHtml(texts[i + 1].title)} →</a>` : ""}</span></nav>`;
    const body = `<p class="meta">${escapeHtml(m.title)} · 第 ${i + 1} / ${texts.length} 篇</p>${renderHtml(t, it.dir, assets)}${nav}`;
    await backend.ext.exportWriteText(abs(dir, file(i)), page(`${t.title} · ${m.title}`, body));
  }
  await backend.ext.exportWriteText(abs(dir, "style.css"), EXPORT_CSS);
  await writeKatex(dir);
  const n = await assets.copyAll(dir);
  return { target: dir, files: texts.length + n + 2, warnings: assets.warnings };
}

/** Blog: offline archive with index (by date), drafts excluded by default, per-post pages. */
export async function exportBlogArchive(itemId: UUID, includeDrafts = false): Promise<ExportResult | null> {
  const it = repo.requireItem(itemId);
  if (it.meta.type !== "blog") return null;
  const parent = await pickDir("选择博客归档导出位置");
  if (!parent) return null;
  const dir = await bundleDir(parent, it.meta.title);
  await backend.ext.exportMkdir(abs(dir, "posts"));
  const tl = blogTimeline(it.meta.data.posts);
  const posts: Post[] = includeDrafts ? [...tl.published, ...tl.drafts] : tl.published;
  const assets = new AssetCollector();
  const texts = await loadTexts(it, posts);
  const names = new Set<string>();
  const files = texts.map((t) => {
    const p = t.unit as Post;
    const n = uniqueFileName(`${p.publishedAt?.slice(0, 10) ?? "draft"}-${p.slug || t.title}`, "html", names);
    names.add(n);
    return n;
  });
  let index = `<h1>${escapeHtml(it.meta.title)}</h1>`;
  if (it.meta.summary) index += `<p class="meta">${escapeHtml(it.meta.summary)}</p>`;
  let curYear = "";
  index += "";
  texts.forEach((t, i) => {
    const p = t.unit as Post;
    const y = p.publishedAt?.slice(0, 4) ?? "草稿";
    if (y !== curYear) {
      index += `${curYear ? "</ul>" : ""}<h2>${y}</h2><ul class="post-list">`;
      curYear = y;
    }
    const excerpt = p.excerpt ? `<br><span class="meta">${escapeHtml(p.excerpt)}</span>` : "";
    index += `<li><span class="date">${p.publishedAt?.slice(0, 10) ?? "未发布"}</span><a href="posts/${files[i]}">${escapeHtml(t.title)}</a>${excerpt}</li>`;
  });
  if (curYear) index += "</ul>";
  await backend.ext.exportWriteText(abs(dir, "index.html"), page(it.meta.title, index));
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    const p = t.unit as Post;
    const nav = `<nav class="pager"><span>${i > 0 ? `<a href="${files[i - 1]}">← ${escapeHtml(texts[i - 1].title)}</a>` : ""}</span><a href="../index.html">归档</a><span>${i < texts.length - 1 ? `<a href="${files[i + 1]}">${escapeHtml(texts[i + 1].title)} →</a>` : ""}</span></nav>`;
    const tags = p.tagIds.map((id) => repo.tag(id)?.name).filter(Boolean).join(" · ");
    const body = `<p class="meta">${p.publishedAt?.slice(0, 10) ?? "未发布"}${tags ? " · " + escapeHtml(tags) : ""}</p>${renderHtml(t, it.dir, assets, "../")}${nav}`;
    await backend.ext.exportWriteText(abs(dir, "posts", files[i]), page(t.title, body, "../"));
  }
  await backend.ext.exportWriteText(abs(dir, "style.css"), EXPORT_CSS);
  await writeKatex(dir);
  const n = await assets.copyAll(dir);
  return { target: dir, files: texts.length + n + 2, warnings: assets.warnings };
}

// ------------------------------------------------------------------ Markdown

/**
 * Markdown export. `merge`: one .md with all units in order (image refs
 * rewritten to assets/); otherwise the unit files keep their folder layout
 * with the item's assets copied alongside so relative paths stay valid.
 */
export async function exportMarkdown(itemId: UUID, opts: { unitId?: UUID; merge?: boolean } = {}): Promise<ExportResult | null> {
  const it = repo.requireItem(itemId);
  const parent = await pickDir("选择 Markdown 导出位置");
  if (!parent) return null;
  const units = opts.unitId ? getUnits(it.meta).filter((u) => u.id === opts.unitId) : exportOrder(it.meta);
  const texts = await loadTexts(it, units);
  const title = opts.unitId ? units[0].title : it.meta.title;
  const dir = await bundleDir(parent, title);
  const assets = new AssetCollector();
  const warnings: string[] = [];
  const rewrite = (t: TextUnitSource) => {
    let out = t.text;
    for (const ref of imageRefs(t.text)) {
      const rel = resolveRef(t.path, ref, it.dir);
      if (!rel) continue;
      const target = assets.add(rel);
      out = out.split(`](${ref}`).join(`](${target}`).split(`src="${ref}"`).join(`src="${target}"`);
    }
    return out;
  };
  let files = 0;
  if (opts.merge || texts.length === 1) {
    const merged = texts.map(rewrite).join("\n\n---\n\n");
    await backend.ext.exportWriteText(abs(dir, `${safeName(title)}.md`), merged);
    files = 1;
  } else {
    const names = new Set<string>();
    for (let i = 0; i < texts.length; i++) {
      const n = uniqueFileName(`${String(i + 1).padStart(2, "0")}-${texts[i].title}`, "md", names);
      names.add(n);
      await backend.ext.exportWriteText(abs(dir, n), rewrite(texts[i]));
      files++;
    }
  }
  files += await assets.copyAll(dir);
  return { target: dir, files, warnings: [...warnings, ...assets.warnings] };
}

/** Raw copy of a read-only PDF object (bytes unchanged). */
export async function exportOriginalPdf(itemId: UUID): Promise<ExportResult | null> {
  const it = repo.requireItem(itemId);
  if (it.meta.type !== "pdf") return null;
  const target = await backend.platform.pickSaveFile("另存原始 PDF", it.meta.data.sourceName || `${it.meta.title}.pdf`, [{ name: "PDF", extensions: ["pdf"] }]);
  if (!target) return null;
  await backend.ext.exportCopyFromWs(joinRel(it.dir, it.meta.data.sourcePath), target);
  return { target, files: 1, warnings: [] };
}

/** Copy original photo files of an album into a folder. */
export async function exportPhotos(itemId: UUID, unitIds?: UUID[]): Promise<ExportResult | null> {
  const it = repo.requireItem(itemId);
  const parent = await pickDir("选择照片导出位置");
  if (!parent) return null;
  const dir = await bundleDir(parent, it.meta.title);
  const units = getUnits(it.meta).filter((u) => !unitIds || unitIds.includes(u.id));
  const names = new Set<string>();
  for (const [i, u] of units.entries()) {
    const n = uniqueFileName(`${String(i + 1).padStart(3, "0")}-${u.title}`, extOf(u.path), names);
    names.add(n);
    await backend.ext.exportCopyFromWs(joinRel(it.dir, u.path), abs(dir, n));
  }
  return { target: dir, files: units.length, warnings: [] };
}

export function describeExport(r: ExportResult | null | undefined): string | null {
  if (!r) return null;
  return `已导出到 ${r.target}${r.warnings.length ? `（${r.warnings.length} 条提示）` : ""}`;
}

export { dirName };
