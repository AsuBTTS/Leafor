import { useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import type { ContentUnit } from "@/domain/models/types";
import { StatusDot } from "@/components/marks/Marks";
import { useContextMenu, type MenuItem } from "@/components/forms/Popover";

export interface TreeSection {
  id: string | null;
  title?: string;
  units: ContentUnit[];
  menu?: MenuItem[];
}

/**
 * Ordered, drag-sortable list of content units, optionally split into sections
 * (series volumes). Shows a clear insertion line while dragging (§13.3).
 */
export function UnitTree({
  sections,
  activeId,
  onOpen,
  onMove,
  menuFor,
  renderMeta,
  emptyHint,
}: {
  sections: TreeSection[];
  activeId?: string;
  onOpen: (u: ContentUnit) => void;
  /** Move unit to section at index (within that section's list, after removal). */
  onMove: (unitId: string, sectionId: string | null, index: number) => void;
  menuFor?: (u: ContentUnit) => MenuItem[];
  renderMeta?: (u: ContentUnit) => ReactNode;
  emptyHint?: string;
}) {
  const drag = useRef<string | null>(null);
  const [drop, setDrop] = useState<{ section: string | null; index: number } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const ctx = useContextMenu();

  const finish = () => {
    if (drag.current && drop) onMove(drag.current, drop.section, drop.index);
    drag.current = null;
    setDrop(null);
  };

  const total = sections.reduce((n, s) => n + s.units.length, 0);

  return (
    <div className="lf-tree" onDragEnd={() => (drag.current = null, setDrop(null))}>
      {total === 0 && sections.every((s) => !s.title) && <div className="lf-tree-empty">{emptyHint ?? "暂无内容"}</div>}
      {sections.map((sec) => {
        const key = sec.id ?? "__root";
        const isCollapsed = collapsed.has(key);
        return (
          <div key={key} className="lf-tree-section">
            {sec.title && (
              <div
                className={`lf-tree-group ${drop && drop.section === sec.id && sec.units.length === 0 ? "drop-into" : ""}`}
                onContextMenu={(e) => sec.menu && ctx.open(e, sec.menu)}
                onDragOver={(e) => {
                  if (!drag.current) return;
                  e.preventDefault();
                  setDrop({ section: sec.id, index: sec.units.length });
                }}
                onDrop={(e) => (e.preventDefault(), finish())}
              >
                <button
                  className="lf-tree-caret"
                  onClick={() => {
                    const s = new Set(collapsed);
                    if (s.has(key)) s.delete(key);
                    else s.add(key);
                    setCollapsed(s);
                  }}
                  aria-label={isCollapsed ? "展开" : "收起"}
                >
                  {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                </button>
                <span className="lf-tree-group-title">{sec.title}</span>
                <small>{sec.units.length}</small>
              </div>
            )}
            {!isCollapsed &&
              sec.units.map((u, i) => (
                <div
                  key={u.id}
                  className={`lf-tree-row ${sec.title ? "nested" : ""} ${u.id === activeId ? "active" : ""} ${drop && drop.section === sec.id && drop.index === i ? "drop-before" : ""} ${drop && drop.section === sec.id && drop.index === i + 1 && i === sec.units.length - 1 ? "drop-after" : ""}`}
                  draggable
                  onDragStart={(e) => {
                    drag.current = u.id;
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", u.title);
                  }}
                  onDragOver={(e) => {
                    if (!drag.current) return;
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    setDrop({ section: sec.id, index: e.clientY > r.top + r.height / 2 ? i + 1 : i });
                  }}
                  onDrop={(e) => (e.preventDefault(), finish())}
                  onClick={() => onOpen(u)}
                  onContextMenu={(e) => menuFor && ctx.open(e, menuFor(u))}
                  title={u.title}
                >
                  <GripVertical className="lf-tree-grip" size={12} />
                  <span className="lf-tree-label">{u.title || "（无标题）"}</span>
                  {renderMeta?.(u)}
                  <StatusDot statusId={u.statusId} />
                </div>
              ))}
          </div>
        );
      })}
      {ctx.node}
    </div>
  );
}
