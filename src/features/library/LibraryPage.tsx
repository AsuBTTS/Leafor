import { useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LayoutGrid, List, Plus, Search, MoreHorizontal, FolderPlus, Upload, BookOpen, ListOrdered, Newspaper, Images, FileText, FileType2, FileInput, Tags as TagsIcon } from "lucide-react";
import { useRepo, usePref } from "@/app/store";
import { TopBar } from "@/components/navigation/Chrome";
import { Cover } from "@/components/Cover";
import { StatusBadge, TagChips, MarksPopover } from "@/components/marks/Marks";
import { MenuButton, useContextMenu, type MenuItem } from "@/components/forms/Popover";
import { EmptyState } from "@/components/feedback/Overlays";
import { ITEM_TYPES, ITEM_TYPE_LABEL, type ItemType, type LoadedItem, type TargetRef } from "@/domain/models/types";
import { getUnits } from "@/domain/policies/units";
import { createCollectionFlow, createItemFlow, importFlow, itemMenu } from "./actions";
import { PropertiesDialog } from "./PropertiesDialog";
import { useDocxImport } from "./DocxImportDialog";
import { moveIndex } from "@/domain/policies/units";

export function LibraryPage() {
  const repo = useRepo();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const collectionId = params.get("c");
  const typeFilter = (params.get("t") as ItemType | null) ?? null;
  const [view, setView] = usePref<"grid" | "list">("library.view", "grid");
  const [q, setQ] = useState("");
  const [props, setProps] = useState<string | null>(null);
  const [marks, setMarks] = useState<{ anchor: HTMLElement | null; targets: TargetRef[] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ctx = useContextMenu();
  const docx = useDocxImport();
  const dragId = useRef<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const all = repo.orderedItems(collectionId).filter((i) => !i.meta.archived);
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((i) => {
      if (typeFilter && i.meta.type !== typeFilter) return false;
      if (!needle) return true;
      const tags = i.meta.tagIds.map((t) => repo.tag(t)?.name ?? "").join(" ");
      return (i.meta.title + " " + (i.meta.summary ?? "") + " " + tags + " " + (i.meta.author ?? "")).toLowerCase().includes(needle);
    });
  }, [all, typeFilter, q, repo]);

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const canReorder = !!collectionId && !typeFilter && !q.trim();
  const onDrop = async (index: number) => {
    const id = dragId.current;
    dragId.current = null;
    setDropIndex(null);
    if (!id || !collectionId) return;
    const ids = all.map((i) => i.meta.id);
    const from = ids.indexOf(id);
    if (from < 0) return;
    await repo.reorderItems(collectionId, moveIndex(ids, from, index > from ? index - 1 : index));
  };

  const newItems: MenuItem[] = [
    { label: "新建集合", icon: <FolderPlus size={14} />, onSelect: async () => { const id = await createCollectionFlow(); if (id) setParam("c", id); } },
    { separator: true, label: "" },
    { label: "图书", icon: <BookOpen size={14} />, onSelect: () => createItemFlow("book", collectionId, navigate) },
    { label: "系列文章", icon: <ListOrdered size={14} />, onSelect: () => createItemFlow("article_series", collectionId, navigate) },
    { label: "博客集", icon: <Newspaper size={14} />, onSelect: () => createItemFlow("blog", collectionId, navigate) },
    { label: "摄影集", icon: <Images size={14} />, onSelect: () => createItemFlow("photo_album", collectionId, navigate) },
    { label: "纯文本", icon: <FileText size={14} />, onSelect: () => createItemFlow("document", collectionId, navigate) },
    { separator: true, label: "" },
    { label: "导入 Markdown…", icon: <Upload size={14} />, onSelect: () => importFlow("markdown", collectionId, navigate) },
    { label: "导入 Word（DOCX）…", icon: <FileInput size={14} />, onSelect: () => importFlow("docx", collectionId, navigate, docx) },
    { label: "导入照片…", icon: <Images size={14} />, onSelect: () => importFlow("photos", collectionId, navigate) },
    { label: "导入 PDF（只读）…", icon: <FileType2 size={14} />, onSelect: () => importFlow("pdf", collectionId, navigate) },
  ];

  const menuFor = (it: LoadedItem, el?: HTMLElement | null) =>
    itemMenu(it, navigate, {
      onProps: () => setProps(it.meta.id),
      onMarks: () => setMarks({ anchor: el ?? document.querySelector(`[data-item="${it.meta.id}"]`), targets: selected.has(it.meta.id) && selected.size > 1 ? [...selected].map((id) => ({ kind: "item", itemId: id })) : [{ kind: "item", itemId: it.meta.id }] }),
    });

  const onCardClick = (e: React.MouseEvent, it: LoadedItem) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
      const s = new Set(selected);
      if (s.has(it.meta.id)) s.delete(it.meta.id);
      else s.add(it.meta.id);
      setSelected(s);
      return;
    }
    navigate(`/item/${it.meta.id}`);
  };

  const collection = collectionId ? repo.collections.get(collectionId) : null;
  const total = repo.orderedItems().filter((i) => !i.meta.archived).length;

  return (
    <div className="lf-page">
      <TopBar
        left={
          <div className="lf-page-title">
            <h1>{collection ? collection.meta.title : "作品库"}</h1>
            <span className="lf-count">{collection ? `${items.length} 项` : `${total} 项`}</span>
          </div>
        }
        center={
          <label className="lf-search">
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="筛选作品、标签…（Ctrl+K 全局搜索）" onKeyDown={(e) => e.key === "Enter" && q.trim() && navigate(`/search?q=${encodeURIComponent(q.trim())}`)} />
          </label>
        }
        right={
          <>
            <div className="lf-seg-icons" role="group" aria-label="视图">
              <button className={view === "grid" ? "on" : ""} onClick={() => setView("grid")} aria-label="网格视图" title="网格视图">
                <LayoutGrid size={16} />
              </button>
              <button className={view === "list" ? "on" : ""} onClick={() => setView("list")} aria-label="列表视图" title="列表视图">
                <List size={17} />
              </button>
            </div>
            <MenuButton items={newItems} className="lf-btn primary" title="新建或导入">
              <Plus size={16} /> 新建
            </MenuButton>
          </>
        }
      />

      <div className="lf-filterbar">
        <div className="lf-collection-chips" role="tablist" aria-label="集合">
          <button className={`lf-cchip ${!collectionId ? "on" : ""}`} onClick={() => setParam("c", null)}>
            全部集合
          </button>
          {repo.orderedCollections().map((c) => (
            <button key={c.meta.id} className={`lf-cchip ${collectionId === c.meta.id ? "on" : ""}`} onClick={() => setParam("c", c.meta.id)}>
              {c.meta.title}
              <small>{c.meta.itemIds.filter((id) => !repo.getItem(id)?.meta.archived).length}</small>
            </button>
          ))}
          <button className="lf-cchip add" onClick={async () => { const id = await createCollectionFlow(); if (id) setParam("c", id); }} title="新建集合" aria-label="新建集合">
            <Plus size={13} />
          </button>
        </div>
        <div className="lf-type-tabs" role="tablist" aria-label="类型">
          <button className={!typeFilter ? "on" : ""} onClick={() => setParam("t", null)}>
            全部
          </button>
          {ITEM_TYPES.map((t) => (
            <button key={t} className={typeFilter === t ? "on" : ""} onClick={() => setParam("t", t)}>
              {ITEM_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="lf-selection-bar">
          已选择 {selected.size} 项
          <button className="lf-btn small" onClick={(e) => setMarks({ anchor: e.currentTarget, targets: [...selected].map((id) => ({ kind: "item", itemId: id })) })}>
            <TagsIcon size={14} /> 批量设置状态与标签
          </button>
          <button className="lf-link-btn" onClick={() => setSelected(new Set())}>
            取消选择
          </button>
        </div>
      )}

      <div className="lf-scroll">
        {items.length === 0 ? (
          repo.collections.size === 0 ? (
            <EmptyState title="作品库还是空的" hint="先新建一个集合（如“文学作品”“摄影作品”），再在其中创建图书、摄影集、博客集等作品，或直接导入已有文件。">
              <button className="lf-btn primary" onClick={createCollectionFlow}>
                <FolderPlus size={15} /> 新建集合
              </button>
              <MenuButton items={newItems.slice(8)} className="lf-btn" placement="bottom-start">
                <Upload size={15} /> 导入作品
              </MenuButton>
            </EmptyState>
          ) : (
            <EmptyState title={q || typeFilter ? "没有符合条件的作品" : "这个集合还没有作品"} hint="使用右上角“新建”创建作品或导入文件。">
              <MenuButton items={newItems.slice(2)} className="lf-btn primary" placement="bottom-start">
                <Plus size={15} /> 新建或导入
              </MenuButton>
            </EmptyState>
          )
        ) : view === "grid" ? (
          <div className="lf-grid" onDragOver={(e) => canReorder && e.preventDefault()}>
            {items.map((it, i) => (
              <div
                key={it.meta.id}
                data-item={it.meta.id}
                className={`lf-card ${selected.has(it.meta.id) ? "selected" : ""} ${dropIndex === i ? "drop-before" : ""}`}
                draggable={canReorder}
                onDragStart={(e) => {
                  dragId.current = it.meta.id;
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (!canReorder || !dragId.current) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  setDropIndex(e.clientX > r.left + r.width / 2 ? i + 1 : i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  void onDrop(dropIndex ?? i);
                }}
                onDragEnd={() => setDropIndex(null)}
                onContextMenu={(e) => ctx.open(e, menuFor(it, e.currentTarget as HTMLElement))}
              >
                <button className="lf-card-cover" onClick={(e) => onCardClick(e, it)} aria-label={`打开 ${it.meta.title}`}>
                  <Cover item={it} />
                  {it.meta.statusId && (
                    <span className="lf-card-status">
                      <StatusBadge statusId={it.meta.statusId} />
                    </span>
                  )}
                </button>
                <div className="lf-card-meta">
                  <div className="lf-card-text" onClick={(e) => onCardClick(e, it)}>
                    <div className="lf-card-title" title={it.meta.title}>
                      {it.meta.title}
                    </div>
                    <div className="lf-card-type">{ITEM_TYPE_LABEL[it.meta.type]}</div>
                  </div>
                  <MenuButton items={() => menuFor(it)} title="更多操作" className="lf-icon-btn lf-card-more">
                    <MoreHorizontal size={16} />
                  </MenuButton>
                </div>
              </div>
            ))}
            {canReorder && dropIndex === items.length && <div className="lf-card-dropend" />}
          </div>
        ) : (
          <table className="lf-table">
            <thead>
              <tr>
                <th style={{ width: 46 }} />
                <th>标题</th>
                <th>类型</th>
                <th>集合</th>
                <th>内容</th>
                <th>状态</th>
                <th>标签</th>
                <th>修改时间</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.meta.id} data-item={it.meta.id} className={selected.has(it.meta.id) ? "selected" : ""} onClick={(e) => onCardClick(e, it)} onContextMenu={(e) => ctx.open(e, menuFor(it, e.currentTarget as HTMLElement))}>
                  <td>
                    <div className="lf-thumb-cover">
                      <Cover item={it} size="sm" />
                    </div>
                  </td>
                  <td className="lf-td-title">{it.meta.title}</td>
                  <td>{ITEM_TYPE_LABEL[it.meta.type]}</td>
                  <td className="muted">{repo.collections.get(it.collectionId)?.meta.title}</td>
                  <td className="muted">{it.meta.type === "pdf" ? `${it.meta.data.pageCount ?? "?"} 页` : `${getUnits(it.meta).length} 项`}</td>
                  <td>
                    <StatusBadge statusId={it.meta.statusId} />
                  </td>
                  <td>
                    <TagChips tagIds={it.meta.tagIds} max={3} />
                  </td>
                  <td className="muted">{new Date(it.meta.updatedAt).toLocaleDateString()}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <MenuButton items={() => menuFor(it)} title="更多操作">
                      <MoreHorizontal size={16} />
                    </MenuButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {ctx.node}
      {docx.node}
      {props && <PropertiesDialog itemId={props} onClose={() => setProps(null)} />}
      <MarksPopover anchor={marks?.anchor ?? null} targets={marks?.targets ?? null} onClose={() => setMarks(null)} />
    </div>
  );
}
