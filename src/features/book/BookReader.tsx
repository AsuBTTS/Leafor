import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { repo } from "@/app/backend";
import type { ContentUnit, LoadedItem } from "@/domain/models/types";
import { joinRel, resolveRef } from "@/domain/policies/naming";
import { markdownToHast } from "@/components/markdown/pipeline";

export interface ReaderPrefs {
  doublePage: boolean;
  fontScale: number;
  lineHeight: number;
  theme: "paper" | "white" | "sepia";
}

export interface BookReaderHandle {
  goToChapter(unitId: string): void;
  search(q: string): number;
  next(): void;
  prev(): void;
}

/**
 * Flat book reading view: chapters flow into fixed-size pages (CSS columns);
 * double page = two flat pages side by side — no spine, no 3D (§13.2).
 */
export const BookReader = forwardRef<BookReaderHandle, { item: LoadedItem; chapters: ContentUnit[]; prefs: ReaderPrefs; onChapter?: (unitId: string) => void; initialChapter?: string }>(function BookReader(
  { item, chapters, prefs, onChapter, initialChapter },
  ref,
) {
  const [texts, setTexts] = useState<Record<string, string> | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const flow = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const anchor = useRef<string | null>(initialChapter ?? null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<string, string> = {};
      for (const c of chapters) out[c.id] = await repo.fs.readText(joinRel(item.dir, c.path)).catch(() => `# ${c.title}\n\n（无法读取章节文件）`);
      if (alive) setTexts(out);
    })();
    return () => {
      alive = false;
    };
  }, [chapters, item.dir]);

  const content = useMemo(() => {
    if (!texts) return null;
    return chapters.map((c) => {
      const path = joinRel(item.dir, c.path);
      let t = texts[c.id] ?? "";
      if (!/^\s{0,3}#\s/.test(t)) t = `# ${c.title}\n\n${t}`;
      const tree = markdownToHast(t, {
        resolveImage: (src) => {
          const rel = resolveRef(path, src, item.dir);
          return rel ? repo.fs.assetUrl(rel) || null : null;
        },
      });
      return (
        <section key={c.id} className="lf-reader-chapter" data-unit={c.id}>
          {toJsxRuntime(tree, { Fragment, jsx, jsxs, ignoreInvalidStyle: true } as never)}
        </section>
      );
    });
  }, [texts, chapters, item.dir]);

  // Page geometry
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    setBox({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!content]); // eslint-disable-line react-hooks/exhaustive-deps

  const gap = 72;
  const spread = prefs.doublePage && box.w > 900;
  const pageW = spread ? Math.floor((Math.min(box.w - 80, 1240) - gap) / 2) : Math.min(box.w - 80, 680);
  const pageH = Math.max(200, box.h - 72);
  const step = pageW + gap;
  const perView = spread ? 2 : 1;

  const measure = useCallback(() => {
    const f = flow.current;
    if (!f) return;
    const n = Math.max(1, Math.round((f.scrollWidth + gap + 112) / step));
    setPages(n);
    if (anchor.current) {
      const sec = f.querySelector(`[data-unit="${CSS.escape(anchor.current)}"]`) as HTMLElement | null;
      if (sec) {
        const p = Math.floor(sec.offsetLeft / step);
        setPage(spread ? p - (p % 2) : p);
      }
      anchor.current = null;
    }
  }, [step, spread]);

  useLayoutEffect(() => {
    measure();
    const f = flow.current;
    if (!f) return;
    const imgs = Array.from(f.querySelectorAll("img"));
    imgs.forEach((i) => i.addEventListener("load", measure));
    return () => imgs.forEach((i) => i.removeEventListener("load", measure));
  }, [content, pageW, pageH, prefs.fontScale, prefs.lineHeight, measure]);

  const clamp = useCallback((p: number) => Math.max(0, Math.min(pages - 1, spread ? p - (p % 2) : p)), [pages, spread]);
  const next = useCallback(() => setPage((p) => clamp(p + perView)), [clamp, perView]);
  const prev = useCallback(() => setPage((p) => clamp(p - perView)), [clamp, perView]);

  // Report current chapter
  useEffect(() => {
    const f = flow.current;
    if (!f || !onChapter) return;
    const x = page * step;
    let cur: string | null = null;
    f.querySelectorAll<HTMLElement>(".lf-reader-chapter").forEach((s) => {
      if (s.offsetLeft <= x + 4) cur = s.dataset.unit ?? null;
    });
    if (cur) onChapter(cur);
  }, [page, step, onChapter, pages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") (e.preventDefault(), next());
      if (e.key === "ArrowLeft" || e.key === "PageUp") (e.preventDefault(), prev());
      if (e.key === "Home") setPage(0);
      if (e.key === "End") setPage(clamp(pages - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, clamp, pages]);

  useImperativeHandle(ref, () => ({
    goToChapter(unitId) {
      const f = flow.current;
      const sec = f?.querySelector(`[data-unit="${CSS.escape(unitId)}"]`) as HTMLElement | null;
      if (sec) setPage(clamp(Math.floor(sec.offsetLeft / step)));
      else anchor.current = unitId;
    },
    search(q) {
      const f = flow.current;
      if (!f || !q.trim()) return -1;
      const walker = document.createTreeWalker(f, NodeFilter.SHOW_TEXT);
      const needle = q.toLowerCase();
      const startX = (page + perView) * step;
      let first: { x: number } | null = null;
      let after: { x: number } | null = null;
      const ranges: Range[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = (n as Text).data.toLowerCase();
        let i = text.indexOf(needle);
        while (i >= 0) {
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + q.length);
          ranges.push(r);
          const rect = r.getBoundingClientRect();
          const base = f.getBoundingClientRect().left;
          const x = rect.left - base;
          if (!first) first = { x };
          if (!after && x >= startX) after = { x };
          i = text.indexOf(needle, i + 1);
        }
      }
      const H = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
      const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
      if (H && reg) reg.set("lf-search", new H(...ranges));
      const target = after ?? first;
      if (target) setPage(clamp(Math.floor(target.x / step)));
      return ranges.length;
    },
    next,
    prev,
  }));

  if (!content)
    return (
      <div className="lf-loading">
        <Loader2 className="spin" size={20} />
      </div>
    );

  const visiblePages = Array.from({ length: perView }, (_, i) => page + i).filter((p) => p < pages);

  return (
    <div className={`lf-reader theme-${prefs.theme}`}>
      <div className="lf-reader-viewport" ref={viewport}>
        <div className="lf-reader-spread" style={{ width: perView * pageW + (perView - 1) * gap, height: pageH }}>
          <div className="lf-reader-pagebg" style={{ width: pageW }} />
          {spread && <div className="lf-reader-pagebg right" style={{ width: pageW, left: pageW + gap }} />}
          <div className="lf-reader-clip" style={{ width: perView * pageW + (perView - 1) * gap, height: pageH }}>
            <div
              ref={flow}
              className="lf-reader-flow lf-md"
              style={{
                height: pageH - 96,
                width: pageW - 112,
                columnWidth: pageW - 112,
                columnGap: gap + 112,
                transform: `translateX(${-page * step}px)`,
                fontSize: `${17 * prefs.fontScale}px`,
                lineHeight: prefs.lineHeight,
                ["--page-inner-h" as string]: `${pageH - 96}px`,
              }}
            >
              {content}
            </div>
          </div>
          {visiblePages.map((p, i) => (
            <div key={p} className="lf-reader-folio" style={{ left: i * (pageW + gap), width: pageW }}>
              {p + 1} / {pages}
            </div>
          ))}
        </div>
        <button className="lf-reader-nav left" onClick={prev} disabled={page === 0} aria-label="上一页">
          <ChevronLeft size={22} />
        </button>
        <button className="lf-reader-nav right" onClick={next} disabled={page + perView >= pages} aria-label="下一页">
          <ChevronRight size={22} />
        </button>
      </div>
      <input className="lf-reader-progress" type="range" min={0} max={Math.max(0, pages - 1)} value={page} onChange={(e) => setPage(clamp(Number(e.target.value)))} aria-label="阅读进度" />
    </div>
  );
});
