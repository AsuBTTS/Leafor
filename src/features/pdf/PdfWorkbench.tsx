/**
 * External PDF workbench — strictly read-only (spec §3.8, FR-13, FR-29, FR-32).
 * Receives only read services: loads bytes, reads the outline, persists reader
 * state and notes to item.json. There is no editor, no OCR, no PDF→Markdown.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck, ExternalLink, FileDown, BookMarked, LayoutGrid, NotebookPen, FolderSearch } from "lucide-react";
import type { WorkbenchProps } from "@/features/library/ItemPage";
import { ItemHeader } from "@/features/library/ItemHeader";
import { SidePanel, useTocOpen } from "@/components/navigation/SidePanel";
import { PdfThumbnails, PdfViewer, type PdfViewerHandle } from "@/components/pdf/PdfViewer";
import { readOutline, type PdfOutlineNode, type PDFDocumentProxy } from "@/services/content/pdf";
import { repo, backend } from "@/app/backend";
import { toast, withBusy } from "@/app/store";
import { joinRel } from "@/domain/policies/naming";
import type { PdfItem } from "@/domain/models/types";
import { exportOriginalPdf } from "@/services/import-export/exportService";
import { runExport } from "@/features/library/unitActions";

/** The PDF read service: the only capabilities the PDF workbench gets. */
export const PdfReadService = {
  loadPdf: (itemId: string) => {
    const it = repo.requireItem(itemId);
    if (it.meta.type !== "pdf") throw new Error("不是 PDF 对象");
    return repo.fs.readBytes(joinRel(it.dir, it.meta.data.sourcePath));
  },
  async verifyOriginal(itemId: string): Promise<boolean> {
    const it = repo.requireItem(itemId);
    if (it.meta.type !== "pdf") return false;
    return (await repo.fs.hash(joinRel(it.dir, it.meta.data.sourcePath))) === it.meta.data.sha256AtImport;
  },
  async updateReaderState(itemId: string, s: { lastPage?: number; zoom?: number; mode?: "single" | "continuous" }) {
    const it = repo.getItem(itemId);
    if (!it || it.meta.type !== "pdf") return;
    const m = it.meta as PdfItem;
    await repo.saveItem({ ...m, data: { ...m.data, readerState: { ...m.data.readerState, ...s } } });
  },
  async updateNotes(itemId: string, notes: string) {
    await repo.updateItem(itemId, { notes });
  },
};

function OutlineTree({ nodes, onPick, depth = 0 }: { nodes: PdfOutlineNode[]; onPick: (p: number) => void; depth?: number }) {
  return (
    <>
      {nodes.map((n, i) => (
        <div key={i}>
          <button className="lf-outline-row" style={{ paddingLeft: 12 + depth * 14 }} disabled={n.pageIndex === null} onClick={() => n.pageIndex !== null && onPick(n.pageIndex + 1)} title={n.title}>
            {n.title}
          </button>
          {n.children.length > 0 && <OutlineTree nodes={n.children} onPick={onPick} depth={depth + 1} />}
        </div>
      ))}
    </>
  );
}

export function PdfWorkbench({ item }: WorkbenchProps) {
  const [tocOpen, setTocOpen] = useTocOpen("pdf");
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [outline, setOutline] = useState<PdfOutlineNode[]>([]);
  const [tab, setTab] = useState<"outline" | "thumbs" | "notes">("outline");
  const [page, setPage] = useState(1);
  const [notes, setNotes] = useState(item.meta.notes ?? "");
  const viewer = useRef<PdfViewerHandle>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = item.meta.id;
  const m = item.meta as PdfItem;

  useEffect(() => {
    PdfReadService.loadPdf(id)
      .then(setBytes)
      .catch((e) => toast.error(`无法读取 PDF 原件：${(e as Error).message}`));
  }, [id]);

  const onDocument = useCallback(async (d: PDFDocumentProxy | null) => {
    setDoc(d);
    if (!d) return;
    const o = await readOutline(d);
    setOutline(o);
    if (!o.length) setTab("thumbs");
    const it = repo.getItem(id);
    if (it?.meta.type === "pdf" && it.meta.data.pageCount !== d.numPages) {
      const mm = it.meta;
      await repo.saveItem({ ...mm, data: { ...mm.data, pageCount: d.numPages } });
    }
  }, [id]);

  const onState = useCallback(
    (s: { page: number; zoom: number; mode: "single" | "continuous" }) => {
      setPage(s.page);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void PdfReadService.updateReaderState(id, { lastPage: s.page, zoom: s.zoom || undefined, mode: s.mode }), 1500);
    },
    [id],
  );
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  if (m.type !== "pdf") return null;

  const verify = async () => {
    const ok = await withBusy("正在校验 SHA-256…", () => PdfReadService.verifyOriginal(id));
    if (ok) toast.success(`原件完整：SHA-256 与导入时一致（${m.data.sha256AtImport.slice(0, 12)}…）`);
    else if (ok === false) toast.error("警告：PDF 原件的 SHA-256 与导入时不一致，文件可能在 Leafor 之外被修改。");
  };

  return (
    <div className="lf-page lf-item-page">
      <ItemHeader
        item={item}
        tocOpen={tocOpen}
        onToggleToc={() => setTocOpen(!tocOpen)}
        right={
          <>
            <button className="lf-icon-btn" onClick={verify} title="校验原件完整性（SHA-256）" aria-label="校验原件">
              <ShieldCheck size={16} strokeWidth={1.6} />
            </button>
            <button className="lf-icon-btn" onClick={() => backend.platform.openInSystem(joinRel(item.dir, m.data.sourcePath)).catch(toast.error)} title="在系统默认 PDF 阅读器中打开" aria-label="外部打开">
              <ExternalLink size={16} strokeWidth={1.6} />
            </button>
          </>
        }
        exportItems={[
          { label: "另存原始 PDF（字节不变）", icon: <FileDown size={14} />, onSelect: () => runExport("复制 PDF", () => exportOriginalPdf(id)) },
          { label: "在文件管理器中显示原件", icon: <FolderSearch size={14} />, onSelect: () => backend.platform.reveal(joinRel(item.dir, m.data.sourcePath)).catch(toast.error) },
        ]}
      />
      <div className="lf-item-body">
        <SidePanel
          title={
            <span className="lf-tabs-mini">
              <button className={tab === "outline" ? "on" : ""} onClick={() => setTab("outline")} title="书签目录">
                <BookMarked size={14} />
              </button>
              <button className={tab === "thumbs" ? "on" : ""} onClick={() => setTab("thumbs")} title="缩略图">
                <LayoutGrid size={14} />
              </button>
              <button className={tab === "notes" ? "on" : ""} onClick={() => setTab("notes")} title="备注">
                <NotebookPen size={14} />
              </button>
            </span>
          }
          open={tocOpen}
          onClose={() => setTocOpen(false)}
          prefKey="toc.width.pdf"
          footer={<span className="muted">{m.data.pageCount ?? "?"} 页 · 只读原件</span>}
        >
          {tab === "outline" && (outline.length ? <OutlineTree nodes={outline} onPick={(p) => viewer.current?.goTo(p)} /> : <div className="lf-tree-empty">此 PDF 没有内置书签目录。</div>)}
          {tab === "thumbs" && doc && <PdfThumbnails doc={doc} current={page} onPick={(p) => viewer.current?.goTo(p)} />}
          {tab === "notes" && (
            <div className="lf-pdf-notes">
              <textarea value={notes} placeholder="阅读笔记、来源说明……（保存在 item.json，不写入 PDF）" onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (m.notes ?? "") && PdfReadService.updateNotes(id, notes)} />
              <dl className="lf-props-meta">
                <dt>原文件名</dt>
                <dd>{m.data.sourceName}</dd>
                {m.data.pdfTitle && (
                  <>
                    <dt>PDF 标题</dt>
                    <dd>{m.data.pdfTitle}</dd>
                  </>
                )}
                {m.data.pdfAuthor && (
                  <>
                    <dt>PDF 作者</dt>
                    <dd>{m.data.pdfAuthor}</dd>
                  </>
                )}
                <dt>导入时间</dt>
                <dd>{new Date(m.data.importedAt).toLocaleString()}</dd>
                <dt>大小</dt>
                <dd>{(m.data.bytes / 1024 / 1024).toFixed(2)} MB</dd>
                <dt>SHA-256</dt>
                <dd className="mono small">{m.data.sha256AtImport}</dd>
              </dl>
            </div>
          )}
        </SidePanel>
        <div className="lf-item-main">
          <PdfViewer
            ref={viewer}
            bytes={bytes}
            initialPage={m.data.readerState?.lastPage ?? 1}
            initialZoom={m.data.readerState?.zoom || undefined}
            initialMode={m.data.readerState?.mode ?? "continuous"}
            onDocument={onDocument}
            onState={onState}
          />
        </div>
      </div>
    </div>
  );
}
