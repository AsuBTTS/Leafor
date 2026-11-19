import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArchiveRestore, RotateCcw, Trash2 } from "lucide-react";
import { useRepo, confirmDialog, toast, withBusy } from "@/app/store";
import { TopBar } from "@/components/navigation/Chrome";
import { Cover } from "@/components/Cover";
import { EmptyState } from "@/components/feedback/Overlays";
import type { TrashEntry } from "@/domain/models/types";
import { ITEM_TYPE_LABEL } from "@/domain/models/types";

export function ArchivePage() {
  const repo = useRepo();
  const navigate = useNavigate();
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const archived = repo.orderedItems().filter((i) => i.meta.archived);

  useEffect(() => {
    repo.listTrash().then(setTrash);
  }, [repo, repo.version]);

  const kindLabel = (e: TrashEntry) => (e.kind === "collection" ? "集合" : e.kind === "unit" ? (e.unit?.type === "photo" ? "照片" : "内容单元") : ITEM_TYPE_LABEL[e.itemType ?? "document"]);

  return (
    <div className="lf-page">
      <TopBar
        left={
          <div className="lf-page-title">
            <h1>归档与回收站</h1>
          </div>
        }
      />
      <div className="lf-scroll">
        <div className="lf-archive">
          <section>
            <h2>已归档</h2>
            <p className="muted">归档的作品不在作品库中显示，但保留在原位置，随时可以取消归档。</p>
            {!archived.length ? (
              <p className="lf-tree-empty">没有已归档的作品</p>
            ) : (
              <div className="lf-archive-grid">
                {archived.map((it) => (
                  <div key={it.meta.id} className="lf-archive-card">
                    <button onClick={() => navigate(`/item/${it.meta.id}`)} className="lf-archive-cover">
                      <Cover item={it} size="sm" />
                    </button>
                    <div>
                      <strong>{it.meta.title}</strong>
                      <small>{ITEM_TYPE_LABEL[it.meta.type]}</small>
                      <button className="lf-btn small" onClick={() => repo.setArchived(it.meta.id, false)}>
                        <ArchiveRestore size={13} /> 取消归档
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section>
            <h2>回收站</h2>
            <p className="muted">删除的作品、集合、章节和照片会先移到作品库内的 .leafor/trash 文件夹。只有在这里“永久删除”才会真正移除文件。</p>
            {!trash.length ? (
              <EmptyState title="回收站是空的" />
            ) : (
              <table className="lf-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>类型</th>
                    <th>原位置</th>
                    <th>删除时间</th>
                    <th style={{ width: 200 }} />
                  </tr>
                </thead>
                <tbody>
                  {trash.map((e) => (
                    <tr key={e.id}>
                      <td>{e.title}</td>
                      <td>{kindLabel(e)}</td>
                      <td className="muted mono small">{e.originalPath}</td>
                      <td className="muted">{new Date(e.deletedAt).toLocaleString()}</td>
                      <td className="lf-row-actions">
                        <button className="lf-btn small" onClick={() => withBusy("正在恢复…", () => repo.restoreTrash(e.id)).then(() => toast.success("已恢复"))}>
                          <RotateCcw size={13} /> 恢复
                        </button>
                        <button
                          className="lf-btn small danger"
                          onClick={async () => {
                            const ok = await confirmDialog({ title: "永久删除", message: `“${e.title}”将被永久删除，无法恢复。`, okText: "永久删除", danger: true });
                            if (ok) await withBusy("正在删除…", () => repo.purgeTrash(e.id));
                          }}
                        >
                          <Trash2 size={13} /> 永久删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
