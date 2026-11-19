import { useEffect, useState } from "react";
import { RefreshCw, Save, FileDown, AlertTriangle, Info } from "lucide-react";
import { repo, backend } from "@/app/backend";
import { toast, withBusy } from "@/app/store";
import type { LayoutProfile, LoadedItem } from "@/domain/models/types";
import { LAYOUT_PRESETS, SONG_FONT_STACK, defaultLayoutProfile } from "@/domain/policies/defaults";
import { slugify } from "@/domain/policies/naming";
import { PdfViewer } from "@/components/pdf/PdfViewer";
import { Modal } from "@/components/feedback/Overlays";
import { buildBookPdf, loadCachedPreview, type PrintProgress } from "@/services/preview/printService";
import { flushAll } from "@/services/content/editSessions";

const FONTS: Array<{ label: string; value: string }> = [
  { label: "宋体（默认）", value: SONG_FONT_STACK },
  { label: "仿宋", value: '"FangSong", "仿宋", "STFangsong", ' + SONG_FONT_STACK },
  { label: "楷体", value: '"KaiTi", "楷体", "STKaiti", ' + SONG_FONT_STACK },
  { label: "思源宋体", value: '"Source Han Serif SC", "Noto Serif CJK SC", "Noto Serif SC", ' + SONG_FONT_STACK },
  { label: "西文衬线 + 宋体", value: '"Palatino Linotype", "Book Antiqua", Georgia, ' + SONG_FONT_STACK },
];

function Num({ label, value, onChange, step = 1, min = 0, max = 999, unit }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string }) {
  return (
    <label className="lf-field compact">
      <span>{label}</span>
      <span className="lf-num">
        <input type="number" value={value} step={step} min={min} max={max} onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value))))} />
        {unit && <em>{unit}</em>}
      </span>
    </label>
  );
}

/** Layout profile editor + generated-PDF preview (spec §3.3-4, FR-30, FR-31). */
export function PublishPanel({ item }: { item: LoadedItem }) {
  const [profile, setProfile] = useState<LayoutProfile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [info, setInfo] = useState<{ pages: number; at: string; warnings: string[]; stale?: boolean } | null>(null);
  const [progress, setProgress] = useState<PrintProgress | null>(null);
  const id = item.meta.id;

  useEffect(() => {
    repo.readLayout(id).then(setProfile);
    loadCachedPreview(id).then((b) => {
      if (b) {
        setBytes(b);
        setInfo({ pages: 0, at: "", warnings: [], stale: true });
      }
    });
  }, [id]);

  if (!profile) return <div className="lf-loading" />;

  const set = (patch: (p: LayoutProfile) => LayoutProfile) => {
    setProfile(patch(profile));
    setDirty(true);
  };

  const save = async () => {
    await repo.saveLayout(id, profile);
    setDirty(false);
    toast.success("排版配置已保存到书籍元数据（layouts/print.json）");
  };

  const build = async () => {
    await flushAll();
    if (dirty) await repo.saveLayout(id, profile);
    setDirty(false);
    try {
      setProgress({ phase: "layout", done: 0, total: 1 });
      const r = await buildBookPdf(id, profile, setProgress);
      setBytes(r.bytes);
      setInfo({ pages: r.pageCount, at: r.builtAt, warnings: r.warnings });
    } catch (e) {
      toast.error(e);
    } finally {
      setProgress(null);
    }
  };

  const exportPdf = async () => {
    if (!bytes) return;
    const target = await backend.platform.pickSaveFile("导出 PDF 成品", `${slugify(item.meta.title, 60) || "book"}.pdf`, [{ name: "PDF", extensions: ["pdf"] }]);
    if (!target) return;
    // The exported file is byte-for-byte the previewed PDF.
    await withBusy("正在保存 PDF…", () => backend.ext.exportWriteBytes(target, bytes));
    toast.success(`已导出：${target}`);
  };

  const p = profile;
  return (
    <div className="lf-publish">
      <div className="lf-publish-form">
        <div className="lf-publish-section">
          <h3>预设</h3>
          <select
            value=""
            onChange={(e) => {
              const preset = LAYOUT_PRESETS.find((x) => x.name === e.target.value);
              if (preset) set(() => ({ ...preset.make(), id: p.id }));
            }}
          >
            <option value="">应用预设…（当前：{p.name}）</option>
            {LAYOUT_PRESETS.map((x) => (
              <option key={x.name} value={x.name}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
        <div className="lf-publish-section">
          <h3>纸张与版心</h3>
          <div className="lf-grid2">
            <label className="lf-field compact">
              <span>开本</span>
              <select value={p.page.size} onChange={(e) => set((x) => ({ ...x, page: { ...x.page, size: e.target.value as LayoutProfile["page"]["size"] } }))}>
                <option value="A4">A4（210×297）</option>
                <option value="B5">B5（176×250）</option>
                <option value="A5">A5（148×210）</option>
                <option value="32K">32 开（130×184）</option>
                <option value="custom">自定义</option>
              </select>
            </label>
            <label className="lf-field compact">
              <span>方向</span>
              <select value={p.page.orientation ?? "portrait"} onChange={(e) => set((x) => ({ ...x, page: { ...x.page, orientation: e.target.value as "portrait" } }))}>
                <option value="portrait">纵向</option>
                <option value="landscape">横向</option>
              </select>
            </label>
            {p.page.size === "custom" && (
              <>
                <Num label="宽" unit="mm" value={p.page.widthMm ?? 148} min={60} max={600} onChange={(v) => set((x) => ({ ...x, page: { ...x.page, widthMm: v } }))} />
                <Num label="高" unit="mm" value={p.page.heightMm ?? 210} min={60} max={900} onChange={(v) => set((x) => ({ ...x, page: { ...x.page, heightMm: v } }))} />
              </>
            )}
            <Num label="上边距" unit="mm" value={p.marginsMm.top} max={80} onChange={(v) => set((x) => ({ ...x, marginsMm: { ...x.marginsMm, top: v } }))} />
            <Num label="下边距" unit="mm" value={p.marginsMm.bottom} max={80} onChange={(v) => set((x) => ({ ...x, marginsMm: { ...x.marginsMm, bottom: v } }))} />
            <Num label="内侧（订口）" unit="mm" value={p.marginsMm.inner} max={80} onChange={(v) => set((x) => ({ ...x, marginsMm: { ...x.marginsMm, inner: v } }))} />
            <Num label="外侧（切口）" unit="mm" value={p.marginsMm.outer} max={80} onChange={(v) => set((x) => ({ ...x, marginsMm: { ...x.marginsMm, outer: v } }))} />
          </div>
        </div>
        <div className="lf-publish-section">
          <h3>字体与段落</h3>
          <label className="lf-field compact">
            <span>正文字体</span>
            <select value={FONTS.find((f) => f.value === p.typography.fontFamily) ? p.typography.fontFamily : "__custom"} onChange={(e) => e.target.value !== "__custom" && set((x) => ({ ...x, typography: { ...x.typography, fontFamily: e.target.value } }))}>
              {FONTS.map((f) => (
                <option key={f.label} value={f.value}>
                  {f.label}
                </option>
              ))}
              {!FONTS.find((f) => f.value === p.typography.fontFamily) && <option value="__custom">自定义：{p.typography.fontFamily.slice(0, 20)}</option>}
            </select>
          </label>
          <div className="lf-grid2">
            <Num label="字号" unit="pt" step={0.5} min={6} max={24} value={p.typography.fontSizePt} onChange={(v) => set((x) => ({ ...x, typography: { ...x.typography, fontSizePt: v } }))} />
            <Num label="行距" unit="倍" step={0.05} min={1} max={3} value={p.typography.lineHeight} onChange={(v) => set((x) => ({ ...x, typography: { ...x.typography, lineHeight: v } }))} />
            <Num label="首行缩进" unit="字" step={0.5} max={4} value={p.typography.paragraphIndentEm} onChange={(v) => set((x) => ({ ...x, typography: { ...x.typography, paragraphIndentEm: v } }))} />
            <Num label="段距" unit="pt" step={1} max={30} value={p.typography.paragraphSpacingPt} onChange={(v) => set((x) => ({ ...x, typography: { ...x.typography, paragraphSpacingPt: v } }))} />
          </div>
        </div>
        <div className="lf-publish-section">
          <h3>章节与书籍元素</h3>
          <label className="lf-check">
            <input type="checkbox" checked={p.chapters.startOnNewPage} onChange={(e) => set((x) => ({ ...x, chapters: { ...x.chapters, startOnNewPage: e.target.checked } }))} /> 每章从新页开始
          </label>
          <label className="lf-check">
            <input type="checkbox" checked={!!p.chapters.startOnOddPage} disabled={!p.chapters.startOnNewPage} onChange={(e) => set((x) => ({ ...x, chapters: { ...x.chapters, startOnOddPage: e.target.checked } }))} /> 章节从奇数页（右页）开始
          </label>
          <label className="lf-field compact">
            <span>章节标题</span>
            <select value={p.chapters.titleStyle ?? "centered"} onChange={(e) => set((x) => ({ ...x, chapters: { ...x.chapters, titleStyle: e.target.value as "centered" } }))}>
              <option value="centered">居中</option>
              <option value="left">居左</option>
            </select>
          </label>
          <label className="lf-check">
            <input type="checkbox" checked={p.includeCover} onChange={(e) => set((x) => ({ ...x, includeCover: e.target.checked }))} /> 封面
          </label>
          <label className="lf-check">
            <input type="checkbox" checked={p.includeTitlePage} onChange={(e) => set((x) => ({ ...x, includeTitlePage: e.target.checked }))} /> 扉页
          </label>
          <label className="lf-check">
            <input type="checkbox" checked={p.includeToc} onChange={(e) => set((x) => ({ ...x, includeToc: e.target.checked }))} /> 目录（含页码）
          </label>
        </div>
        <div className="lf-publish-section">
          <h3>页眉页脚</h3>
          <label className="lf-check">
            <input type="checkbox" checked={p.headerFooter.showPageNumbers} onChange={(e) => set((x) => ({ ...x, headerFooter: { ...x.headerFooter, showPageNumbers: e.target.checked } }))} /> 页码
          </label>
          <label className="lf-field compact">
            <span>页码位置</span>
            <select value={p.headerFooter.pageNumberPosition ?? "center"} onChange={(e) => set((x) => ({ ...x, headerFooter: { ...x.headerFooter, pageNumberPosition: e.target.value as "center" } }))}>
              <option value="center">居中</option>
              <option value="outer">外侧</option>
            </select>
          </label>
          <label className="lf-check">
            <input type="checkbox" checked={!!p.headerFooter.headerChapterTitle} onChange={(e) => set((x) => ({ ...x, headerFooter: { ...x.headerFooter, headerChapterTitle: e.target.checked } }))} /> 页眉显示章名
          </label>
          <label className="lf-check">
            <input type="checkbox" checked={!!p.headerFooter.mirrorOddEven} onChange={(e) => set((x) => ({ ...x, headerFooter: { ...x.headerFooter, mirrorOddEven: e.target.checked } }))} /> 奇偶页对称（左页书名 / 右页章名）
          </label>
          <label className="lf-field compact">
            <span>页眉文字</span>
            <input value={p.headerFooter.headerText ?? ""} placeholder={item.meta.title} onChange={(e) => set((x) => ({ ...x, headerFooter: { ...x.headerFooter, headerText: e.target.value } }))} />
          </label>
          <label className="lf-field compact">
            <span>页脚文字</span>
            <input value={p.headerFooter.footerText ?? ""} onChange={(e) => set((x) => ({ ...x, headerFooter: { ...x.headerFooter, footerText: e.target.value } }))} />
          </label>
        </div>
        <div className="lf-publish-section">
          <h3>输出</h3>
          <label className="lf-field compact">
            <span>分辨率</span>
            <select value={p.exportDpi ?? 200} onChange={(e) => set((x) => ({ ...x, exportDpi: Number(e.target.value) }))}>
              <option value={150}>150 dpi（快速预览）</option>
              <option value={200}>200 dpi（屏幕阅读）</option>
              <option value={300}>300 dpi（打印）</option>
            </select>
          </label>
          <p className="lf-note">
            <Info size={13} /> 预览显示的就是将被导出的同一份 PDF；修改内容请回到 Markdown，修改版式请调整此处配置后重新生成。
          </p>
        </div>
        <div className="lf-publish-actions">
          <button className="lf-btn" onClick={save} disabled={!dirty}>
            <Save size={14} /> 保存配置
          </button>
          <button className="lf-btn" onClick={() => set(() => ({ ...defaultLayoutProfile(), id: p.id }))}>
            恢复默认
          </button>
        </div>
      </div>
      <div className="lf-publish-preview">
        <div className="lf-publish-bar">
          <button className="lf-btn primary" onClick={build} disabled={!!progress}>
            <RefreshCw size={14} className={progress ? "spin" : ""} /> {bytes ? "重新生成成品预览" : "生成成品预览"}
          </button>
          <button className="lf-btn" onClick={exportPdf} disabled={!bytes || !!progress || dirty}>
            <FileDown size={14} /> 导出 PDF
          </button>
          {progress && (
            <span className="lf-progress">
              {progress.phase === "layout" ? "排版中" : progress.phase === "render" ? "渲染页面" : "生成 PDF"} {progress.total > 1 ? `${progress.done}/${progress.total}` : ""}
            </span>
          )}
          {!progress && info && !info.stale && (
            <span className="muted">
              {info.pages} 页 · {new Date(info.at).toLocaleTimeString()}
            </span>
          )}
          {!progress && info?.stale && <span className="muted">显示的是上次生成的预览（缓存）</span>}
          {dirty && <span className="lf-warn-text">配置已修改，请重新生成</span>}
        </div>
        {info?.warnings.length ? (
          <div className="lf-note warn">
            <AlertTriangle size={13} /> {info.warnings.slice(0, 3).join("；")}
          </div>
        ) : null}
        <div className="lf-publish-viewer">
          {bytes ? (
            <PdfViewer bytes={bytes} label="成品预览（只读）" />
          ) : (
            <div className="lf-empty">
              <h3>尚未生成成品预览</h3>
              <p>调整左侧的排版配置，然后生成 PDF 成品预览，检查真实分页、章节起页与图片公式的布局。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function PublishDialog({ item, onClose }: { item: LoadedItem; onClose: () => void }) {
  return (
    <Modal title={`排版与 PDF 成品 · ${item.meta.title}`} onClose={onClose} width={Math.min(1280, window.innerWidth - 80)} className="lf-modal-publish">
      <PublishPanel item={item} />
    </Modal>
  );
}
