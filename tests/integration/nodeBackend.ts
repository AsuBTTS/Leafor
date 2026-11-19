/** Real-filesystem backend for integration tests (mirrors the Rust command semantics). */
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Backend, FsEntry } from "@/services/persistence/ports";
import { FsError } from "@/services/persistence/ports";
import { joinRel } from "@/domain/policies/naming";

const sha = (b: Uint8Array | Buffer) => createHash("sha256").update(b).digest("hex");

export function createNodeBackend(): Backend & { root(): string } {
  let root = "";
  const res = (rel: string) => {
    if (!root) throw new FsError("no_workspace", "no workspace");
    if (/^[a-zA-Z]:|^[\\/]/.test(rel) || rel.replace(/\\/g, "/").split("/").includes("..")) throw new FsError("invalid_path", rel);
    return path.join(root, joinRel(rel));
  };
  const wrap = async <T>(f: () => Promise<T>): Promise<T> => {
    try {
      return await f();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new FsError("not_found", String(e));
      throw e;
    }
  };
  const atomic = async (p: string, data: Uint8Array | string) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    const tmp = path.join(path.dirname(p), `.${path.basename(p)}.leafor-tmp-${Date.now()}`);
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, p);
  };
  const entry = async (p: string, name: string): Promise<FsEntry> => {
    const s = await fs.stat(p);
    return { name, isDir: s.isDirectory(), size: s.size, mtimeMs: s.mtimeMs };
  };
  return {
    root: () => root,
    fs: {
      readText: (p) => wrap(() => fs.readFile(res(p), "utf8")),
      readBytes: (p) => wrap(async () => new Uint8Array(await fs.readFile(res(p)))),
      async writeText(p, text, expected) {
        const f = res(p);
        if (expected !== undefined && expected !== null) {
          const disk = await fs.readFile(f).then(sha, () => "");
          if (disk !== expected) throw new FsError("conflict", "conflict", disk);
        }
        await atomic(f, text);
        return { hash: sha(Buffer.from(text)) };
      },
      async writeBytes(p, b) {
        await atomic(res(p), b);
        return { hash: sha(b) };
      },
      async list(p) {
        const d = res(p);
        const names = await fs.readdir(d).catch(() => [] as string[]);
        return Promise.all(names.filter((n) => !n.includes(".leafor-tmp-")).sort().map((n) => entry(path.join(d, n), n)));
      },
      stat: (p) => entry(res(p), path.basename(p)).catch(() => null),
      mkdir: async (p) => void (await fs.mkdir(res(p), { recursive: true })),
      hash: (p) => wrap(async () => sha(await fs.readFile(res(p)))),
      copy: async (a, b) => {
        await fs.mkdir(path.dirname(res(b)), { recursive: true });
        await fs.cp(res(a), res(b), { recursive: true });
      },
      move: async (a, b) => {
        await fs.mkdir(path.dirname(res(b)), { recursive: true });
        await fs.rename(res(a), res(b));
      },
      remove: async (p) => {
        if (!joinRel(p).startsWith(".leafor/")) throw new FsError("out_of_scope", p);
        await fs.rm(res(p), { recursive: true, force: true });
      },
      assetUrl: () => "",
      absPath: async (p) => res(p),
    },
    ext: {
      importCopy: async (s, d) => {
        await fs.mkdir(path.dirname(res(d)), { recursive: true });
        await fs.copyFile(s, res(d));
        const b = await fs.readFile(res(d));
        return { hash: sha(b), size: b.length };
      },
      importReadBytes: async (s) => new Uint8Array(await fs.readFile(s)),
      importStat: (s) => entry(s, path.basename(s)),
      exportWriteText: (t, x) => atomic(t, x),
      exportWriteBytes: (t, b) => atomic(t, b),
      exportCopyFromWs: (p, t) => fs.cp(res(p), t, { recursive: true }),
      exportMkdir: async (t) => void (await fs.mkdir(t, { recursive: true })),
    },
    platform: {
      kind: "memory",
      pickDirectory: async () => null,
      pickFiles: async () => [],
      pickSaveFile: async () => null,
      pickExportDir: async () => null,
      openWorkspace: async (r, o) => {
        if (o.create) await fs.mkdir(r, { recursive: true });
        root = path.resolve(r);
        return { root };
      },
      closeWorkspace: async () => void (root = ""),
      recentList: async () => [],
      recentRemove: async () => {},
      recentRename: async () => {},
      openInSystem: async () => {},
      reveal: async () => {},
      revealExport: async () => {},
      openUrl: async () => {},
      appInfo: async () => ({ version: "test", platform: "node" }),
      dataDir: async () => "",
      joinAbs: (d, n) => path.join(d, n),
      window: { minimize: async () => {}, toggleMaximize: async () => {}, close: async () => {}, startDragging: async () => {}, setFullscreen: async () => {}, isFullscreen: async () => false },
    },
  };
}
