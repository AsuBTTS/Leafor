/**
 * Persistence & platform ports. Services depend only on these interfaces so
 * tests can use the in-memory adapter and the desktop app the Tauri adapter.
 */

export interface FsEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export class FsError extends Error {
  constructor(
    public kind: "no_workspace" | "invalid_path" | "out_of_scope" | "conflict" | "not_granted" | "not_found" | "io" | "unknown",
    message: string,
    public diskHash?: string | null,
  ) {
    super(message);
  }
}

export interface WorkspaceFs {
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  /**
   * Atomic write. `expectedHash`: undefined = no check, "" = must not exist,
   * otherwise the on-disk sha256 must match or FsError("conflict") is thrown.
   */
  writeText(path: string, text: string, expectedHash?: string): Promise<{ hash: string }>;
  writeBytes(path: string, bytes: Uint8Array): Promise<{ hash: string }>;
  list(path: string): Promise<FsEntry[]>;
  stat(path: string): Promise<FsEntry | null>;
  mkdir(path: string): Promise<void>;
  hash(path: string): Promise<string>;
  copy(from: string, to: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  /** Permanent delete — only allowed under `.leafor/`. */
  remove(path: string): Promise<void>;
  /** URL usable in <img>/<video> for a workspace file. */
  assetUrl(path: string, version?: string | number): string;
  absPath(path: string): Promise<string>;
}

export interface ExternalFs {
  /** Copy a user-picked external file into the workspace. */
  importCopy(source: string, dest: string): Promise<{ hash: string; size: number }>;
  importReadBytes(source: string): Promise<Uint8Array>;
  importStat(source: string): Promise<FsEntry>;
  exportWriteText(target: string, text: string): Promise<void>;
  exportWriteBytes(target: string, bytes: Uint8Array): Promise<void>;
  exportCopyFromWs(path: string, target: string): Promise<void>;
  exportMkdir(target: string): Promise<void>;
}

export interface RecentWorkspace {
  path: string;
  title: string;
  openedAt: string;
}

export interface Platform {
  readonly kind: "tauri" | "memory";
  pickDirectory(title: string): Promise<string | null>;
  pickFiles(title: string, filters: FileFilter[], multiple: boolean): Promise<string[]>;
  pickSaveFile(title: string, defaultName: string, filters: FileFilter[]): Promise<string | null>;
  pickExportDir(title: string): Promise<string | null>;
  openWorkspace(root: string, opts: { create: boolean; title?: string }): Promise<{ root: string }>;
  closeWorkspace(): Promise<void>;
  recentList(): Promise<RecentWorkspace[]>;
  recentRemove(path: string): Promise<void>;
  recentRename(path: string, title: string): Promise<void>;
  openInSystem(path: string): Promise<void>;
  reveal(path: string): Promise<void>;
  revealExport(target: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  appInfo(): Promise<{ version: string; platform: string }>;
  dataDir(): Promise<string>;
  /** Join an absolute OS path with a child name. */
  joinAbs(dir: string, name: string): string;
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    startDragging(): Promise<void>;
    setFullscreen(v: boolean): Promise<void>;
    isFullscreen(): Promise<boolean>;
  };
}

export interface Backend {
  platform: Platform;
  fs: WorkspaceFs;
  ext: ExternalFs;
}
