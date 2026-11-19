import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { Bold, Italic, Heading2, Link2, Image as ImageIcon, Code, Quote, List, ListOrdered, Table, Sigma, SquareFunction, Minus, Loader2, CheckCircle2, AlertTriangle, CircleDot } from "lucide-react";
import { repo, backend } from "@/app/backend";
import { toast, useRepo } from "@/app/store";
import { FsError } from "@/services/persistence/ports";
import { MarkdownEditor, type MarkdownEditorHandle } from "./MarkdownEditor";
import { MarkdownView, useRenderedMarkdown } from "@/components/markdown/MarkdownView";
import type { OutlineEntry } from "@/components/markdown/pipeline";
import { wordCount } from "@/components/markdown/pipeline";
import { registerSession } from "@/services/content/editSessions";
import { searchIndex } from "@/services/search/searchIndex";
import { findUnit } from "@/domain/policies/units";
import { dirName, joinRel, stem } from "@/domain/policies/naming";
import { Modal } from "@/components/feedback/Overlays";
import { insertImagesForUnit } from "@/services/import-export/importService";

export type TextMode = "edit" | "split" | "preview";
export type SaveState = "loading" | "clean" | "dirty" | "saving" | "saved" | "conflict" | "error";

export interface TextWorkbenchHandle {
  flush(): Promise<boolean>;
  scrollToHeading(id: string, line?: number): void;
  getText(): string;
}

export interface TextWorkbenchProps {
  itemId: string;
  unitId: string;
  mode: TextMode;
  onOutline?: (o: OutlineEntry[]) => void;
  onState?: (s: SaveState) => void;
  onInternalLink?: (path: string) => void;
  /** Extra content rendered above the preview text (e.g. series navigation). */
  previewHeader?: ReactNode;
  previewFooter?: ReactNode;
  readerClass?: string;
}

export const TextWorkbench = forwardRef<TextWorkbenchHandle, TextWorkbenchProps>(function TextWorkbench(props, ref) {
  const { itemId, unitId, mode } = props;
  const r = useRepo();
  const it = r.getItem(itemId);
  const unit = it ? findUnit(it.meta, unitId) : undefined;
  const filePath = it && unit ? joinRel(it.dir, unit.path) : "";
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>("loading");
  const [conflict, setConflict] = useState<{ disk: string } | null>(null);
  const [scrollSync, setScrollSync] = useState(true);
  const textRef = useRef("");
  const savedText = useRef("");
  const baseHash = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);
  const editor = useRef<MarkdownEditorHandle>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<SaveState>("loading");
  const [docKey, setDocKey] = useState(0);

  const setS = useCallback(
    (s: SaveState) => {
      stateRef.current = s;
      setState(s);
      props.onState?.(s);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.onState],
  );

  // ---- load
  useEffect(() => {
    let alive = true;
    setText(null);
    setS("loading");
    repo
      .readUnitText(itemId, unitId)
      .then(({ text, hash }) => {
        if (!alive) return;
        textRef.current = text;
        savedText.current = text;
        baseHash.current = hash;
        setText(text);
        setDocKey((k) => k + 1);
        setS("clean");
      })
      .catch((e) => {
        if (!alive) return;
        setS("error");
        toast.error(e instanceof FsError && e.kind === "not_found" ? `找不到文件：${filePath}（内容未被删除，可能已在外部移动）` : e);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, unitId]);

  // ---- save
  const save = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    if (saving.current) await saving.current;
    if (stateRef.current === "conflict") return false;
    const t = textRef.current;
    if (t === savedText.current) {
      if (stateRef.current === "dirty") setS("clean");
      return true;
    }
    setS("saving");
    const job = (async () => {
      try {
        const h = await repo.saveUnitText(itemId, unitId, t, baseHash.current);
        baseHash.current = h;
        savedText.current = t;
        searchIndex.updateUnitText(itemId, unitId, t);
        setS(textRef.current === t ? "saved" : "dirty");
        if (textRef.current !== t) schedule();
        return true;
      } catch (e) {
        if (e instanceof FsError && e.kind === "conflict") {
          const disk = await repo.fs.readText(filePath).catch(() => "");
          setConflict({ disk });
          setS("conflict");
        } else {
          setS("error");
          toast.error(`保存失败：${(e as Error).message}。修改已保留为恢复草稿。`);
        }
        return false;
      } finally {
        saving.current = null;
      }
    })();
    saving.current = job;
    return job;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, unitId, filePath]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), repo.ws?.settings.autosaveDelayMs ?? 1000);
  }, [save]);

  const onChange = useCallback(
    (t: string) => {
      textRef.current = t;
      setText(t);
      if (stateRef.current !== "conflict") setS("dirty");
      if (stateRef.current !== "conflict") schedule();
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => {
        if (textRef.current === savedText.current) return;
        void repo.writeRecovery({ itemId, unitId, path: filePath, title: unit?.title ?? "", text: textRef.current, baseHash: baseHash.current, savedAt: new Date().toISOString() }).catch(() => undefined);
      }, 400);
    },
    [schedule, itemId, unitId, filePath, unit?.title, setS],
  );

  // ---- external change detection
  const checkExternal = useCallback(async () => {
    if (stateRef.current === "loading" || stateRef.current === "conflict" || saving.current) return;
    const disk = await repo.fs.hash(filePath).catch(() => null);
    if (!disk || disk === baseHash.current) return;
    if (textRef.current === savedText.current) {
      const t = await repo.fs.readText(filePath);
      textRef.current = t;
      savedText.current = t;
      baseHash.current = disk;
      setText(t);
      setDocKey((k) => k + 1);
      setS("clean");
      toast.info("检测到文件在外部被修改，已重新载入");
    } else {
      setConflict({ disk: await repo.fs.readText(filePath) });
      setS("conflict");
    }
  }, [filePath, setS]);

  useEffect(() => {
    const unregister = registerSession(`${itemId}:${unitId}`, {
      isDirty: () => textRef.current !== savedText.current,
      flush: save,
      checkExternal,
    });
    return () => {
      unregister();
      if (textRef.current !== savedText.current && stateRef.current !== "conflict") void save();
    };
  }, [itemId, unitId, save, checkExternal]);

  useImperativeHandle(ref, () => ({
    flush: save,
    getText: () => textRef.current,
    scrollToHeading(id, line) {
      if (mode !== "edit" && previewRef.current) {
        previewRef.current.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (mode !== "preview" && line) editor.current?.scrollToLine(line);
    },
  }));

  // ---- conflict resolution
  const resolve = async (choice: "reload" | "mine" | "copy") => {
    if (!conflict) return;
    try {
      if (choice === "reload") {
        const t = await repo.fs.readText(filePath);
        baseHash.current = await repo.fs.hash(filePath);
        textRef.current = t;
        savedText.current = t;
        setText(t);
        setDocKey((k) => k + 1);
        await repo.clearRecovery(unitId);
        setS("clean");
      } else if (choice === "mine") {
        baseHash.current = await repo.fs.hash(filePath);
        setConflict(null);
        stateRef.current = "dirty";
        savedText.current = "\u0000";
        await save();
      } else {
        const copy = joinRel(dirName(filePath), `${stem(filePath)}.conflict-${Date.now()}.md`);
        await repo.fs.writeText(copy, textRef.current, "");
        toast.success(`你的版本已另存为 ${copy.split("/").pop()}`);
        await resolveReload();
      }
      setConflict(null);
    } catch (e) {
      toast.error(e);
    }
  };
  const resolveReload = async () => {
    const t = await repo.fs.readText(filePath);
    baseHash.current = await repo.fs.hash(filePath);
    textRef.current = t;
    savedText.current = t;
    setText(t);
    setDocKey((k) => k + 1);
    setS("clean");
  };

  // ---- outline
  const rendered = useRenderedMarkdown(text ?? "", filePath, it?.dir ?? "");
  const onOutline = props.onOutline;
  useEffect(() => {
    onOutline?.(rendered.outline);
  }, [rendered.outline, onOutline]);

  const insertImage = async () => {
    if (!unit) return;
    const files = await backend.platform.pickFiles("插入图片（将复制到作品的 assets/ 中）", [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"] }], true);
    if (!files.length) return;
    try {
      const md = await insertImagesForUnit(repo, itemId, unit.path, files);
      editor.current?.insert(md, { block: true });
    } catch (e) {
      toast.error(e);
    }
  };

  const onEditorScroll = (ratio: number) => {
    if (mode !== "split" || !scrollSync || !previewRef.current) return;
    const p = previewRef.current.parentElement!;
    p.scrollTop = ratio * (p.scrollHeight - p.clientHeight);
  };

  if (!it || !unit) return <div className="lf-empty-pane">内容不存在</div>;

  const wc = wordCount(text ?? "");
  const tools: Array<[ReactNode, string, () => void]> = [
    [<Bold size={15} />, "粗体 Ctrl+B", () => editor.current?.wrap("**", "**", "粗体")],
    [<Italic size={15} />, "斜体 Ctrl+I", () => editor.current?.wrap("*", "*", "斜体")],
    [<Heading2 size={15} />, "标题", () => editor.current?.prefixLines("## ")],
    [<Quote size={15} />, "引用", () => editor.current?.prefixLines("> ")],
    [<List size={15} />, "无序列表", () => editor.current?.prefixLines("- ")],
    [<ListOrdered size={15} />, "有序列表", () => editor.current?.prefixLines("1. ")],
    [<Link2 size={15} />, "链接", () => editor.current?.wrap("[", "](https://)", "链接文字")],
    [<ImageIcon size={15} />, "插入图片", insertImage],
    [<Code size={15} />, "代码块", () => editor.current?.insert("```\n\n```", { block: true })],
    [<Table size={15} />, "表格", () => editor.current?.insert("| 列 1 | 列 2 |\n| --- | --- |\n|  |  |", { block: true })],
    [<Sigma size={15} />, "行内公式", () => editor.current?.wrap("$", "$", "x^2")],
    [<SquareFunction size={15} />, "块级公式", () => editor.current?.insert("$$\n\\int_0^1 f(x)\\,dx\n$$", { block: true })],
    [<Minus size={15} />, "分隔线", () => editor.current?.insert("---", { block: true })],
  ];

  return (
    <div className={`lf-textwb mode-${mode}`}>
      {mode !== "preview" && (
        <div className="lf-mdtools" role="toolbar" aria-label="Markdown 工具">
          {tools.map(([icon, label, fn], i) => (
            <button key={i} className="lf-icon-btn" title={label} aria-label={label} onClick={fn}>
              {icon}
            </button>
          ))}
          {mode === "split" && (
            <label className="lf-mdtools-sync">
              <input type="checkbox" checked={scrollSync} onChange={(e) => setScrollSync(e.target.checked)} /> 同步滚动
            </label>
          )}
        </div>
      )}
      <div className="lf-textwb-body">
        {mode !== "preview" && (
          <div className="lf-textwb-editor">
            {text === null ? (
              <div className="lf-loading">
                <Loader2 className="spin" size={18} />
              </div>
            ) : (
              <MarkdownEditor ref={editor} docKey={`${unitId}:${docKey}`} initial={text} onChange={onChange} onSave={() => void save()} onScroll={onEditorScroll} />
            )}
          </div>
        )}
        {mode !== "edit" && (
          <div className="lf-textwb-preview">
            <div className={`lf-reading ${props.readerClass ?? ""}`}>
              {props.previewHeader}
              <MarkdownView ref={previewRef} text={text ?? ""} filePath={filePath} scopeDir={it.dir} onInternalLink={(p) => props.onInternalLink?.(p)} />
              {props.previewFooter}
            </div>
          </div>
        )}
      </div>
      <div className="lf-statusbar">
        <SaveIndicator state={state} />
        <span>{wc.toLocaleString()} 字</span>
        <span className="muted mono" title={filePath}>
          {unit.path}
        </span>
      </div>
      {conflict && (
        <Modal title="文件冲突" width={760} onClose={() => {}}>
          <p className="lf-dialog-text">《{unit.title}》在 Leafor 之外被修改，而你在这里也有未保存的修改。Leafor 不会静默覆盖磁盘上的版本，请选择：</p>
          <div className="lf-conflict-compare">
            <div>
              <h4>磁盘上的版本</h4>
              <pre>{conflict.disk}</pre>
            </div>
            <div>
              <h4>你的版本</h4>
              <pre>{textRef.current}</pre>
            </div>
          </div>
          <div className="lf-conflict-actions">
            <button className="lf-btn" onClick={() => resolve("copy")}>
              将我的版本另存为副本，载入磁盘版本
            </button>
            <button className="lf-btn" onClick={() => resolve("reload")}>
              放弃我的修改，载入磁盘版本
            </button>
            <button className="lf-btn danger" onClick={() => resolve("mine")}>
              用我的版本覆盖
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
});

export function SaveIndicator({ state }: { state: SaveState }) {
  const map: Record<SaveState, [ReactNode, string]> = {
    loading: [<Loader2 size={13} className="spin" />, "载入中"],
    clean: [<CheckCircle2 size={13} />, "已保存"],
    saved: [<CheckCircle2 size={13} />, "已保存"],
    dirty: [<CircleDot size={13} />, "未保存"],
    saving: [<Loader2 size={13} className="spin" />, "保存中…"],
    conflict: [<AlertTriangle size={13} />, "冲突"],
    error: [<AlertTriangle size={13} />, "保存失败"],
  };
  const [icon, label] = map[state];
  return (
    <span className={`lf-save state-${state}`}>
      {icon}
      {label}
    </span>
  );
}
