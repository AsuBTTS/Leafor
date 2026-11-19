-- Leafor rebuildable index cache (technical design §7.2).
-- Every table here can be dropped and rebuilt from the workspace files.
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  root_path TEXT NOT NULL,
  title TEXT NOT NULL,
  indexed_at TEXT
);
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,
  title TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  status_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS content_units (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  unit_type TEXT NOT NULL,
  title TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  status_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  body TEXT,
  file_mtime REAL,
  file_size INTEGER
);
CREATE TABLE IF NOT EXISTS object_tags (
  workspace_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('item', 'unit', 'collection')),
  target_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id, target_kind, target_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_items_collection ON items(collection_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_units_item ON content_units(item_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_units_published ON content_units(item_id, published_at);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
