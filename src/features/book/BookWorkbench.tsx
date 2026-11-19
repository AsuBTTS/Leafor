import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PenLine, Columns2, Eye, BookOpen, Printer, Plus, Upload, FileText, FileCode2, FileDown, Type, BookOpenText, Search, X } from "lucide-react";
import type { WorkbenchProps } from "@/features/library/ItemPage";
import { ItemHeader, ModeSwitch } from "@/features/library/ItemHeader";
import { SidePanel, useTocOpen } from "@/components/navigation/SidePanel";
import { UnitTree } from "@/components/navigation/UnitTree";
import { TextWorkbench, type TextWorkbenchHandle } from "@/components/editor/TextWorkbench";
import { MarksPopover } from "@/components/marks/Marks";
import { Popover } from "@/components/forms/Popover";
import { repo, backend } from "@/app/backend";
import { usePref, toast, withBusy } from "@/app/store";
import { getUnits, moveIndex } from "@/domain/policies/units";
import type { TargetRef } from "@/domain/models/types";
import { runExport, unitMenu } from "@/features/library/unitActions";
import { exportHtml, exportMarkdown } from "@/services/import-export/exportService";
import { exportDocx } from "@/services/import-export/docxExport";
import { importMarkdownIntoItem } from "@/services/import-export/importService";
import { MD_FILTER } from "@/features/library/actions";
import { BookReader, type BookReaderHandle, type ReaderPrefs } from "./BookReader";
import { PublishPanel } from "./PublishPanel";
import { EmptyState } from "@/components/feedback/Overlays";

type BookMode = "edit" | "split" | "preview" | "read" | "publish";

export function BookWorkbench({ item, unitId }: WorkbenchProps) {
  const navigate = useNavigate();
  const [mode, setMode] = usePref<BookMode>("book.mode", "split");
  const [tocOpen, setTocOpen] = useTocOpen("book");
  const [marks, setMarks] = useState<{ anchor: HTMLElement | null; targets: TargetRef[] } | null>(null);
  const [prefs, setPrefs] = usePref<ReaderPrefs>("reader.prefs", { doublePage: true, fontScale: 1, lineHeight: 1.85, theme: "paper" });
  const [fontAnchor, setFontAnchor] = useState<HTMLButtonElement | null>(null);
  const [fontOpen, setFontOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<number | null>(null);
  const [readerChapter, setReaderChapter] = useState<string | undefined>(undefined);
  const reader = useRef<BookReaderHandle>(null);
  const wb = useRef<TextWorkbenchHandle>(null);
  if (item.meta.type !== "book") return null;
  const chapters = getUnits(item.meta);
  const id = item.meta.id;
  const lastId = item.meta.type === "book" ? item.meta.data.readerPrefs?.lastChapterId : undefined;
  const active = chapters.find((c) => c.id === unitId) ?? chapters.find((c) => c.id === lastId) ?? chapters[0];

  // Remember the last opened chapter (stored in item.json, not the chapter files).
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const meta = item.meta;
    if (active && unitId && meta.type === "book" && meta.data.readerPrefs?.lastChapterId !== active.id) {
      const t = setTimeout(() => {
        const cur = repo.getItem(id)?.meta;
        if (cur?.type === "book") void repo.saveItem({ ...cur, data: { ...cur.data, readerPrefs: { ...cur.data.readerPrefs, lastChapterId: active.id } } });
      }, 800);
      return () => clearTimeout(t);
    }
  }, [active?.id, unitId, id, item.meta]);

  const open = (uid: string) => {
    if (mode === "read") reader.current?.goToChapter(uid);
    navigate(`/item/${id}/${uid}`, { replace: true });
  };

  const addChapter = async () => {
    const u = await repo.addUnit(id, {});
    navigate(`/item/${id}/${u.id}`);
    if (mode === "read" || mode === "publish") setMode("split");
  };

  const importChapters = async () => {
    const files = await backend.platform.pickFiles("导入 Markdown 为章节", MD_FILTER, true);
    if (!files.length) return;
    const r = await withBusy("正在导入章节…", () => importMarkdownIntoItem(repo, id, [...files].sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }))));
    if (r) r.warnings.length ? toast.warning(r.warnings.slice(0, 2).join("；")) : toast.success(`已导入 ${r.created.length} 个章节`);
  };

  const isText = mode === "edit" || mode === "split" || mode === "preview";
  const onState = useCallback(() => undefined, []);

  return (
    <div className="lf-page lf-item-page">
      <ItemHeader
        item={item}
        tocOpen={tocOpen}
        onToggleToc={() => setTocOpen(!tocOpen)}
        center={
          <ModeSwitch<BookMode>
            value={mode}
            onChange={async (m) => {
              await wb.current?.flush();
              setMode(m);
            }}
            options={[
              { value: "edit", label: "编辑", icon: <PenLine size={14} /> },
              { value: "split", label: "分屏", icon: <Columns2 size={14} /> },
              { value: "preview", label: "预览", icon: <Eye size={14} /> },
              { value: "read", label: "书籍", icon: <BookOpen size={14} />, title: "书籍阅读模式" },
              { value: "publish", label: "排版", icon: <Printer size={14} />, title: "出版排版与 PDF 成品预览" },
            ]}
          />
        }
        right={
          mode === "read" ? (
            <>
              <button ref={setFontAnchor} className={`lf-icon-btn ${fontOpen ? "on" : ""}`} onClick={() => setFontOpen((o) => !o)} title="字号与版面" aria-label="字号与版面">
                <Type size={16} />
              </button>
              <button className={`lf-icon-btn ${prefs.doublePage ? "on" : ""}`} onClick={() => setPrefs({ ...prefs, doublePage: !prefs.doublePage })} title={prefs.doublePage ? "单页" : "双页"} aria-label="切换单双页">
                <BookOpenText size={16} />
              </button>
              <button className={`lf-icon-btn ${searchOpen ? "on" : ""}`} onClick={() => setSearchOpen((s) => !s)} title="在书中查找" aria-label="在书中查找">
                <Search size={16} />
              </button>
            </>
          ) : null
        }
        exportItems={[
          { label: "导出 Markdown（按章节）", icon: <FileText size={14} />, onSelect: () => runExport("导出 Markdown", () => exportMarkdown(id)) },
          { label: "导出 Markdown（合并为单文件）", icon: <FileText size={14} />, onSelect: () => runExport("导出 Markdown", () => exportMarkdown(id, { merge: true })) },
          { label: "导出 HTML", icon: <FileCode2 size={14} />, onSelect: () => runExport("导出 HTML", () => exportHtml(id)) },
          { label: "导出 Word", icon: <FileDown size={14} />, onSelect: () => runExport("导出 Word", () => exportDocx(id)) },
          { label: "排版并导出 PDF…", icon: <Printer size={14} />, onSelect: () => setMode("publish") },
        ]}
      />
      <div className="lf-item-body">
        <SidePanel
          title="目录"
          open={tocOpen}
          onClose={() => setTocOpen(false)}
          actions={
            <>
              <button className="lf-icon-btn" onClick={importChapters} title="导入 Markdown 为章节" aria-label="导入章节">
                <Upload size={15} />
              </button>
              <button className="lf-icon-btn" onClick={addChapter} title="新建章节" aria-label="新建章节">
                <Plus size={16} />
              </button>
            </>
          }
          footer={<span className="muted">{chapters.length} 章</span>}
        >
          <UnitTree
            sections={[{ id: null, units: chapters }]}
            activeId={mode === "read" ? readerChapter ?? active?.id : active?.id}
            onOpen={(u) => open(u.id)}
            onMove={(uid, _s, index) => {
              const ids = chapters.map((c) => c.id);
              const from = ids.indexOf(uid);
              void repo.reorderUnits(id, moveIndex(ids, from, index > from ? index - 1 : index));
            }}
            menuFor={(u) =>
              unitMenu(item, u, navigate, {
                onMarks: () => setMarks({ anchor: document.querySelector(".lf-tree-row.active") as HTMLElement, targets: [{ kind: "unit", itemId: id, unitId: u.id }] }),
              })
            }
            emptyHint="还没有章节"
          />
        </SidePanel>
        <div className="lf-item-main">
          {!active && mode !== "publish" ? (
            <EmptyState title="这本书还没有章节" hint="新建章节开始写作，或导入已有的 Markdown 文件。">
              <button className="lf-btn primary" onClick={addChapter}>
                <Plus size={15} /> 新建章节
              </button>
              <button className="lf-btn" onClick={importChapters}>
                <Upload size={15} /> 导入 Markdown
              </button>
            </EmptyState>
          ) : isText && active ? (
            <TextWorkbench
              key={active.id}
              ref={wb}
              itemId={id}
              unitId={active.id}
              mode={mode as "edit"}
              onState={onState}
              onInternalLink={(p) => {
                const target = chapters.find((c) => `${item.dir}/${c.path}` === p);
                if (target) open(target.id);
              }}
            />
          ) : mode === "read" ? (
            <div className="lf-reader-wrap">
              {searchOpen && (
                <div className="lf-reader-search">
                  <Search size={14} />
                  <input autoFocus value={q} placeholder="在全书中查找…" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setHits(reader.current?.search(q) ?? 0)} />
                  {hits !== null && <small>{hits ? `${hits} 处` : "无结果"}</small>}
                  <button className="lf-icon-btn tiny" onClick={() => (setSearchOpen(false), setHits(null))} aria-label="关闭查找">
                    <X size={13} />
                  </button>
                </div>
              )}
              <BookReader ref={reader} item={item} chapters={chapters} prefs={prefs} initialChapter={active?.id} onChapter={setReaderChapter} />
            </div>
          ) : (
            <PublishPanel item={item} />
          )}
        </div>
      </div>
      <MarksPopover anchor={marks?.anchor ?? null} targets={marks?.targets ?? null} onClose={() => setMarks(null)} />
      <Popover anchor={fontAnchor} open={fontOpen} onClose={() => setFontOpen(false)} placement="bottom-end" width={260}>
        <div className="lf-reader-settings">
          <label>
            字号
            <input type="range" min={0.8} max={1.6} step={0.05} value={prefs.fontScale} onChange={(e) => setPrefs({ ...prefs, fontScale: Number(e.target.value) })} />
          </label>
          <label>
            行距
            <input type="range" min={1.4} max={2.4} step={0.05} value={prefs.lineHeight} onChange={(e) => setPrefs({ ...prefs, lineHeight: Number(e.target.value) })} />
          </label>
          <div className="lf-seg small">
            {(["paper", "white", "sepia"] as const).map((t) => (
              <button key={t} className={prefs.theme === t ? "on" : ""} onClick={() => setPrefs({ ...prefs, theme: t })}>
                {t === "paper" ? "纸白" : t === "white" ? "纯白" : "暖黄"}
              </button>
            ))}
          </div>
        </div>
      </Popover>
    </div>
  );
}
