import { useEffect, useState } from "react";
import { FolderSearch, RefreshCw, LogOut, CheckCircle2, AlertTriangle, Database, Trash2 } from "lucide-react";
import { useRepo, toast, withBusy, confirmDialog } from "@/app/store";
import { backend, isDesktop } from "@/app/backend";
import { TopBar } from "@/components/navigation/Chrome";
import { useSearchIndex } from "@/services/search/searchIndex";
import { flushAll } from "@/services/content/editSessions";
import { CACHE_DIR } from "@/services/library/repository";
import { clearThumbMemory } from "@/services/content/thumbnails";

function songAvailable(): { name: string; ok: boolean }[] {
  const c = document.createElement("canvas").getContext("2d")!;
  const sample = "永和九年岁在癸丑暮春之初";
  const w = (f: string) => ((c.font = `24px ${f}`), c.measureText(sample).width);
  return ["SimSun", "Songti SC", "STSong", "Source Han Serif SC", "Noto Serif CJK SC"].map((name) => ({ name, ok: w(`"${name}", monospace`) !== w("monospace") }));
}

export function SettingsPage() {
  const repo = useRepo();
  const index = useSearchIndex();
  const [info, setInfo] = useState<{ version: string; platform: string } | null>(null);
  const [dataDir, setDataDir] = useState("");
  const [fonts] = useState(songAvailable);
  const s = repo.ws.settings;

  useEffect(() => {
    backend.platform.appInfo().then(setInfo);
    backend.platform.dataDir().then(setDataDir).catch(() => setDataDir(""));
  }, []);

  const songOk = fonts.some((f) => f.ok);

  return (
    <div className="lf-page">
      <TopBar
        left={
          <div className="lf-page-title">
            <h1>设置</h1>
          </div>
        }
      />
      <div className="lf-scroll">
        <div className="lf-settings">
          <section>
            <h2>作品库</h2>
            <dl className="lf-props-meta wide">
              <dt>名称</dt>
              <dd>
                <input className="lf-inline-input" defaultValue={repo.ws.title} onBlur={(e) => e.target.value.trim() && e.target.value !== repo.ws.title && repo.saveWorkspace({ title: e.target.value.trim() })} />
              </dd>
              <dt>位置</dt>
              <dd className="mono">{repo.root}</dd>
              <dt>内容</dt>
              <dd>
                {repo.collections.size} 个集合 · {repo.items.size} 个作品
              </dd>
              <dt>格式</dt>
              <dd>Markdown、图片、PDF 与 JSON 元数据直接保存在文件夹中；复制整个文件夹即可备份或迁移。</dd>
            </dl>
            <div className="lf-settings-actions">
              <button className="lf-btn" onClick={() => backend.platform.reveal(".leafor/workspace.json").catch(toast.error)}>
                <FolderSearch size={14} /> 在文件管理器中显示
              </button>
              <button
                className="lf-btn"
                onClick={async () => {
                  if (!(await flushAll())) return toast.warning("有未能保存的修改，请先处理冲突");
                  await repo.closeWorkspace();
                }}
              >
                <LogOut size={14} /> 切换作品库
              </button>
            </div>
            {repo.loadIssues.length > 0 && (
              <div className="lf-note warn">
                <AlertTriangle size={13} /> 载入时跳过了 {repo.loadIssues.length} 个无效的元数据文件（原文件未改动）：{repo.loadIssues.slice(0, 3).join("；")}
              </div>
            )}
          </section>

          <section>
            <h2>编辑</h2>
            <label className="lf-field compact">
              <span>自动保存延迟</span>
              <select value={s.autosaveDelayMs} onChange={(e) => repo.saveWorkspace({ settings: { ...s, autosaveDelayMs: Number(e.target.value) } })}>
                <option value={800}>0.8 秒</option>
                <option value={1000}>1 秒（推荐）</option>
                <option value={1500}>1.5 秒</option>
                <option value={3000}>3 秒</option>
              </select>
            </label>
            <label className="lf-field compact">
              <span>编辑器字号</span>
              <select
                value={s.editorFontSize}
                onChange={(e) => {
                  void repo.saveWorkspace({ settings: { ...s, editorFontSize: Number(e.target.value) } });
                  document.documentElement.style.setProperty("--lf-editor-size", `${e.target.value}px`);
                }}
              >
                {[14, 15, 16, 17, 18, 20, 22].map((n) => (
                  <option key={n} value={n}>
                    {n}px
                  </option>
                ))}
              </select>
            </label>
            <p className="muted small">编辑时修改会在停顿后自动安全写盘（临时文件 + 原子替换）；异常退出时未保存的内容会保存为恢复草稿，下次打开时提示恢复。</p>
          </section>

          <section>
            <h2>字体</h2>
            <p className="muted">Leafor 的界面与正文默认使用宋体（Windows：SimSun；macOS：Songti SC）。</p>
            <ul className="lf-font-list">
              {fonts.map((f) => (
                <li key={f.name} style={{ fontFamily: `"${f.name}"` }}>
                  {f.ok ? <CheckCircle2 size={13} className="ok" /> : <span className="lf-dot-muted" />} {f.name} {f.ok ? "可用" : "未检测到"}
                </li>
              ))}
            </ul>
            {!songOk && (
              <div className="lf-note warn">
                <AlertTriangle size={13} /> 未检测到宋体，当前使用系统衬线字体回退。可在系统中安装宋体 / 思源宋体后重启 Leafor。
              </div>
            )}
          </section>

          <section>
            <h2>搜索索引与缓存</h2>
            <p className="muted">
              索引与缩略图只是可重建的缓存；删除或损坏都不会影响作品文件。
              {isDesktop ? ` 索引数据库保存在：${dataDir}` : ""}
            </p>
            <dl className="lf-props-meta wide">
              <dt>索引状态</dt>
              <dd>
                {index.state === "ready" ? `已就绪（${index.docs.size} 条）` : index.state === "building" ? "正在建立…" : index.state === "error" ? `出错：${index.error}` : "未建立"}
                {isDesktop && !index.sqliteOk ? `（SQLite 缓存不可用，已使用内存索引：${index.sqliteError ?? ""}）` : ""}
              </dd>
            </dl>
            <div className="lf-settings-actions">
              <button className="lf-btn" onClick={() => withBusy("正在重建索引…", () => index.resetCache()).then(() => toast.success("索引已重建"))}>
                <Database size={14} /> 重建搜索索引
              </button>
              <button
                className="lf-btn"
                onClick={async () => {
                  if (!(await confirmDialog({ title: "清除缓存", message: "删除 .leafor/cache 中的缩略图与排版预览缓存。它们会在需要时自动重新生成。", okText: "清除" }))) return;
                  await withBusy("正在清除…", () => repo.fs.remove(CACHE_DIR).then(() => repo.fs.mkdir(CACHE_DIR)));
                  clearThumbMemory();
                  toast.success("缓存已清除");
                }}
              >
                <Trash2 size={14} /> 清除缩略图与预览缓存
              </button>
              <button className="lf-btn" onClick={() => withBusy("正在重新读取作品库…", () => repo.loadWorkspace())}>
                <RefreshCw size={14} /> 重新读取作品库文件
              </button>
            </div>
          </section>

          <section>
            <h2>关于</h2>
            <dl className="lf-props-meta wide">
              <dt>版本</dt>
              <dd>Leafor {info?.version ?? ""}（{info?.platform ?? ""}）</dd>
              <dt>隐私</dt>
              <dd>无账户、无云端、无遥测。Leafor 不会上传任何文档、图片或使用数据，远程图片默认不加载。</dd>
              {isDesktop && (
                <>
                  <dt>应用数据</dt>
                  <dd className="mono">{dataDir}</dd>
                </>
              )}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
