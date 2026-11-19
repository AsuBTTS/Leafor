/**
 * One-way Markdown rendering pipeline (technical design §8). The source text
 * is never rewritten by rendering: switching edit/preview/split is read-only.
 *
 * md → remark (GFM + math) → rehype (raw HTML) → sanitize → KaTeX → slugs →
 * asset/link rewriting → React elements or an HTML string.
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import type { Root as HastRoot, Element } from "hast";
import type { Root as MdastRoot } from "mdast";

export interface RenderOptions {
  /** Map a Markdown image src to a displayable URL; return null to block. */
  resolveImage?: (src: string) => string | null;
  /** Map a link href (relative) to something; return null to leave as-is. */
  resolveLink?: (href: string) => string | null;
  /** Load remote (http) images. Off by default — offline-first. */
  allowRemoteImages?: boolean;
}

const schema = {
  ...defaultSchema,
  clobberPrefix: "user-content-",
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]],
    span: [...(defaultSchema.attributes?.span ?? []), ["className", "math", "math-inline", "math-display"]],
    div: [...(defaultSchema.attributes?.div ?? []), ["className", "math", "math-display"], "align"],
    img: [...(defaultSchema.attributes?.img ?? []), "width", "height", "title", "align"],
    p: [...(defaultSchema.attributes?.p ?? []), "align"],
    td: [...(defaultSchema.attributes?.td ?? []), "align"],
    th: [...(defaultSchema.attributes?.th ?? []), "align"],
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "title", "lang", "dir"],
  },
  tagNames: [...(defaultSchema.tagNames ?? []), "figure", "figcaption", "mark", "u", "small", "abbr", "center"],
  protocols: { ...defaultSchema.protocols, src: ["http", "https"], href: ["http", "https", "mailto"] },
};

const mdProcessor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

export function parseMarkdown(text: string): MdastRoot {
  return mdProcessor.parse(text) as MdastRoot;
}

function rewriteAssets(opts: RenderOptions) {
  return (tree: HastRoot) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName === "img") {
        const src = String(node.properties?.src ?? "");
        const isRemote = /^https?:\/\//i.test(src);
        let url: string | null = null;
        if (isRemote) url = opts.allowRemoteImages ? src : null;
        else url = opts.resolveImage ? opts.resolveImage(src) : src;
        if (url) {
          node.properties = { ...node.properties, src: url, loading: "lazy", "data-src": src };
        } else if (parent && typeof index === "number") {
          const placeholder: Element = {
            type: "element",
            tagName: "span",
            properties: { className: ["lf-img-blocked"], title: src },
            children: [{ type: "text", value: isRemote ? `远程图片未自动加载：${String(node.properties?.alt || src)}` : `图片不可用：${src}` }],
          };
          parent.children[index] = placeholder;
        }
      }
      if (node.tagName === "a") {
        const href = String(node.properties?.href ?? "");
        if (/^(https?:|mailto:)/i.test(href)) {
          node.properties = { ...node.properties, "data-external": "true", rel: ["noopener", "noreferrer"] };
        } else if (href && !href.startsWith("#") && opts.resolveLink) {
          const r = opts.resolveLink(href);
          if (r) node.properties = { ...node.properties, "data-internal": r };
        }
      }
    });
  };
}

export function markdownToHast(text: string, opts: RenderOptions = {}): HastRoot {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype, { allowDangerousHtml: true, footnoteLabel: "脚注", footnoteBackLabel: "返回正文" })
    .use(rehypeRaw)
    .use(rehypeSanitize, schema as never)
    .use(rehypeKatex, { throwOnError: false, strict: "ignore", errorColor: "#b5654a", output: "htmlAndMathml" } as never)
    .use(rehypeSlug)
    .use(() => rewriteAssets(opts));
  const mdast = processor.parse(text);
  return processor.runSync(mdast) as HastRoot;
}

export function hastToHtml(tree: HastRoot): string {
  return unified().use(rehypeStringify).stringify(tree);
}

export function markdownToHtml(text: string, opts: RenderOptions = {}): string {
  return hastToHtml(markdownToHast(text, opts));
}

export interface OutlineEntry {
  depth: number;
  text: string;
  id: string;
}

export function outlineFromHast(tree: HastRoot): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  visit(tree, "element", (node: Element) => {
    const m = /^h([1-6])$/.exec(node.tagName);
    if (m) out.push({ depth: Number(m[1]), text: textOf(node), id: String(node.properties?.id ?? "") });
  });
  return out;
}

function textOf(node: Element | HastRoot): string {
  let s = "";
  visit(node, "text", (t: { value: string }) => {
    s += t.value;
  });
  return s.trim();
}

/** Strip Markdown to plain text (search index, excerpts). */
export function markdownToPlain(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~`>|-]{1,3}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** First heading text, if any (used when importing Markdown files). */
export function firstHeading(text: string): string | null {
  const m = /^\s{0,3}#{1,2}\s+(.+?)\s*#*\s*$/m.exec(text);
  return m ? m[1].trim() : null;
}

/** Collect relative image references in Markdown source. */
export function imageRefs(text: string): string[] {
  const out = new Set<string>();
  const tree = parseMarkdown(text);
  visit(tree, "image", (n: { url: string }) => {
    if (n.url && !/^[a-z]+:/i.test(n.url)) out.add(n.url);
  });
  for (const m of text.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) if (!/^[a-z]+:/i.test(m[1])) out.add(m[1]);
  return [...out];
}

/** Count CJK characters + Latin words, for the status bar. */
export function wordCount(text: string): number {
  const cjk = (text.match(/[㐀-鿿豈-﫿]/g) ?? []).length;
  const latin = (text.replace(/[㐀-鿿豈-﫿]/g, " ").match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length;
  return cjk + latin;
}
