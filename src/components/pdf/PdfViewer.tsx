import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Search, X, Rows3, File as FileIcon, MoveHorizontal, Loader2, Lock, Shrink } from "lucide-react";
import "pdfjs-dist/web/pdf_viewer.css";
import { loadPdf, pdfjs, type PDFDocumentProxy } from "@/services/content/pdf";
import { prompt } from "@/app/store";

export interface PdfViewerHandle {
  goTo(page: number): void;
  doc(): PDFDocumentProxy | null;
}

export interface PdfViewerProps {
  bytes: Uint8Array | null;
  initialPage?: number;
  initialZoom?: number;
  initialMode?: "single" | "continuous";
  onDocument?: (doc: PDFDocumentProxy | null) => void;
  onState?: (s: { page: number; zoom: number; mode: "single" | "continuous" }) => void;
  toolbarExtra?: React.ReactNode;
  label?: string;
}

interface PageSize {
  w: number;
  h: number;
}

function PdfPage({ doc, index, scale, size, query, onVisible, eager }: { doc: PDFDocumentProxy; index: number; scale: number; size: PageSize; query: string; onVisible?: (i: number) => void; eager?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!!eager);

  useEffect(() => {
    const el = ref.current;
    if (!el || eager) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setVisible(true);
          if (e.intersectionRatio > 0.5) onVisible?.(index);
        }
      },
      { rootMargin: "600px 0px", threshold: [0, 0.5] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [index, onVisible, eager]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: { cancel(): void; promise: Promise<void> } | null = null as { cancel(): void; promise: Promise<void> } | null;
    (async () => {
      const page = await doc.getPage(index + 1);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current!;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const rt = page.render({ canvas, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined } as never);
      task = rt as unknown as { cancel(): void; promise: Promise<void> };
      try {
        await rt.promise;
      } catch {
        return;
      }
      if (cancelled || !textRef.current) return;
      textRef.current.innerHTML = "";
      textRef.current.style.setProperty("--scale-factor", String(scale));
      textRef.current.style.setProperty("--total-scale-factor", String(scale));
      const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textRef.current, viewport });
      await tl.render().catch(() => undefined);
      highlight(textRef.current, query);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, index, scale, visible, query]);

  return (
    <div ref={ref} className="lf-pdf-page" style={{ width: size.w * scale, height: size.h * scale }} data-page={index + 1}>
      <canvas ref={canvasRef} />
      <div ref={textRef} className="lf-pdf-text textLayer" />
      {!visible && <span className="lf-pdf-pagenum">{index + 1}</span>}
    </div>
  );
}

function highlight(container: HTMLElement, q: string) {
  const needle = q.trim().toLowerCase();
  container.querySelectorAll("span").forEach((s) => s.classList.toggle("lf-hit", !!needle && (s.textContent ?? "").toLowerCase().includes(needle)));
}

export const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(function PdfViewer({ bytes, initialPage = 1, initialZoom, initialMode = "continuous", onDocument, onState, toolbarExtra, label }, ref) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [page, setPage] = useState(initialPage);
  const [zoom, setZoom] = useState<number | "fit" | "page">(initialZoom ?? "page");
  const [mode, setMode] = useState<"single" | "continuous">(initialMode);
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(700);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<number[]>([]);
  const [hitIdx, setHitIdx] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const pageText = useRef<Map<number, string>>(new Map());

  // Load document. The bytes are copied so PDF.js never touches the caller's buffer.
  useEffect(() => {
    if (!bytes) return;
    let alive = true;
    let loaded: PDFDocumentProxy | null = null;
    setDoc(null);
    setError(null);
    pageText.current.clear();
    const open = async (password?: string): Promise<void> => {
      try {
        loaded = await loadPdf(bytes.slice(), password);
        if (!alive) return void loaded.loadingTask.destroy();
        const s: PageSize[] = [];
        for (let i = 1; i <= loaded.numPages; i++) {
          const p = await loaded.getPage(i);
          const v = p.getViewport({ scale: 1 });
          s.push({ w: v.width, h: v.height });
        }
        if (!alive) return;
        setSizes(s);
        setDoc(loaded);
        onDocument?.(loaded);
      } catch (e) {
        const err = e as { name?: string; message?: string };
        if (err?.name === "PasswordException" && alive) {
          const pw = await prompt({ title: "此 PDF 已加密", label: "输入打开密码（仅用于本次阅读，不会保存或改动文件）" });
          if (pw) return open(pw);
          setError("PDF 已加密，未提供密码");
          return;
        }
        if (alive) setError(`无法打开 PDF：${err?.message ?? e}`);
      }
    };
    void open();
    return () => {
      alive = false;
      onDocument?.(null);
      void loaded?.loadingTask.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => (setWidth(el.clientWidth), setHeight(el.clientHeight)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxW = useMemo(() => Math.max(...sizes.map((s) => s.w), 1), [sizes]);
  const maxH = useMemo(() => Math.max(...sizes.map((s) => s.h), 1), [sizes]);
  const fitW = Math.max(0.2, Math.min(4, (width - 48) / maxW));
  const scale = zoom === "fit" ? fitW : zoom === "page" ? Math.max(0.2, Math.min(fitW, (height - 48) / maxH)) : zoom;

  const goTo = useCallback(
    (n: number) => {
      if (!doc) return;
      const p = Math.max(1, Math.min(doc.numPages, n));
      setPage(p);
      if (mode === "continuous") scroller.current?.querySelector(`[data-page="${p}"]`)?.scrollIntoView({ block: "start" });
    },
    [doc, mode],
  );

  useImperativeHandle(ref, () => ({ goTo, doc: () => doc }), [goTo, doc]);

  // Restore initial page once.
  const restored = useRef(false);
  useEffect(() => {
    if (doc && !restored.current) {
      restored.current = true;
      setTimeout(() => goTo(initialPage), 50);
    }
  }, [doc, goTo, initialPage]);

  useEffect(() => {
    onState?.({ page, zoom: typeof zoom === "number" ? zoom : 0, mode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, zoom, mode]);

  const onVisible = useCallback((i: number) => setPage(i + 1), []);

  const runSearch = async () => {
    if (!doc || !query.trim()) return setHits([]);
    const needle = query.trim().toLowerCase();
    const found: number[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      let t = pageText.current.get(i);
      if (t === undefined) {
        const p = await doc.getPage(i);
        const c = await p.getTextContent();
        t = c.items.map((it) => ("str" in it ? it.str : "")).join("");
        pageText.current.set(i, t);
      }
      if (t.toLowerCase().includes(needle)) found.push(i);
    }
    setHits(found);
    setHitIdx(0);
    if (found[0]) goTo(found[0]);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (mode === "single" && (e.key === "ArrowRight" || e.key === "PageDown")) goTo(page + 1);
      if (mode === "single" && (e.key === "ArrowLeft" || e.key === "PageUp")) goTo(page - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, page, goTo]);

  const setNumericZoom = (z: number) => setZoom(Math.round(Math.max(0.25, Math.min(4, z)) * 100) / 100);

  return (
    <div className="lf-pdf">
      <div className="lf-pdf-toolbar" aria-label={label ?? "PDF 阅读"}>
        <button className="lf-icon-btn" onClick={() => goTo(page - 1)} disabled={!doc || page <= 1} aria-label="上一页" title="上一页">
          <ChevronLeft size={16} />
        </button>
        <span className="lf-pdf-pageinput">
          <input value={page} onChange={(e) => setPage(Number(e.target.value.replace(/\D/g, "")) || 1)} onKeyDown={(e) => e.key === "Enter" && goTo(page)} aria-label="页码" />
          <span>/ {doc?.numPages ?? "–"}</span>
        </span>
        <button className="lf-icon-btn" onClick={() => goTo(page + 1)} disabled={!doc || page >= (doc?.numPages ?? 1)} aria-label="下一页" title="下一页">
          <ChevronRight size={16} />
        </button>
        <span className="lf-sep" />
        <button className="lf-icon-btn" onClick={() => setNumericZoom(scale - 0.15)} aria-label="缩小" title="缩小">
          <ZoomOut size={16} />
        </button>
        <span className="lf-pdf-zoom">{Math.round(scale * 100)}%</span>
        <button className="lf-icon-btn" onClick={() => setNumericZoom(scale + 0.15)} aria-label="放大" title="放大">
          <ZoomIn size={16} />
        </button>
        <button className={`lf-icon-btn ${zoom === "page" ? "on" : ""}`} onClick={() => setZoom("page")} aria-label="适合页面" title="适合页面">
          <Shrink size={16} />
        </button>
        <button className={`lf-icon-btn ${zoom === "fit" ? "on" : ""}`} onClick={() => setZoom("fit")} aria-label="适合宽度" title="适合宽度">
          <MoveHorizontal size={16} />
        </button>
        <span className="lf-sep" />
        <button className={`lf-icon-btn ${mode === "continuous" ? "on" : ""}`} onClick={() => setMode("continuous")} aria-label="连续滚动" title="连续滚动">
          <Rows3 size={16} />
        </button>
        <button className={`lf-icon-btn ${mode === "single" ? "on" : ""}`} onClick={() => setMode("single")} aria-label="单页" title="单页（←/→ 翻页）">
          <FileIcon size={16} />
        </button>
        <span className="lf-sep" />
        <button className={`lf-icon-btn ${searchOpen ? "on" : ""}`} onClick={() => setSearchOpen((s) => !s)} aria-label="搜索文本" title="搜索文本层（Ctrl+F）">
          <Search size={16} />
        </button>
        {searchOpen && (
          <span className="lf-pdf-search">
            <input autoFocus value={query} placeholder="搜索 PDF 文本…" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (hits.length && query ? (setHitIdx((hitIdx + 1) % hits.length), goTo(hits[(hitIdx + 1) % hits.length])) : runSearch())} />
            <button className="lf-btn small" onClick={runSearch}>
              查找
            </button>
            <small>{query ? (hits.length ? `${hitIdx + 1}/${hits.length} 页` : "无结果") : ""}</small>
            <button className="lf-icon-btn tiny" onClick={() => (setSearchOpen(false), setQuery(""), setHits([]))} aria-label="关闭搜索">
              <X size={13} />
            </button>
          </span>
        )}
        <span className="lf-pdf-spacer" />
        <span className="lf-pdf-readonly" title="只读：Leafor 不修改 PDF 文件">
          <Lock size={12} /> 只读
        </span>
        {toolbarExtra}
      </div>
      <div className={`lf-pdf-scroll mode-${mode}`} ref={scroller}>
        {error && <div className="lf-pdf-error">{error}</div>}
        {!doc && !error && (
          <div className="lf-loading">
            <Loader2 className="spin" size={20} />
          </div>
        )}
        {doc &&
          (mode === "continuous" ? (
            sizes.map((s, i) => <PdfPage key={i} doc={doc} index={i} scale={scale} size={s} query={query} onVisible={onVisible} />)
          ) : (
            <PdfPage key={`single-${page}`} doc={doc} index={page - 1} scale={scale} size={sizes[page - 1]} query={query} eager />
          ))}
      </div>
    </div>
  );
});

/** Thumbnail list for the side panel. */
export function PdfThumbnails({ doc, current, onPick }: { doc: PDFDocumentProxy; current: number; onPick: (p: number) => void }) {
  const pages = Array.from({ length: doc.numPages }, (_, i) => i);
  return (
    <div className="lf-pdf-thumbs">
      {pages.map((i) => (
        <button key={i} className={`lf-pdf-thumb ${current === i + 1 ? "on" : ""}`} onClick={() => onPick(i + 1)}>
          <Thumb doc={doc} index={i} />
          <small>{i + 1}</small>
        </button>
      ))}
    </div>
  );
}

function Thumb({ doc, index }: { doc: PDFDocumentProxy; index: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setVis(true), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!vis) return;
    let t: { cancel(): void } | null = null;
    (async () => {
      const p = await doc.getPage(index + 1);
      const v0 = p.getViewport({ scale: 1 });
      const v = p.getViewport({ scale: 140 / v0.width });
      const c = ref.current!;
      c.width = v.width;
      c.height = v.height;
      t = p.render({ canvas: c, viewport: v } as never) as never;
    })();
    return () => t?.cancel();
  }, [vis, doc, index]);
  return <canvas ref={ref} />;
}
