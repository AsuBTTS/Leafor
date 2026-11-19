import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Upload, FolderPlus, BookOpen, Columns2, PenLine, ChevronLeft, ChevronRight, FileText, FileCode2, FileDown, Printer, Globe, ScrollText, Home, Pencil, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import type { WorkbenchProps } from "@/features/library/ItemPage";
import { ItemHeader, ModeSwitch } from "@/features/library/ItemHeader";
import { SidePanel, useTocOpen } from "@/components/navigation/SidePanel";
import { UnitTree, type TreeSection } from "@/components/navigation/UnitTree";
import { TextWorkbench, type TextMode } from "@/components/editor/TextWorkbench";
import { MarksPopover, StatusBadge } from "@/components/marks/Marks";
import { MarkdownView } from "@/components/markdown/MarkdownView";
import { repo, backend } from "@/app/backend";
import { usePref, prompt, confirmDialog, toast, withBusy, useRepo } from "@/app/store";
import { orderedSeries, seriesNavigation, sortByOrder, moveIndex } from "@/domain/policies/units";
import type { SeriesArticle, SeriesGroup, TargetRef } from "@/domain/models/types";
import { joinRel } from "@/domain/policies/naming";
import { runExport, unitMenu } from "@/features/library/unitActions";
import { exportHtml, exportMarkdown, exportSeriesSite } from "@/services/import-export/exportService";
import { exportDocx } from "@/services/import-export/docxExport";
import { importMarkdownIntoItem } from "@/services/import-export/importService";
import { MD_FILTER } from "@/features/library/actions";
import { PublishDialog } from "@/features/book/PublishPanel";
import { EmptyState } from "@/components/feedback/Overlays";

type SeriesMode = TextMode | "all";

export function SeriesWorkbench({ item, unitId }: WorkbenchProps) {
  useRepo();
  const navigate = useNavigate();
  const [tocOpen, setTocOpen] = useTocOpen("series");
  const [mode, setMode] = usePref<SeriesMode>("series.mode", "preview");
  const [marks, setMarks] = useState<{ anchor: HTMLElement | null; targets: TargetRef[] } | null>(null);
  const [publish, setPublish] = useState(false);
  const onOutline = useCallback(() => undefined, []);
  if (item.meta.type !== "article_series") return null;
  const m = item.meta;
  const id = m.id;
  const groups = sortByOrder(m.data.groups ?? []);
  const seq = orderedSeries(m.data.articles, groups);
  const current = seq.find((a) => a.id === unitId);
  const nav = current ? seriesNavigation(m.data.articles, groups, current.id) : null;

  const sections: TreeSection[] = [
    { id: null, units: seq.filter((a) => !a.groupId || !groups.some((g) => g.id === a.groupId)) },
    ...groups.map((g) => ({
      id: g.id,
      title: g.title,
      units: seq.filter((a) => a.groupId === g.id),
      menu: groupMenu(g),
    })),
  ];

  function groupMenu(g: SeriesGroup) {
    const idx = groups.findIndex((x) => x.id === g.id);
    return [
      {
        label: "重命名分组",
        icon: <Pencil size={14} />,
        onSelect: async () => {
          const t = await prompt({ title: "重命名分组", value: g.title });
          if (t) await repo.updateSeriesGroups(id, groups.map((x) => (x.id === g.id ? { ...x, title: t } : x)));
        },
      },
      { label: "上移", icon: <ArrowUp size={14} />, disabled: idx === 0, onSelect: () => repo.updateSeriesGroups(id, moveIndex(groups, idx, idx - 1)) },
      { label: "下移", icon: <ArrowDown size={14} />, disabled: idx === groups.length - 1, onSelect: () => repo.updateSeriesGroups(id, moveIndex(groups, idx, idx + 1)) },
      {
        label: "删除分组（保留文章）",
        icon: <Trash2 size={14} />,
        danger: true,
        onSelect: async () => {
          if (await confirmDialog({ title: "删除分组", message: `分组“${g.title}”中的文章会移到未分组区域，文章本身不会被删除。`, okText: "删除分组" }))
            await repo.updateSeriesGroups(id, groups.filter((x) => x.id !== g.id));
        },
      },
    ];
  }

  const onMove = async (uid: string, sectionId: string | null, index: number) => {
    // Build the new reading sequence: remove the article, insert into target section at index.
    const target = sections.find((s) => s.id === sectionId)!;
    const without = seq.filter((a) => a.id !== uid);
    const targetUnits = target.units.filter((a) => a.id !== uid);
    const fromSameSection = target.units.some((a) => a.id === uid);
    const fromIndex = target.units.findIndex((a) => a.id === uid);
    const insertAt = fromSameSection && fromIndex < index ? index - 1 : index;
    const anchor = targetUnits[insertAt];
    const moved = seq.find((a) => a.id === uid)!;
    let order: SeriesArticle[];
    if (anchor) {
      const pos = without.findIndex((a) => a.id === anchor.id);
      order = [...without.slice(0, pos), moved, ...without.slice(pos)];
    } else {
      const last = targetUnits[targetUnits.length - 1];
      const pos = last ? without.findIndex((a) => a.id === last.id) + 1 : without.length;
      order = [...without.slice(0, pos), moved, ...without.slice(pos)];
    }
    await repo.placeSeriesArticle(id, uid, sectionId, order.map((a) => a.id));
  };

  const addArticle = async (groupId: string | null = null) => {
    const u = await repo.addUnit(id, { groupId });
    if (mode === "all" || mode === "preview") setMode("split");
    navigate(`/item/${id}/${u.id}`);
  };
  const addGroup = async () => {
    const t = await prompt({ title: "新建分组", label: "分卷 / 分部 / 专题名称", value: `第${groups.length + 1}部` });
    if (t) await repo.addSeriesGroup(id, t);
  };
  const importArticles = async () => {
    const files = await backend.platform.pickFiles("导入 Markdown 为系列文章", MD_FILTER, true);
    if (!files.length) return;
    const r = await withBusy("正在导入…", () => importMarkdownIntoItem(repo, id, [...files].sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }))));
    if (r) toast.success(`已导入 ${r.created.length} 篇`);
  };

  const showAll = mode === "all";

  return (
    <div className="lf-page lf-item-page">
      <ItemHeader
        item={item}
        tocOpen={tocOpen}
        onToggleToc={() => setTocOpen(!tocOpen)}
        center={
          <ModeSwitch<SeriesMode>
            value={mode}
            onChange={setMode}
            options={[
              { value: "preview", label: "阅读", icon: <BookOpen size={14} /> },
              { value: "all", label: "连续阅读", icon: <ScrollText size={14} />, title: "从第一篇开始连续阅读全部文章" },
              { value: "split", label: "分屏", icon: <Columns2 size={14} /> },
              { value: "edit", label: "编辑", icon: <PenLine size={14} /> },
            ]}
          />
        }
        exportItems={[
          ...(current
            ? [
                { label: "导出本篇 Markdown", icon: <FileText size={14} />, onSelect: () => runExport("导出 Markdown", () => exportMarkdown(id, { unitId: current.id })) },
                { label: "导出本篇 HTML", icon: <FileCode2 size={14} />, onSelect: () => runExport("导出 HTML", () => exportHtml(id, current.id)) },
                { label: "", separator: true },
              ]
            : []),
          { label: "整个系列：合并 Markdown", icon: <FileText size={14} />, onSelect: () => runExport("导出 Markdown", () => exportMarkdown(id, { merge: true })) },
          { label: "整个系列：带目录与前后篇导航的 HTML", icon: <Globe size={14} />, onSelect: () => runExport("导出系列 HTML", () => exportSeriesSite(id)) },
          { label: "整个系列：单页 HTML", icon: <FileCode2 size={14} />, onSelect: () => runExport("导出 HTML", () => exportHtml(id)) },
          { label: "整个系列：Word", icon: <FileDown size={14} />, onSelect: () => runExport("导出 Word", () => exportDocx(id)) },
          { label: "整个系列：排版并导出 PDF…", icon: <Printer size={14} />, onSelect: () => setPublish(true) },
        ]}
      />
      <div className="lf-item-body">
        <SidePanel
          title="系列目录"
          open={tocOpen}
          onClose={() => setTocOpen(false)}
          actions={
            <>
              <button className="lf-icon-btn" onClick={importArticles} title="导入 Markdown" aria-label="导入文章">
                <Upload size={15} />
              </button>
              <button className="lf-icon-btn" onClick={addGroup} title="新建分组（分卷 / 分部）" aria-label="新建分组">
                <FolderPlus size={15} />
              </button>
              <button className="lf-icon-btn" onClick={() => addArticle(current?.groupId ?? null)} title="新建文章" aria-label="新建文章">
                <Plus size={16} />
              </button>
            </>
          }
          footer={<span className="muted">共 {seq.length} 篇 · 拖动调整顺序</span>}
        >
          <button className={`lf-blog-home ${!current ? "active" : ""}`} onClick={() => navigate(`/item/${id}`)}>
            <Home size={14} /> 系列首页
          </button>
          <UnitTree
            sections={sections}
            activeId={current?.id}
            onOpen={(u) => navigate(`/item/${id}/${u.id}`)}
            onMove={(u, s, i) => void onMove(u, s, i)}
            menuFor={(u) => unitMenu(item, u, navigate, { onMarks: () => setMarks({ anchor: document.querySelector(".lf-tree-row.active") as HTMLElement, targets: [{ kind: "unit", itemId: id, unitId: u.id }] }) })}
            renderMeta={(u) => <span className="lf-tree-num">{seq.findIndex((a) => a.id === u.id) + 1}</span>}
            emptyHint="还没有文章"
          />
        </SidePanel>
        <div className="lf-item-main">
          {showAll ? (
            <ContinuousReader itemId={id} articles={seq} groups={groups} title={m.title} />
          ) : current && nav ? (
            <TextWorkbench
              key={current.id}
              itemId={id}
              unitId={current.id}
              mode={mode as TextMode}
              onOutline={onOutline}
              readerClass="series"
              previewHeader={
                <div className="lf-series-head">
                  <span>{m.title}</span>
                  {nav.group && <span>· {nav.group.title}</span>}
                  <span className="lf-series-pos">
                    第 {nav.index + 1} / {nav.total} 篇
                  </span>
                  <StatusBadge statusId={current.statusId} />
                </div>
              }
              previewFooter={
                <nav className="lf-pager">
                  {nav.prev ? (
                    <button onClick={() => navigate(`/item/${id}/${nav.prev!.id}`)}>
                      <ChevronLeft size={14} /> 上一篇：{nav.prev.title}
                    </button>
                  ) : (
                    <span />
                  )}
                  {nav.next ? (
                    <button onClick={() => navigate(`/item/${id}/${nav.next!.id}`)}>
                      下一篇：{nav.next.title} <ChevronRight size={14} />
                    </button>
                  ) : (
                    <span className="muted">— 系列完 —</span>
                  )}
                </nav>
              }
            />
          ) : (
            <div className="lf-scroll">
              <div className="lf-series-index">
                <h1>{m.title}</h1>
                {m.summary && <p className="muted">{m.summary}</p>}
                <div className="lf-blog-index-actions">
                  {seq[0] && (
                    <button className="lf-btn primary" onClick={() => (setMode("preview"), navigate(`/item/${id}/${seq[0].id}`))}>
                      <BookOpen size={14} /> 从第一篇开始阅读
                    </button>
                  )}
                  <button className="lf-btn" onClick={() => addArticle(null)}>
                    <Plus size={14} /> 新建文章
                  </button>
                </div>
                {!seq.length ? (
                  <EmptyState title="还没有文章" hint="系列文章按你设定的顺序阅读，与创建时间或发布日期无关。" />
                ) : (
                  sections.map((s) =>
                    s.units.length || s.title ? (
                      <section key={s.id ?? "root"}>
                        {s.title && <h2>{s.title}</h2>}
                        <ol start={seq.findIndex((a) => a.id === s.units[0]?.id) + 1 || undefined}>
                          {s.units.map((a) => (
                            <li key={a.id}>
                              <button className="lf-link-btn" onClick={() => (setMode("preview"), navigate(`/item/${id}/${a.id}`))}>
                                {a.title}
                              </button>
                              <StatusBadge statusId={a.statusId} compact />
                            </li>
                          ))}
                        </ol>
                      </section>
                    ) : null,
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <MarksPopover anchor={marks?.anchor ?? null} targets={marks?.targets ?? null} onClose={() => setMarks(null)} />
      {publish && <PublishDialog item={item} onClose={() => setPublish(false)} />}
    </div>
  );
}

function ContinuousReader({ itemId, articles, groups, title }: { itemId: string; articles: SeriesArticle[]; groups: SeriesGroup[]; title: string }) {
  const it = repo.requireItem(itemId);
  const [texts, setTexts] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<string, string> = {};
      for (const a of articles) out[a.id] = await repo.fs.readText(joinRel(it.dir, a.path)).catch(() => "");
      if (alive) setTexts(out);
    })();
    return () => {
      alive = false;
    };
  }, [articles, it.dir]);
  if (!texts) return <div className="lf-loading" />;
  let lastGroup: string | null | undefined = undefined;
  return (
    <div className="lf-scroll">
      <div className="lf-reading series">
        <div className="lf-series-head">
          <span>{title}</span>
          <span className="lf-series-pos">连续阅读 · 共 {articles.length} 篇</span>
        </div>
        {articles.map((a, i) => {
          const g = a.groupId ?? null;
          const showGroup = g !== lastGroup && g;
          lastGroup = g;
          return (
            <article key={a.id} className="lf-continuous-article">
              {showGroup && <div className="lf-continuous-group">{groups.find((x) => x.id === g)?.title}</div>}
              <div className="lf-continuous-num">第 {i + 1} 篇</div>
              <MarkdownView text={texts[a.id] ?? ""} filePath={joinRel(it.dir, a.path)} scopeDir={it.dir} />
            </article>
          );
        })}
      </div>
    </div>
  );
}
