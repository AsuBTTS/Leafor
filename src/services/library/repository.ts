/**
 * Leafor repository — the single owner of workspace metadata in memory.
 * Files on disk are authoritative; this class loads them, applies changes and
 * writes them back with per-file serialised, atomic writes.
 */
import type {
  BookItem,
  Chapter,
  Collection,
  ContentUnit,
  DocumentItem,
  Item,
  ItemType,
  LayoutProfile,
  LoadedCollection,
  LoadedItem,
  Photo,
  Post,
  SeriesArticle,
  SeriesGroup,
  StatusDefinition,
  TagDefinition,
  TargetRef,
  TextUnit,
  TrashEntry,
  UUID,
  WorkspaceMeta,
} from "@/domain/models/types";
import { applyOrder, findUnit, getUnits, sortByOrder, updateUnit, withUnits } from "@/domain/policies/units";
import { baseName, dirName, joinRel, newId, nowIso, slugify, uniqueFileName } from "@/domain/policies/naming";
import { defaultLayoutProfile, newWorkspaceMeta } from "@/domain/policies/defaults";
import { parseCollection, parseItem, parseWorkspace } from "@/domain/schemas";
import type { Backend } from "@/services/persistence/ports";
import { FsError } from "@/services/persistence/ports";

export const WS_DIR = ".leafor";
export const WS_FILE = ".leafor/workspace.json";
export const TRASH_DIR = ".leafor/trash";
export const TRASH_INDEX = ".leafor/trash/index.json";
export const RECOVERY_DIR = ".leafor/recovery";
export const CACHE_DIR = ".leafor/cache";
export const OPLOG_FILE = ".leafor/oplog.json";

export class NotAWorkspaceError extends Error {
  constructor(public root: string) {
    super("该文件夹还不是 Leafor 作品库");
  }
}

export interface RecoveryDraft {
  itemId: UUID;
  unitId: UUID;
  path: string;
  title: string;
  text: string;
  baseHash: string;
  savedAt: string;
}

export interface UnitInit {
  title?: string;
  text?: string;
  publishedAt?: string | null;
  groupId?: string | null;
  statusId?: string | null;
  tagIds?: string[];
  /** Insert position (index in ordered list). Default: end. */
  position?: number;
}

type Listener = () => void;

const UNIT_DIR: Record<string, string> = { book: "chapters", blog: "posts", article_series: "articles", photo_album: "photos", document: "" };

export class Repository {
  root = "";
  ws!: WorkspaceMeta;
  collections = new Map<UUID, LoadedCollection>();
  items = new Map<UUID, LoadedItem>();
  loadIssues: string[] = [];
  version = 0;
  private listeners = new Set<Listener>();
  private queues = new Map<string, Promise<unknown>>();

  constructor(public backend: Backend) {}

  get fs() {
    return this.backend.fs;
  }
  get isOpen() {
    return !!this.root && !!this.ws;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  /** Serialise writes per path; each write is atomic on the backend. */
  private enqueue<T>(path: string, job: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(path) ?? Promise.resolve();
    const next = prev.then(job, job);
    this.queues.set(
      path,
      next.catch(() => undefined),
    );
    return next;
  }
  async flushWrites(): Promise<void> {
    await Promise.all([...this.queues.values()]);
  }

  private writeJson(path: string, value: unknown) {
    return this.enqueue(path, () => this.fs.writeText(path, JSON.stringify(value, null, 2) + "\n"));
  }
  private async readJson<T>(path: string): Promise<T> {
    return JSON.parse(await this.fs.readText(path)) as T;
  }

  // ------------------------------------------------------------- workspace

  async createWorkspace(root: string, title: string): Promise<void> {
    const { root: r } = await this.backend.platform.openWorkspace(root, { create: true, title });
    this.root = r;
    if (await this.fs.stat(WS_FILE)) {
      await this.loadWorkspace();
      return;
    }
    this.ws = newWorkspaceMeta(title);
    for (const d of ["collections", TRASH_DIR, RECOVERY_DIR, CACHE_DIR]) await this.fs.mkdir(d);
    await this.writeJson(WS_FILE, this.ws);
    await this.writeJson(TRASH_INDEX, []);
    await this.fs.writeText(
      ".leafor/README.txt",
      "本文件夹由 Leafor 管理：workspace.json 保存工作区词条与设置；cache/ 可随时删除并自动重建；trash/ 为应用内回收站；recovery/ 为未保存草稿。\n",
    );
    this.collections.clear();
    this.items.clear();
    this.emit();
  }

  async openWorkspace(root: string): Promise<void> {
    const { root: r } = await this.backend.platform.openWorkspace(root, { create: false });
    this.root = r;
    if (!(await this.fs.stat(WS_FILE))) throw new NotAWorkspaceError(r);
    await this.loadWorkspace();
    await this.backend.platform.recentRename(r, this.ws.title).catch(() => undefined);
  }

  async closeWorkspace(): Promise<void> {
    await this.flushWrites();
    await this.backend.platform.closeWorkspace();
    this.root = "";
    this.collections.clear();
    this.items.clear();
    (this as { ws?: WorkspaceMeta }).ws = undefined;
    this.emit();
  }

  /** (Re)load all metadata from disk. Invalid files are reported, never deleted. */
  async loadWorkspace(): Promise<void> {
    this.loadIssues = [];
    this.ws = parseWorkspace(await this.readJson(WS_FILE), WS_FILE);
    const collections = new Map<UUID, LoadedCollection>();
    const items = new Map<UUID, LoadedItem>();
    await this.fs.mkdir("collections");
    for (const cEntry of await this.fs.list("collections")) {
      if (!cEntry.isDir) continue;
      const cDir = joinRel("collections", cEntry.name);
      let meta: Collection;
      try {
        meta = parseCollection(await this.readJson(joinRel(cDir, "collection.json")), joinRel(cDir, "collection.json"));
      } catch (e) {
        if (e instanceof FsError && e.kind === "not_found") continue;
        this.loadIssues.push(String((e as Error).message));
        continue;
      }
      const found: UUID[] = [];
      for (const iEntry of await this.fs.list(joinRel(cDir, "items"))) {
        if (!iEntry.isDir) continue;
        const iDir = joinRel(cDir, "items", iEntry.name);
        try {
          const item = parseItem(await this.readJson(joinRel(iDir, "item.json")), joinRel(iDir, "item.json"));
          if (items.has(item.id)) {
            this.loadIssues.push(`重复的单品 ID：${item.id}（${iDir}）`);
            continue;
          }
          items.set(item.id, { meta: item, dir: iDir, collectionId: meta.id });
          found.push(item.id);
        } catch (e) {
          if (e instanceof FsError && e.kind === "not_found") continue;
          this.loadIssues.push(String((e as Error).message));
        }
      }
      // Repair order: keep known order, drop missing, append untracked.
      const known = meta.itemIds.filter((id) => found.includes(id));
      const extra = found.filter((id) => !known.includes(id));
      meta = { ...meta, itemIds: [...known, ...extra] };
      collections.set(meta.id, { meta, dir: cDir });
    }
    this.collections = collections;
    this.items = items;
    const order = this.ws.collectionOrder.filter((id) => collections.has(id));
    for (const id of collections.keys()) if (!order.includes(id)) order.push(id);
    this.ws.collectionOrder = order;
    this.emit();
  }

  async saveWorkspace(patch?: Partial<WorkspaceMeta>): Promise<void> {
    if (patch) this.ws = { ...this.ws, ...patch };
    this.emit();
    await this.writeJson(WS_FILE, this.ws);
  }

  // ------------------------------------------------------------- queries

  orderedCollections(): LoadedCollection[] {
    return this.ws.collectionOrder.map((id) => this.collections.get(id)!).filter(Boolean);
  }

  /** Items in library order (collection order, then item order). */
  orderedItems(collectionId?: UUID | null): LoadedItem[] {
    const cols = collectionId ? [this.collections.get(collectionId)].filter(Boolean) : this.orderedCollections();
    const out: LoadedItem[] = [];
    for (const c of cols as LoadedCollection[]) for (const id of c.meta.itemIds) {
      const it = this.items.get(id);
      if (it) out.push(it);
    }
    return out;
  }

  getItem(id: UUID): LoadedItem | undefined {
    return this.items.get(id);
  }
  requireItem(id: UUID): LoadedItem {
    const it = this.items.get(id);
    if (!it) throw new Error(`找不到单品 ${id}`);
    return it;
  }
  unitPath(itemId: UUID, unit: ContentUnit): string {
    return joinRel(this.requireItem(itemId).dir, unit.path);
  }
  itemFile(itemId: UUID, rel: string): string {
    return joinRel(this.requireItem(itemId).dir, rel);
  }
  tag(id: string): TagDefinition | undefined {
    return this.ws.tags.find((t) => t.id === id);
  }
  status(id?: string | null): StatusDefinition | undefined {
    return id ? this.ws.statuses.find((s) => s.id === id) : undefined;
  }
  orderedStatuses(): StatusDefinition[] {
    return sortByOrder(this.ws.statuses);
  }

  // ------------------------------------------------------------- collections

  async createCollection(title: string): Promise<Collection> {
    const id = newId("c");
    const dir = joinRel("collections", `${slugify(title, 24)}--${id}`);
    const now = nowIso();
    const meta: Collection = { schemaVersion: 1, id, title, itemIds: [], createdAt: now, updatedAt: now };
    await this.fs.mkdir(joinRel(dir, "items"));
    await this.writeJson(joinRel(dir, "collection.json"), meta);
    this.collections.set(id, { meta, dir });
    this.ws.collectionOrder = [...this.ws.collectionOrder, id];
    await this.saveWorkspace();
    return meta;
  }

  async updateCollection(id: UUID, patch: Partial<Collection>): Promise<void> {
    const c = this.collections.get(id);
    if (!c) return;
    c.meta = { ...c.meta, ...patch, id, updatedAt: nowIso() };
    this.emit();
    await this.writeJson(joinRel(c.dir, "collection.json"), c.meta);
  }

  async reorderCollections(ids: UUID[]): Promise<void> {
    await this.saveWorkspace({ collectionOrder: ids.filter((id) => this.collections.has(id)) });
  }

  /** Move an entire collection (with its items) to the in-app trash. */
  async trashCollection(id: UUID): Promise<void> {
    const c = this.collections.get(id);
    if (!c) return;
    await this.flushWrites();
    const entry = await this.moveToTrash(c.dir, { kind: "collection", title: c.meta.title, collectionId: id });
    for (const iid of c.meta.itemIds) this.items.delete(iid);
    this.collections.delete(id);
    this.ws.collectionOrder = this.ws.collectionOrder.filter((x) => x !== id);
    await this.saveWorkspace();
    void entry;
  }

  // ------------------------------------------------------------- items

  async createItem(collectionId: UUID, type: ItemType, title: string, extra?: Partial<Item>): Promise<LoadedItem> {
    const c = this.collections.get(collectionId);
    if (!c) throw new Error("集合不存在");
    const id = newId("i");
    const dir = joinRel(c.dir, "items", `${slugify(title, 24)}--${id}`);
    const now = nowIso();
    const common = { schemaVersion: 1 as const, id, title, tagIds: [], statusId: null, createdAt: now, updatedAt: now };
    let item: Item;
    switch (type) {
      case "book":
        item = { ...common, type, data: { chapters: [], layoutProfilePath: "layouts/print.json" } };
        await this.fs.mkdir(joinRel(dir, "chapters"));
        await this.fs.mkdir(joinRel(dir, "assets"));
        break;
      case "photo_album":
        item = { ...common, type, data: { photos: [], groups: [] } };
        await this.fs.mkdir(joinRel(dir, "photos"));
        break;
      case "blog":
        item = { ...common, type, data: { posts: [] } };
        await this.fs.mkdir(joinRel(dir, "posts"));
        await this.fs.mkdir(joinRel(dir, "assets"));
        break;
      case "article_series":
        item = { ...common, type, data: { articles: [], groups: [] } };
        await this.fs.mkdir(joinRel(dir, "articles"));
        await this.fs.mkdir(joinRel(dir, "assets"));
        break;
      case "document": {
        const content: TextUnit = { id: newId("u"), type: "text", title, path: "content.md", order: 0, tagIds: [], statusId: null, createdAt: now, updatedAt: now };
        item = { ...common, type, data: { content } };
        await this.fs.writeText(joinRel(dir, "content.md"), `# ${title}\n\n`, "");
        await this.fs.mkdir(joinRel(dir, "assets"));
        break;
      }
      case "pdf":
        throw new Error("PDF 单品只能通过导入创建");
    }
    item = { ...item, ...(extra as object) } as Item;
    await this.writeJson(joinRel(dir, "item.json"), item);
    const loaded: LoadedItem = { meta: item, dir, collectionId };
    this.items.set(id, loaded);
    c.meta = { ...c.meta, itemIds: [...c.meta.itemIds, id], updatedAt: now };
    await this.writeJson(joinRel(c.dir, "collection.json"), c.meta);
    this.emit();
    return loaded;
  }

  /** Register an item whose folder was fully prepared (import staging). */
  async registerPreparedItem(collectionId: UUID, dir: string, item: Item): Promise<LoadedItem> {
    const c = this.collections.get(collectionId);
    if (!c) throw new Error("集合不存在");
    await this.writeJson(joinRel(dir, "item.json"), item);
    const loaded: LoadedItem = { meta: item, dir, collectionId };
    this.items.set(item.id, loaded);
    c.meta = { ...c.meta, itemIds: [...c.meta.itemIds, item.id], updatedAt: nowIso() };
    await this.writeJson(joinRel(c.dir, "collection.json"), c.meta);
    this.emit();
    return loaded;
  }

  newItemDir(collectionId: UUID, title: string, id: UUID): string {
    const c = this.collections.get(collectionId);
    if (!c) throw new Error("集合不存在");
    return joinRel(c.dir, "items", `${slugify(title, 24)}--${id}`);
  }

  async saveItem(item: Item): Promise<void> {
    const it = this.requireItem(item.id);
    it.meta = item;
    this.emit();
    await this.writeJson(joinRel(it.dir, "item.json"), item);
  }

  async updateItem(id: UUID, patch: Partial<Item> | ((i: Item) => Item)): Promise<Item> {
    const it = this.requireItem(id);
    const next = typeof patch === "function" ? patch(it.meta) : ({ ...it.meta, ...patch, id, type: it.meta.type, updatedAt: nowIso() } as Item);
    await this.saveItem(next);
    return next;
  }

  async reorderItems(collectionId: UUID, orderedIds: UUID[]): Promise<void> {
    const c = this.collections.get(collectionId);
    if (!c) return;
    const set = new Set(c.meta.itemIds);
    const ids = orderedIds.filter((x) => set.has(x));
    for (const x of c.meta.itemIds) if (!ids.includes(x)) ids.push(x);
    await this.updateCollection(collectionId, { itemIds: ids });
  }

  async moveItem(itemId: UUID, targetCollectionId: UUID, position?: number): Promise<void> {
    const it = this.requireItem(itemId);
    if (it.collectionId === targetCollectionId) return;
    const from = this.collections.get(it.collectionId)!;
    const to = this.collections.get(targetCollectionId);
    if (!to) throw new Error("目标集合不存在");
    await this.flushWrites();
    const newDir = joinRel(to.dir, "items", baseName(it.dir));
    // Ordered commit: move folder first, then update both collection files.
    await this.fs.move(it.dir, newDir);
    it.dir = newDir;
    it.collectionId = targetCollectionId;
    const ids = [...to.meta.itemIds];
    ids.splice(position ?? ids.length, 0, itemId);
    await this.updateCollection(from.meta.id, { itemIds: from.meta.itemIds.filter((x) => x !== itemId) });
    await this.updateCollection(to.meta.id, { itemIds: ids });
  }

  async setArchived(itemId: UUID, archived: boolean): Promise<void> {
    await this.updateItem(itemId, { archived } as Partial<Item>);
  }

  async trashItem(itemId: UUID): Promise<void> {
    const it = this.requireItem(itemId);
    await this.flushWrites();
    await this.moveToTrash(it.dir, { kind: "item", title: it.meta.title, collectionId: it.collectionId, itemId, itemType: it.meta.type });
    this.items.delete(itemId);
    const c = this.collections.get(it.collectionId);
    if (c) await this.updateCollection(c.meta.id, { itemIds: c.meta.itemIds.filter((x) => x !== itemId) });
    this.emit();
  }

  // ------------------------------------------------------------- content units

  async addUnit(itemId: UUID, init: UnitInit = {}): Promise<ContentUnit> {
    const it = this.requireItem(itemId);
    const item = it.meta;
    if (item.type === "pdf" || item.type === "document" || item.type === "photo_album") throw new Error("该类型不支持新建文本单元");
    const sub = UNIT_DIR[item.type];
    const existing = (await this.fs.list(joinRel(it.dir, sub))).map((e) => e.name);
    const units = getUnits(item);
    const title = init.title?.trim() || defaultUnitTitle(item.type, units.length);
    const file = uniqueFileName(fileStem(item.type, units.length, title), "md", existing);
    const path = joinRel(sub, file);
    const now = nowIso();
    const base = { id: newId("u"), title, path, order: units.length, statusId: init.statusId ?? null, tagIds: init.tagIds ?? [], createdAt: now, updatedAt: now };
    let unit: ContentUnit;
    if (item.type === "book") unit = { ...base, type: "chapter" } as Chapter;
    else if (item.type === "blog") unit = { ...base, type: "post", publishedAt: init.publishedAt ?? null, slug: slugify(title, 60) } as Post;
    else unit = { ...base, type: "series_article", groupId: init.groupId ?? null } as SeriesArticle;
    const text = init.text ?? `# ${title}\n\n`;
    await this.fs.writeText(joinRel(it.dir, path), text, "");
    let list = [...units, unit];
    if (init.position !== undefined && init.position < units.length) {
      list = [...units];
      list.splice(init.position, 0, unit);
    }
    await this.saveItem(withUnits(item, list));
    return findUnit(this.requireItem(itemId).meta, unit.id)!;
  }

  async addPhotos(itemId: UUID, photos: Photo[]): Promise<void> {
    const it = this.requireItem(itemId);
    if (it.meta.type !== "photo_album") throw new Error("不是摄影集");
    const list = [...getUnits(it.meta), ...photos];
    await this.saveItem(withUnits(it.meta, list));
  }

  async updateUnit(itemId: UUID, unitId: UUID, patch: Partial<ContentUnit>): Promise<void> {
    const it = this.requireItem(itemId);
    const { path: _ignored, ...safe } = patch as Partial<ContentUnit> & { path?: string };
    void _ignored;
    await this.saveItem(updateUnit(it.meta, unitId, safe));
  }

  async updateUnits(itemId: UUID, unitIds: UUID[], patch: Partial<ContentUnit> | ((u: ContentUnit) => Partial<ContentUnit>)): Promise<void> {
    const it = this.requireItem(itemId);
    let item = it.meta;
    for (const id of unitIds) {
      const u = findUnit(item, id);
      if (!u) continue;
      item = updateUnit(item, id, typeof patch === "function" ? patch(u) : patch);
    }
    await this.saveItem(item);
  }

  async reorderUnits(itemId: UUID, orderedIds: UUID[]): Promise<void> {
    const it = this.requireItem(itemId);
    const units = applyOrder(getUnits(it.meta), orderedIds);
    await this.saveItem(withUnits(it.meta, units));
  }

  async deleteUnit(itemId: UUID, unitId: UUID): Promise<void> {
    const it = this.requireItem(itemId);
    const unit = findUnit(it.meta, unitId);
    if (!unit || it.meta.type === "document") return;
    await this.flushWrites();
    const file = joinRel(it.dir, unit.path);
    if (await this.fs.stat(file)) {
      await this.moveToTrash(file, { kind: "unit", title: unit.title, itemId, unit, collectionId: it.collectionId });
    }
    await this.saveItem(withUnits(it.meta, getUnits(it.meta).filter((u) => u.id !== unitId)));
    await this.clearRecovery(unitId);
  }

  async duplicateUnit(itemId: UUID, unitId: UUID): Promise<ContentUnit | undefined> {
    const it = this.requireItem(itemId);
    const unit = findUnit(it.meta, unitId);
    if (!unit || unit.type === "photo" || unit.type === "text") return;
    const { text } = await this.readUnitText(itemId, unitId);
    const idx = getUnits(it.meta).findIndex((u) => u.id === unitId);
    return this.addUnit(itemId, {
      title: `${unit.title}（副本）`,
      text,
      position: idx + 1,
      groupId: unit.type === "series_article" ? unit.groupId ?? null : undefined,
      tagIds: [...unit.tagIds],
      statusId: unit.statusId,
      publishedAt: null,
    });
  }

  async readUnitText(itemId: UUID, unitId: UUID): Promise<{ text: string; hash: string; path: string }> {
    const it = this.requireItem(itemId);
    const unit = findUnit(it.meta, unitId);
    if (!unit) throw new Error("内容单元不存在");
    if (unit.type === "photo") throw new Error("照片不是文本");
    const path = joinRel(it.dir, unit.path);
    const text = await this.fs.readText(path);
    const hash = await this.fs.hash(path);
    return { text, hash, path };
  }

  /** Guarded save: throws FsError("conflict") if disk changed since `expectedHash`. */
  async saveUnitText(itemId: UUID, unitId: UUID, text: string, expectedHash: string): Promise<string> {
    const it = this.requireItem(itemId);
    const unit = findUnit(it.meta, unitId);
    if (!unit || unit.type === "photo") throw new Error("内容单元不存在");
    if (it.meta.type === "pdf") throw new Error("PDF 为只读对象");
    const path = joinRel(it.dir, unit.path);
    const { hash } = await this.enqueue(path, () => this.fs.writeText(path, text, expectedHash));
    await this.clearRecovery(unitId);
    const last = Date.parse(unit.updatedAt) || 0;
    if (Date.now() - last > 30_000) await this.saveItem(updateUnit(it.meta, unitId, {}));
    return hash;
  }

  // ------------------------------------------------------------- series groups

  async addSeriesGroup(itemId: UUID, title: string): Promise<SeriesGroup> {
    const it = this.requireItem(itemId);
    if (it.meta.type !== "article_series") throw new Error("不是系列文章");
    const groups = it.meta.data.groups ?? [];
    const g: SeriesGroup = { id: newId("g"), title, order: groups.length };
    await this.saveItem({ ...it.meta, updatedAt: nowIso(), data: { ...it.meta.data, groups: [...groups, g] } });
    return g;
  }

  async updateSeriesGroups(itemId: UUID, groups: SeriesGroup[]): Promise<void> {
    const it = this.requireItem(itemId);
    if (it.meta.type !== "article_series") return;
    const ids = new Set(groups.map((g) => g.id));
    const articles = it.meta.data.articles.map((a) => (a.groupId && !ids.has(a.groupId) ? { ...a, groupId: null } : a));
    await this.saveItem({ ...it.meta, updatedAt: nowIso(), data: { ...it.meta.data, groups: groups.map((g, i) => ({ ...g, order: i })), articles } });
  }

  /** Move an article into a group (or ungrouped) at a position within the reading sequence. */
  async placeSeriesArticle(itemId: UUID, articleId: UUID, groupId: UUID | null, orderedIds: UUID[]): Promise<void> {
    const it = this.requireItem(itemId);
    if (it.meta.type !== "article_series") return;
    const articles = it.meta.data.articles.map((a) => (a.id === articleId ? { ...a, groupId } : a));
    const ordered = applyOrder(articles, orderedIds);
    await this.saveItem({ ...it.meta, updatedAt: nowIso(), data: { ...it.meta.data, articles: ordered } });
  }

  // ------------------------------------------------------------- tags & statuses

  async upsertTag(tag: TagDefinition): Promise<void> {
    const tags = this.ws.tags.some((t) => t.id === tag.id) ? this.ws.tags.map((t) => (t.id === tag.id ? tag : t)) : [...this.ws.tags, tag];
    await this.saveWorkspace({ tags });
  }
  async createTag(name: string, color?: string): Promise<TagDefinition> {
    const existing = this.ws.tags.find((t) => t.name === name.trim());
    if (existing) return existing;
    const tag = { id: newId("t"), name: name.trim(), color: color ?? pickColor(this.ws.tags.length) };
    await this.upsertTag(tag);
    return tag;
  }
  async upsertStatus(status: StatusDefinition): Promise<void> {
    const statuses = this.ws.statuses.some((s) => s.id === status.id) ? this.ws.statuses.map((s) => (s.id === status.id ? status : s)) : [...this.ws.statuses, status];
    await this.saveWorkspace({ statuses });
  }
  async createStatus(name: string, color?: string): Promise<StatusDefinition> {
    const s = { id: newId("s"), name: name.trim(), color: color ?? pickColor(this.ws.statuses.length + 3), order: this.ws.statuses.length };
    await this.upsertStatus(s);
    return s;
  }
  async reorderStatuses(ids: string[]): Promise<void> {
    const statuses = applyOrder(this.ws.statuses, ids);
    await this.saveWorkspace({ statuses });
  }

  /** Count of objects using a tag/status (for delete confirmation). */
  usage(kind: "tag" | "status", id: string): number {
    let n = 0;
    for (const it of this.items.values()) {
      if (kind === "tag" ? it.meta.tagIds.includes(id) : it.meta.statusId === id) n++;
      for (const u of getUnits(it.meta)) if (kind === "tag" ? u.tagIds.includes(id) : u.statusId === id) n++;
    }
    for (const c of this.collections.values()) if (kind === "tag" && c.meta.tagIds?.includes(id)) n++;
    return n;
  }

  /** Delete a tag/status definition and remove references from all metadata. */
  async deleteDefinition(kind: "tag" | "status", id: string): Promise<void> {
    if (kind === "tag") this.ws = { ...this.ws, tags: this.ws.tags.filter((t) => t.id !== id) };
    else this.ws = { ...this.ws, statuses: this.ws.statuses.filter((s) => s.id !== id) };
    await this.saveWorkspace();
    for (const it of [...this.items.values()]) {
      let item = it.meta;
      let changed = false;
      if (kind === "tag" && item.tagIds.includes(id)) {
        item = { ...item, tagIds: item.tagIds.filter((t) => t !== id) } as Item;
        changed = true;
      }
      if (kind === "status" && item.statusId === id) {
        item = { ...item, statusId: null } as Item;
        changed = true;
      }
      for (const u of getUnits(item)) {
        if (kind === "tag" && u.tagIds.includes(id)) {
          item = updateUnit(item, u.id, { tagIds: u.tagIds.filter((t) => t !== id) });
          changed = true;
        }
        if (kind === "status" && u.statusId === id) {
          item = updateUnit(item, u.id, { statusId: null });
          changed = true;
        }
      }
      if (changed) await this.saveItem(item);
    }
    for (const c of this.collections.values()) {
      if (kind === "tag" && c.meta.tagIds?.includes(id)) await this.updateCollection(c.meta.id, { tagIds: c.meta.tagIds.filter((t) => t !== id) });
    }
  }

  /** Read the tags/status of any target. */
  marks(target: TargetRef): { tagIds: string[]; statusId: string | null } {
    if (target.kind === "collection") {
      const c = this.collections.get(target.collectionId);
      return { tagIds: c?.meta.tagIds ?? [], statusId: null };
    }
    const it = this.items.get(target.itemId);
    if (!it) return { tagIds: [], statusId: null };
    if (target.kind === "item") return { tagIds: it.meta.tagIds, statusId: it.meta.statusId ?? null };
    const u = findUnit(it.meta, target.unitId);
    return { tagIds: u?.tagIds ?? [], statusId: u?.statusId ?? null };
  }

  /** Set marks on a target. Item-level and unit-level marks are independent. */
  async setMarks(target: TargetRef, patch: { tagIds?: string[]; statusId?: string | null }): Promise<void> {
    if (target.kind === "collection") {
      if (patch.tagIds) await this.updateCollection(target.collectionId, { tagIds: patch.tagIds });
      return;
    }
    if (target.kind === "item") {
      await this.updateItem(target.itemId, patch as Partial<Item>);
      return;
    }
    await this.updateUnit(target.itemId, target.unitId, patch as Partial<ContentUnit>);
  }

  // ------------------------------------------------------------- trash

  async listTrash(): Promise<TrashEntry[]> {
    try {
      return await this.readJson<TrashEntry[]>(TRASH_INDEX);
    } catch {
      return [];
    }
  }

  private async moveToTrash(path: string, info: Omit<TrashEntry, "id" | "trashPath" | "originalPath" | "deletedAt">): Promise<TrashEntry> {
    const id = newId("x");
    const trashPath = joinRel(TRASH_DIR, `${Date.now()}--${id}--${baseName(path)}`);
    await this.fs.move(path, trashPath);
    const entry: TrashEntry = { ...info, id, trashPath, originalPath: path, deletedAt: nowIso() };
    await this.enqueue(TRASH_INDEX, async () => {
      const list = await this.listTrash();
      await this.fs.writeText(TRASH_INDEX, JSON.stringify([entry, ...list], null, 2));
    });
    this.emit();
    return entry;
  }

  async restoreTrash(entryId: string): Promise<void> {
    const list = await this.listTrash();
    const e = list.find((x) => x.id === entryId);
    if (!e) return;
    let target = e.originalPath;
    if (await this.fs.stat(target)) target = joinRel(dirName(target), `${Date.now()}-restored-${baseName(target)}`);
    if (e.kind === "item" || e.kind === "collection") {
      // Restore into its original collection if it still exists, else into the first collection.
      if (e.kind === "item" && e.collectionId && !this.collections.has(e.collectionId)) {
        const first = this.orderedCollections()[0] ?? { meta: await this.createCollection("已恢复") , dir: "" };
        const c = this.collections.get(first.meta.id)!;
        target = joinRel(c.dir, "items", baseName(e.originalPath));
      }
      await this.fs.move(e.trashPath, target);
    } else {
      await this.fs.move(e.trashPath, target);
      const it = e.itemId ? this.items.get(e.itemId) : undefined;
      if (it && e.unit) {
        const relPath = target.startsWith(it.dir + "/") ? target.slice(it.dir.length + 1) : e.unit.path;
        const unit = { ...e.unit, path: relPath, order: getUnits(it.meta).length } as ContentUnit;
        await this.saveItem(withUnits(it.meta, [...getUnits(it.meta), unit]));
      }
    }
    await this.enqueue(TRASH_INDEX, () => this.fs.writeText(TRASH_INDEX, JSON.stringify(list.filter((x) => x.id !== entryId), null, 2)));
    if (e.kind !== "unit") await this.loadWorkspace();
    else this.emit();
  }

  /** Permanently delete a trash entry (only ever inside .leafor/trash). */
  async purgeTrash(entryId: string): Promise<void> {
    const list = await this.listTrash();
    const e = list.find((x) => x.id === entryId);
    if (!e) return;
    if (!e.trashPath.startsWith(TRASH_DIR + "/")) throw new Error("非法回收站路径");
    await this.fs.remove(e.trashPath);
    await this.enqueue(TRASH_INDEX, () => this.fs.writeText(TRASH_INDEX, JSON.stringify(list.filter((x) => x.id !== entryId), null, 2)));
    this.emit();
  }

  // ------------------------------------------------------------- recovery drafts

  async writeRecovery(d: RecoveryDraft): Promise<void> {
    const p = joinRel(RECOVERY_DIR, `${d.unitId}.json`);
    await this.enqueue(p, () => this.fs.writeText(p, JSON.stringify(d)));
  }
  async clearRecovery(unitId: UUID): Promise<void> {
    const p = joinRel(RECOVERY_DIR, `${unitId}.json`);
    await this.enqueue(p, async () => {
      if (await this.fs.stat(p)) await this.fs.remove(p);
    });
  }
  async listRecovery(): Promise<RecoveryDraft[]> {
    const out: RecoveryDraft[] = [];
    for (const e of await this.fs.list(RECOVERY_DIR).catch(() => [])) {
      if (!e.name.endsWith(".json")) continue;
      try {
        const d = await this.readJson<RecoveryDraft>(joinRel(RECOVERY_DIR, e.name));
        if (this.items.has(d.itemId)) out.push(d);
      } catch {
        /* ignore broken drafts */
      }
    }
    return out;
  }

  // ------------------------------------------------------------- layout profile

  async readLayout(itemId: UUID): Promise<LayoutProfile> {
    const it = this.requireItem(itemId);
    if (it.meta.type !== "book" && it.meta.type !== "article_series" && it.meta.type !== "document") return defaultLayoutProfile();
    const rel = (it.meta.type === "book" && it.meta.data.layoutProfilePath) || "layouts/print.json";
    try {
      const raw = await this.readJson<LayoutProfile>(joinRel(it.dir, rel));
      const d = defaultLayoutProfile();
      return { ...d, ...raw, page: { ...d.page, ...raw.page }, marginsMm: { ...d.marginsMm, ...raw.marginsMm }, typography: { ...d.typography, ...raw.typography }, chapters: { ...d.chapters, ...raw.chapters }, headerFooter: { ...d.headerFooter, ...raw.headerFooter } };
    } catch {
      return defaultLayoutProfile();
    }
  }

  async saveLayout(itemId: UUID, profile: LayoutProfile): Promise<void> {
    const it = this.requireItem(itemId);
    const rel = (it.meta.type === "book" && it.meta.data.layoutProfilePath) || "layouts/print.json";
    await this.writeJson(joinRel(it.dir, rel), profile);
    if (it.meta.type === "book" && !it.meta.data.layoutProfilePath) {
      await this.saveItem({ ...(it.meta as BookItem), data: { ...(it.meta as BookItem).data, layoutProfilePath: rel } });
    }
  }

  // ------------------------------------------------------------- misc

  isDocument(item: Item): item is DocumentItem {
    return item.type === "document";
  }
}

function defaultUnitTitle(type: ItemType, n: number): string {
  if (type === "book") return `第${toChineseNumber(n + 1)}章`;
  if (type === "blog") return "未命名博文";
  return `第 ${n + 1} 篇`;
}

function fileStem(type: ItemType, n: number, title: string): string {
  const num = String(n + 1).padStart(2, "0");
  if (type === "book" || type === "article_series") return `${num}-${slugify(title, 30)}`;
  return slugify(title, 40);
}

export function toChineseNumber(n: number): string {
  const d = "零一二三四五六七八九";
  if (n < 10) return d[n];
  if (n < 20) return "十" + (n % 10 ? d[n % 10] : "");
  if (n < 100) return d[Math.floor(n / 10)] + "十" + (n % 10 ? d[n % 10] : "");
  return String(n);
}

const PALETTE = ["#5d7f74", "#6b7a8f", "#a0705a", "#8d8a5a", "#7d6aa6", "#3f7d72", "#b88a2e", "#b5654a", "#4f6d8a", "#8a5a7a"];
export function pickColor(i: number): string {
  return PALETTE[i % PALETTE.length];
}
