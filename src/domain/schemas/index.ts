/**
 * JSON schema validation for the authoritative metadata files. Unknown fields
 * are preserved (loose objects) so newer files are not silently stripped.
 */
import { z } from "zod";
import type { Collection, Item, WorkspaceMeta } from "../models/types";
import { DEFAULT_SETTINGS, DEFAULT_STATUSES } from "../policies/defaults";
import { ITEM_TYPES } from "../models/types";

const unitBase = {
  id: z.string().min(1),
  title: z.string(),
  path: z.string(),
  order: z.number(),
  statusId: z.string().nullable().optional(),
  tagIds: z.array(z.string()).default([]),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
};

const chapter = z.looseObject({ ...unitBase, type: z.literal("chapter") });
const photo = z.looseObject({ ...unitBase, type: z.literal("photo") });
const post = z.looseObject({ ...unitBase, type: z.literal("post"), publishedAt: z.string().nullable().default(null) });
const seriesArticle = z.looseObject({ ...unitBase, type: z.literal("series_article") });
const textUnit = z.looseObject({ ...unitBase, type: z.literal("text") });

const itemCommon = {
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  title: z.string(),
  tagIds: z.array(z.string()).default([]),
  statusId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
};

export const itemSchema = z.discriminatedUnion("type", [
  z.looseObject({ ...itemCommon, type: z.literal("book"), data: z.looseObject({ chapters: z.array(chapter).default([]) }) }),
  z.looseObject({ ...itemCommon, type: z.literal("photo_album"), data: z.looseObject({ photos: z.array(photo).default([]) }) }),
  z.looseObject({ ...itemCommon, type: z.literal("blog"), data: z.looseObject({ posts: z.array(post).default([]) }) }),
  z.looseObject({ ...itemCommon, type: z.literal("article_series"), data: z.looseObject({ articles: z.array(seriesArticle).default([]) }) }),
  z.looseObject({ ...itemCommon, type: z.literal("document"), data: z.looseObject({ content: textUnit }) }),
  z.looseObject({
    ...itemCommon,
    type: z.literal("pdf"),
    data: z.looseObject({ sourcePath: z.string(), sha256AtImport: z.string(), importedAt: z.string() }),
  }),
]);

export const collectionSchema = z.looseObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  title: z.string(),
  itemIds: z.array(z.string()).default([]),
  createdAt: z.string().default(() => new Date().toISOString()),
  updatedAt: z.string().default(() => new Date().toISOString()),
});

export const workspaceSchema = z.looseObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  title: z.string(),
  app: z.literal("leafor").default("leafor"),
  createdAt: z.string().default(() => new Date().toISOString()),
  collectionOrder: z.array(z.string()).default([]),
  tags: z.array(z.looseObject({ id: z.string(), name: z.string() })).default([]),
  statuses: z.array(z.looseObject({ id: z.string(), name: z.string(), order: z.number().default(0) })).default(() => DEFAULT_STATUSES.map((s) => ({ ...s }))),
  settings: z.looseObject({}).default({}),
});

export class SchemaError extends Error {
  constructor(public file: string, public detail: string) {
    super(`${file} 格式无效：${detail}`);
  }
}

/** Upgrade older/unknown schema versions. v1 is the first, so this only fills defaults. */
function migrate(raw: unknown): unknown {
  if (raw && typeof raw === "object" && !("schemaVersion" in raw)) return { ...(raw as object), schemaVersion: 1 };
  return raw;
}

function fmt(e: z.ZodError): string {
  return e.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
}

export function parseItem(raw: unknown, file: string): Item {
  const r = itemSchema.safeParse(migrate(raw));
  if (!r.success) throw new SchemaError(file, fmt(r.error));
  return r.data as unknown as Item;
}

export function parseCollection(raw: unknown, file: string): Collection {
  const r = collectionSchema.safeParse(migrate(raw));
  if (!r.success) throw new SchemaError(file, fmt(r.error));
  return r.data as unknown as Collection;
}

export function parseWorkspace(raw: unknown, file: string): WorkspaceMeta {
  const r = workspaceSchema.safeParse(migrate(raw));
  if (!r.success) throw new SchemaError(file, fmt(r.error));
  const ws = r.data as unknown as WorkspaceMeta;
  ws.settings = { ...DEFAULT_SETTINGS, ...(ws.settings ?? {}) };
  return ws;
}

export function isItemType(t: string): t is (typeof ITEM_TYPES)[number] {
  return (ITEM_TYPES as readonly string[]).includes(t);
}
