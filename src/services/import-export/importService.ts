/**
 * Import pipeline (spec §4.2, technical design §11.1). External files are
 * always COPIED into the workspace; originals are never modified. New items
 * are staged: files are written first and item.json last, so an interrupted
 * import never produces a half-created item.
 */
import type { Photo, PdfItem, BookItem, DocumentItem, UUID, Chapter, TextUnit, Item } from "@/domain/models/types";
import { baseName, extOf, joinRel, newId, nowIso, slugify, stem, uniqueFileName, IMAGE_EXTS } from "@/domain/policies/naming";
import { getUnits } from "@/domain/policies/units";
import { firstHeading, imageRefs } from "@/components/markdown/pipeline";
import type { Repository } from "@/services/library/repository";

export interface ImportReport {
  created: string[];
  warnings: string[];
}

const dec = new TextDecoder("utf-8");

export function decodeText(bytes: Uint8Array): string {
  let t = dec.decode(bytes);
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  return t.replace(/\r\n?/g, "\n");
}

/** Directory of an absolute OS path (either separator). */
export function extDir(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(0, i) : "";
}
/** Resolve a relative reference against an absolute OS directory. */
export function extJoin(dir: string, rel: string): string | null {
  const sep = dir.includes("\\") ? "\\" : "/";
  const parts = dir.split(/[\\/]/);
  for (const seg of rel.split(/[\\/]/)) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (parts.length <= 1) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join(sep);
}

/**
 * Copy images referenced by an external Markdown file into `assetsDir` and
 * rewrite references relative to `unitPath`. Unknown/missing refs are kept
 * verbatim (never deleted) and reported.
 */
export async function importMarkdownImages(repo: Repository, source: string, text: string, itemDir: string, unitPath: string, assetsSub = "assets"): Promise<{ text: string; warnings: string[] }> {
  const warnings: string[] = [];
  const refs = imageRefs(text);
  if (!refs.length) return { text, warnings };
  const srcDir = extDir(source);
  const existing = new Set((await repo.fs.list(joinRel(itemDir, assetsSub)).catch(() => [])).map((e) => e.name));
  const depth = unitPath.split("/").length - 1;
  const up = "../".repeat(depth);
  let out = text;
  for (const ref of refs) {
    let decoded = ref;
    try {
      decoded = decodeURIComponent(ref);
    } catch {
      /* raw */
    }
    const abs = extJoin(srcDir, decoded.split("?")[0].split("#")[0]);
    if (!abs) {
      warnings.push(`图片路径越界，保持原样：${ref}`);
      continue;
    }
    try {
      const name = uniqueFileName(stem(abs), extOf(abs) || "png", existing);
      existing.add(name);
      await repo.backend.ext.importCopy(abs, joinRel(itemDir, assetsSub, name));
      const newRef = `${up}${assetsSub}/${encodeURI(name)}`;
      out = out.split(`](${ref}`).join(`](${newRef}`).split(`src="${ref}"`).join(`src="${newRef}"`).split(`src='${ref}'`).join(`src='${newRef}'`);
    } catch {
      warnings.push(`找不到或无法读取图片，已保留原引用：${ref}`);
    }
  }
  return { text: out, warnings };
}

async function readExternalText(repo: Repository, source: string): Promise<string> {
  return decodeText(await repo.backend.ext.importReadBytes(source));
}

// ------------------------------------------------------------------ Markdown

/** Each Markdown file becomes a 纯文本 Document item. */
export async function importMarkdownAsDocuments(repo: Repository, collectionId: UUID, sources: string[]): Promise<ImportReport> {
  const report: ImportReport = { created: [], warnings: [] };
  for (const source of sources) {
    const raw = await readExternalText(repo, source);
    const title = firstHeading(raw) ?? stem(source);
    const id = newId("i");
    const dir = repo.newItemDir(collectionId, title, id);
    const { text, warnings } = await importMarkdownImages(repo, source, raw, dir, "content.md");
    report.warnings.push(...warnings);
    await repo.fs.writeText(joinRel(dir, "content.md"), text, "");
    await repo.fs.mkdir(joinRel(dir, "assets"));
    const now = nowIso();
    const content: TextUnit = { id: newId("u"), type: "text", title, path: "content.md", order: 0, tagIds: [], statusId: null, createdAt: now, updatedAt: now };
    const item: DocumentItem = { schemaVersion: 1, id, type: "document", title, tagIds: [], statusId: null, createdAt: now, updatedAt: now, data: { content }, originals: [{ path: "", importedAt: now, sourceName: baseName(source) }] };
    await repo.registerPreparedItem(collectionId, dir, item);
    report.created.push(id);
  }
  return report;
}

/** Several Markdown files become chapters of one new book, in the given order. */
export async function importMarkdownAsBook(repo: Repository, collectionId: UUID, sources: string[], title: string): Promise<ImportReport> {
  const report: ImportReport = { created: [], warnings: [] };
  const id = newId("i");
  const dir = repo.newItemDir(collectionId, title, id);
  const chapters: Chapter[] = [];
  const names = new Set<string>();
  for (let i = 0; i < sources.length; i++) {
    const raw = await readExternalText(repo, sources[i]);
    const ctitle = firstHeading(raw) ?? stem(sources[i]);
    const file = uniqueFileName(`${String(i + 1).padStart(2, "0")}-${slugify(ctitle, 30)}`, "md", names);
    names.add(file);
    const path = `chapters/${file}`;
    const { text, warnings } = await importMarkdownImages(repo, sources[i], raw, dir, path);
    report.warnings.push(...warnings);
    await repo.fs.writeText(joinRel(dir, path), text, "");
    const now = nowIso();
    chapters.push({ id: newId("u"), type: "chapter", title: ctitle, path, order: i, tagIds: [], statusId: null, createdAt: now, updatedAt: now });
  }
  const now = nowIso();
  const item: BookItem = { schemaVersion: 1, id, type: "book", title, tagIds: [], statusId: null, createdAt: now, updatedAt: now, data: { chapters, layoutProfilePath: "layouts/print.json" } };
  await repo.registerPreparedItem(collectionId, dir, item);
  report.created.push(id);
  return report;
}

/** Import Markdown files as new units (chapter / post / series article) of an existing item. */
export async function importMarkdownIntoItem(repo: Repository, itemId: UUID, sources: string[], opts: { groupId?: string | null } = {}): Promise<ImportReport> {
  const report: ImportReport = { created: [], warnings: [] };
  for (const source of sources) {
    const raw = await readExternalText(repo, source);
    const title = firstHeading(raw) ?? stem(source);
    const unit = await repo.addUnit(itemId, { title, text: raw, groupId: opts.groupId ?? null, publishedAt: null });
    const it = repo.requireItem(itemId);
    const { text, warnings } = await importMarkdownImages(repo, source, raw, it.dir, unit.path);
    report.warnings.push(...warnings);
    if (text !== raw) {
      const { hash } = await repo.readUnitText(itemId, unit.id);
      await repo.saveUnitText(itemId, unit.id, text, hash);
    }
    report.created.push(unit.id);
  }
  return report;
}

// ------------------------------------------------------------------ Photos

async function imageInfo(bytes: Uint8Array, ext: string): Promise<Partial<Photo>> {
  const info: Partial<Photo> = { bytes: bytes.length, format: ext.toUpperCase() };
  try {
    const exifr = (await import("exifr")).default;
    const ex = await exifr.parse(bytes, { pick: ["Make", "Model", "LensModel", "FNumber", "ExposureTime", "ISO", "FocalLength", "DateTimeOriginal", "ExifImageWidth", "ExifImageHeight"] });
    if (ex) {
      const exif: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(ex)) {
        if (v instanceof Date) exif[k] = v.toISOString();
        else if (typeof v === "number" || typeof v === "string") exif[k] = v;
      }
      info.exif = exif;
      if (typeof ex.ExifImageWidth === "number") info.width = ex.ExifImageWidth;
      if (typeof ex.ExifImageHeight === "number") info.height = ex.ExifImageHeight;
    }
  } catch {
    /* no EXIF */
  }
  if (!info.width && typeof createImageBitmap === "function" && ext !== "svg") {
    try {
      const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
      info.width = bmp.width;
      info.height = bmp.height;
      bmp.close?.();
    } catch {
      /* undecodable in WebView (e.g. HEIC/TIFF) */
    }
  }
  return info;
}

export async function importPhotosIntoAlbum(repo: Repository, itemId: UUID, sources: string[], onProgress?: (n: number, total: number) => void): Promise<ImportReport> {
  const it = repo.requireItem(itemId);
  if (it.meta.type !== "photo_album") throw new Error("不是摄影集");
  const report: ImportReport = { created: [], warnings: [] };
  const existing = new Set((await repo.fs.list(joinRel(it.dir, "photos"))).map((e) => e.name));
  const startOrder = getUnits(it.meta).length;
  const photos: Photo[] = [];
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const ext = extOf(src);
    if (!IMAGE_EXTS.includes(ext)) {
      report.warnings.push(`跳过不支持的文件：${baseName(src)}`);
      continue;
    }
    const name = uniqueFileName(stem(src), ext, existing);
    existing.add(name);
    const path = `photos/${name}`;
    const { hash, size } = await repo.backend.ext.importCopy(src, joinRel(it.dir, path));
    const bytes = await repo.fs.readBytes(joinRel(it.dir, path));
    const info = await imageInfo(bytes, ext);
    const now = nowIso();
    photos.push({ id: newId("u"), type: "photo", title: stem(src), path, order: startOrder + photos.length, tagIds: [], statusId: null, caption: "", sha256AtImport: hash, ...info, bytes: size, createdAt: now, updatedAt: now });
    onProgress?.(i + 1, sources.length);
  }
  if (photos.length) await repo.addPhotos(itemId, photos);
  report.created.push(...photos.map((p) => p.id));
  return report;
}

export async function importPhotosAsAlbum(repo: Repository, collectionId: UUID, sources: string[], title: string, onProgress?: (n: number, total: number) => void): Promise<ImportReport> {
  const album = await repo.createItem(collectionId, "photo_album", title);
  const r = await importPhotosIntoAlbum(repo, album.meta.id, sources, onProgress);
  return { created: [album.meta.id], warnings: r.warnings };
}

/** Replace a photo file with an externally edited version (e.g. after retouching). Keeps metadata. */
export async function replacePhotoFile(repo: Repository, itemId: UUID, unitId: UUID, source: string): Promise<void> {
  const it = repo.requireItem(itemId);
  const u = getUnits(it.meta).find((x) => x.id === unitId) as Photo | undefined;
  if (!u) return;
  const ext = extOf(source);
  const existing = new Set((await repo.fs.list(joinRel(it.dir, "photos"))).map((e) => e.name));
  const name = uniqueFileName(`${stem(u.path)}-v${Date.now().toString(36)}`, ext, existing);
  const path = `photos/${name}`;
  const { hash, size } = await repo.backend.ext.importCopy(source, joinRel(it.dir, path));
  const info = await imageInfo(await repo.fs.readBytes(joinRel(it.dir, path)), ext);
  // Old file goes to the trash via a unit-less move to keep history recoverable.
  const old = joinRel(it.dir, u.path);
  await repo.fs.move(old, joinRel(".leafor/trash", `${Date.now()}--replaced--${baseName(u.path)}`)).catch(() => undefined);
  const items = getUnits(it.meta).map((x) => (x.id === unitId ? ({ ...x, ...info, path, bytes: size, sha256AtImport: hash, updatedAt: nowIso() } as Photo) : x));
  await repo.saveItem({ ...it.meta, updatedAt: nowIso(), data: { ...(it.meta as Extract<Item, { type: "photo_album" }>).data, photos: items as Photo[] } } as Item);
}

// ------------------------------------------------------------------ PDF (read-only object)

export async function inspectPdf(bytes: Uint8Array): Promise<{ pageCount?: number; title?: string; author?: string }> {
  try {
    const { loadPdf } = await import("@/services/content/pdf");
    const doc = await loadPdf(bytes.slice());
    const meta = await doc.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as { Title?: string; Author?: string };
    const out = { pageCount: doc.numPages, title: info.Title || undefined, author: info.Author || undefined };
    await doc.loadingTask.destroy();
    return out;
  } catch {
    return {};
  }
}

export async function importPdfs(repo: Repository, collectionId: UUID, sources: string[]): Promise<ImportReport> {
  const report: ImportReport = { created: [], warnings: [] };
  for (const source of sources) {
    const head = (await repo.backend.ext.importReadBytes(source)).slice(0, 5);
    if (dec.decode(head) !== "%PDF-") {
      report.warnings.push(`不是有效的 PDF 文件：${baseName(source)}`);
      continue;
    }
    const title = stem(source);
    const id = newId("i");
    const dir = repo.newItemDir(collectionId, title, id);
    const sourcePath = "originals/original.pdf";
    const { hash, size } = await repo.backend.ext.importCopy(source, joinRel(dir, sourcePath));
    // Verify the copy is byte-identical to what we hashed.
    const verify = await repo.fs.hash(joinRel(dir, sourcePath));
    if (verify !== hash) throw new Error("PDF 复制校验失败");
    const info = await inspectPdf(await repo.fs.readBytes(joinRel(dir, sourcePath)));
    const now = nowIso();
    const item: PdfItem = {
      schemaVersion: 1,
      id,
      type: "pdf",
      title,
      tagIds: [],
      statusId: null,
      createdAt: now,
      updatedAt: now,
      data: { sourcePath, sourceName: baseName(source), sha256AtImport: hash, bytes: size, pageCount: info.pageCount, pdfTitle: info.title, pdfAuthor: info.author, importedAt: now },
    };
    await repo.registerPreparedItem(collectionId, dir, item);
    report.created.push(id);
  }
  return report;
}

// ------------------------------------------------------------------ DOCX → Markdown working copy

export interface DocxCandidate {
  title: string;
  markdown: string;
}

export interface DocxConversion {
  markdown: string;
  images: Array<{ name: string; bytes: Uint8Array }>;
  messages: string[];
}

export async function convertDocx(bytes: Uint8Array): Promise<DocxConversion> {
  const mammoth = (await import("mammoth")).default;
  const TurndownService = (await import("turndown")).default;
  const { gfm } = await import("turndown-plugin-gfm");
  const images: DocxConversion["images"] = [];
  const result = await mammoth.convertToHtml(
    { arrayBuffer: bytes.slice().buffer },
    {
      convertImage: mammoth.images.imgElement(async (image: { contentType: string; readAsUint8Array?: () => Promise<Uint8Array>; read: (enc?: string) => Promise<ArrayBuffer | Uint8Array | string> }) => {
        const ext = (image.contentType.split("/")[1] || "png").replace("jpeg", "jpg").replace("x-emf", "emf");
        const name = `docx-image-${String(images.length + 1).padStart(3, "0")}.${ext}`;
        const raw = await image.read();
        const data = raw instanceof Uint8Array ? raw : typeof raw === "string" ? new TextEncoder().encode(raw) : new Uint8Array(raw);
        images.push({ name, bytes: data });
        return { src: `__ASSET__/${name}` };
      }),
    } as never,
  );
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
  td.use(gfm);
  const markdown = td.turndown(result.value).replace(/\n{3,}/g, "\n\n");
  return { markdown, images, messages: result.messages.map((m: { message: string }) => m.message) };
}

/** Split converted Markdown at headings of `level` (1 or 2). Text before the first heading becomes a 前言 chapter. */
export function splitByHeading(markdown: string, level: 1 | 2): DocxCandidate[] {
  const lines = markdown.split("\n");
  const re = level === 1 ? /^#\s+(.+)$/ : /^#{1,2}\s+(.+)$/;
  const out: DocxCandidate[] = [];
  let cur: DocxCandidate | null = null;
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    const m = !inFence && re.exec(line);
    if (m) {
      if (cur) out.push(cur);
      cur = { title: m[1].replace(/[*_`]/g, "").trim() || "未命名章节", markdown: line + "\n" };
    } else {
      if (!cur) cur = { title: "前言", markdown: "" };
      cur.markdown += line + "\n";
    }
  }
  if (cur) out.push(cur);
  return out.filter((c) => c.markdown.trim() || c.title !== "前言");
}

/** Create a book (or document) from a converted DOCX. Original .docx is kept under originals/. */
export async function importDocx(
  repo: Repository,
  collectionId: UUID,
  source: string,
  conv: DocxConversion,
  candidates: DocxCandidate[],
  opts: { asBook: boolean; title: string },
): Promise<ImportReport> {
  const id = newId("i");
  const dir = repo.newItemDir(collectionId, opts.title, id);
  const now = nowIso();
  await repo.backend.ext.importCopy(source, joinRel(dir, "originals", baseName(source).replace(/[<>:"|?*]/g, "_")));
  for (const img of conv.images) await repo.fs.writeBytes(joinRel(dir, "assets", img.name), img.bytes);
  const fix = (md: string, depth: number) => md.split("__ASSET__/").join(`${"../".repeat(depth)}assets/`);
  const originals = [{ path: `originals/${baseName(source)}`, importedAt: now, sourceName: baseName(source) }];
  let item: Item;
  if (opts.asBook) {
    const names = new Set<string>();
    const chapters: Chapter[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const file = uniqueFileName(`${String(i + 1).padStart(2, "0")}-${slugify(c.title, 30)}`, "md", names);
      names.add(file);
      await repo.fs.writeText(joinRel(dir, "chapters", file), fix(c.markdown, 1), "");
      chapters.push({ id: newId("u"), type: "chapter", title: c.title, path: `chapters/${file}`, order: i, tagIds: [], statusId: null, createdAt: now, updatedAt: now });
    }
    item = { schemaVersion: 1, id, type: "book", title: opts.title, tagIds: [], statusId: null, createdAt: now, updatedAt: now, data: { chapters, layoutProfilePath: "layouts/print.json" }, originals };
  } else {
    await repo.fs.writeText(joinRel(dir, "content.md"), fix(candidates.map((c) => c.markdown).join("\n"), 0), "");
    const content: TextUnit = { id: newId("u"), type: "text", title: opts.title, path: "content.md", order: 0, tagIds: [], statusId: null, createdAt: now, updatedAt: now };
    item = { schemaVersion: 1, id, type: "document", title: opts.title, tagIds: [], statusId: null, createdAt: now, updatedAt: now, data: { content }, originals };
  }
  await repo.registerPreparedItem(collectionId, dir, item);
  return { created: [id], warnings: conv.messages };
}

// ------------------------------------------------------------------ images inserted while editing

/** Copy picked images into the item's assets/ and return Markdown snippets relative to the unit file. */
export async function insertImagesForUnit(repo: Repository, itemId: UUID, unitPath: string, sources: string[]): Promise<string> {
  const it = repo.requireItem(itemId);
  const existing = new Set((await repo.fs.list(joinRel(it.dir, "assets")).catch(() => [])).map((e) => e.name));
  const up = "../".repeat(unitPath.split("/").length - 1);
  const parts: string[] = [];
  for (const s of sources) {
    const name = uniqueFileName(stem(s), extOf(s) || "png", existing);
    existing.add(name);
    await repo.backend.ext.importCopy(s, joinRel(it.dir, "assets", name));
    parts.push(`![${stem(s)}](${up}assets/${encodeURI(name)})`);
  }
  return parts.join("\n\n");
}

/** Set an item cover from a picked image (copied into the item folder). */
export async function setCoverFromFile(repo: Repository, itemId: UUID, source: string): Promise<void> {
  const it = repo.requireItem(itemId);
  const ext = extOf(source) || "jpg";
  const name = `cover-${Date.now().toString(36)}.${ext}`;
  await repo.backend.ext.importCopy(source, joinRel(it.dir, name));
  const old = it.meta.coverPath;
  await repo.updateItem(itemId, { coverPath: name } as Partial<Item>);
  if (old && old.startsWith("cover-")) await repo.fs.move(joinRel(it.dir, old), joinRel(".leafor/trash", `${Date.now()}--old-${old}`)).catch(() => undefined);
}
