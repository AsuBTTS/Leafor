import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, Loader2, X } from "lucide-react";
import { useRepo } from "@/app/store";
import { TopBar } from "@/components/navigation/Chrome";
import { StatusBadge, TagChips } from "@/components/marks/Marks";
import { TYPE_ICON } from "@/components/Cover";
import { useSearchIndex, type SearchFilters } from "@/services/search/searchIndex";
import { ITEM_TYPES, ITEM_TYPE_LABEL, UNIT_TYPE_LABEL, type ItemType } from "@/domain/models/types";

/** Global search & filter across collections (FR-10, AC-04). */
export function SearchPage() {
  const repo = useRepo();
  const index = useSearchIndex();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [types, setTypes] = useState<ItemType[]>([]);
  const [collectionId, setCollectionId] = useState<string | null>(params.get("c"));
  const [statusId, setStatusId] = useState<string | null>(params.get("status"));
  const [tagIds, setTagIds] = useState<string[]>(params.get("tag") ? [params.get("tag")!] : []);
  const [kind, setKind] = useState<"all" | "item" | "unit">((params.get("kind") as "all") ?? "all");
  const [archived, setArchived] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (statusId) next.set("status", statusId);
    if (tagIds[0]) next.set("tag", tagIds[0]);
    if (collectionId) next.set("c", collectionId);
    if (kind !== "all") next.set("kind", kind);
    setParams(next, { replace: true });
  }, [q, statusId, tagIds, collectionId, kind, setParams]);

  const filters: SearchFilters = { types, collectionId, statusId, tagIds, kinds: kind === "all" ? undefined : [kind], includeArchived: archived };
  const active = q.trim() || statusId || tagIds.length || types.length || collectionId;
  const hits = useMemo(() => (active ? index.query(q, filters).slice(0, 300) : []), [index.getVersion(), q, JSON.stringify(filters)]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (h: (typeof hits)[number]) => navigate(h.doc.unitId ? `/item/${h.doc.itemId}/${h.doc.unitId}` : `/item/${h.doc.itemId}`);

  return (
    <div className="lf-page">
      <TopBar
        left={
          <div className="lf-page-title">
            <h1>搜索与筛选</h1>
          </div>
        }
        center={
          <label className="lf-search big">
            <Search size={16} />
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="标题、正文、标签……（支持中文子串）" />
            {q && (
              <button className="lf-icon-btn tiny" onClick={() => setQ("")} aria-label="清空">
                <X size={13} />
              </button>
            )}
          </label>
        }
      />
      <div className="lf-search-layout">
        <aside className="lf-search-filters">
          <section>
            <h4>范围</h4>
            <div className="lf-seg small vertical">
              {(["all", "item", "unit"] as const).map((k) => (
                <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
                  {k === "all" ? "全部" : k === "item" ? "只看单品" : "只看内容单元（章节、照片、博文…）"}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h4>状态</h4>
            <div className="lf-chips-wrap">
              {repo.orderedStatuses().map((s) => (
                <button key={s.id} className={`lf-chip small ${statusId === s.id ? "on" : ""}`} onClick={() => setStatusId(statusId === s.id ? null : s.id)}>
                  <i className="lf-status-dot" style={{ background: s.color }} />
                  {s.name}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h4>标签</h4>
            <div className="lf-chips-wrap">
              {repo.ws.tags.map((t) => (
                <button key={t.id} className={`lf-chip small ${tagIds.includes(t.id) ? "on" : ""}`} onClick={() => setTagIds(tagIds.includes(t.id) ? tagIds.filter((x) => x !== t.id) : [...tagIds, t.id])}>
                  <i className="lf-status-dot" style={{ background: t.color }} />
                  {t.name}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h4>类型</h4>
            <div className="lf-chips-wrap">
              {ITEM_TYPES.map((t) => (
                <button key={t} className={`lf-chip small ${types.includes(t) ? "on" : ""}`} onClick={() => setTypes(types.includes(t) ? types.filter((x) => x !== t) : [...types, t])}>
                  {ITEM_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h4>集合</h4>
            <select value={collectionId ?? ""} onChange={(e) => setCollectionId(e.target.value || null)}>
              <option value="">全部集合</option>
              {repo.orderedCollections().map((c) => (
                <option key={c.meta.id} value={c.meta.id}>
                  {c.meta.title}
                </option>
              ))}
            </select>
          </section>
          <label className="lf-check">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> 包含已归档
          </label>
        </aside>
        <div className="lf-scroll">
          <div className="lf-search-results">
            {index.state === "building" && (
              <div className="lf-note">
                <Loader2 size={13} className="spin" /> 正在建立索引…（不影响阅读与编辑）
              </div>
            )}
            {index.state === "error" && <div className="lf-note warn">搜索索引不可用：{index.error}。作品文件不受影响，可在设置中重建索引。</div>}
            {!active ? (
              <div className="lf-empty">
                <h3>搜索整个作品库</h3>
                <p>输入关键词，或按状态、标签筛选跨集合的单品、章节、照片、博文与 PDF。例如选择状态“待P图”可以找出所有需要修图的照片。</p>
              </div>
            ) : (
              <>
                <div className="muted lf-result-count">{hits.length} 个结果</div>
                {hits.map((h) => {
                  const it = repo.getItem(h.doc.itemId);
                  const Icon = TYPE_ICON[h.doc.itemType];
                  return (
                    <button key={h.doc.key} className="lf-result" onClick={() => open(h)}>
                      <Icon size={16} strokeWidth={1.5} className="lf-result-icon" />
                      <div className="lf-result-body">
                        <div className="lf-result-title">
                          {h.doc.title}
                          <small>
                            {h.doc.kind === "unit" ? `${UNIT_TYPE_LABEL[h.doc.unitType!]} · ${it?.meta.title ?? ""}` : ITEM_TYPE_LABEL[h.doc.itemType]}
                            {" · "}
                            {repo.collections.get(h.doc.collectionId)?.meta.title}
                          </small>
                        </div>
                        {h.snippet && (
                          <div className="lf-result-snippet">
                            {h.snippet.before}
                            <mark>{h.snippet.match}</mark>
                            {h.snippet.after}
                          </div>
                        )}
                        <div className="lf-result-meta">
                          <StatusBadge statusId={h.doc.statusId} />
                          <TagChips tagIds={h.doc.tagIds} />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
