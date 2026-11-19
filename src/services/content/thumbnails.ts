/**
 * Thumbnail cache (.leafor/cache/thumbs). Thumbnails are derived data and can
 * be deleted at any time; originals are never modified.
 */
import { useSyncExternalStore } from "react";
import { repo } from "@/app/backend";
import { extOf, joinRel } from "@/domain/policies/naming";
import { CACHE_DIR } from "@/services/library/repository";

const ready = new Map<string, string>(); // key -> cache rel path
const pending = new Set<string>();
const failed = new Set<string>();
const queue: Array<() => Promise<void>> = [];
let running = 0;
let version = 0;
const listeners = new Set<() => void>();

function notify() {
  version++;
  listeners.forEach((l) => l());
}

export function useThumbVersion() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
}

function fnv(s: string): string {
  let h1 = 0x811c9dc5,
    h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

function pump() {
  while (running < 2 && queue.length) {
    const job = queue.shift()!;
    running++;
    job().finally(() => {
      running--;
      pump();
    });
  }
}

async function makeThumb(rel: string, cachePath: string, size: number): Promise<void> {
  const bytes = await repo.fs.readBytes(rel);
  const blob = new Blob([bytes as BlobPart]);
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, size / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.84));
  if (!out) throw new Error("thumbnail encode failed");
  await repo.fs.writeBytes(cachePath, new Uint8Array(await out.arrayBuffer()));
}

/**
 * Return the best URL available now for an image at `rel`; schedules thumbnail
 * generation in the background and re-renders subscribers when done.
 */
export function thumbnailUrl(rel: string, ver: string, size: number): string {
  if (!repo.isOpen) return "";
  const ext = extOf(rel);
  if (ext === "svg" || ext === "gif" || repo.backend.platform.kind === "memory") return repo.fs.assetUrl(rel, ver);
  const key = `${rel}|${ver}|${size}`;
  const done = ready.get(key);
  if (done) return repo.fs.assetUrl(done);
  if (!pending.has(key) && !failed.has(key) && typeof createImageBitmap === "function") {
    pending.add(key);
    const cachePath = joinRel(CACHE_DIR, "thumbs", `${fnv(key)}-${size}.jpg`);
    queue.push(async () => {
      try {
        const st = await repo.fs.stat(cachePath);
        if (!st) await makeThumb(rel, cachePath, size);
        ready.set(key, cachePath);
        notify();
      } catch {
        failed.add(key);
      } finally {
        pending.delete(key);
      }
    });
    pump();
  }
  return repo.fs.assetUrl(rel, ver);
}

export function clearThumbMemory() {
  ready.clear();
  failed.clear();
  notify();
}
