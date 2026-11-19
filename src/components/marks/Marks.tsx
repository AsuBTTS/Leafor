import { useState } from "react";
import { Check, Plus, Tag as TagIcon, CircleDot } from "lucide-react";
import type { TargetRef } from "@/domain/models/types";
import { useRepo, toast } from "@/app/store";
import { Popover } from "@/components/forms/Popover";

export function StatusBadge({ statusId, compact }: { statusId?: string | null; compact?: boolean }) {
  const repo = useRepo();
  const s = repo.status(statusId);
  if (!s) return null;
  return (
    <span className={`lf-status ${compact ? "compact" : ""}`} style={{ ["--c" as string]: s.color ?? "#6e7773" }} title={`状态：${s.name}`}>
      <i />
      {!compact && s.name}
    </span>
  );
}

export function StatusDot({ statusId }: { statusId?: string | null }) {
  const repo = useRepo();
  const s = repo.status(statusId);
  if (!s) return null;
  return <i className="lf-status-dot" style={{ background: s.color }} title={s.name} />;
}

export function TagChips({ tagIds, max = 4, onClick }: { tagIds: string[]; max?: number; onClick?: (id: string) => void }) {
  const repo = useRepo();
  const tags = tagIds.map((id) => repo.tag(id)).filter(Boolean);
  if (!tags.length) return null;
  return (
    <span className="lf-tags">
      {tags.slice(0, max).map((t) => (
        <span key={t!.id} className="lf-tag" style={{ ["--c" as string]: t!.color ?? "#6e7773" }} onClick={onClick ? () => onClick(t!.id) : undefined}>
          {t!.name}
        </span>
      ))}
      {tags.length > max && <span className="lf-tag more">+{tags.length - max}</span>}
    </span>
  );
}

/** Compact editor for status + tags of one or more targets (batch when several). */
export function MarksPanel({ targets, onDone }: { targets: TargetRef[]; onDone?: () => void }) {
  const repo = useRepo();
  const [newTag, setNewTag] = useState("");
  if (!targets.length) return null;
  const marks = targets.map((t) => repo.marks(t));
  const first = marks[0];
  const sameStatus = marks.every((m) => m.statusId === first.statusId) ? first.statusId : undefined;
  const tagState = (id: string) => {
    const n = marks.filter((m) => m.tagIds.includes(id)).length;
    return n === 0 ? "none" : n === marks.length ? "all" : "some";
  };
  const isCollection = targets.every((t) => t.kind === "collection");

  const setStatus = async (statusId: string | null) => {
    try {
      for (const t of targets) await repo.setMarks(t, { statusId });
    } catch (e) {
      toast.error(e);
    }
  };
  const toggleTag = async (id: string) => {
    const state = tagState(id);
    try {
      for (const t of targets) {
        const cur = repo.marks(t).tagIds;
        const next = state === "all" ? cur.filter((x) => x !== id) : cur.includes(id) ? cur : [...cur, id];
        await repo.setMarks(t, { tagIds: next });
      }
    } catch (e) {
      toast.error(e);
    }
  };
  const addTag = async () => {
    const name = newTag.trim();
    if (!name) return;
    const tag = await repo.createTag(name);
    setNewTag("");
    if (tagState(tag.id) !== "all") await toggleTag(tag.id);
  };

  return (
    <div className="lf-marks-panel">
      {targets.length > 1 && <div className="lf-marks-batch">批量修改 {targets.length} 项</div>}
      {!isCollection && (
        <section>
          <h4>
            <CircleDot size={13} /> 状态
          </h4>
          <div className="lf-marks-status">
            <button className={`lf-chip ${sameStatus === null ? "on" : ""}`} onClick={() => setStatus(null)}>
              无
            </button>
            {repo.orderedStatuses().map((s) => (
              <button key={s.id} className={`lf-chip ${sameStatus === s.id ? "on" : ""}`} style={{ ["--c" as string]: s.color }} onClick={() => setStatus(s.id)}>
                <i className="lf-status-dot" style={{ background: s.color }} />
                {s.name}
              </button>
            ))}
          </div>
        </section>
      )}
      <section>
        <h4>
          <TagIcon size={13} /> 标签
        </h4>
        <div className="lf-marks-tags">
          {repo.ws.tags.map((t) => {
            const st = tagState(t.id);
            return (
              <button key={t.id} className={`lf-chip ${st === "all" ? "on" : st === "some" ? "some" : ""}`} onClick={() => toggleTag(t.id)}>
                {st === "all" && <Check size={12} />}
                <i className="lf-status-dot" style={{ background: t.color }} />
                {t.name}
              </button>
            );
          })}
        </div>
        <div className="lf-marks-new">
          <input
            value={newTag}
            placeholder="新标签…"
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && addTag()}
          />
          <button className="lf-icon-btn" onClick={addTag} disabled={!newTag.trim()} aria-label="添加标签">
            <Plus size={14} />
          </button>
        </div>
      </section>
      {onDone && (
        <div className="lf-marks-foot">
          <button className="lf-btn small" onClick={onDone}>
            完成
          </button>
        </div>
      )}
    </div>
  );
}

export function MarksButton({ targets, label, className }: { targets: TargetRef[]; label?: string; className?: string }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={setAnchor} className={className ?? "lf-icon-btn"} onClick={(e) => (e.stopPropagation(), setOpen((o) => !o))} title="状态与标签" aria-label="状态与标签">
        <TagIcon size={16} strokeWidth={1.6} />
        {label && <span>{label}</span>}
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={300}>
        <MarksPanel targets={targets} onDone={() => setOpen(false)} />
      </Popover>
    </>
  );
}

/** Popover controlled externally (e.g. from a context menu). */
export function MarksPopover({ anchor, targets, onClose }: { anchor: HTMLElement | null; targets: TargetRef[] | null; onClose: () => void }) {
  return (
    <Popover anchor={anchor} open={!!targets && !!anchor} onClose={onClose} width={300}>
      {targets && <MarksPanel targets={targets} onDone={onClose} />}
    </Popover>
  );
}
