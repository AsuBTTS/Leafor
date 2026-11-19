/**
 * Leafor domain model (technical design §5). Pure TypeScript — no React,
 * Tauri or PDF.js imports are allowed in src/domain.
 */

export type UUID = string;
/** Path relative to the owning Item folder (unit/cover paths) or workspace root. */
export type RelativePath = string;

export const ITEM_TYPES = ["book", "article_series", "blog", "photo_album", "document", "pdf"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export type UnitType = "chapter" | "photo" | "post" | "series_article" | "text";

export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  book: "图书",
  article_series: "系列文章",
  blog: "博客集",
  photo_album: "摄影集",
  document: "纯文本",
  pdf: "PDF",
};

export const UNIT_TYPE_LABEL: Record<UnitType, string> = {
  chapter: "章节",
  photo: "照片",
  post: "博文",
  series_article: "系列文章",
  text: "文本",
};

export interface TagDefinition {
  id: UUID;
  name: string;
  color?: string;
  description?: string;
}

export interface StatusDefinition {
  id: UUID;
  name: string;
  color?: string;
  order: number;
  workflow?: string;
}

export interface ContentUnitBase {
  id: UUID;
  type: UnitType;
  title: string;
  /** Relative to the Item folder. */
  path: RelativePath;
  order: number;
  statusId?: UUID | null;
  tagIds: UUID[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Chapter extends ContentUnitBase {
  type: "chapter";
}

export interface Photo extends ContentUnitBase {
  type: "photo";
  caption?: string;
  width?: number;
  height?: number;
  bytes?: number;
  format?: string;
  exif?: Record<string, string | number>;
  sha256AtImport?: string;
  groupId?: UUID;
}

export interface Post extends ContentUnitBase {
  type: "post";
  /** null = unpublished draft. ISO date (YYYY-MM-DD or full ISO). */
  publishedAt: string | null;
  slug?: string;
  excerpt?: string;
  coverPath?: RelativePath;
}

export interface SeriesArticle extends ContentUnitBase {
  type: "series_article";
  groupId?: UUID | null;
  excerpt?: string;
  publishedAt?: string | null;
}

export interface TextUnit extends ContentUnitBase {
  type: "text";
}

export type ContentUnit = Chapter | Photo | Post | SeriesArticle | TextUnit;

export interface SeriesGroup {
  id: UUID;
  title: string;
  order: number;
}

export interface PhotoGroup {
  id: UUID;
  title: string;
  order: number;
}

export interface LayoutProfile {
  id: string;
  name: string;
  page: { size: "A4" | "A5" | "B5" | "32K" | "custom"; widthMm?: number; heightMm?: number; orientation?: "portrait" | "landscape" };
  marginsMm: { top: number; bottom: number; inner: number; outer: number };
  typography: {
    fontFamily: string;
    fontSizePt: number;
    lineHeight: number;
    paragraphIndentEm: number;
    paragraphSpacingPt: number;
    headingFontFamily?: string;
  };
  chapters: { startOnNewPage: boolean; startOnOddPage?: boolean; titleStyle?: "centered" | "left" };
  headerFooter: {
    showPageNumbers: boolean;
    pageNumberPosition?: "center" | "outer";
    headerText?: string;
    /** Show the current chapter title in the running header. */
    headerChapterTitle?: boolean;
    footerText?: string;
    mirrorOddEven?: boolean;
  };
  includeToc: boolean;
  includeTitlePage: boolean;
  includeCover: boolean;
  exportDpi?: number;
}

interface ItemCommon {
  schemaVersion: 1;
  id: UUID;
  title: string;
  coverPath?: RelativePath;
  summary?: string;
  author?: string;
  statusId?: UUID | null;
  tagIds: UUID[];
  notes?: string;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
  /** Original imported files kept under originals/. */
  originals?: Array<{ path: RelativePath; importedAt: string; sourceName: string; sha256?: string }>;
}

export interface BookItem extends ItemCommon {
  type: "book";
  data: {
    chapters: Chapter[];
    layoutProfilePath?: RelativePath;
    readerPrefs?: { doublePage?: boolean; fontScale?: number; lastChapterId?: string };
  };
}
export interface PhotoAlbumItem extends ItemCommon {
  type: "photo_album";
  data: { photos: Photo[]; groups?: PhotoGroup[] };
}
export interface BlogItem extends ItemCommon {
  type: "blog";
  data: { posts: Post[] };
}
export interface SeriesItem extends ItemCommon {
  type: "article_series";
  data: { articles: SeriesArticle[]; groups?: SeriesGroup[] };
}
export interface DocumentItem extends ItemCommon {
  type: "document";
  data: { content: TextUnit };
}
export interface PdfItem extends ItemCommon {
  type: "pdf";
  data: {
    sourcePath: RelativePath;
    sourceName: string;
    sha256AtImport: string;
    bytes: number;
    pageCount?: number;
    pdfTitle?: string;
    pdfAuthor?: string;
    importedAt: string;
    readerState?: { lastPage?: number; zoom?: number; mode?: "single" | "continuous" };
  };
}

export type Item = BookItem | PhotoAlbumItem | BlogItem | SeriesItem | DocumentItem | PdfItem;

export type ItemOf<T extends ItemType> = Extract<Item, { type: T }>;

export interface Collection {
  schemaVersion: 1;
  id: UUID;
  title: string;
  itemIds: UUID[];
  coverPath?: RelativePath;
  summary?: string;
  tagIds?: UUID[];
  icon?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSettings {
  autosaveDelayMs: number;
  editorFontSize: number;
  readerFontScale: number;
  defaultImportMode: "copy";
}

export interface WorkspaceMeta {
  schemaVersion: 1;
  id: UUID;
  title: string;
  createdAt: string;
  app: "leafor";
  collectionOrder: UUID[];
  tags: TagDefinition[];
  statuses: StatusDefinition[];
  settings: WorkspaceSettings;
}

/** In-memory runtime records (paths are workspace-relative). */
export interface LoadedCollection {
  meta: Collection;
  dir: RelativePath;
}
export interface LoadedItem {
  meta: Item;
  dir: RelativePath;
  collectionId: UUID;
}

export interface TrashEntry {
  id: string;
  kind: "item" | "collection" | "unit";
  title: string;
  /** Location inside .leafor/trash */
  trashPath: RelativePath;
  /** Original workspace-relative location. */
  originalPath: RelativePath;
  deletedAt: string;
  /** For items: owning collection; for units: owning item + serialized unit. */
  collectionId?: UUID;
  itemId?: UUID;
  unit?: ContentUnit;
  itemType?: ItemType;
}

export type TargetRef =
  | { kind: "item"; itemId: UUID }
  | { kind: "unit"; itemId: UUID; unitId: UUID }
  | { kind: "collection"; collectionId: UUID };
