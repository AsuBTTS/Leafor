import { useEffect, useState } from "react";
import { FolderOpen, FolderPlus, Sparkles, X, Clock } from "lucide-react";
import { backend, repo } from "@/app/backend";
import { confirmDialog, prompt, toast, withBusy } from "@/app/store";
import { LeaforMark, WindowControls } from "@/components/navigation/Chrome";
import { NotAWorkspaceError } from "@/services/library/repository";
import type { RecentWorkspace } from "@/services/persistence/ports";
import { seedDemoWorkspace } from "@/services/library/demoSeed";
import { searchIndex } from "@/services/search/searchIndex";

export function WelcomePage() {
  const [recent, setRecent] = useState<RecentWorkspace[]>([]);
  const p = backend.platform;

  const refresh = () => p.recentList().then(setRecent).catch(() => setRecent([]));
  useEffect(() => {
    void refresh();
  }, []);

  const afterOpen = () => {
    searchIndex.scheduleRebuild(0);
    if (repo.loadIssues.length) toast.warning(`有 ${repo.loadIssues.length} 个元数据文件无法读取，已跳过（原文件未改动）。`);
  };

  const openPath = async (path: string) => {
    await withBusy("正在打开作品库…", async () => {
      try {
        await repo.openWorkspace(path);
        afterOpen();
      } catch (e) {
        if (e instanceof NotAWorkspaceError) {
          const ok = await confirmDialog({
            title: "初始化作品库",
            message: `“${path}” 还不是 Leafor 作品库。是否在此文件夹中创建 .leafor 元数据，并把它作为作品库？已有文件不会被改动。`,
            okText: "初始化",
          });
          if (!ok) {
            await repo.closeWorkspace();
            return;
          }
          const name = path.split(/[\\/]/).filter(Boolean).pop() ?? "我的作品库";
          await repo.createWorkspace(path, name);
          afterOpen();
        } else throw e;
      }
    });
  };

  const openExisting = async () => {
    const dir = await p.pickDirectory("选择作品库文件夹");
    if (dir) await openPath(dir);
  };

  const createNew = async (demo = false) => {
    const parent = await p.pickDirectory(demo ? "选择示例作品库的存放位置" : "选择新作品库的存放位置");
    if (!parent) return;
    const name = await prompt({ title: demo ? "示例作品库名称" : "新建作品库", label: "作品库名称（将创建同名文件夹）", value: demo ? "Leafor 示例作品库" : "我的作品库", okText: "创建" });
    if (!name) return;
    const safe = name.replace(/[<>:"/\\|?*]/g, " ").trim() || "我的作品库";
    const root = p.joinAbs(parent, safe);
    await withBusy(demo ? "正在生成示例内容…" : "正在创建作品库…", async () => {
      if (demo) await seedDemoWorkspace(repo, root, safe);
      else await repo.createWorkspace(root, safe);
      afterOpen();
    });
  };

  return (
    <div className="lf-welcome">
      <div className="lf-welcome-drag" data-tauri-drag-region>
        <WindowControls />
      </div>
      <div className="lf-welcome-card">
        <div className="lf-welcome-brand">
          <span className="lf-welcome-logo">
            <LeaforMark size={30} />
          </span>
          <div>
            <h1>Leafor</h1>
            <p>本地作品档案馆与创作工作台</p>
          </div>
        </div>
        <p className="lf-welcome-intro">作品以 Markdown、图片、PDF 与 JSON 文件保存在你选择的文件夹中。无需账户，离线可用；停用本软件后，文件依然可以用常规工具打开。</p>
        <div className="lf-welcome-actions">
          <button className="lf-welcome-action primary" onClick={() => createNew(false)}>
            <FolderPlus size={20} strokeWidth={1.5} />
            <span>
              <strong>新建作品库</strong>
              <small>在本地选择位置，创建一个空的作品库文件夹</small>
            </span>
          </button>
          <button className="lf-welcome-action" onClick={openExisting}>
            <FolderOpen size={20} strokeWidth={1.5} />
            <span>
              <strong>打开作品库</strong>
              <small>打开已有的作品库，或把一个文件夹初始化为作品库</small>
            </span>
          </button>
          <button className="lf-welcome-action" onClick={() => createNew(true)}>
            <Sparkles size={20} strokeWidth={1.5} />
            <span>
              <strong>创建示例作品库</strong>
              <small>包含图书、博客、系列文章、摄影集与只读 PDF 的示例</small>
            </span>
          </button>
        </div>
        {recent.length > 0 && (
          <div className="lf-welcome-recent">
            <h3>
              <Clock size={14} /> 最近打开
            </h3>
            {recent.map((r) => (
              <div key={r.path} className="lf-recent-row">
                <button className="lf-recent-open" onClick={() => openPath(r.path)}>
                  <strong>{r.title}</strong>
                  <small>{r.path}</small>
                </button>
                <button className="lf-icon-btn" title="从列表移除（不删除文件）" aria-label="从列表移除" onClick={async () => (await p.recentRemove(r.path), refresh())}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
