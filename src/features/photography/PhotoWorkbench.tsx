import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ImagePlus, X, ChevronLeft, ChevronRight, Maximize2, Minimize2, Tags, Trash2, ExternalLink, RefreshCw, Download, CheckSquare, Square, Info, Star } from "lucide-react";
import type { WorkbenchProps } from "@/features/library/ItemPage";
import { ItemHeader } from "@/features/library/ItemHeader";
import { SidePanel, useTocOpen } from "@/components/navigation/SidePanel";
import { MarksPanel, MarksPopover, StatusBadge, TagChips } from "@/components/marks/Marks";
import { useContextMenu } from "@/components/forms/Popover";
import { repo, backend } from "@/app/backend";
import { confirmDialog, toast, withBusy, usePref, useRepo } from "@/app/store";
import { getUnits, moveIndex } from "@/domain/policies/units";
import type { Item, Photo, TargetRef } from "@/domain/models/types";
import { DISPLAYABLE_IMAGE_EXTS, extOf, joinRel } from "@/domain/policies/naming";
import { importPhotosIntoAlbum, replacePhotoFile } from "@/services/import-export/importService";
import { exportPhotos } from "@/services/import-export/exportService";
import { runExport } from "@/features/library/unitActions";
import { IMG_FILTER } from "@/features/library/actions";
import { thumbnailUrl, useThumbVersion } from "@/services/content/thumbnails";
import { EmptyState } from "@/components/feedback/Overlays";

function fmtBytes(n?: number) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const EXIF_LABEL: Record<string, string> = { Make: "相机品牌", Model: "相机型号", LensModel: "镜头", FNumber: "光圈", ExposureTime: "快门", ISO: "ISO", FocalLength: "焦距", DateTimeOriginal: "拍摄时间" };
function fmtExif(k: string, v: string | number) {
  if (k === "FNumber") return `f/${v}`;
  if (k === "ExposureTime" && typeof v === "number") return v < 1 ? `1/${Math.round(1 / v)} s` : `${v} s`;
  if (k === "FocalLength") return `${v} mm`;
  if (k === "DateTimeOriginal") return new Date(String(v)).toLocaleString();
  return String(v);
}

export function PhotoWorkbench({ item, unitId }: WorkbenchProps) {
  useRepo();
  useThumbVersion();
  const navigate = useNavigate();
  const [tocOpen, setTocOpen] = useTocOpen("photos");
  const [size, setSize] = usePref<number>("photos.size", 200);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [marks, setMarks] = useState<{ anchor: HTMLElement | null; targets: TargetRef[] } | null>(null);
  const [drop, setDrop] = useState<number | null>(null);
  const drag = useRef<string | null>(null);
  const ctx = useContextMenu();
  const photos = (item.meta.type === "photo_album" ? getUnits(item.meta) : []) as Photo[];
  const id = item.meta.id;
  const visible = useMemo(() => photos.filter((p) => (!statusFilter || p.statusId === statusFilter) && (!tagFilter || p.tagIds.includes(tagFilter))), [photos, statusFilter, tagFilter]);
  const focusIndex = visible.findIndex((p) => p.id === unitId);
  const focus = focusIndex >= 0 ? visible[focusIndex] : undefined;
  const reorderable = !statusFilter && !tagFilter;

  if (item.meta.type !== "photo_album") return null;

  const importPhotos = async () => {
    const files = await backend.platform.pickFiles("导入照片（复制到摄影集，原文件不变）", IMG_FILTER, true);
    if (!files.length) return;
    const r = await withBusy(`正在导入 ${files.length} 张照片…`, () => importPhotosIntoAlbum(repo, id, files));
    if (r) r.warnings.length ? toast.warning(r.warnings.join("；")) : toast.success(`已导入 ${r.created.length} 张照片`);
  };

  const trashPhotos = async (ids: string[]) => {
    const ok = await confirmDialog({ title: "移除照片", message: `${ids.length} 张照片将移入作品库回收站（可恢复），不会永久删除文件。`, okText: "移到回收站", danger: true });
    if (!ok) return;
    for (const u of ids) await repo.deleteUnit(id, u);
    setSelected(new Set());
    if (unitId && ids.includes(unitId)) navigate(`/item/${id}`);
  };

  const toggleSel = (pid: string) => {
    const s = new Set(selected);
    s.has(pid) ? s.delete(pid) : s.add(pid);
    setSelected(s);
  };

  const onDropAt = async (index: number) => {
    const d = drag.current;
    drag.current = null;
    setDrop(null);
    if (!d) return;
    const ids = photos.map((p) => p.id);
    const from = ids.indexOf(d);
    await repo.reorderUnits(id, moveIndex(ids, from, index > from ? index - 1 : index));
  };

  const statusCounts = repo.orderedStatuses().map((s) => ({ s, n: photos.filter((p) => p.statusId === s.id).length })).filter((x) => x.n > 0);
  const usedTags = [...new Set(photos.flatMap((p) => p.tagIds))];

  const photoMenu = (p: Photo, el: HTMLElement) => [
    { label: "查看", icon: <Maximize2 size={14} />, onSelect: () => navigate(`/item/${id}/${p.id}`) },
    { label: "状态与标签", icon: <Tags size={14} />, onSelect: () => setMarks({ anchor: el, targets: (selected.has(p.id) && selected.size > 1 ? [...selected] : [p.id]).map((u) => ({ kind: "unit" as const, itemId: id, unitId: u })) }) },
    { label: "设为封面", icon: <Star size={14} />, onSelect: () => repo.updateItem(id, { coverPath: p.path } as Partial<Item>) },
    { label: "在系统中打开（外部修图）", icon: <ExternalLink size={14} />, onSelect: () => backend.platform.openInSystem(joinRel(item.dir, p.path)).catch(toast.error) },
    { label: "", separator: true },
    { label: "移到回收站", icon: <Trash2 size={14} />, danger: true, onSelect: () => trashPhotos(selected.has(p.id) && selected.size > 1 ? [...selected] : [p.id]) },
  ];

  return (
    <div className="lf-page lf-item-page">
      <ItemHeader
        item={item}
        tocOpen={tocOpen}
        onToggleToc={() => setTocOpen(!tocOpen)}
        right={
          <>
            <input className="lf-size-slider" type="range" min={120} max={360} step={20} value={size} onChange={(e) => setSize(Number(e.target.value))} title="缩略图大小" aria-label="缩略图大小" />
            <button className="lf-btn small" onClick={importPhotos}>
              <ImagePlus size={14} /> 导入照片
            </button>
          </>
        }
        exportItems={[
          { label: "导出全部原图", icon: <Download size={14} />, onSelect: () => runExport("导出照片", () => exportPhotos(id)) },
          ...(selected.size ? [{ label: `导出所选 ${selected.size} 张`, icon: <Download size={14} />, onSelect: () => runExport("导出照片", () => exportPhotos(id, [...selected])) }] : []),
        ]}
      />
      <div className="lf-item-body">
        <SidePanel title="照片" open={tocOpen} onClose={() => setTocOpen(false)} footer={<span className="muted">{photos.length} 张</span>}>
          <div className="lf-photo-filters">
            <button className={`lf-filter-row ${!statusFilter && !tagFilter ? "on" : ""}`} onClick={() => (setStatusFilter(null), setTagFilter(null))}>
              全部照片 <small>{photos.length}</small>
            </button>
            {statusCounts.length > 0 && <h4>按状态</h4>}
            {statusCounts.map(({ s, n }) => (
              <button key={s.id} className={`lf-filter-row ${statusFilter === s.id ? "on" : ""}`} onClick={() => setStatusFilter(statusFilter === s.id ? null : s.id)}>
                <i className="lf-status-dot" style={{ background: s.color }} /> {s.name} <small>{n}</small>
              </button>
            ))}
            {usedTags.length > 0 && <h4>按标签</h4>}
            {usedTags.map((t) => (
              <button key={t} className={`lf-filter-row ${tagFilter === t ? "on" : ""}`} onClick={() => setTagFilter(tagFilter === t ? null : t)}>
                # {repo.tag(t)?.name ?? t} <small>{photos.filter((p) => p.tagIds.includes(t)).length}</small>
              </button>
            ))}
            <h4>列表</h4>
            {visible.map((p) => (
              <button key={p.id} className={`lf-filter-row photo ${p.id === unitId ? "on" : ""}`} onClick={() => navigate(`/item/${id}/${p.id}`)} title={p.title}>
                {p.title}
              </button>
            ))}
          </div>
        </SidePanel>
        <div className="lf-item-main">
          {selected.size > 0 && (
            <div className="lf-selection-bar">
              已选择 {selected.size} 张
              <button className="lf-btn small" onClick={(e) => setMarks({ anchor: e.currentTarget, targets: [...selected].map((u) => ({ kind: "unit", itemId: id, unitId: u })) })}>
                <Tags size={14} /> 批量状态与标签
              </button>
              <button className="lf-btn small" onClick={() => trashPhotos([...selected])}>
                <Trash2 size={14} /> 移到回收站
              </button>
              <button className="lf-link-btn" onClick={() => setSelected(new Set(visible.map((p) => p.id)))}>
                全选
              </button>
              <button className="lf-link-btn" onClick={() => setSelected(new Set())}>
                取消
              </button>
            </div>
          )}
          <div className="lf-scroll">
            {!photos.length ? (
              <EmptyState title="摄影集还是空的" hint="导入照片后可以排序、填写标题与说明，并用状态（如“待P图”）管理修图进度。Leafor 不会修改原图。">
                <button className="lf-btn primary" onClick={importPhotos}>
                  <ImagePlus size={15} /> 导入照片
                </button>
              </EmptyState>
            ) : (
              <div className="lf-photo-grid" style={{ ["--tile" as string]: `${size}px` }}>
                {visible.map((p, i) => {
                  const displayable = DISPLAYABLE_IMAGE_EXTS.includes(extOf(p.path));
                  return (
                    <div
                      key={p.id}
                      className={`lf-photo-tile ${selected.has(p.id) ? "selected" : ""} ${drop === i ? "drop-before" : ""}`}
                      draggable={reorderable}
                      onDragStart={(e) => {
                        drag.current = p.id;
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => {
                        if (!drag.current) return;
                        e.preventDefault();
                        const r = e.currentTarget.getBoundingClientRect();
                        setDrop(e.clientX > r.left + r.width / 2 ? i + 1 : i);
                      }}
                      onDrop={(e) => (e.preventDefault(), void onDropAt(drop ?? i))}
                      onDragEnd={() => setDrop(null)}
                      onClick={(e) => (e.ctrlKey || e.metaKey || e.shiftKey ? toggleSel(p.id) : navigate(`/item/${id}/${p.id}`))}
                      onContextMenu={(e) => ctx.open(e, photoMenu(p, e.currentTarget as HTMLElement))}
                    >
                      <div className="lf-photo-img">
                        {displayable ? <img src={thumbnailUrl(joinRel(item.dir, p.path), p.updatedAt, 480)} alt={p.title} loading="lazy" draggable={false} /> : <span className="lf-photo-noprev">{extOf(p.path).toUpperCase()} 无法预览</span>}
                        <button className="lf-photo-check" onClick={(e) => (e.stopPropagation(), toggleSel(p.id))} aria-label="选择">
                          {selected.has(p.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                        </button>
                        {p.statusId && (
                          <span className="lf-photo-status">
                            <StatusBadge statusId={p.statusId} />
                          </span>
                        )}
                      </div>
                      <div className="lf-photo-cap">
                        <span>{p.title}</span>
                        <TagChips tagIds={p.tagIds} max={2} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      {focus && <Lightbox itemDir={item.dir} itemId={id} photo={focus} index={focusIndex} total={visible.length} onNav={(d) => navigate(`/item/${id}/${visible[(focusIndex + d + visible.length) % visible.length].id}`, { replace: true })} onClose={() => navigate(`/item/${id}`)} />}
      {ctx.node}
      <MarksPopover anchor={marks?.anchor ?? null} targets={marks?.targets ?? null} onClose={() => setMarks(null)} />
    </div>
  );
}

function Lightbox({ itemDir, itemId, photo, index, total, onNav, onClose }: { itemDir: string; itemId: string; photo: Photo; index: number; total: number; onNav: (d: number) => void; onClose: () => void }) {
  const [info, setInfo] = usePref<boolean>("photos.info", true);
  const [full, setFull] = useState(false);
  const [title, setTitle] = useState(photo.title);
  const [caption, setCaption] = useState(photo.caption ?? "");
  const [notes, setNotes] = useState(photo.notes ?? "");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setTitle(photo.title);
    setCaption(photo.caption ?? "");
    setNotes(photo.notes ?? "");
  }, [photo.id, photo.title, photo.caption, photo.notes]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") onNav(1);
      if (e.key === "ArrowLeft") onNav(-1);
      if (e.key === "Escape") full ? toggleFull() : onClose();
      if (e.key.toLowerCase() === "f") toggleFull();
      if (e.key.toLowerCase() === "i") setInfo(!info);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const toggleFull = async () => {
    const next = !full;
    setFull(next);
    await backend.platform.window.setFullscreen(next).catch(() => undefined);
  };
  useEffect(() => () => void backend.platform.window.setFullscreen(false).catch(() => undefined), []);

  const save = (patch: Partial<Photo>) => repo.updateUnit(itemId, photo.id, patch as never);
  const rel = joinRel(itemDir, photo.path);
  const displayable = DISPLAYABLE_IMAGE_EXTS.includes(extOf(photo.path));
  const replace = async () => {
    const f = await backend.platform.pickFiles("选择修图后的新版本（旧文件移入回收站）", IMG_FILTER, false);
    if (f[0]) await withBusy("正在替换…", () => replacePhotoFile(repo, itemId, photo.id, f[0]));
  };

  return (
    <div className={`lf-lightbox ${full ? "full" : ""}`} ref={box}>
      <div className="lf-lightbox-stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="lf-lightbox-top">
          <span>
            {index + 1} / {total} · {photo.title}
          </span>
          <span className="lf-lightbox-tools">
            <button className={`lf-icon-btn light ${info ? "on" : ""}`} onClick={() => setInfo(!info)} title="信息（I）" aria-label="信息">
              <Info size={17} />
            </button>
            <button className="lf-icon-btn light" onClick={toggleFull} title="全屏（F）" aria-label="全屏">
              {full ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </button>
            <button className="lf-icon-btn light" onClick={onClose} title="关闭（Esc）" aria-label="关闭">
              <X size={18} />
            </button>
          </span>
        </div>
        {displayable ? <img src={repo.fs.assetUrl(rel, photo.updatedAt)} alt={photo.title} /> : <div className="lf-photo-noprev big">此格式（{extOf(photo.path).toUpperCase()}）无法在应用内预览，可用系统程序打开。</div>}
        <button className="lf-lightbox-nav left" onClick={() => onNav(-1)} aria-label="上一张">
          <ChevronLeft size={30} />
        </button>
        <button className="lf-lightbox-nav right" onClick={() => onNav(1)} aria-label="下一张">
          <ChevronRight size={30} />
        </button>
        {photo.caption && !info && <div className="lf-lightbox-caption">{photo.caption}</div>}
      </div>
      {info && !full && (
        <aside className="lf-lightbox-info">
          <label className="lf-field">
            <span>标题</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== photo.title && save({ title: title.trim() })} />
          </label>
          <label className="lf-field">
            <span>说明</span>
            <textarea rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} onBlur={() => caption !== (photo.caption ?? "") && save({ caption })} />
          </label>
          <label className="lf-field">
            <span>备注</span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (photo.notes ?? "") && save({ notes })} />
          </label>
          <MarksPanel targets={[{ kind: "unit", itemId, unitId: photo.id }]} />
          <dl className="lf-props-meta">
            <dt>文件</dt>
            <dd className="mono">{photo.path}</dd>
            <dt>尺寸</dt>
            <dd>{photo.width && photo.height ? `${photo.width} × ${photo.height}` : "—"}</dd>
            <dt>格式</dt>
            <dd>{photo.format ?? extOf(photo.path).toUpperCase()}</dd>
            <dt>大小</dt>
            <dd>{fmtBytes(photo.bytes)}</dd>
            {Object.entries(photo.exif ?? {}).map(([k, v]) =>
              EXIF_LABEL[k] ? (
                <span key={k} style={{ display: "contents" }}>
                  <dt>{EXIF_LABEL[k]}</dt>
                  <dd>{fmtExif(k, v)}</dd>
                </span>
              ) : null,
            )}
          </dl>
          <div className="lf-lightbox-actions">
            <button className="lf-btn small" onClick={() => backend.platform.openInSystem(rel).catch(toast.error)}>
              <ExternalLink size={14} /> 用系统程序打开
            </button>
            <button className="lf-btn small" onClick={replace}>
              <RefreshCw size={14} /> 替换为修图后的版本
            </button>
          </div>
          <p className="lf-note">Leafor 不内置修图。“待P图”等状态只用于管理进度，标记不会改动图片文件。</p>
        </aside>
      )}
    </div>
  );
}
