import { forwardRef, useMemo } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { markdownToHast, outlineFromHast, type OutlineEntry } from "./pipeline";
import { repo, backend } from "@/app/backend";
import { confirmDialog } from "@/app/store";
import { resolveRef } from "@/domain/policies/naming";

export interface MarkdownViewProps {
  text: string;
  /** Workspace-relative path of the Markdown file (for relative images/links). */
  filePath: string;
  /** Item folder: relative references may not escape it. */
  scopeDir: string;
  className?: string;
  onInternalLink?: (workspacePath: string, hash: string) => void;
  onOutline?: (o: OutlineEntry[]) => void;
}

export function useRenderedMarkdown(text: string, filePath: string, scopeDir: string) {
  return useMemo(() => {
    const tree = markdownToHast(text, {
      resolveImage: (src) => {
        const rel = resolveRef(filePath, src, scopeDir);
        return rel ? repo.fs.assetUrl(rel) || null : null;
      },
      resolveLink: (href) => resolveRef(filePath, href, scopeDir),
    });
    const outline = outlineFromHast(tree);
    const element = toJsxRuntime(tree, { Fragment, jsx, jsxs, ignoreInvalidStyle: true } as never);
    return { element, outline };
  }, [text, filePath, scopeDir]);
}

/** Read-only rendered Markdown with safe link handling. */
export const MarkdownView = forwardRef<HTMLDivElement, MarkdownViewProps>(function MarkdownView({ text, filePath, scopeDir, className, onInternalLink }, ref) {
  const { element } = useRenderedMarkdown(text, filePath, scopeDir);
  const onClick = async (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    e.preventDefault();
    if (href.startsWith("#")) {
      const id = decodeURIComponent(href.slice(1));
      const root = (e.currentTarget as HTMLElement);
      root.querySelector(`[id="${CSS.escape(id)}"], [id="user-content-${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (a.dataset.external) {
      const ok = await confirmDialog({ title: "打开外部链接", message: `将在系统浏览器中打开：\n${href}`, okText: "打开" });
      if (ok) await backend.platform.openUrl(href);
      return;
    }
    if (a.dataset.internal && onInternalLink) onInternalLink(a.dataset.internal, href.includes("#") ? href.split("#")[1] : "");
  };
  return (
    <div ref={ref} className={`lf-md ${className ?? ""}`} onClick={onClick}>
      {element}
    </div>
  );
});

export { outlineFromHast };
