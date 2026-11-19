import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, drawSelection, highlightActiveLine, dropCursor, placeholder as cmPlaceholder, rectangularSelection, crosshairCursor } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching } from "@codemirror/language";
import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { tags as t } from "@lezer/highlight";

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.45em", fontWeight: "700", color: "#164f47" },
  { tag: t.heading2, fontSize: "1.25em", fontWeight: "700", color: "#164f47" },
  { tag: t.heading3, fontSize: "1.1em", fontWeight: "700", color: "#1e665c" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "700", color: "#1e665c" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "#2c6b8a", textDecoration: "underline" },
  { tag: t.url, color: "#6b7a8f" },
  { tag: t.monospace, fontFamily: "var(--leafor-font-mono)", color: "#7a4b3a", fontSize: "0.92em" },
  { tag: t.quote, color: "#5d6b66", fontStyle: "italic" },
  { tag: [t.processingInstruction, t.meta], color: "#a3aaa6" },
  { tag: t.comment, color: "#8e9893", fontStyle: "italic" },
  { tag: t.keyword, color: "#7d6aa6" },
  { tag: [t.string, t.special(t.string)], color: "#5d7f45" },
  { tag: [t.number, t.bool, t.atom], color: "#b5654a" },
  { tag: [t.function(t.variableName), t.propertyName], color: "#2c6b8a" },
  { tag: t.contentSeparator, color: "#a3aaa6" },
  { tag: t.list, color: "#164f47" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "var(--lf-editor-size, 16px)", backgroundColor: "transparent" },
  ".cm-scroller": { fontFamily: "var(--leafor-font-serif)", lineHeight: "1.85", padding: "28px 0 40vh" },
  ".cm-content": { maxWidth: "760px", margin: "0 auto", padding: "0 40px", caretColor: "#164f47" },
  ".cm-line": { padding: "0 2px" },
  "&.cm-focused": { outline: "none" },
  ".cm-activeLine": { backgroundColor: "rgba(22,79,71,0.035)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "rgba(22,79,71,0.18) !important" },
  ".cm-cursor": { borderLeftColor: "#164f47", borderLeftWidth: "2px" },
  ".cm-panels": { fontFamily: "var(--leafor-font-serif)", backgroundColor: "#f1f2f0", borderColor: "#e3e8e4" },
  ".cm-searchMatch": { backgroundColor: "rgba(184,138,46,0.25)" },
  ".cm-searchMatch-selected": { backgroundColor: "rgba(184,138,46,0.5)" },
  ".cm-placeholder": { color: "#a3aaa6" },
});

export interface MarkdownEditorHandle {
  insert(text: string, opts?: { block?: boolean }): void;
  wrap(before: string, after?: string, placeholderText?: string): void;
  prefixLines(prefix: string): void;
  focus(): void;
  scrollToLine(line: number): void;
  view(): EditorView | null;
  getText(): string;
}

export interface MarkdownEditorProps {
  docKey: string;
  initial: string;
  onChange: (text: string) => void;
  onSave?: () => void;
  onScroll?: (ratio: number) => void;
  readOnly?: boolean;
  placeholder?: string;
  extraExtensions?: Extension[];
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cb = useRef(props);
  cb.current = props;

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: props.initial,
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
        syntaxHighlighting(highlight),
        theme,
        cmPlaceholder(props.placeholder ?? "开始写作…（支持 Markdown 与 $LaTeX$ 公式）"),
        EditorState.readOnly.of(!!props.readOnly),
        keymap.of([
          { key: "Mod-s", preventDefault: true, run: () => (cb.current.onSave?.(), true) },
          { key: "Mod-b", run: (v) => (wrapSel(v, "**", "**", "粗体"), true) },
          { key: "Mod-i", run: (v) => (wrapSel(v, "*", "*", "斜体"), true) },
          ...closeBracketsKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...defaultKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cb.current.onChange(u.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          scroll: (_e, v) => {
            const s = v.scrollDOM;
            const max = s.scrollHeight - s.clientHeight;
            cb.current.onScroll?.(max > 0 ? s.scrollTop / max : 0);
            return false;
          },
        }),
        ...(props.extraExtensions ?? []),
      ],
    });
    const view = new EditorView({ state, parent: host.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Recreate only when the document identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.docKey, props.readOnly]);

  useImperativeHandle(ref, () => ({
    insert(text, opts) {
      const v = viewRef.current;
      if (!v) return;
      const { from, to } = v.state.selection.main;
      let insert = text;
      if (opts?.block) {
        const line = v.state.doc.lineAt(from);
        const before = from === line.from ? "" : "\n\n";
        insert = `${before}${text}\n`;
      }
      v.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
      v.focus();
    },
    wrap(before, after = before, ph = "") {
      const v = viewRef.current;
      if (v) wrapSel(v, before, after, ph);
    },
    prefixLines(prefix) {
      const v = viewRef.current;
      if (!v) return;
      const { from, to } = v.state.selection.main;
      const start = v.state.doc.lineAt(from).number;
      const end = v.state.doc.lineAt(to).number;
      const changes = [];
      for (let n = start; n <= end; n++) changes.push({ from: v.state.doc.line(n).from, insert: prefix });
      v.dispatch({ changes });
      v.focus();
    },
    focus: () => viewRef.current?.focus(),
    scrollToLine(line) {
      const v = viewRef.current;
      if (!v) return;
      const l = v.state.doc.line(Math.max(1, Math.min(line, v.state.doc.lines)));
      v.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: "start", yMargin: 40 }) });
      v.focus();
    },
    view: () => viewRef.current,
    getText: () => viewRef.current?.state.doc.toString() ?? "",
  }));

  return <div className="lf-cm" ref={host} />;
});

function wrapSel(v: EditorView, before: string, after: string, ph: string) {
  const { from, to } = v.state.selection.main;
  const sel = v.state.sliceDoc(from, to) || ph;
  v.dispatch({
    changes: { from, to, insert: before + sel + after },
    selection: { anchor: from + before.length, head: from + before.length + sel.length },
  });
  v.focus();
}
