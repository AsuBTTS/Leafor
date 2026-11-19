/** Reusable library flows (create / import / item menu) used across pages. */
import type { NavigateFunction } from "react-router-dom";
import { ExternalLink, FolderInput, FolderSearch, Pencil, Archive, ArchiveRestore, Trash2, Tag, Image as ImageIcon, Info } from "lucide-react";
import { repo, backend } from "@/app/backend";
import { choose, confirmDialog, prompt, toast, withBusy } from "@/app/store";
import type { ItemType, LoadedItem, UUID } from "@/domain/models/types";
import { ITEM_TYPE_LABEL } from "@/domain/models/types";
import type { MenuItem } from "@/components/forms/Popover";
import { importMarkdownAsBook, importMarkdownAsDocuments, importPdfs, importPhotosAsAlbum, convertDocx, type ImportReport } from "@/services/import-export/importService";
import { IMAGE_EXTS, stem } from "@/domain/policies/naming";
import { useDocxImport } from "./DocxImportDialog";

export const MD_FILTER = [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }];
export const IMG_FILTER = [{ name: "图片", extensions: IMAGE_EXTS }];
export const PDF_FILTER = [{ name: "PDF", extensions: ["pdf"] }];
export const DOCX_FILTER = [{ name: "Word 文档", extensions: ["docx"] }];

/** Resolve the collection to put new items in: current filter, the only one, or ask. */
export async function pickCollection(current?: string | null, title = "放入哪个集合？"): Promise<UUID | null> {
  if (current && repo.collections.has(current)) return current;
  const cols = repo.orderedCollections();
  if (!cols.length) {
    const name = await prompt({ title: "先创建一个集合", label: "集合名称（如“文学作品”“摄影作品”）", value: "我的作品" });
    if (!name) return null;
    return (await repo.createCollection(name)).id;
  }
  if (cols.length === 1) return cols[0].meta.id;
  const v = await choose({
    title,
    options: [...cols.map((c) => ({ value: c.meta.id, label: c.meta.title, hint: `${c.meta.itemIds.length} 项` })), { value: "__new", label: "＋ 新建集合…" }],
  });
  if (v === "__new") {
    const name = await prompt({ title: "新建集合", label: "集合名称" });
    return name ? (await repo.createCollection(name)).id : null;
  }
  return v;
}

export async function createCollectionFlow(): Promise<UUID | null> {
  const name = await prompt({ title: "新建集合", label: "集合名称", placeholder: "例如：文学作品、摄影作品", okText: "创建" });
  if (!name) return null;
  const c = await repo.createCollection(name);
  toast.success(`已创建集合“${name}”`);
  return c.id;
}

export async function createItemFlow(type: ItemType, collectionId: string | null | undefined, navigate: NavigateFunction) {
  const cid = await pickCollection(collectionId);
  if (!cid) return;
  const name = await prompt({ title: `新建${ITEM_TYPE_LABEL[type]}`, label: "标题", okText: "创建" });
  if (!name) return;
  const it = await withBusy("正在创建…", () => repo.createItem(cid, type, name));
  if (!it) return;
  if (type === "book") await repo.addUnit(it.meta.id, {});
  navigate(`/item/${it.meta.id}`);
}

function reportResult(r: ImportReport | undefined, what: string) {
  if (!r) return;
  if (r.warnings.length) toast.warning(`${what}完成，但有 ${r.warnings.length} 条提示：${r.warnings.slice(0, 2).join("；")}${r.warnings.length > 2 ? "…" : ""}`);
  else toast.success(`${what}完成`);
}

export async function importFlow(kind: "markdown" | "photos" | "pdf" | "docx", collectionId: string | null | undefined, navigate: NavigateFunction, docx?: ReturnType<typeof useDocxImport>) {
  const p = backend.platform;
  if (kind === "markdown") {
    const files = await p.pickFiles("导入 Markdown", MD_FILTER, true);
    if (!files.length) return;
    const cid = await pickCollection(collectionId);
    if (!cid) return;
    let mode = "docs";
    if (files.length > 1) {
      mode =
        (await choose({
          title: `导入 ${files.length} 个 Markdown 文件`,
          options: [
            { value: "docs", label: "每个文件一个纯文本单品" },
            { value: "book", label: "合并为一本图书", hint: "按文件名顺序成为章节" },
          ],
        })) ?? "";
      if (!mode) return;
    }
    if (mode === "book") {
      const title = await prompt({ title: "图书标题", value: stem(files[0]) });
      if (!title) return;
      const sorted = [...files].sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
      const r = await withBusy("正在导入…", () => importMarkdownAsBook(repo, cid, sorted, title));
      reportResult(r, "导入");
      if (r?.created[0]) navigate(`/item/${r.created[0]}`);
    } else {
      const r = await withBusy("正在导入…", () => importMarkdownAsDocuments(repo, cid, files));
      reportResult(r, "导入");
      if (r?.created.length === 1) navigate(`/item/${r.created[0]}`);
    }
  }
  if (kind === "photos") {
    const files = await p.pickFiles("导入照片", IMG_FILTER, true);
    if (!files.length) return;
    const cid = await pickCollection(collectionId);
    if (!cid) return;
    const title = await prompt({ title: "新摄影集", label: "摄影集标题", value: "新摄影集" });
    if (!title) return;
    const r = await withBusy(`正在导入 ${files.length} 张照片…`, () => importPhotosAsAlbum(repo, cid, files, title));
    reportResult(r, "导入照片");
    if (r?.created[0]) navigate(`/item/${r.created[0]}`);
  }
  if (kind === "pdf") {
    const files = await p.pickFiles("导入 PDF（只读归档）", PDF_FILTER, true);
    if (!files.length) return;
    const cid = await pickCollection(collectionId);
    if (!cid) return;
    const r = await withBusy("正在复制并校验 PDF…", () => importPdfs(repo, cid, files));
    reportResult(r, "导入 PDF");
    if (r?.created.length === 1) navigate(`/item/${r.created[0]}`);
  }
  if (kind === "docx" && docx) {
    const files = await p.pickFiles("导入 Word 文档", DOCX_FILTER, false);
    if (!files[0]) return;
    const cid = await pickCollection(collectionId);
    if (!cid) return;
    const conv = await withBusy("正在转换 Word 文档…", async () => convertDocx(await backend.ext.importReadBytes(files[0])));
    if (!conv) return;
    docx.open({ source: files[0], collectionId: cid, conv });
  }
}

export function itemMenu(
  it: LoadedItem,
  navigate: NavigateFunction,
  opts: { onRename?: () => void; onProps?: () => void; onMarks?: () => void } = {},
): MenuItem[] {
  const m = it.meta;
  return [
    { label: "打开", icon: <ExternalLink size={14} />, onSelect: () => navigate(`/item/${m.id}`) },
    { label: "重命名", icon: <Pencil size={14} />, onSelect: opts.onRename ?? (() => renameItem(it)) },
    { label: "属性与封面", icon: <Info size={14} />, onSelect: opts.onProps },
    { label: "状态与标签", icon: <Tag size={14} />, onSelect: opts.onMarks },
    { label: "移动到集合…", icon: <FolderInput size={14} />, onSelect: () => moveItemFlow(it) },
    { label: "在文件管理器中显示", icon: <FolderSearch size={14} />, onSelect: () => backend.platform.reveal(it.dir + "/item.json").catch(toast.error) },
    { separator: true, label: "" },
    m.archived
      ? { label: "取消归档", icon: <ArchiveRestore size={14} />, onSelect: () => repo.setArchived(m.id, false) }
      : { label: "归档", icon: <Archive size={14} />, onSelect: () => repo.setArchived(m.id, true).then(() => toast.success("已归档，可在“归档与回收站”中找回")) },
    { label: "移到回收站", icon: <Trash2 size={14} />, danger: true, onSelect: () => trashItemFlow(it) },
  ];
}

export async function renameItem(it: LoadedItem) {
  const name = await prompt({ title: "重命名", label: "标题", value: it.meta.title });
  if (name && name !== it.meta.title) await repo.updateItem(it.meta.id, { title: name });
}

export async function moveItemFlow(it: LoadedItem) {
  const others = repo.orderedCollections().filter((c) => c.meta.id !== it.collectionId);
  if (!others.length) return toast.info("没有其他集合可移动");
  const target = await choose({ title: `移动“${it.meta.title}”到…`, options: others.map((c) => ({ value: c.meta.id, label: c.meta.title })) });
  if (target) await withBusy("正在移动…", () => repo.moveItem(it.meta.id, target));
}

export async function trashItemFlow(it: LoadedItem) {
  const ok = await confirmDialog({
    title: "移到回收站",
    message: `“${it.meta.title}”的整个文件夹将移入作品库内的回收站（.leafor/trash），可以随时恢复。`,
    okText: "移到回收站",
    danger: true,
  });
  if (ok) await withBusy("正在移动…", () => repo.trashItem(it.meta.id)).then(() => toast.success("已移到回收站"));
}

export const ImageIconSmall = <ImageIcon size={14} />;
