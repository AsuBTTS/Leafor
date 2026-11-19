import { useNavigate } from "react-router-dom";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { useRepo, confirmDialog, prompt } from "@/app/store";
import { TopBar } from "@/components/navigation/Chrome";
import { moveIndex } from "@/domain/policies/units";

const SWATCHES = ["#164f47", "#3f7d72", "#5d7f74", "#9aa39f", "#6b7a8f", "#4f6d8a", "#7d6aa6", "#8a5a7a", "#b5654a", "#a0705a", "#b88a2e", "#8d8a5a"];

/** Maintain user-defined statuses (progress) and tags (classification) — §4.4. */
export function MarksPage() {
  const repo = useRepo();
  const navigate = useNavigate();
  const statuses = repo.orderedStatuses();

  const del = async (kind: "tag" | "status", id: string, name: string) => {
    const n = repo.usage(kind, id);
    const ok = await confirmDialog({
      title: `删除${kind === "tag" ? "标签" : "状态"}“${name}”`,
      message: n ? `有 ${n} 个对象正在使用它，删除后这些对象上的该${kind === "tag" ? "标签" : "状态"}会被移除（作品内容不受影响）。` : "目前没有对象使用它。",
      okText: "删除",
      danger: true,
    });
    if (ok) await repo.deleteDefinition(kind, id);
  };

  return (
    <div className="lf-page">
      <TopBar
        left={
          <div className="lf-page-title">
            <h1>标签与状态</h1>
          </div>
        }
      />
      <div className="lf-scroll">
        <div className="lf-marks-page">
          <section>
            <header>
              <div>
                <h2>状态</h2>
                <p className="muted">表示进度，如“草稿”“待校对”“待P图”。每个对象最多一个主状态；博客的发布日期单独记录。</p>
              </div>
              <button
                className="lf-btn"
                onClick={async () => {
                  const n = await prompt({ title: "新建状态", label: "状态名称" });
                  if (n) await repo.createStatus(n);
                }}
              >
                <Plus size={14} /> 新建状态
              </button>
            </header>
            <table className="lf-table">
              <thead>
                <tr>
                  <th style={{ width: 48 }}>颜色</th>
                  <th>名称</th>
                  <th>使用</th>
                  <th style={{ width: 160 }} />
                </tr>
              </thead>
              <tbody>
                {statuses.map((s, i) => (
                  <tr key={s.id}>
                    <td>
                      <ColorPick value={s.color} onChange={(c) => repo.upsertStatus({ ...s, color: c })} />
                    </td>
                    <td>
                      <input className="lf-inline-input" defaultValue={s.name} onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && repo.upsertStatus({ ...s, name: e.target.value.trim() })} />
                    </td>
                    <td>
                      <button className="lf-link-btn" onClick={() => navigate(`/search?status=${s.id}`)}>
                        {repo.usage("status", s.id)} 项 →
                      </button>
                    </td>
                    <td className="lf-row-actions">
                      <button className="lf-icon-btn" disabled={i === 0} onClick={() => repo.reorderStatuses(moveIndex(statuses.map((x) => x.id), i, i - 1))} aria-label="上移">
                        <ArrowUp size={14} />
                      </button>
                      <button className="lf-icon-btn" disabled={i === statuses.length - 1} onClick={() => repo.reorderStatuses(moveIndex(statuses.map((x) => x.id), i, i + 1))} aria-label="下移">
                        <ArrowDown size={14} />
                      </button>
                      <button className="lf-icon-btn" onClick={() => del("status", s.id, s.name)} aria-label="删除">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section>
            <header>
              <div>
                <h2>标签</h2>
                <p className="muted">自由分类，如“人像”“散文”“待选入集”。一个对象可以有多个标签；单品与章节、照片等的标签互不覆盖。</p>
              </div>
              <button
                className="lf-btn"
                onClick={async () => {
                  const n = await prompt({ title: "新建标签", label: "标签名称" });
                  if (n) await repo.createTag(n);
                }}
              >
                <Plus size={14} /> 新建标签
              </button>
            </header>
            <table className="lf-table">
              <thead>
                <tr>
                  <th style={{ width: 48 }}>颜色</th>
                  <th>名称</th>
                  <th>描述</th>
                  <th>使用</th>
                  <th style={{ width: 60 }} />
                </tr>
              </thead>
              <tbody>
                {repo.ws.tags.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <ColorPick value={t.color} onChange={(c) => repo.upsertTag({ ...t, color: c })} />
                    </td>
                    <td>
                      <input className="lf-inline-input" defaultValue={t.name} onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && repo.upsertTag({ ...t, name: e.target.value.trim() })} />
                    </td>
                    <td>
                      <input className="lf-inline-input" defaultValue={t.description ?? ""} placeholder="—" onBlur={(e) => e.target.value !== (t.description ?? "") && repo.upsertTag({ ...t, description: e.target.value || undefined })} />
                    </td>
                    <td>
                      <button className="lf-link-btn" onClick={() => navigate(`/search?tag=${t.id}`)}>
                        {repo.usage("tag", t.id)} 项 →
                      </button>
                    </td>
                    <td>
                      <button className="lf-icon-btn" onClick={() => del("tag", t.id, t.name)} aria-label="删除">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
}

function ColorPick({ value, onChange }: { value?: string; onChange: (c: string) => void }) {
  return (
    <select className="lf-color-select" value={value ?? ""} style={{ background: value }} onChange={(e) => onChange(e.target.value)} aria-label="颜色">
      {SWATCHES.map((c) => (
        <option key={c} value={c} style={{ background: c }}>
          {c}
        </option>
      ))}
      {value && !SWATCHES.includes(value) && <option value={value}>{value}</option>}
    </select>
  );
}
