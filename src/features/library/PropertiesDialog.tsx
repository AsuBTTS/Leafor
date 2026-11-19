import { useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { Modal } from "@/components/feedback/Overlays";
import { repo, backend } from "@/app/backend";
import { toast, useRepo } from "@/app/store";
import type { Item, UUID } from "@/domain/models/types";
import { ITEM_TYPE_LABEL } from "@/domain/models/types";
import { Cover } from "@/components/Cover";
import { setCoverFromFile } from "@/services/import-export/importService";
import { IMG_FILTER } from "./actions";
import { MarksPanel } from "@/components/marks/Marks";
import { getUnits } from "@/domain/policies/units";

export function PropertiesDialog({ itemId, onClose }: { itemId: UUID; onClose: () => void }) {
  const r = useRepo();
  const it = r.getItem(itemId);
  const [title, setTitle] = useState(it?.meta.title ?? "");
  const [author, setAuthor] = useState(it?.meta.author ?? "");
  const [summary, setSummary] = useState(it?.meta.summary ?? "");
  const [notes, setNotes] = useState(it?.meta.notes ?? "");
  if (!it) return null;
  const m = it.meta;

  const save = async () => {
    await repo.updateItem(itemId, { title: title.trim() || m.title, author: author.trim() || undefined, summary: summary.trim() || undefined, notes: notes.trim() || undefined } as Partial<Item>);
    onClose();
  };
  const pickCover = async () => {
    const f = await backend.platform.pickFiles("选择封面图片", IMG_FILTER, false);
    if (f[0]) await setCoverFromFile(repo, itemId, f[0]).catch(toast.error);
  };

  return (
    <Modal
      title="属性"
      width={620}
      onClose={onClose}
      footer={
        <>
          <button className="lf-btn" onClick={onClose}>
            取消
          </button>
          <button className="lf-btn primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
      <div className="lf-props">
        <div className="lf-props-cover">
          <Cover item={it} size="md" />
          <div className="lf-props-cover-actions">
            <button className="lf-btn small" onClick={pickCover}>
              <ImagePlus size={14} /> 选择封面
            </button>
            {m.coverPath && (
              <button className="lf-btn small" onClick={() => repo.updateItem(itemId, { coverPath: undefined } as Partial<Item>)}>
                <X size={14} /> 使用默认封面
              </button>
            )}
          </div>
        </div>
        <div className="lf-form">
          <label className="lf-field">
            <span>标题</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {m.type !== "pdf" && m.type !== "photo_album" ? (
            <label className="lf-field">
              <span>作者</span>
              <input value={author} onChange={(e) => setAuthor(e.target.value)} />
            </label>
          ) : null}
          <label className="lf-field">
            <span>摘要</span>
            <textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </label>
          <label className="lf-field">
            <span>备注</span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <dl className="lf-props-meta">
            <dt>类型</dt>
            <dd>{ITEM_TYPE_LABEL[m.type]}</dd>
            <dt>内容</dt>
            <dd>{m.type === "pdf" ? `${m.data.pageCount ?? "?"} 页` : `${getUnits(m).length} 个内容单元`}</dd>
            <dt>创建</dt>
            <dd>{new Date(m.createdAt).toLocaleString()}</dd>
            <dt>修改</dt>
            <dd>{new Date(m.updatedAt).toLocaleString()}</dd>
            <dt>位置</dt>
            <dd className="mono">{it.dir}</dd>
          </dl>
          <MarksPanel targets={[{ kind: "item", itemId }]} />
        </div>
      </div>
    </Modal>
  );
}
