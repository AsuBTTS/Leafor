import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderPlus, MoreHorizontal, Pencil, Trash2, ArrowUp, ArrowDown, FolderSearch, Tags } from "lucide-react";
import { useRepo, prompt, confirmDialog, toast, withBusy } from "@/app/store";
import { backend } from "@/app/backend";
import { TopBar } from "@/components/navigation/Chrome";
import { Cover } from "@/components/Cover";
import { MenuButton } from "@/components/forms/Popover";
import { EmptyState } from "@/components/feedback/Overlays";
import { MarksPopover, TagChips } from "@/components/marks/Marks";
import { createCollectionFlow } from "@/features/library/actions";
import { moveIndex } from "@/domain/policies/units";
import { ITEM_TYPE_LABEL, type TargetRef } from "@/domain/models/types";

export function CollectionsPage() {
  const repo = useRepo();
  const navigate = useNavigate();
  const cols = repo.orderedCollections();
  const drag = useRef<string | null>(null);
  const [marks, setMarks] = useState<{ anchor: HTMLElement | null; targets: TargetRef[] } | null>(null);

  const reorder = async (from: number, to: number) => {
    await repo.reorderCollections(moveIndex(cols.map((c) => c.meta.id), from, to));
  };

  return (
    <div className="lf-page">
      <TopBar
        left={
          <div className="lf-page-title">
            <h1>集合</h1>
            <span className="lf-count">{cols.length} 个</span>
          </div>
        }
        right={
          <button className="lf-btn primary" onClick={createCollectionFlow}>
            <FolderPlus size={15} /> 新建集合
          </button>
        }
      />
      <div className="lf-scroll">
        {!cols.length ? (
          <EmptyState title="还没有集合" hint="集合用来组织作品，例如“文学作品”“摄影作品”。一个集合里可以混合放入不同类型的单品。">
            <button className="lf-btn primary" onClick={createCollectionFlow}>
              <FolderPlus size={15} /> 新建集合
            </button>
          </EmptyState>
        ) : (
          <div className="lf-collections">
            {cols.map((c, i) => {
              const items = c.meta.itemIds.map((id) => repo.getItem(id)).filter(Boolean).filter((x) => !x!.meta.archived);
              const types = [...new Set(items.map((x) => ITEM_TYPE_LABEL[x!.meta.type]))];
              return (
                <div
                  key={c.meta.id}
                  className="lf-collection-card"
                  draggable
                  onDragStart={() => (drag.current = c.meta.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    const from = cols.findIndex((x) => x.meta.id === drag.current);
                    if (from >= 0 && from !== i) void reorder(from, i);
                    drag.current = null;
                  }}
                >
                  <button className="lf-collection-covers" onClick={() => navigate(`/?c=${c.meta.id}`)} aria-label={`打开集合 ${c.meta.title}`}>
                    {items.slice(0, 4).map((x) => (
                      <Cover key={x!.meta.id} item={x!} size="sm" />
                    ))}
                    {!items.length && <span className="lf-collection-empty">空集合</span>}
                  </button>
                  <div className="lf-collection-meta">
                    <div>
                      <h3 onClick={() => navigate(`/?c=${c.meta.id}`)}>{c.meta.title}</h3>
                      <small>
                        {items.length} 项{types.length ? ` · ${types.join("、")}` : ""}
                      </small>
                      <TagChips tagIds={c.meta.tagIds ?? []} />
                    </div>
                    <MenuButton
                      title="集合操作"
                      items={[
                        {
                          label: "重命名",
                          icon: <Pencil size={14} />,
                          onSelect: async () => {
                            const t = await prompt({ title: "重命名集合", value: c.meta.title });
                            if (t) await repo.updateCollection(c.meta.id, { title: t });
                          },
                        },
                        {
                          label: "描述",
                          icon: <Pencil size={14} />,
                          onSelect: async () => {
                            const t = await prompt({ title: "集合描述", value: c.meta.summary ?? "", multiline: true });
                            if (t !== null) await repo.updateCollection(c.meta.id, { summary: t });
                          },
                        },
                        { label: "标签", icon: <Tags size={14} />, onSelect: () => setMarks({ anchor: document.querySelector(`[aria-label="打开集合 ${c.meta.title}"]`), targets: [{ kind: "collection", collectionId: c.meta.id }] }) },
                        { label: "上移", icon: <ArrowUp size={14} />, disabled: i === 0, onSelect: () => reorder(i, i - 1) },
                        { label: "下移", icon: <ArrowDown size={14} />, disabled: i === cols.length - 1, onSelect: () => reorder(i, i + 1) },
                        { label: "在文件管理器中显示", icon: <FolderSearch size={14} />, onSelect: () => backend.platform.reveal(`${c.dir}/collection.json`).catch(toast.error) },
                        { label: "", separator: true },
                        {
                          label: "移到回收站",
                          icon: <Trash2 size={14} />,
                          danger: true,
                          onSelect: async () => {
                            const ok = await confirmDialog({ title: "移除集合", message: `集合“${c.meta.title}”及其中的 ${items.length} 个作品将整体移入作品库回收站，可以恢复。`, okText: "移到回收站", danger: true });
                            if (ok) await withBusy("正在移动…", () => repo.trashCollection(c.meta.id));
                          },
                        },
                      ]}
                    >
                      <MoreHorizontal size={16} />
                    </MenuButton>
                  </div>
                  {c.meta.summary && <p className="lf-collection-summary">{c.meta.summary}</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <MarksPopover anchor={marks?.anchor ?? null} targets={marks?.targets ?? null} onClose={() => setMarks(null)} />
    </div>
  );
}
