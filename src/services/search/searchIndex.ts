/**
 * Search index (technical design §7): an in-memory query engine over item and
 * content-unit metadata plus Markdown body text, backed on desktop by the
 * rebuildable SQLite cache (body text keyed by file mtime/size so unchanged
 * files are not re-read). Chinese uses substring matching (M1 per ADR-011).
 */
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { repo, isDesktop } from "@/app/backend";
import type { ItemType, UnitType, UUID } from "@/domain/models/types";
import { getUnits } from "@/domain/policies/units";
import { joinRel } from "@/domain/policies/naming";
import { markdownToPlain } from "@/components/markdown/pipeline";

export interface IndexDoc {
  key: string;
  kind: "item" | "unit";
  itemId: UUID;
  unitId?: UUID;
  collectionId: UUID;
  itemType: ItemType;
  unitType?: UnitType;
  title: string;
  body: string;
  tagIds: string[];
  statusId: string | null;
  publishedAt?: string | null;
  updatedAt: string;
  archived?: boolean;
}

export interface SearchFilters {
  types?: ItemType[];
  collectionId?: string | null;
  tagIds?: string[];
  statusId?: string | null;
  kinds?: Array<"item" | "unit">;
  includeArchived?: boolean;
}

export interface SearchHit {
  doc: IndexDoc;
  score: number;
  snippet?: { before: string; match: string; after: string };
}

type CacheRow = { id: string; body: string | null; file_mtime: number | null; file_size: number | null };

class SearchIndex {
  docs = new Map<string, IndexDoc>();
  state: "idle" | "building" | "ready" | "error" = "idle";
  error?: string;
  sqliteOk = isDesktop;
  sqliteError?: string;
  private version = 0;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getVersion = () => this.version;
  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  scheduleRebuild(delay = 400) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.rebuild(), delay);
  }

  private async sql<T>(cmd: "index_select" | "index_execute" | "index_batch" | "index_reset", args: Record<string, unknown>): Promise<T | null> {
    if (!this.sqliteOk) return null;
    try {
      return await invoke<T>(cmd, args);
    } catch (e) {
      console.warn("index cache unavailable", e);
      this.sqliteError = String(e);
      this.sqliteOk = false;
      return null;
    }
  }

  /** Full rebuild from workspace files. Never blocks reading/editing. */
  async rebuild(full = true): Promise<void> {
    if (!repo.isOpen) return;
    const gen = ++this.generation;
    this.state = "building";
    this.emit();
    try {
      const wsId = repo.ws.id;
      const cached = new Map<string, CacheRow>();
      const rows = await this.sql<CacheRow[]>("index_select", { sql: "SELECT cu.id AS id, cu.body AS body, cu.file_mtime AS file_mtime, cu.file_size AS file_size FROM content_units cu JOIN items i ON cu.item_id = i.id JOIN collections c ON i.collection_id = c.id WHERE c.workspace_id = ?", params: [wsId] });
      rows?.forEach((r) => cached.set(r.id, r));

      const docs = new Map<string, IndexDoc>();
      const stmts: Array<{ sql: string; params: unknown[] }> = [
        { sql: "DELETE FROM workspaces WHERE id = ?", params: [wsId] },
        { sql: "INSERT INTO workspaces(id, root_path, title, indexed_at) VALUES (?,?,?,?)", params: [wsId, repo.root, repo.ws.title, new Date().toISOString()] },
      ];
      repo.orderedCollections().forEach((c, ci) => {
        stmts.push({ sql: "INSERT OR REPLACE INTO collections(id, workspace_id, title, rel_path, sort_order) VALUES (?,?,?,?,?)", params: [c.meta.id, wsId, c.meta.title, c.dir, ci] });
      });
      for (const it of repo.orderedItems()) {
        if (gen !== this.generation) return;
        const m = it.meta;
        docs.set(m.id, {
          key: m.id,
          kind: "item",
          itemId: m.id,
          collectionId: it.collectionId,
          itemType: m.type,
          title: m.title,
          body: [m.summary, m.author, m.notes, m.type === "pdf" ? m.data.sourceName : ""].filter(Boolean).join(" "),
          tagIds: m.tagIds,
          statusId: m.statusId ?? null,
          updatedAt: m.updatedAt,
          archived: m.archived,
        });
        const sort = repo.collections.get(it.collectionId)?.meta.itemIds.indexOf(m.id) ?? 0;
        stmts.push({ sql: "INSERT OR REPLACE INTO items(id, collection_id, item_type, title, rel_path, status_id, sort_order, updated_at) VALUES (?,?,?,?,?,?,?,?)", params: [m.id, it.collectionId, m.type, m.title, it.dir, m.statusId ?? null, sort, m.updatedAt] });
        m.tagIds.forEach((t) => stmts.push({ sql: "INSERT OR REPLACE INTO object_tags VALUES (?,?,?,?)", params: [wsId, "item", m.id, t] }));
        for (const u of getUnits(m)) {
          let body = "";
          let mtime: number | null = null;
          let size: number | null = null;
          const prev = this.docs.get(`${m.id}:${u.id}`);
          if (u.type === "photo") body = [u.caption, u.notes].filter(Boolean).join(" ");
          else if (!full && prev) body = prev.body;
          else {
            const path = joinRel(it.dir, u.path);
            const st = await repo.fs.stat(path).catch(() => null);
            mtime = st?.mtimeMs ?? null;
            size = st?.size ?? null;
            const c = cached.get(u.id);
            if (c && c.body !== null && st && c.file_mtime === st.mtimeMs && c.file_size === st.size) body = c.body;
            else if (st) body = markdownToPlain(await repo.fs.readText(path).catch(() => ""));
          }
          docs.set(`${m.id}:${u.id}`, {
            key: `${m.id}:${u.id}`,
            kind: "unit",
            itemId: m.id,
            unitId: u.id,
            collectionId: it.collectionId,
            itemType: m.type,
            unitType: u.type,
            title: u.title,
            body,
            tagIds: u.tagIds,
            statusId: u.statusId ?? null,
            publishedAt: u.type === "post" ? u.publishedAt : undefined,
            updatedAt: u.updatedAt,
            archived: m.archived,
          });
          stmts.push({
            sql: "INSERT OR REPLACE INTO content_units(id, item_id, unit_type, title, rel_path, status_id, sort_order, published_at, body, file_mtime, file_size) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            params: [u.id, m.id, u.type, u.title, u.path, u.statusId ?? null, u.order, u.type === "post" ? u.publishedAt : null, body, mtime, size],
          });
          u.tagIds.forEach((t) => stmts.push({ sql: "INSERT OR REPLACE INTO object_tags VALUES (?,?,?,?)", params: [wsId, "unit", u.id, t] }));
        }
      }
      if (gen !== this.generation) return;
      this.docs = docs;
      this.state = "ready";
      this.emit();
      await this.sql("index_batch", { statements: [{ sql: "DELETE FROM object_tags WHERE workspace_id = ?", params: [wsId] }, ...stmts] });
    } catch (e) {
      console.error(e);
      this.state = "error";
      this.error = String((e as Error)?.message ?? e);
      this.emit();
    }
  }

  /** Incremental body update after a save. */
  updateUnitText(itemId: string, unitId: string, text: string) {
    const d = this.docs.get(`${itemId}:${unitId}`);
    if (!d) return this.scheduleRebuild(1500);
    d.body = markdownToPlain(text);
    this.emit();
  }

  async resetCache() {
    this.sqliteOk = isDesktop;
    this.sqliteError = undefined;
    await this.sql("index_reset", {});
    await this.rebuild();
  }

  /** Re-sync metadata (titles, marks) without re-reading bodies. */
  refreshMeta() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.rebuild(this.state !== "ready"), 600);
  }

  query(q: string, f: SearchFilters = {}): SearchHit[] {
    const needle = q.trim().toLowerCase();
    const terms = needle.split(/\s+/).filter(Boolean);
    const hits: SearchHit[] = [];
    for (const d of this.docs.values()) {
      if (!f.includeArchived && d.archived) continue;
      if (f.types?.length && !f.types.includes(d.itemType)) continue;
      if (f.collectionId && d.collectionId !== f.collectionId) continue;
      if (f.kinds?.length && !f.kinds.includes(d.kind)) continue;
      if (f.statusId && d.statusId !== f.statusId) continue;
      if (f.tagIds?.length && !f.tagIds.every((t) => d.tagIds.includes(t))) continue;
      let score = 0;
      let snippet: SearchHit["snippet"];
      if (terms.length) {
        const title = d.title.toLowerCase();
        const body = d.body.toLowerCase();
        let all = true;
        for (const t of terms) {
          const ti = title.indexOf(t);
          const bi = body.indexOf(t);
          const tagHit = d.tagIds.some((id) => repo.tag(id)?.name.toLowerCase().includes(t));
          if (ti < 0 && bi < 0 && !tagHit) {
            all = false;
            break;
          }
          if (ti >= 0) score += ti === 0 ? 12 : 8;
          if (tagHit) score += 5;
          if (bi >= 0) {
            score += 2;
            if (!snippet) {
              const s = Math.max(0, bi - 36);
              snippet = { before: (s > 0 ? "…" : "") + d.body.slice(s, bi), match: d.body.slice(bi, bi + t.length), after: d.body.slice(bi + t.length, bi + t.length + 60) + "…" };
            }
          }
        }
        if (!all) continue;
      }
      if (d.kind === "item") score += 1;
      hits.push({ doc: d, score, snippet });
    }
    return hits.sort((a, b) => b.score - a.score || b.doc.updatedAt.localeCompare(a.doc.updatedAt));
  }
}

export const searchIndex = new SearchIndex();

export function useSearchIndex() {
  useSyncExternalStore(searchIndex.subscribe, searchIndex.getVersion);
  return searchIndex;
}

// Keep the index in step with metadata changes.
let lastRepoVersion = -1;
repo.subscribe(() => {
  if (repo.isOpen && repo.version !== lastRepoVersion) {
    lastRepoVersion = repo.version;
    searchIndex.refreshMeta();
  }
});
