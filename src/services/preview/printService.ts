/**
 * Book publishing pipeline (spec §4.5, technical design §11.3, ADR-006).
 *
 *   Markdown chapters + LayoutProfile
 *     → HTML (same renderer as the editor preview)
 *     → page layout engine (fixed page boxes, chapter rules, running heads,
 *        page numbers, TOC, keep-with-next, splittable paragraphs/lists/tables/code)
 *     → each page rasterised at the chosen DPI
 *     → one PDF (pdf-lib)
 *
 * The preview shows exactly these PDF bytes and "export" saves the same bytes,
 * so the preview and the exported file can never drift apart. Leafor never
 * edits a PDF; to change the result, edit the Markdown or the profile.
 */
import { repo } from "@/app/backend";
import type { LayoutProfile, LoadedItem, UUID } from "@/domain/models/types";
import { pageSizeMm } from "@/domain/policies/defaults";
import { joinRel, resolveRef } from "@/domain/policies/naming";
import { markdownToHast, hastToHtml } from "@/components/markdown/pipeline";
import { exportOrder, loadTexts, escapeHtml } from "@/services/import-export/exportService";
import { CACHE_DIR } from "@/services/library/repository";

const MM_PX = 96 / 25.4;
const MM_PT = 72 / 25.4;

export interface PrintProgress {
  phase: "layout" | "render" | "pdf";
  done: number;
  total: number;
}

export interface PrintResult {
  bytes: Uint8Array;
  pageCount: number;
  warnings: string[];
  builtAt: string;
  cachePath: string;
}

interface Chapter {
  title: string;
  html: string;
}

interface PageSpec {
  kind: "cover" | "title" | "toc" | "blank" | "body";
  chapter?: number;
  chapterStart?: boolean;
  number?: string; // printed folio
  content: HTMLElement;
}

function fontAvailable(family: string): boolean {
  const first = family.split(",")[0].trim();
  if (/^(serif|sans-serif|monospace)$/i.test(first)) return true;
  try {
    // Compare rendered widths against generic fallbacks.
    const c = document.createElement("canvas").getContext("2d")!;
    const sample = "永和九年岁在癸丑 Leafor 123";
    const width = (f: string) => {
      c.font = `24px ${f}`;
      return c.measureText(sample).width;
    };
    return width(`${first}, monospace`) !== width("monospace") || width(`${first}, sans-serif`) !== width("sans-serif");
  } catch {
    return true;
  }
}

function toRoman(n: number): string {
  const r: Array<[number, string]> = [[10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let s = "";
  for (const [v, k] of r) while (n >= v) (s += k), (n -= v);
  return s;
}

function css(p: LayoutProfile, wPx: number, hPx: number): string {
  const t = p.typography;
  const m = p.marginsMm;
  return `
.lfp-page{position:relative;width:${wPx}px;height:${hPx}px;background:#fff;color:#111;overflow:hidden;font-family:${t.fontFamily};font-size:${t.fontSizePt}pt;line-height:${t.lineHeight};font-kerning:normal;-webkit-font-smoothing:antialiased}
.lfp-body{position:absolute;top:${m.top * MM_PX}px;bottom:${m.bottom * MM_PX}px;overflow:hidden}
.lfp-page.recto .lfp-body{left:${m.inner * MM_PX}px;right:${m.outer * MM_PX}px}
.lfp-page.verso .lfp-body{left:${(p.headerFooter.mirrorOddEven ? m.outer : m.inner) * MM_PX}px;right:${(p.headerFooter.mirrorOddEven ? m.inner : m.outer) * MM_PX}px}
.lfp-head,.lfp-foot{position:absolute;font-size:${Math.max(7, t.fontSizePt * 0.78)}pt;color:#555;line-height:1.2;white-space:nowrap;overflow:hidden}
.lfp-head{top:${Math.max(4, m.top * 0.42) * MM_PX}px;border-bottom:0.5pt solid #bbb;padding-bottom:3px}
.lfp-foot{bottom:${Math.max(4, m.bottom * 0.42) * MM_PX}px}
.lfp-page.recto .lfp-head,.lfp-page.recto .lfp-foot{left:${m.inner * MM_PX}px;right:${m.outer * MM_PX}px}
.lfp-page.verso .lfp-head,.lfp-page.verso .lfp-foot{left:${(p.headerFooter.mirrorOddEven ? m.outer : m.inner) * MM_PX}px;right:${(p.headerFooter.mirrorOddEven ? m.inner : m.outer) * MM_PX}px}
.lfp-head.recto{text-align:${p.headerFooter.mirrorOddEven ? "right" : "center"}}.lfp-head.verso{text-align:${p.headerFooter.mirrorOddEven ? "left" : "center"}}
.lfp-foot{display:flex;justify-content:space-between}.lfp-foot .num{flex:1;text-align:center}
.lfp-foot.outer.recto .num{text-align:right}.lfp-foot.outer.verso .num{text-align:left}
.lfp-body p{margin:0 0 ${t.paragraphSpacingPt}pt;text-indent:${t.paragraphIndentEm}em;text-align:justify;orphans:1;widows:1}
.lfp-body p.lfp-cont{text-indent:0}
.lfp-body h1,.lfp-body h2,.lfp-body h3,.lfp-body h4,.lfp-body h5,.lfp-body h6{font-family:${t.headingFontFamily || t.fontFamily};font-weight:700;line-height:1.4;margin:1em 0 .6em;text-indent:0;break-after:avoid}
.lfp-body h1{font-size:1.6em;margin:0 0 1.6em;${p.chapters.titleStyle === "centered" ? "text-align:center;" : ""}}
.lfp-body .lfp-chapter-top h1{padding-top:${(hPx - (m.top + m.bottom) * MM_PX) * 0.12}px}
.lfp-body h2{font-size:1.28em}.lfp-body h3{font-size:1.12em}.lfp-body h4{font-size:1em}
.lfp-body blockquote{margin:.6em 0 .6em 1.5em;padding-left:.8em;border-left:1.5pt solid #bbb;color:#333}
.lfp-body blockquote p{text-indent:0}
.lfp-body ul,.lfp-body ol{margin:.4em 0;padding-left:2em}.lfp-body li p{text-indent:0;margin:0}
.lfp-body pre{font-family:"Cascadia Mono",Consolas,"Noto Sans Mono CJK SC",monospace;font-size:.82em;line-height:1.5;background:#f4f4f2;padding:6px 8px;margin:.6em 0;white-space:pre-wrap;word-break:break-all}
.lfp-body code{font-family:"Cascadia Mono",Consolas,monospace;font-size:.88em}
.lfp-body img{display:block;max-width:100%;max-height:var(--lfp-maxh);margin:.6em auto;object-fit:contain}
.lfp-body table{border-collapse:collapse;width:100%;margin:.6em 0;font-size:.9em}.lfp-body th,.lfp-body td{border:.5pt solid #999;padding:3px 6px;text-indent:0}
.lfp-body hr{border:none;text-align:center;margin:1em 0}.lfp-body hr::after{content:"＊　＊　＊";color:#777}
.lfp-body .katex-display{margin:.6em 0;overflow:hidden}
.lfp-body .footnotes{font-size:.85em;border-top:.5pt solid #bbb;margin-top:1.2em}
.lfp-body .lf-img-blocked{display:inline-block;border:.5pt dashed #999;padding:0 4px;color:#777;font-size:.85em}
.lfp-title{display:flex;flex-direction:column;justify-content:center;align-items:center;height:100%;text-align:center}
.lfp-title h1{font-size:2.3em;margin:0 0 .6em;letter-spacing:.06em}.lfp-title .author{font-size:1.2em;color:#333}.lfp-title .sub{margin-top:3em;color:#777;font-size:.9em}
.lfp-toc h1{text-align:center;font-size:1.5em;margin:0 0 1.4em}
.lfp-toc .row{display:flex;align-items:baseline;gap:6px;margin:.35em 0}.lfp-toc .row .t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.lfp-toc .row .dots{flex:1;border-bottom:1px dotted #999;transform:translateY(-4px)}
.lfp-cover{position:absolute;inset:0;background:#164f47;color:#f1efe8;display:flex;flex-direction:column;justify-content:center;padding:15%}
.lfp-cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.lfp-cover h1{font-size:2.6em;margin:0}
`;
}

/** Split a block element so that the first part fits the available height. */
function splitText(container: HTMLElement, el: HTMLElement, fits: () => boolean): HTMLElement | null {
  // Collect text positions, treating KaTeX/images/code spans as atomic.
  const full = el.cloneNode(true) as HTMLElement;
  const atoms: Array<{ node: Text | HTMLElement; len: number }> = [];
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) atoms.push({ node: n as Text, len: (n as Text).data.length });
    else if (n instanceof HTMLElement && (n.classList.contains("katex") || n.tagName === "IMG" || n.classList.contains("katex-display"))) atoms.push({ node: n, len: 1 });
    else n.childNodes.forEach(walk);
  };
  walk(full);
  const total = atoms.reduce((s, a) => s + a.len, 0);
  if (total < 2) return null;

  const truncate = (k: number, keepHead: boolean): HTMLElement => {
    const clone = full.cloneNode(true) as HTMLElement;
    const cAtoms: Array<{ node: Text | HTMLElement; len: number }> = [];
    const w2 = (n: Node) => {
      if (n.nodeType === Node.TEXT_NODE) cAtoms.push({ node: n as Text, len: (n as Text).data.length });
      else if (n instanceof HTMLElement && (n.classList.contains("katex") || n.tagName === "IMG" || n.classList.contains("katex-display"))) cAtoms.push({ node: n, len: 1 });
      else n.childNodes.forEach(w2);
    };
    w2(clone);
    let pos = 0;
    for (const a of cAtoms) {
      const start = pos;
      const end = pos + a.len;
      pos = end;
      if (keepHead) {
        if (start >= k) a.node instanceof Text ? (a.node.data = "") : a.node.remove();
        else if (end > k && a.node instanceof Text) a.node.data = a.node.data.slice(0, k - start);
      } else {
        if (end <= k) a.node instanceof Text ? (a.node.data = "") : a.node.remove();
        else if (start < k && a.node instanceof Text) a.node.data = a.node.data.slice(k - start);
      }
    }
    return clone;
  };

  // Binary search the largest k whose head fits.
  let lo = 1,
    hi = total - 1,
    best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const head = truncate(mid, true);
    container.appendChild(head);
    const ok = fits();
    head.remove();
    if (ok) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (best < 8) return null; // avoid a widow line of a few characters
  // Prefer breaking after punctuation / whitespace near the limit.
  const plain = full.textContent ?? "";
  for (let k = best; k > best - 12 && k > 0; k--) {
    if (/[\s，。、；：！？,.;:!?）」』”]/.test(plain[k - 1] ?? "")) {
      best = k;
      break;
    }
  }
  const head = truncate(best, true);
  const tail = truncate(best, false);
  container.appendChild(head);
  el.replaceWith(tail);
  if (tail.tagName === "P") tail.classList.add("lfp-cont");
  return tail;
}

class Paginator {
  pages: PageSpec[] = [];
  warnings: string[] = [];
  private host: HTMLElement;
  private cur: HTMLElement | null = null;
  private curPage: PageSpec | null = null;

  constructor(private p: LayoutProfile, _wPx: number, _hPx: number, host: HTMLElement) {
    this.host = host;
  }

  newPageEl(): { page: HTMLElement; body: HTMLElement } {
    const page = document.createElement("div");
    page.className = "lfp-page";
    const body = document.createElement("div");
    body.className = "lfp-body";
    page.appendChild(body);
    this.host.appendChild(page);
    return { page, body };
  }

  private parityFix(page: HTMLElement, index: number) {
    page.classList.add(index % 2 === 0 ? "recto" : "verso");
  }

  addSpecial(kind: PageSpec["kind"], inner: HTMLElement | null) {
    const { page, body } = this.newPageEl();
    this.parityFix(page, this.pages.length);
    if (inner) body.appendChild(inner);
    if (kind === "cover") {
      body.style.inset = "0";
    }
    this.pages.push({ kind, content: page });
    this.cur = null;
  }

  private open(chapter: number, chapterStart: boolean) {
    const { page, body } = this.newPageEl();
    this.parityFix(page, this.pages.length);
    this.curPage = { kind: "body", chapter, chapterStart, content: page };
    this.pages.push(this.curPage);
    this.cur = body;
    body.style.setProperty("--lfp-maxh", `${body.clientHeight - 8}px`);
  }

  private fits(): boolean {
    const b = this.cur!;
    return b.scrollHeight <= b.clientHeight + 0.5;
  }

  flowChapter(index: number, html: string) {
    const p = this.p;
    if (p.chapters.startOnNewPage || !this.cur) {
      if (p.chapters.startOnOddPage && this.pages.length % 2 === 1) this.addSpecial("blank", null);
      this.open(index, true);
    }
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    const nodes = Array.from(tmp.children) as HTMLElement[];
    if (nodes[0]?.tagName === "H1" && this.curPage?.chapterStart) {
      const wrap = document.createElement("div");
      wrap.className = "lfp-chapter-top";
      wrap.appendChild(nodes.shift()!);
      nodes.unshift(wrap);
    }
    const lineH = (p.typography.fontSizePt * 96) / 72 * p.typography.lineHeight;
    let guard = 0;
    while (nodes.length && guard++ < 200000) {
      const el = nodes.shift()!;
      const body = this.cur!;
      body.appendChild(el);
      if (this.fits()) {
        // keep-with-next: headings need room for ~2 more lines
        if (/^H[1-6]$/.test(el.tagName) && nodes.length) {
          const remaining = body.clientHeight - body.scrollHeight;
          const spacer = body.lastElementChild === el ? el.getBoundingClientRect() : null;
          void spacer;
          if (remaining < lineH * 2.2 && body.childElementCount > 1) {
            el.remove();
            this.open(index, false);
            this.cur!.appendChild(el);
          }
        }
        continue;
      }
      el.remove();
      const empty = body.childElementCount === 0;
      const tag = el.tagName;
      if (tag === "P" || tag === "BLOCKQUOTE" || /^(LI)$/.test(tag)) {
        const tail = splitText(body, el, () => this.fits());
        if (tail) {
          this.open(index, false);
          nodes.unshift(tail);
          continue;
        }
      } else if (tag === "UL" || tag === "OL" || tag === "TABLE" || tag === "PRE" || tag === "SECTION" || tag === "DIV") {
        const tail = this.splitContainer(el);
        if (tail) {
          this.open(index, false);
          nodes.unshift(tail);
          continue;
        }
      }
      if (empty) {
        // Larger than a page and unsplittable: place it alone; images are scaled by CSS max-height.
        body.appendChild(el);
        if (!this.fits()) this.warnings.push(`有内容超出单页高度，已裁切：${(el.textContent ?? el.tagName).slice(0, 24)}…`);
        this.open(index, false);
        continue;
      }
      this.open(index, false);
      nodes.unshift(el);
    }
  }

  /** Split lists/tables/pre/sections between children. Returns the remainder or null. */
  private splitContainer(el: HTMLElement): HTMLElement | null {
    const body = this.cur!;
    const tag = el.tagName;
    if (tag === "PRE") {
      const code = el.textContent ?? "";
      const lines = code.split("\n");
      if (lines.length < 4) return null;
      const head = el.cloneNode(false) as HTMLElement;
      body.appendChild(head);
      let n = 0;
      const codeEl = document.createElement("code");
      head.appendChild(codeEl);
      while (n < lines.length) {
        codeEl.textContent = lines.slice(0, n + 1).join("\n");
        if (!this.fits()) break;
        n++;
      }
      if (n < 2) {
        head.remove();
        return null;
      }
      codeEl.textContent = lines.slice(0, n).join("\n");
      const tail = el.cloneNode(false) as HTMLElement;
      const tc = document.createElement("code");
      tc.textContent = lines.slice(n).join("\n");
      tail.appendChild(tc);
      return tail;
    }
    const isTable = tag === "TABLE";
    const rowsParent = isTable ? (el.querySelector("tbody") as HTMLElement | null) : el;
    if (!rowsParent) return null;
    const children = Array.from(rowsParent.children) as HTMLElement[];
    if (children.length < 2) return null;
    const head = el.cloneNode(true) as HTMLElement;
    const headRows = isTable ? (head.querySelector("tbody") as HTMLElement) : head;
    headRows.innerHTML = "";
    body.appendChild(head);
    let n = 0;
    for (const c of children) {
      headRows.appendChild(c.cloneNode(true));
      if (!this.fits()) {
        headRows.lastElementChild!.remove();
        break;
      }
      n++;
    }
    if (n === 0) {
      head.remove();
      return null;
    }
    const tail = el.cloneNode(true) as HTMLElement;
    const tailRows = isTable ? (tail.querySelector("tbody") as HTMLElement) : tail;
    Array.from(tailRows.children).slice(0, n).forEach((c) => c.remove());
    if (tag === "OL") tail.setAttribute("start", String(Number(el.getAttribute("start") ?? 1) + n));
    return tail;
  }
}

async function buildChapters(item: LoadedItem, opts: { forPrint: boolean }): Promise<Chapter[]> {
  const units = exportOrder(item.meta).filter((u) => u.type !== "photo");
  const texts = await loadTexts(item, units);
  const out: Chapter[] = [];
  for (const t of texts) {
    let text = t.text;
    // Each chapter must open with its title as h1.
    if (!/^\s{0,3}#\s/.test(text)) text = `# ${t.title}\n\n${text}`;
    const tree = markdownToHast(text, {
      resolveImage: (src) => {
        const rel = resolveRef(t.path, src, item.dir);
        return rel ? repo.fs.assetUrl(rel) || null : null;
      },
    });
    out.push({ title: t.title, html: hastToHtml(tree) });
    void opts;
  }
  return out;
}

async function waitImages(root: HTMLElement) {
  const imgs = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    imgs.map((img) =>
      img.complete && img.naturalWidth
        ? Promise.resolve()
        : new Promise<void>((res) => {
            img.onload = () => res();
            img.onerror = () => res();
            setTimeout(res, 4000);
          }),
    ),
  );
}

export async function buildBookPdf(itemId: UUID, profile: LayoutProfile, onProgress?: (p: PrintProgress) => void): Promise<PrintResult> {
  const item = repo.requireItem(itemId);
  const [wMm, hMm] = pageSizeMm(profile);
  const wPx = Math.round(wMm * MM_PX);
  const hPx = Math.round(hMm * MM_PX);
  const warnings: string[] = [];
  if (!fontAvailable(profile.typography.fontFamily)) warnings.push(`字体“${profile.typography.fontFamily.split(",")[0].replace(/"/g, "")}”在本机不可用，已使用回退字体。预览与导出使用同一份 PDF，因此两者一致。`);

  // Off-screen layout host.
  const host = document.createElement("div");
  host.className = "lfp-host";
  host.style.cssText = `position:fixed;left:-${wPx * 2 + 200}px;top:0;width:${wPx}px;pointer-events:none;z-index:-1;`;
  const style = document.createElement("style");
  style.textContent = css(profile, wPx, hPx);
  host.appendChild(style);
  document.body.appendChild(host);

  try {
    onProgress?.({ phase: "layout", done: 0, total: 1 });
    const chapters = await buildChapters(item, { forPrint: true });
    if (!chapters.length) throw new Error("这本书还没有章节");
    await document.fonts?.ready;

    const pg = new Paginator(profile, wPx, hPx, host);
    // Front matter
    if (profile.includeCover) {
      const cover = document.createElement("div");
      cover.className = "lfp-cover";
      if (item.meta.coverPath) {
        const img = document.createElement("img");
        img.src = repo.fs.assetUrl(joinRel(item.dir, item.meta.coverPath));
        cover.appendChild(img);
      } else cover.innerHTML = `<h1>${escapeHtml(item.meta.title)}</h1>${item.meta.author ? `<p>${escapeHtml(item.meta.author)}</p>` : ""}`;
      pg.addSpecial("cover", cover);
      pg.addSpecial("blank", null);
    }
    if (profile.includeTitlePage) {
      const t = document.createElement("div");
      t.className = "lfp-title";
      t.innerHTML = `<h1>${escapeHtml(item.meta.title)}</h1>${item.meta.author ? `<div class="author">${escapeHtml(item.meta.author)}</div>` : ""}${item.meta.summary ? `<div class="sub">${escapeHtml(item.meta.summary)}</div>` : ""}`;
      pg.addSpecial("title", t);
      pg.addSpecial("blank", null);
    }
    const tocIndex = pg.pages.length;
    const frontCount = tocIndex;

    // Body (laid out first so TOC page numbers are known).
    const bodyHost = document.createElement("div");
    host.appendChild(bodyHost);
    const bodyPg = new Paginator(profile, wPx, hPx, bodyHost);
    // Body starts on a recto page: account for parity of the TOC length later via blank insertion.
    for (let i = 0; i < chapters.length; i++) {
      bodyPg.flowChapter(i, chapters[i].html);
      onProgress?.({ phase: "layout", done: i + 1, total: chapters.length });
      await new Promise((r) => setTimeout(r, 0));
    }
    warnings.push(...bodyPg.warnings);
    const chapterStart = new Map<number, number>();
    bodyPg.pages.forEach((p, i) => p.chapterStart && p.chapter !== undefined && !chapterStart.has(p.chapter) && chapterStart.set(p.chapter, i + 1));

    // TOC
    if (profile.includeToc) {
      const toc = document.createElement("div");
      toc.className = "lfp-toc";
      toc.innerHTML = `<h1>目录</h1>` + chapters.map((c, i) => `<div class="row"><span class="t">${escapeHtml(c.title)}</span><span class="dots"></span><span class="n">${chapterStart.get(i) ?? ""}</span></div>`).join("");
      // TOC may span several pages: flow it like a chapter in a temporary paginator.
      const tocHost = document.createElement("div");
      host.appendChild(tocHost);
      const tocPg = new Paginator({ ...profile, chapters: { startOnNewPage: true } }, wPx, hPx, tocHost);
      tocPg.flowChapter(-1, toc.outerHTML.replace('class="lfp-toc"', 'class="lfp-toc"'));
      for (const pspec of tocPg.pages) {
        pg.pages.push({ kind: "toc", content: pspec.content });
        host.appendChild(pspec.content);
      }
      if (pg.pages.length % 2 === 1) pg.addSpecial("blank", null);
    }
    // Front matter numbering (roman), body numbering (arabic, starts at 1 on a recto).
    pg.pages.forEach((p, i) => {
      if (i >= frontCount && p.kind === "toc") p.number = toRoman(i + 1);
    });
    for (const [i, p] of bodyPg.pages.entries()) {
      p.number = String(i + 1);
      pg.pages.push(p);
      host.appendChild(p.content);
    }

    // Running heads and folios; fix recto/verso by final position.
    pg.pages.forEach((p, i) => {
      const el = p.content;
      el.classList.remove("recto", "verso");
      const side = i % 2 === 0 ? "recto" : "verso";
      el.classList.add(side);
      if (p.kind === "body" || p.kind === "toc") {
        const hf = profile.headerFooter;
        if (p.kind === "body" && !p.chapterStart && (hf.headerChapterTitle || hf.headerText)) {
          const head = document.createElement("div");
          head.className = `lfp-head ${side}`;
          const chapterTitle = p.chapter !== undefined && p.chapter >= 0 ? chapters[p.chapter]?.title : "";
          head.textContent = hf.mirrorOddEven ? (side === "recto" ? (hf.headerChapterTitle ? chapterTitle : hf.headerText) || "" : hf.headerText || item.meta.title) : [hf.headerText, hf.headerChapterTitle ? chapterTitle : ""].filter(Boolean).join(" · ");
          if (head.textContent) el.appendChild(head);
        }
        if (hf.showPageNumbers || hf.footerText) {
          const foot = document.createElement("div");
          foot.className = `lfp-foot ${hf.pageNumberPosition === "outer" ? "outer" : ""} ${side}`;
          foot.innerHTML = `<span class="num">${hf.showPageNumbers ? escapeHtml(p.number ?? "") : ""}${hf.footerText ? `　${escapeHtml(hf.footerText)}` : ""}</span>`;
          el.appendChild(foot);
        }
      }
    });

    await waitImages(host);

    // Rasterise and assemble.
    const { toCanvas, getFontEmbedCSS } = await import("html-to-image");
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    pdf.setTitle(item.meta.title);
    if (item.meta.author) pdf.setAuthor(item.meta.author);
    pdf.setCreator("Leafor");
    pdf.setProducer("Leafor print pipeline");
    const dpi = profile.exportDpi ?? 200;
    const ratio = dpi / 96;
    let fontEmbedCSS = "";
    try {
      fontEmbedCSS = await getFontEmbedCSS(host);
    } catch {
      /* system fonts only */
    }
    const total = pg.pages.length;
    for (let i = 0; i < total; i++) {
      const el = pg.pages[i].content;
      const canvas = await toCanvas(el, { pixelRatio: ratio, width: wPx, height: hPx, backgroundColor: "#ffffff", fontEmbedCSS, cacheBust: false, skipAutoScale: true });
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
      if (!blob) throw new Error("页面渲染失败");
      const jpg = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const page = pdf.addPage([wMm * MM_PT, hMm * MM_PT]);
      page.drawImage(jpg, { x: 0, y: 0, width: wMm * MM_PT, height: hMm * MM_PT });
      onProgress?.({ phase: "render", done: i + 1, total });
      if (i % 3 === 2) await new Promise((r) => setTimeout(r, 0));
    }
    onProgress?.({ phase: "pdf", done: 0, total: 1 });
    const bytes = await pdf.save();
    const cachePath = joinRel(CACHE_DIR, "preview", `${itemId}.pdf`);
    await repo.fs.writeBytes(cachePath, bytes).catch(() => undefined);
    return { bytes, pageCount: total, warnings, builtAt: new Date().toISOString(), cachePath };
  } finally {
    host.remove();
  }
}

export async function loadCachedPreview(itemId: UUID): Promise<Uint8Array | null> {
  try {
    return await repo.fs.readBytes(joinRel(CACHE_DIR, "preview", `${itemId}.pdf`));
  } catch {
    return null;
  }
}
