import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Upload, FileText, FileCode2, FileDown, Archive, PenLine, Columns2, BookOpen, Home, Search, Tags, ChevronLeft, ChevronRight, CalendarDays, CheckSquare, Square } from "lucide-react";
import type { WorkbenchProps } from "@/features/library/ItemPage";
import { ItemHeader, ModeSwitch } from "@/features/library/ItemHeader";
import { SidePanel, useTocOpen } from "@/components/navigation/SidePanel";
import { TextWorkbench, type TextMode } from "@/components/editor/TextWorkbench";
import { MarksPopover, StatusBadge, StatusDot, TagChips, MarksButton } from "@/components/marks/Marks";
import { useContextMenu } from "@/components/forms/Popover";
import { repo, backend } from "@/app/backend";
import { usePref, toast, withBusy, useRepo } from "@/app/store";
import { blogNeighbours, blogTimeline, isPublished } from "@/domain/policies/units";
import type { Post, TargetRef } from "@/domain/models/types";
import { runExport, unitMenu } from "@/features/library/unitActions";
import { exportBlogArchive, exportHtml, exportMarkdown } from "@/services/import-export/exportService";
import { exportDocx } from "@/services/import-export/docxExport";
import { importMarkdownIntoItem } from "@/services/import-export/importService";
import { MD_FILTER } from "@/features/library/actions";
import { slugify, todayDate } from "@/domain/policies/naming";
import { EmptyState } from "@/components/feedback/Overlays";
import { searchIndex } from "@/services/search/searchIndex";

const MONTHS = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];

function fmtDate(d?: string | null) {
  if (!d) return "未发布";
  const t = new Date(d.length === 10 ? d + "T00:00:00" : d);
  return Number.isNaN(t.getTime()) ? d : `${t.getFullYear()} 年 ${t.getMonth() + 1} 月 ${t.getDate()} 日`;
}

export function BlogWorkbench({ item, unitId }: WorkbenchProps) {
  useRepo();
  const navigate = useNavigate();
  const [tocOpen, setTocOpen] = useTocOpen("blog");
  const [mode, setMode] = usePref<TextMode>("blog.mode", "preview");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [archiveKey, setArchiveKey] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [marks, setMarks] = useState<{ anchor: HTMLElement | null; targets: TargetRef[] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ctx = useContextMenu();
  const onOutline = useCallback(() => undefined, []);
  const posts = item.meta.type === "blog" ? item.meta.data.posts : [];
  const tl = useMemo(() => blogTimeline(posts), [posts]);
  const id = item.meta.id;
  const post = posts.find((p) => p.id === unitId);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = (p: Post) => {
      if (tagFilter && !p.tagIds.includes(tagFilter)) return false;
      if (archiveKey && (!p.publishedAt || p.publishedAt.slice(0, 7) !== archiveKey)) return false;
      if (needle) {
        const body = searchIndex.docs.get(`${id}:${p.id}`)?.body.toLowerCase() ?? "";
        if (!p.title.toLowerCase().includes(needle) && !(p.excerpt ?? "").toLowerCase().includes(needle) && !body.includes(needle)) return false;
      }
      return true;
    };
    return { published: tl.published.filter(match), drafts: archiveKey ? [] : tl.drafts.filter(match) };
  }, [tl, tagFilter, archiveKey, q, id]);

  if (item.meta.type !== "blog") return null;
  const usedTags = [...new Set(posts.flatMap((p) => p.tagIds))];

  const newPost = async () => {
    const u = await repo.addUnit(id, { title: "未命名博文", publishedAt: null, statusId: "draft" });
    setMode("split");
    navigate(`/item/${id}/${u.id}`);
  };
  const importPosts = async () => {
    const files = await backend.platform.pickFiles("导入 Markdown 为博文", MD_FILTER, true);
    if (!files.length) return;
    const r = await withBusy("正在导入…", () => importMarkdownIntoItem(repo, id, files));
    if (r) toast.success(`已导入 ${r.created.length} 篇博文（作为草稿，可设置发布日期）`);
  };

  const postRow = (p: Post) => (
    <button
      key={p.id}
      className={`lf-blog-row ${p.id === unitId ? "active" : ""}`}
      onClick={() => navigate(`/item/${id}/${p.id}`)}
      onContextMenu={(e) => ctx.open(e, unitMenu(item, p, navigate, { onMarks: () => setMarks({ anchor: e.currentTarget as HTMLElement, targets: [{ kind: "unit", itemId: id, unitId: p.id }] }) }))}
      title={p.title}
    >
      <span className="lf-blog-row-title">{p.title}</span>
      <span className="lf-blog-row-date">{p.publishedAt ? p.publishedAt.slice(5, 10) : ""}</span>
      <StatusDot statusId={p.statusId} />
    </button>
  );

  const nb = post ? blogNeighbours(posts, post.id) : {};

  return (
    <div className="lf-page lf-item-page">
      <ItemHeader
        item={item}
        tocOpen={tocOpen}
        onToggleToc={() => setTocOpen(!tocOpen)}
        center={
          post ? (
            <ModeSwitch<TextMode>
              value={mode}
              onChange={setMode}
              options={[
                { value: "preview", label: "阅读", icon: <BookOpen size={14} /> },
                { value: "split", label: "分屏", icon: <Columns2 size={14} /> },
                { value: "edit", label: "编辑", icon: <PenLine size={14} /> },
              ]}
            />
          ) : null
        }
        exportItems={[
          ...(post
            ? [
                { label: "导出本篇 Markdown", icon: <FileText size={14} />, onSelect: () => runExport("导出 Markdown", () => exportMarkdown(id, { unitId: post.id })) },
                { label: "导出本篇 HTML", icon: <FileCode2 size={14} />, onSelect: () => runExport("导出 HTML", () => exportHtml(id, post.id)) },
                { label: "导出本篇 Word", icon: <FileDown size={14} />, onSelect: () => runExport("导出 Word", () => exportDocx(id, post.id)) },
                { label: "", separator: true },
              ]
            : []),
          { label: "整套博客：离线 HTML 归档", icon: <Archive size={14} />, onSelect: () => runExport("导出博客归档", () => exportBlogArchive(id)) },
          { label: "整套博客：归档（含草稿）", icon: <Archive size={14} />, onSelect: () => runExport("导出博客归档", () => exportBlogArchive(id, true)) },
          { label: "整套博客：Markdown", icon: <FileText size={14} />, onSelect: () => runExport("导出 Markdown", () => exportMarkdown(id)) },
        ]}
      />
      <div className="lf-item-body">
        <SidePanel
          title="博客"
          open={tocOpen}
          onClose={() => setTocOpen(false)}
          actions={
            <>
              <button className="lf-icon-btn" onClick={importPosts} title="导入 Markdown 为博文" aria-label="导入博文">
                <Upload size={15} />
              </button>
              <button className="lf-icon-btn" onClick={newPost} title="新建博文" aria-label="新建博文">
                <Plus size={16} />
              </button>
            </>
          }
          footer={<span className="muted">{tl.published.length} 篇已发布 · {tl.drafts.length} 篇草稿</span>}
        >
          <button className={`lf-blog-home ${!post ? "active" : ""}`} onClick={() => navigate(`/item/${id}`)}>
            <Home size={14} /> 博客首页
          </button>
          <label className="lf-mini-search">
            <Search size={13} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索本博客…" />
          </label>
          {usedTags.length > 0 && (
            <div className="lf-blog-tags">
              {usedTags.map((t) => (
                <button key={t} className={`lf-chip small ${tagFilter === t ? "on" : ""}`} onClick={() => setTagFilter(tagFilter === t ? null : t)}>
                  {repo.tag(t)?.name ?? t}
                </button>
              ))}
            </div>
          )}
          {archiveKey && (
            <button className="lf-chip small on" onClick={() => setArchiveKey(null)}>
              归档：{archiveKey} ✕
            </button>
          )}
          {filtered.drafts.length > 0 && (
            <div className="lf-blog-group">
              <h4>草稿 · {filtered.drafts.length}</h4>
              {filtered.drafts.map(postRow)}
            </div>
          )}
          {tl.years.map((y) => {
            const months = y.months.map((m) => ({ ...m, posts: m.posts.filter((p) => filtered.published.includes(p)) })).filter((m) => m.posts.length);
            if (!months.length) return null;
            return (
              <div key={y.year} className="lf-blog-group">
                <h4>{y.year} 年</h4>
                {months.map((m) => (
                  <div key={m.key}>
                    <button className="lf-blog-month" onClick={() => setArchiveKey(archiveKey === m.key ? null : m.key)}>
                      {MONTHS[m.month - 1]} <small>{m.posts.length}</small>
                    </button>
                    {m.posts.map(postRow)}
                  </div>
                ))}
              </div>
            );
          })}
          {!posts.length && <div className="lf-tree-empty">还没有博文</div>}
        </SidePanel>
        <div className="lf-item-main">
          {post ? (
            <div className="lf-blog-post">
              <PostMetaBar key={post.id} itemId={id} post={post} />
              <TextWorkbench
                key={post.id}
                itemId={id}
                unitId={post.id}
                mode={mode}
                onOutline={onOutline}
                readerClass="blog"
                previewHeader={
                  <div className="lf-blog-post-head">
                    <div className="lf-blog-date">
                      <CalendarDays size={13} /> {fmtDate(post.publishedAt)}
                      {!isPublished(post) && <span className="lf-draft-pill">草稿</span>}
                    </div>
                    <TagChips tagIds={post.tagIds} max={8} />
                  </div>
                }
                previewFooter={
                  isPublished(post) ? (
                    <nav className="lf-pager">
                      {nb.older ? (
                        <button onClick={() => navigate(`/item/${id}/${nb.older!.id}`)}>
                          <ChevronLeft size={14} /> {nb.older.title}
                        </button>
                      ) : (
                        <span />
                      )}
                      {nb.newer ? (
                        <button onClick={() => navigate(`/item/${id}/${nb.newer!.id}`)}>
                          {nb.newer.title} <ChevronRight size={14} />
                        </button>
                      ) : (
                        <span />
                      )}
                    </nav>
                  ) : null
                }
              />
            </div>
          ) : (
            <div className="lf-scroll">
              <div className="lf-blog-index">
                <header>
                  <h1>{item.meta.title}</h1>
                  {item.meta.summary && <p className="muted">{item.meta.summary}</p>}
                  <div className="lf-blog-index-actions">
                    <button className="lf-btn primary" onClick={newPost}>
                      <Plus size={14} /> 新建博文
                    </button>
                    {selected.size > 0 && (
                      <>
                        <button className="lf-btn" onClick={(e) => setMarks({ anchor: e.currentTarget, targets: [...selected].map((u) => ({ kind: "unit", itemId: id, unitId: u })) })}>
                          <Tags size={14} /> 批量修改状态与标签（{selected.size}）
                        </button>
                        <button className="lf-link-btn" onClick={() => setSelected(new Set())}>
                          取消选择
                        </button>
                      </>
                    )}
                  </div>
                </header>
                {!posts.length && <EmptyState title="还没有博文" hint="博文以独立 .md 文件保存；未设置发布日期的博文会显示在草稿区。" />}
                {[...filtered.drafts.length ? [{ label: "草稿", list: filtered.drafts }] : [], { label: "已发布", list: filtered.published }].map((sec) =>
                  sec.list.length ? (
                    <section key={sec.label}>
                      <h2>{sec.label}</h2>
                      {sec.list.map((p) => (
                        <article key={p.id} className="lf-blog-card" onClick={() => navigate(`/item/${id}/${p.id}`)}>
                          <button
                            className="lf-icon-btn lf-blog-select"
                            onClick={(e) => {
                              e.stopPropagation();
                              const s = new Set(selected);
                              s.has(p.id) ? s.delete(p.id) : s.add(p.id);
                              setSelected(s);
                            }}
                            aria-label="选择"
                          >
                            {selected.has(p.id) ? <CheckSquare size={15} /> : <Square size={15} />}
                          </button>
                          <div className="lf-blog-card-date">{p.publishedAt ? fmtDate(p.publishedAt) : `最后修改 ${new Date(p.updatedAt).toLocaleDateString()}`}</div>
                          <h3>{p.title}</h3>
                          {p.excerpt && <p>{p.excerpt}</p>}
                          <div className="lf-blog-card-meta">
                            <StatusBadge statusId={p.statusId} />
                            <TagChips tagIds={p.tagIds} />
                          </div>
                        </article>
                      ))}
                    </section>
                  ) : null,
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {ctx.node}
      <MarksPopover anchor={marks?.anchor ?? null} targets={marks?.targets ?? null} onClose={() => setMarks(null)} />
    </div>
  );
}

function PostMetaBar({ itemId, post }: { itemId: string; post: Post }) {
  const [excerpt, setExcerpt] = useState(post.excerpt ?? "");
  const [slug, setSlug] = useState(post.slug ?? "");
  const save = (patch: Partial<Post>) => repo.updateUnit(itemId, post.id, patch as never);
  return (
    <div className="lf-postmeta">
      <label title="发布日期为空表示未发布草稿；状态与发布日期相互独立">
        <CalendarDays size={14} />
        <input type="date" value={post.publishedAt?.slice(0, 10) ?? ""} onChange={(e) => save({ publishedAt: e.target.value || null })} aria-label="发布日期" />
      </label>
      {post.publishedAt ? (
        <button className="lf-link-btn muted" onClick={() => save({ publishedAt: null })}>
          转为草稿
        </button>
      ) : (
        <button className="lf-link-btn" onClick={() => save({ publishedAt: todayDate() })}>
          今天发布
        </button>
      )}
      <label className="grow" title="摘要">
        <span>摘要</span>
        <input value={excerpt} placeholder="一句话摘要（显示在博客首页）" onChange={(e) => setExcerpt(e.target.value)} onBlur={() => excerpt !== (post.excerpt ?? "") && save({ excerpt: excerpt || undefined })} />
      </label>
      <label title="slug 用于导出的文件名">
        <span>slug</span>
        <input value={slug} placeholder={slugify(post.title, 40)} onChange={(e) => setSlug(e.target.value)} onBlur={() => slug !== (post.slug ?? "") && save({ slug: slug ? slugify(slug, 60) : undefined })} />
      </label>
      <StatusBadge statusId={post.statusId} />
      <MarksButton targets={[{ kind: "unit", itemId, unitId: post.id }]} />
    </div>
  );
}
