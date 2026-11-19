import type { ContentUnit, Item, Post, SeriesArticle, SeriesGroup, UUID } from "../models/types";

/** All content units of an item, in stored order. */
export function getUnits(item: Item): ContentUnit[] {
  switch (item.type) {
    case "book":
      return sortByOrder(item.data.chapters);
    case "photo_album":
      return sortByOrder(item.data.photos);
    case "blog":
      return sortByOrder(item.data.posts);
    case "article_series":
      return orderedSeries(item.data.articles, item.data.groups ?? []);
    case "document":
      return [item.data.content];
    case "pdf":
      return [];
  }
}

export function findUnit(item: Item, unitId: UUID): ContentUnit | undefined {
  return getUnits(item).find((u) => u.id === unitId);
}

export function sortByOrder<T extends { order: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => a.order - b.order);
}

/** Normalise `order` to 0..n-1 following the array order. */
export function renumber<T extends { order: number }>(list: T[]): T[] {
  return list.map((u, i) => (u.order === i ? u : { ...u, order: i }));
}

/** Apply a full ordered id list to a unit array. Unknown ids are ignored, missing ones appended. */
export function applyOrder<T extends { id: string; order: number }>(list: T[], orderedIds: string[]): T[] {
  const byId = new Map(list.map((u) => [u.id, u]));
  const out: T[] = [];
  for (const id of orderedIds) {
    const u = byId.get(id);
    if (u) {
      out.push(u);
      byId.delete(id);
    }
  }
  out.push(...sortByOrder([...byId.values()]));
  return renumber(out);
}

/** Move an element from one index to another (drag & drop helper). */
export function moveIndex<T>(list: T[], from: number, to: number): T[] {
  const copy = [...list];
  const [x] = copy.splice(from, 1);
  copy.splice(Math.max(0, Math.min(copy.length, to)), 0, x);
  return copy;
}

/** Replace units in an item (immutable). Unit order is renumbered. */
export function withUnits(item: Item, units: ContentUnit[]): Item {
  const now = new Date().toISOString();
  switch (item.type) {
    case "book":
      return { ...item, updatedAt: now, data: { ...item.data, chapters: renumber(units.filter((u) => u.type === "chapter")) as never } };
    case "photo_album":
      return { ...item, updatedAt: now, data: { ...item.data, photos: renumber(units.filter((u) => u.type === "photo")) as never } };
    case "blog":
      return { ...item, updatedAt: now, data: { ...item.data, posts: renumber(units.filter((u) => u.type === "post")) as never } };
    case "article_series":
      return { ...item, updatedAt: now, data: { ...item.data, articles: renumber(units.filter((u) => u.type === "series_article")) as never } };
    case "document": {
      const t = units.find((u) => u.type === "text");
      return t ? { ...item, updatedAt: now, data: { ...item.data, content: t as never } } : item;
    }
    case "pdf":
      return item;
  }
}

export function updateUnit(item: Item, unitId: UUID, patch: Partial<ContentUnit>): Item {
  const units = getUnits(item).map((u) =>
    u.id === unitId ? ({ ...u, ...patch, id: u.id, type: u.type, updatedAt: new Date().toISOString() } as ContentUnit) : u,
  );
  return withUnits(item, units);
}

/**
 * Series ordering: groups (by group order) and their articles, ungrouped
 * articles first. Article `order` is global; the reading sequence is the
 * flattened group traversal so navigation matches the directory tree.
 */
export function orderedSeries(articles: SeriesArticle[], groups: SeriesGroup[]): SeriesArticle[] {
  const sorted = sortByOrder(articles);
  if (!groups.length) return sorted;
  const groupIds = new Set(groups.map((g) => g.id));
  const ungrouped = sorted.filter((a) => !a.groupId || !groupIds.has(a.groupId));
  const out = [...ungrouped];
  for (const g of sortByOrder(groups)) out.push(...sorted.filter((a) => a.groupId === g.id));
  return out;
}

export interface SeriesNav {
  index: number;
  total: number;
  prev?: SeriesArticle;
  next?: SeriesArticle;
  group?: SeriesGroup;
}

export function seriesNavigation(articles: SeriesArticle[], groups: SeriesGroup[], currentId: UUID): SeriesNav {
  const seq = orderedSeries(articles, groups);
  const index = seq.findIndex((a) => a.id === currentId);
  const cur = seq[index];
  return {
    index,
    total: seq.length,
    prev: index > 0 ? seq[index - 1] : undefined,
    next: index >= 0 && index < seq.length - 1 ? seq[index + 1] : undefined,
    group: cur?.groupId ? groups.find((g) => g.id === cur.groupId) : undefined,
  };
}

// ------------------------------------------------------------------ blog

export interface BlogMonth {
  key: string; // YYYY-MM
  year: number;
  month: number;
  posts: Post[];
}
export interface BlogTimeline {
  published: Post[];
  drafts: Post[];
  years: Array<{ year: number; months: BlogMonth[] }>;
}

export function isPublished(p: Post): boolean {
  return !!p.publishedAt && !Number.isNaN(Date.parse(p.publishedAt));
}

/** Published posts newest-first by publishedAt; drafts (publishedAt null) separately, newest edit first. */
export function blogTimeline(posts: Post[]): BlogTimeline {
  const published = posts
    .filter(isPublished)
    .sort((a, b) => Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!) || a.title.localeCompare(b.title));
  const drafts = posts.filter((p) => !isPublished(p)).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const yearMap = new Map<number, Map<string, BlogMonth>>();
  for (const p of published) {
    const d = p.publishedAt!.slice(0, 10);
    const year = Number(d.slice(0, 4));
    const month = Number(d.slice(5, 7));
    const key = `${d.slice(0, 4)}-${d.slice(5, 7)}`;
    if (!yearMap.has(year)) yearMap.set(year, new Map());
    const months = yearMap.get(year)!;
    if (!months.has(key)) months.set(key, { key, year, month, posts: [] });
    months.get(key)!.posts.push(p);
  }
  const years = [...yearMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, months]) => ({ year, months: [...months.values()].sort((a, b) => b.key.localeCompare(a.key)) }));
  return { published, drafts, years };
}

/** Blog "previous/next" in reading order (newest first list). */
export function blogNeighbours(posts: Post[], id: UUID): { newer?: Post; older?: Post } {
  const { published } = blogTimeline(posts);
  const i = published.findIndex((p) => p.id === id);
  if (i < 0) return {};
  return { newer: published[i - 1], older: published[i + 1] };
}
