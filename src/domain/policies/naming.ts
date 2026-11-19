/** File & id naming rules. IDs never depend on titles; folder names carry a readable slug + stable id. */

export function newId(prefix: "c" | "i" | "u" | "t" | "s" | "g" | "p" | "l" | "x"): string {
  const raw =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(16).slice(2) + Date.now().toString(16);
  return `${prefix}_${raw.slice(0, 12)}`;
}

const RESERVED = /[<>:"/\\|?*\u0000-\u001f]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** Filesystem-safe slug that keeps CJK characters. */
export function slugify(title: string, max = 40): string {
  let s = title
    .normalize("NFC")
    .replace(RESERVED, " ")
    .replace(/[\s.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  if (!s || WINDOWS_RESERVED.test(s)) s = "untitled";
  return [...s].slice(0, max).join("").replace(/-$/, "");
}

/** Return a file name (with extension) not present in `existing` (case-insensitive). */
export function uniqueFileName(base: string, ext: string, existing: Iterable<string>): string {
  const taken = new Set([...existing].map((x) => x.toLowerCase()));
  const clean = slugify(base) || "untitled";
  const e = ext.startsWith(".") ? ext : `.${ext}`;
  let name = `${clean}${e}`;
  let n = 2;
  while (taken.has(name.toLowerCase())) name = `${clean}-${n++}${e}`;
  return name;
}

export function extOf(name: string): string {
  const m = /\.([^./\\]+)$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

export function baseName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export function stem(name: string): string {
  const b = baseName(name);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(0, i) : b;
}

export function dirName(path: string): string {
  const p = path.replace(/\\/g, "/");
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(0, i) : "";
}

/** Join workspace-relative segments, normalising "." and rejecting "..". */
export function joinRel(...parts: string[]): string {
  const out: string[] = [];
  for (const part of parts) {
    for (const seg of part.replace(/\\/g, "/").split("/")) {
      if (!seg || seg === ".") continue;
      if (seg === "..") {
        if (!out.length) throw new Error(`路径越界：${parts.join("/")}`);
        out.pop();
        continue;
      }
      out.push(seg);
    }
  }
  return out.join("/");
}

/**
 * Resolve a Markdown-relative reference (e.g. image src) against the Markdown
 * file location, constrained to `scopeDir` (the Item folder). Returns null for
 * external/absolute or out-of-scope references.
 */
export function resolveRef(mdPath: string, ref: string, scopeDir: string): string | null {
  if (!ref || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("//") || ref.startsWith("/") || ref.startsWith("#")) return null;
  let decoded = ref.split("#")[0].split("?")[0];
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    /* keep raw */
  }
  try {
    const full = joinRel(dirName(mdPath), decoded);
    const scope = scopeDir.replace(/\/$/, "");
    if (scope && full !== scope && !full.startsWith(scope + "/")) return null;
    return full;
  } catch {
    return null;
  }
}

export const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif", "svg", "tif", "tiff", "heic"];
export const DISPLAYABLE_IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif", "svg"];
export const MARKDOWN_EXTS = ["md", "markdown", "mdown", "txt"];

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayDate(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
