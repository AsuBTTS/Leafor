/**
 * In-memory backend used by tests and the browser preview ("demo mode").
 * Mirrors the Rust command semantics: workspace-relative paths, traversal
 * rejection, atomic guarded writes, permanent delete only under .leafor/.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Backend, FileFilter, FsEntry, Platform, RecentWorkspace, WorkspaceFs, ExternalFs } from "@/services/persistence/ports";
import { FsError } from "@/services/persistence/ports";
import { baseName, joinRel } from "@/domain/policies/naming";

export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

const enc = new TextEncoder();
const dec = new TextDecoder();

interface Node {
  bytes: Uint8Array;
  mtime: number;
}

export interface MemoryBackend extends Backend {
  /** Raw file store keyed by "<root>/<rel>". */
  files: Map<string, Node>;
  dirs: Set<string>;
  external: Map<string, Uint8Array>;
  exported: Map<string, Uint8Array>;
  /** Queue paths that the next pickFiles/pickDirectory/pickSave calls return. */
  queuePick(...results: Array<string[] | string | null>): void;
  addExternal(path: string, bytes: Uint8Array | string): void;
}

function clean(rel: string): string {
  if (/^[a-zA-Z]:/.test(rel) || rel.startsWith("/") || rel.startsWith("\\")) throw new FsError("invalid_path", `路径不合法：${rel}`);
  if (rel.replace(/\\/g, "/").split("/").includes("..")) throw new FsError("invalid_path", `路径不合法：${rel}`);
  return joinRel(rel);
}

export function createMemoryBackend(opts: { browserPickers?: boolean } = {}): MemoryBackend {
  const files = new Map<string, Node>();
  const dirs = new Set<string>();
  const external = new Map<string, Uint8Array>();
  const exported = new Map<string, Uint8Array>();
  const recents: RecentWorkspace[] = [];
  const pickQueue: Array<string[] | string | null> = [];
  const blobUrls = new Map<string, string>();
  let root = "";

  const key = (rel: string) => {
    if (!root) throw new FsError("no_workspace", "没有打开的工作区");
    const c = clean(rel);
    return c ? `${root}/${c}` : root;
  };
  const ensureParents = (k: string) => {
    let p = k;
    while (p.includes("/")) {
      p = p.slice(0, p.lastIndexOf("/"));
      if (!p || dirs.has(p)) break;
      dirs.add(p);
    }
  };
  const write = (k: string, bytes: Uint8Array) => {
    ensureParents(k);
    files.set(k, { bytes: new Uint8Array(bytes), mtime: Date.now() });
    const old = [...blobUrls.keys()].filter((x) => x.startsWith(k + "?") || x === k);
    old.forEach((x) => blobUrls.delete(x));
  };
  const read = (k: string) => {
    const n = files.get(k);
    if (!n) throw new FsError("not_found", `文件不存在：${k.slice(root.length + 1)}`);
    return n;
  };

  const fs: WorkspaceFs = {
    async readText(path) {
      return dec.decode(read(key(path)).bytes);
    },
    async readBytes(path) {
      return new Uint8Array(read(key(path)).bytes);
    },
    async writeText(path, text, expectedHash) {
      const k = key(path);
      if (expectedHash !== undefined && expectedHash !== null) {
        const disk = files.has(k) ? sha256Hex(files.get(k)!.bytes) : "";
        if (disk !== expectedHash) throw new FsError("conflict", "文件已在磁盘上被修改（冲突）", disk);
      }
      const bytes = enc.encode(text);
      write(k, bytes);
      return { hash: sha256Hex(bytes) };
    },
    async writeBytes(path, bytes) {
      write(key(path), bytes);
      return { hash: sha256Hex(bytes) };
    },
    async list(path) {
      const k = key(path);
      const prefix = k + "/";
      const out = new Map<string, FsEntry>();
      for (const [f, n] of files) {
        if (!f.startsWith(prefix)) continue;
        const rest = f.slice(prefix.length);
        const name = rest.split("/")[0];
        const isDir = rest.includes("/");
        if (!out.has(name)) out.set(name, { name, isDir, size: isDir ? 0 : n.bytes.length, mtimeMs: n.mtime });
      }
      for (const d of dirs) {
        if (!d.startsWith(prefix)) continue;
        const name = d.slice(prefix.length).split("/")[0];
        if (!out.has(name)) out.set(name, { name, isDir: true, size: 0, mtimeMs: 0 });
      }
      return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    async stat(path) {
      const k = key(path);
      const n = files.get(k);
      if (n) return { name: baseName(k), isDir: false, size: n.bytes.length, mtimeMs: n.mtime };
      if (dirs.has(k) || [...files.keys()].some((f) => f.startsWith(k + "/"))) return { name: baseName(k), isDir: true, size: 0, mtimeMs: 0 };
      return null;
    },
    async mkdir(path) {
      const k = key(path);
      ensureParents(k + "/x");
    },
    async hash(path) {
      return sha256Hex(read(key(path)).bytes);
    },
    async copy(from, to) {
      const a = key(from);
      const b = key(to);
      if (files.has(a)) return write(b, files.get(a)!.bytes);
      for (const [f, n] of [...files]) if (f.startsWith(a + "/")) write(b + f.slice(a.length), n.bytes);
    },
    async move(from, to) {
      const a = key(from);
      const b = key(to);
      if (files.has(b) || dirs.has(b)) throw new FsError("invalid_path", `目标已存在：${to}`);
      if (files.has(a)) {
        write(b, files.get(a)!.bytes);
        files.delete(a);
        return;
      }
      let moved = false;
      for (const [f, n] of [...files]) {
        if (f.startsWith(a + "/")) {
          write(b + f.slice(a.length), n.bytes);
          files.delete(f);
          moved = true;
        }
      }
      for (const d of [...dirs]) {
        if (d === a || d.startsWith(a + "/")) {
          dirs.delete(d);
          dirs.add(b + d.slice(a.length));
          moved = true;
        }
      }
      if (!moved) throw new FsError("not_found", `文件不存在：${from}`);
    },
    async remove(path) {
      const c = clean(path);
      if (!c.startsWith(".leafor/") ) throw new FsError("out_of_scope", `只允许删除 .leafor 内部文件：${path}`);
      const k = key(path);
      files.delete(k);
      for (const f of [...files.keys()]) if (f.startsWith(k + "/")) files.delete(f);
      for (const d of [...dirs]) if (d === k || d.startsWith(k + "/")) dirs.delete(d);
    },
    assetUrl(path, version) {
      let k: string;
      try {
        k = key(path);
      } catch {
        return "";
      }
      const n = files.get(k);
      if (!n || typeof URL === "undefined" || !("createObjectURL" in URL)) return "";
      const cacheKey = `${k}?${version ?? ""}@${n.mtime}`;
      if (!blobUrls.has(cacheKey)) {
        const ext = k.split(".").pop()?.toLowerCase();
        const type = ext === "svg" ? "image/svg+xml" : ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
        blobUrls.set(cacheKey, URL.createObjectURL(new Blob([n.bytes as BlobPart], { type })));
      }
      return blobUrls.get(cacheKey)!;
    },
    async absPath(path) {
      return key(path);
    },
  };

  const grantedOrThrow = (source: string) => {
    const b = external.get(source);
    if (!b) throw new FsError("not_granted", `未授权的外部路径：${source}`);
    return b;
  };

  const download = (target: string, bytes: Uint8Array) => {
    exported.set(target, new Uint8Array(bytes));
    if (opts.browserPickers && typeof document !== "undefined") {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([bytes as BlobPart]));
      a.download = baseName(target);
      a.click();
    }
  };

  const ext: ExternalFs = {
    async importCopy(source, dest) {
      const b = grantedOrThrow(source);
      const k = key(dest);
      if (files.has(k)) throw new FsError("invalid_path", `目标已存在：${dest}`);
      write(k, b);
      return { hash: sha256Hex(b), size: b.length };
    },
    async importReadBytes(source) {
      return new Uint8Array(grantedOrThrow(source));
    },
    async importStat(source) {
      const b = grantedOrThrow(source);
      return { name: baseName(source), isDir: false, size: b.length, mtimeMs: Date.now() };
    },
    async exportWriteText(target, text) {
      download(target, enc.encode(text));
    },
    async exportWriteBytes(target, bytes) {
      download(target, bytes);
    },
    async exportCopyFromWs(path, target) {
      const k = key(path);
      if (files.has(k)) return download(target, files.get(k)!.bytes);
      for (const [f, n] of files) if (f.startsWith(k + "/")) exported.set(target + f.slice(k.length), n.bytes);
    },
    async exportMkdir() {},
  };

  const nextPick = () => (pickQueue.length ? pickQueue.shift()! : undefined);

  const browserPick = (filters: FileFilter[], multiple: boolean): Promise<string[]> =>
    new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = multiple;
      input.accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(",");
      input.onchange = async () => {
        const out: string[] = [];
        for (const file of Array.from(input.files ?? [])) {
          const p = `/external/${Date.now()}-${file.name}`;
          external.set(p, new Uint8Array(await file.arrayBuffer()));
          out.push(p);
        }
        resolve(out);
      };
      input.click();
    });

  const platform: Platform = {
    kind: "memory",
    async pickDirectory() {
      const r = nextPick();
      if (r !== undefined) return Array.isArray(r) ? r[0] ?? null : r;
      return opts.browserPickers ? "/demo/新的作品库" : null;
    },
    async pickFiles(_t, filters, multiple) {
      const r = nextPick();
      if (r !== undefined) return r === null ? [] : Array.isArray(r) ? r : [r];
      return opts.browserPickers ? browserPick(filters, multiple) : [];
    },
    async pickSaveFile(_t, defaultName) {
      const r = nextPick();
      if (r !== undefined) return Array.isArray(r) ? r[0] ?? null : r;
      return opts.browserPickers ? `/downloads/${defaultName}` : null;
    },
    async pickExportDir() {
      const r = nextPick();
      if (r !== undefined) return Array.isArray(r) ? r[0] ?? null : r;
      return opts.browserPickers ? `/downloads` : null;
    },
    async openWorkspace(r, o) {
      root = r.replace(/[\\/]+$/, "");
      dirs.add(root);
      const i = recents.findIndex((x) => x.path === root);
      const title = o.title ?? (i >= 0 ? recents[i].title : baseName(root));
      if (i >= 0) recents.splice(i, 1);
      recents.unshift({ path: root, title, openedAt: String(Date.now()) });
      return { root };
    },
    async closeWorkspace() {
      root = "";
    },
    async recentList() {
      return [...recents];
    },
    async recentRemove(path) {
      const i = recents.findIndex((x) => x.path === path);
      if (i >= 0) recents.splice(i, 1);
    },
    async recentRename(path, title) {
      const r = recents.find((x) => x.path === path);
      if (r) r.title = title;
    },
    async openInSystem() {},
    async reveal() {},
    async revealExport() {},
    async openUrl(url) {
      if (opts.browserPickers) window.open(url, "_blank", "noopener");
    },
    async appInfo() {
      return { version: "0.1.0", platform: "browser" };
    },
    async dataDir() {
      return "(memory)";
    },
    joinAbs: (dir, name) => `${dir.replace(/\/$/, "")}/${name}`,
    window: {
      async minimize() {},
      async toggleMaximize() {},
      async close() {},
      async startDragging() {},
      async setFullscreen(v) {
        if (typeof document === "undefined") return;
        if (v) await document.documentElement.requestFullscreen?.().catch(() => {});
        else if (document.fullscreenElement) await document.exitFullscreen?.().catch(() => {});
      },
      async isFullscreen() {
        return typeof document !== "undefined" && !!document.fullscreenElement;
      },
    },
  };

  return {
    platform,
    fs,
    ext,
    files,
    dirs,
    external,
    exported,
    queuePick: (...r) => pickQueue.push(...r),
    addExternal: (path, bytes) => external.set(path, typeof bytes === "string" ? enc.encode(bytes) : bytes),
  };
}
