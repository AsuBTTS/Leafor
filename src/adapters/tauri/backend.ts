import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Backend, ExternalFs, FileFilter, FsEntry, Platform, RecentWorkspace, WorkspaceFs } from "@/services/persistence/ports";
import { FsError } from "@/services/persistence/ports";
import { joinRel } from "@/domain/policies/naming";

async function call<T>(cmd: string, args?: Record<string, unknown> | Uint8Array, options?: { headers: Record<string, string> }): Promise<T> {
  try {
    return await invoke<T>(cmd, args as never, options);
  } catch (e) {
    if (e && typeof e === "object" && "kind" in e) {
      const err = e as { kind: FsError["kind"]; message: string; diskHash?: string | null };
      throw new FsError(err.kind, err.message, err.diskHash);
    }
    throw new FsError("unknown", String(e));
  }
}

function toBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (Array.isArray(v)) return new Uint8Array(v);
  throw new FsError("io", "unexpected binary payload");
}

export function createTauriBackend(): Backend {
  let root = "";
  const sep = navigator.userAgent.includes("Windows") ? "\\" : "/";

  const fs: WorkspaceFs = {
    readText: (path) => call("fs_read_text", { path }),
    readBytes: async (path) => toBytes(await call("fs_read_bytes", { path })),
    writeText: (path, text, expectedHash) => call("fs_write_text", { path, text, expectedHash: expectedHash ?? null }),
    writeBytes: (path, bytes) => call("fs_write_bytes", bytes, { headers: { "x-path": encodeURIComponent(path) } }),
    list: (path) => call<FsEntry[]>("fs_list", { path }),
    stat: (path) => call<FsEntry | null>("fs_stat", { path }),
    mkdir: (path) => call("fs_mkdir", { path }),
    hash: (path) => call("fs_hash", { path }),
    copy: (from, to) => call("fs_copy", { from, to }),
    move: (from, to) => call("fs_move", { from, to }),
    remove: (path) => call("fs_remove", { path }),
    assetUrl: (path, version) => {
      if (!root) return "";
      const abs = root + sep + joinRel(path).split("/").join(sep);
      const url = convertFileSrc(abs);
      return version !== undefined ? `${url}?v=${encodeURIComponent(String(version))}` : url;
    },
    absPath: (path) => call("fs_abs_path", { path }),
  };

  const ext: ExternalFs = {
    importCopy: (source, dest) => call("import_copy", { source, dest }),
    importReadBytes: async (source) => toBytes(await call("import_read_bytes", { source })),
    importStat: (source) => call("import_stat", { source }),
    exportWriteText: (target, text) => call("export_write_text", { target, text }),
    exportWriteBytes: (target, bytes) => call("export_write_bytes", bytes, { headers: { "x-target": encodeURIComponent(target) } }),
    exportCopyFromWs: (path, target) => call("export_copy_from_ws", { path, target }),
    exportMkdir: (target) => call("export_mkdir", { target }),
  };

  const win = () => getCurrentWindow();

  const platform: Platform = {
    kind: "tauri",
    pickDirectory: (title) => call("pick_directory", { title }),
    pickFiles: (title, filters: FileFilter[], multiple) => call("pick_files", { title, filters, multiple }),
    pickSaveFile: (title, defaultName, filters) => call("pick_save_file", { title, defaultName, filters }),
    pickExportDir: (title) => call("pick_export_dir", { title }),
    openWorkspace: async (r, opts) => {
      const res = await call<{ root: string }>("ws_open", { root: r, create: opts.create, title: opts.title ?? null });
      root = res.root;
      return res;
    },
    closeWorkspace: async () => {
      root = "";
      await call("ws_close");
    },
    recentList: () => call<RecentWorkspace[]>("recent_list"),
    recentRemove: (path) => call("recent_remove", { path }),
    recentRename: (path, title) => call("recent_rename", { path, title }),
    openInSystem: (path) => call("open_in_system", { path }),
    reveal: (path) => call("reveal_in_explorer", { path }),
    revealExport: (target) => call("reveal_export", { target }),
    openUrl: (url) => call("open_url", { url }),
    appInfo: () => call("app_info"),
    dataDir: () => call("data_dir"),
    joinAbs: (dir, name) => (dir.endsWith(sep) ? dir + name : dir + sep + name),
    window: {
      minimize: () => win().minimize(),
      toggleMaximize: () => win().toggleMaximize(),
      close: () => win().close(),
      startDragging: () => win().startDragging(),
      setFullscreen: (v) => win().setFullscreen(v),
      isFullscreen: () => win().isFullscreen(),
    },
  };

  return { platform, fs, ext };
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
