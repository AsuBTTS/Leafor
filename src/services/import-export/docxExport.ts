/**
 * Markdown → DOCX (pure JS, no Pandoc dependency). Keeps heading levels,
 * paragraphs, emphasis, links, lists, quotes, code, tables and images.
 * LaTeX formulas are kept as their source text in a math font (Word has no
 * lossless LaTeX import) — the export dialog states this format loss.
 */
import type { Root, RootContent, PhrasingContent, Table as MdTable, List as MdList } from "mdast";
import { parseMarkdown } from "@/components/markdown/pipeline";
import { repo, backend } from "@/app/backend";
import type { UUID } from "@/domain/models/types";
import { getUnits } from "@/domain/policies/units";
import { extOf, resolveRef, slugify } from "@/domain/policies/naming";
import { exportOrder, loadTexts, type ExportResult, type TextUnitSource } from "./exportService";

type Docx = typeof import("docx");

interface Ctx {
  d: Docx;
  item: { dir: string };
  src: TextUnitSource;
  warnings: string[];
  images: Map<string, { data: Uint8Array; w: number; h: number; type: "png" | "jpg" | "gif" | "bmp" } | null>;
}

const HEADINGS = ["HEADING_1", "HEADING_2", "HEADING_3", "HEADING_4", "HEADING_5", "HEADING_6"] as const;

function runs(ctx: Ctx, nodes: PhrasingContent[], style: { bold?: boolean; italics?: boolean; strike?: boolean } = {}): Array<InstanceType<Docx["TextRun"]> | InstanceType<Docx["ExternalHyperlink"]> | InstanceType<Docx["ImageRun"]>> {
  const { d } = ctx;
  const out: Array<InstanceType<Docx["TextRun"]> | InstanceType<Docx["ExternalHyperlink"]> | InstanceType<Docx["ImageRun"]>> = [];
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        out.push(new d.TextRun({ text: n.value.replace(/\n/g, " "), bold: style.bold, italics: style.italics, strike: style.strike }));
        break;
      case "strong":
        out.push(...runs(ctx, n.children, { ...style, bold: true }));
        break;
      case "emphasis":
        out.push(...runs(ctx, n.children, { ...style, italics: true }));
        break;
      case "delete":
        out.push(...runs(ctx, n.children, { ...style, strike: true }));
        break;
      case "inlineCode":
        out.push(new d.TextRun({ text: n.value, font: "Consolas", shading: { type: d.ShadingType.CLEAR, fill: "F1F2F0", color: "auto" } }));
        break;
      case "inlineMath" as never:
        out.push(new d.TextRun({ text: (n as unknown as { value: string }).value, font: "Cambria Math", italics: true }));
        break;
      case "break":
        out.push(new d.TextRun({ break: 1 }));
        break;
      case "link":
        if (/^(https?:|mailto:)/.test(n.url))
          out.push(new d.ExternalHyperlink({ link: n.url, children: runs(ctx, n.children, style).map((r) => (r instanceof d.TextRun ? new d.TextRun({ text: textOf(n.children), style: "Hyperlink" }) : r)).slice(0, 1) as never }));
        else out.push(...runs(ctx, n.children, style));
        break;
      case "image": {
        const img = ctx.images.get(n.url);
        if (img) {
          const max = 430;
          const scale = Math.min(1, max / img.w);
          out.push(new d.ImageRun({ type: img.type, data: img.data, transformation: { width: Math.round(img.w * scale), height: Math.round(img.h * scale) } }));
        } else out.push(new d.TextRun({ text: `[图片：${n.alt || n.url}]`, italics: true, color: "6E7773" }));
        break;
      }
      case "footnoteReference":
        out.push(new d.TextRun({ text: `[${n.label ?? n.identifier}]`, superScript: true }));
        break;
      case "html":
        out.push(new d.TextRun({ text: n.value.replace(/<[^>]+>/g, "") }));
        break;
      default:
        if ("children" in n) out.push(...runs(ctx, (n as { children: PhrasingContent[] }).children, style));
        else if ("value" in n) out.push(new d.TextRun({ text: String((n as { value: string }).value) }));
    }
  }
  return out;
}

function textOf(nodes: PhrasingContent[]): string {
  return nodes.map((n) => ("value" in n ? (n as { value: string }).value : "children" in n ? textOf((n as { children: PhrasingContent[] }).children) : "")).join("");
}

function blocks(ctx: Ctx, nodes: RootContent[], level = 0, quote = false): Array<InstanceType<Docx["Paragraph"]> | InstanceType<Docx["Table"]>> {
  const { d } = ctx;
  const out: Array<InstanceType<Docx["Paragraph"]> | InstanceType<Docx["Table"]>> = [];
  for (const n of nodes) {
    switch (n.type) {
      case "heading":
        out.push(new d.Paragraph({ heading: d.HeadingLevel[HEADINGS[Math.min(5, n.depth - 1)]], children: runs(ctx, n.children) as never }));
        break;
      case "paragraph":
        out.push(new d.Paragraph({ children: runs(ctx, n.children) as never, indent: quote ? { left: 480 } : undefined, spacing: { after: 120 }, ...(quote ? { border: { left: { style: d.BorderStyle.SINGLE, size: 12, color: "C9D7CF", space: 8 } } } : {}) }));
        break;
      case "blockquote":
        out.push(...blocks(ctx, n.children as RootContent[], level, true));
        break;
      case "list":
        out.push(...listBlocks(ctx, n, level));
        break;
      case "code":
        for (const line of n.value.split("\n"))
          out.push(new d.Paragraph({ children: [new d.TextRun({ text: line || " ", font: "Consolas", size: 19 })], shading: { type: d.ShadingType.CLEAR, fill: "F1F2F0", color: "auto" }, spacing: { after: 0 } }));
        out.push(new d.Paragraph({ children: [] }));
        break;
      case "math" as never:
        out.push(new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ text: (n as unknown as { value: string }).value, font: "Cambria Math", italics: true })] }));
        break;
      case "thematicBreak":
        out.push(new d.Paragraph({ children: [], border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: "CFD6D1", space: 1 } } }));
        break;
      case "table":
        out.push(table(ctx, n));
        break;
      case "html": {
        const t = n.value.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, "").trim();
        if (t) out.push(new d.Paragraph({ children: [new d.TextRun({ text: t })] }));
        break;
      }
      case "footnoteDefinition":
        out.push(new d.Paragraph({ children: [new d.TextRun({ text: `[${n.label ?? n.identifier}] `, superScript: true }), ...(runs(ctx, (n.children[0] as { children?: PhrasingContent[] })?.children ?? []) as never[])], spacing: { before: 120 } }));
        break;
      default:
        break;
    }
  }
  return out;
}

function listBlocks(ctx: Ctx, list: MdList, level: number) {
  const { d } = ctx;
  const out: Array<InstanceType<Docx["Paragraph"]> | InstanceType<Docx["Table"]>> = [];
  for (const li of list.children) {
    const [first, ...rest] = li.children;
    const prefix = li.checked === true ? "☑ " : li.checked === false ? "☐ " : "";
    const children = first && first.type === "paragraph" ? runs(ctx, first.children) : [];
    out.push(
      new d.Paragraph({
        children: [new d.TextRun(prefix), ...(children as never[])],
        ...(list.ordered ? { numbering: { reference: "leafor-ordered", level: Math.min(level, 8) } } : { bullet: { level: Math.min(level, 8) } }),
      }),
    );
    for (const c of rest) {
      if (c.type === "list") out.push(...listBlocks(ctx, c, level + 1));
      else out.push(...blocks(ctx, [c as RootContent], level + 1));
    }
  }
  return out;
}

function table(ctx: Ctx, t: MdTable) {
  const { d } = ctx;
  return new d.Table({
    width: { size: 100, type: d.WidthType.PERCENTAGE },
    rows: t.children.map(
      (row, ri) =>
        new d.TableRow({
          tableHeader: ri === 0,
          children: row.children.map(
            (cell) =>
              new d.TableCell({
                shading: ri === 0 ? { type: d.ShadingType.CLEAR, fill: "F1F2F0", color: "auto" } : undefined,
                children: [new d.Paragraph({ children: runs(ctx, cell.children, ri === 0 ? { bold: true } : {}) as never })],
              }),
          ),
        }),
    ),
  });
}

async function collectImages(ctx: Ctx, tree: Root) {
  const { visit } = await import("unist-util-visit");
  const urls: string[] = [];
  visit(tree, "image", (n: { url: string }) => void urls.push(n.url));
  for (const url of urls) {
    if (ctx.images.has(url)) continue;
    const rel = resolveRef(ctx.src.path, url, ctx.item.dir);
    const ext = extOf(url);
    const type = ext === "jpeg" || ext === "jpg" ? "jpg" : ext === "png" ? "png" : ext === "gif" ? "gif" : ext === "bmp" ? "bmp" : null;
    if (!rel || !type) {
      ctx.images.set(url, null);
      if (rel && !type) ctx.warnings.push(`DOCX 不支持该图片格式，已用文字代替：${url}`);
      continue;
    }
    try {
      const data = await repo.fs.readBytes(rel);
      let w = 600,
        h = 400;
      try {
        const bmp = await createImageBitmap(new Blob([data as BlobPart]));
        w = bmp.width;
        h = bmp.height;
        bmp.close?.();
      } catch {
        /* keep default */
      }
      ctx.images.set(url, { data, w, h, type });
    } catch {
      ctx.images.set(url, null);
      ctx.warnings.push(`缺少图片：${url}`);
    }
  }
}

export async function buildDocx(itemId: UUID, unitId?: UUID): Promise<{ bytes: Uint8Array; warnings: string[]; title: string }> {
  const d = await import("docx");
  const it = repo.requireItem(itemId);
  const units = unitId ? getUnits(it.meta).filter((u) => u.id === unitId) : exportOrder(it.meta);
  const texts = await loadTexts(it, units);
  const warnings: string[] = [];
  const title = unitId ? units[0].title : it.meta.title;
  const children: Array<InstanceType<Docx["Paragraph"]> | InstanceType<Docx["Table"]> | InstanceType<Docx["TableOfContents"]>> = [];
  const multi = !unitId && texts.length > 1;
  if (multi) {
    children.push(new d.Paragraph({ heading: d.HeadingLevel.TITLE, alignment: d.AlignmentType.CENTER, children: [new d.TextRun(it.meta.title)] }));
    if (it.meta.author) children.push(new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ text: it.meta.author, color: "6E7773" })] }));
    children.push(new d.TableOfContents("目录", { hyperlink: true, headingStyleRange: "1-2" }));
  }
  for (let i = 0; i < texts.length; i++) {
    const src = texts[i];
    const ctx: Ctx = { d, item: it, src, warnings, images: new Map() };
    const tree = parseMarkdown(src.text);
    await collectImages(ctx, tree);
    const body = blocks(ctx, tree.children);
    if (multi) children.push(new d.Paragraph({ children: [new d.PageBreak()] }));
    // Ensure each unit starts with its title as heading 1 if the text has none.
    const first = tree.children[0];
    if (multi && !(first && first.type === "heading" && first.depth === 1)) children.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, children: [new d.TextRun(src.title)] }));
    children.push(...body);
  }
  if (texts.some((t) => /\$[^$]+\$/.test(t.text))) warnings.push("DOCX 中的公式以 LaTeX 源码形式保留（Word 无法无损导入 LaTeX）。");
  const doc = new d.Document({
    creator: it.meta.author || "Leafor",
    title,
    features: { updateFields: multi },
    styles: {
      default: { document: { run: { font: { ascii: "Times New Roman", eastAsia: "SimSun", hAnsi: "Times New Roman" }, size: 22 }, paragraph: { spacing: { line: 360 } } } },
    },
    numbering: {
      config: [
        {
          reference: "leafor-ordered",
          levels: Array.from({ length: 9 }, (_, l) => ({ level: l, format: d.LevelFormat.DECIMAL, text: `%${l + 1}.`, alignment: d.AlignmentType.START, style: { paragraph: { indent: { left: 420 * (l + 1), hanging: 300 } } } })),
        },
      ],
    },
    sections: [{ properties: {}, children: children as never }],
  });
  const blob = await d.Packer.toBlob(doc);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), warnings, title };
}

export async function exportDocx(itemId: UUID, unitId?: UUID): Promise<ExportResult | null> {
  const it = repo.requireItem(itemId);
  const name = unitId ? getUnits(it.meta).find((u) => u.id === unitId)?.title ?? it.meta.title : it.meta.title;
  const target = await backend.platform.pickSaveFile("导出 Word 文档", `${slugify(name, 60) || "export"}.docx`, [{ name: "Word 文档", extensions: ["docx"] }]);
  if (!target) return null;
  const { bytes, warnings } = await buildDocx(itemId, unitId);
  await backend.ext.exportWriteBytes(target, bytes);
  return { target, files: 1, warnings };
}
