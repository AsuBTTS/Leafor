// Desktop E2E against the real Tauri binary via tauri-driver (WebDriver).
// Usage: node tests/e2e/desktop.mjs <app-binary> <workspace-root> <shot-dir>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const [app, ws, shots] = process.argv.slice(2);
const W = "http://127.0.0.1:4444";
const req = async (method, path, body) => {
  const r = await fetch(W + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (j.value && j.value.error) throw new Error(`${path}: ${j.value.error} ${j.value.message}`);
  return j.value;
};
const ok = (c, m) => console.log(c ? "PASS" : "FAIL", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const s = await req("POST", "/session", { capabilities: { alwaysMatch: { "tauri:options": { application: app } } } });
const sid = s.sessionId;
const S = (p) => `/session/${sid}${p}`;
const exec = (script, args = []) => req("POST", S("/execute/sync"), { script, args });
const find = async (css, timeout = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { const e = await req("POST", S("/element"), { using: "css selector", value: css }); return Object.values(e)[0]; } catch { await sleep(300); }
  }
  throw new Error("not found: " + css);
};
const click = async (css) => req("POST", S(`/element/${await find(css)}/click`), {});
const shot = async (name) => writeFileSync(`${shots}/${name}.png`, Buffer.from(await req("GET", S("/screenshot")), "base64"));
const clickText = (sel, text) => exec(`const el=[...document.querySelectorAll(arguments[0])].find(e=>e.textContent.includes(arguments[1])); if(!el) return false; el.click(); return true;`, [sel, text]);
try {
  await find(".lf-card", 30000);
  await sleep(1500);
  await shot("d01-library");
  const n = await exec("return document.querySelectorAll('.lf-card').length");
  ok(n === 10, `library loaded from disk via Rust commands (${n} cards)`);
  // Editing → real atomic write on disk
  await clickText(".lf-card-title", "日常杂记");
  await find(".cm-content");
  await sleep(800);
  await exec(`const v = document.querySelector('.cm-content').cmView?.view; return true;`);
  await req("POST", S(`/element/${await find(".cm-content")}/click`), {});
  await req("POST", S("/actions"), { actions: [{ type: "key", id: "kb", actions: [..."桌面端写入测试".split("").flatMap((c) => [{ type: "keyDown", value: c }, { type: "keyUp", value: c }])] }] });
  await sleep(2500);
  await shot("d02-edit");
  const docFile = (await exec(`return null`)) ?? null;
  void docFile;
  const { execSync } = await import("node:child_process");
  const found = execSync(`grep -rl "桌面端写入测试" "${ws}/collections" || true`).toString().trim();
  ok(found.endsWith("content.md"), "typed text saved to content.md on disk: " + found.split("/").slice(-3).join("/"));
  const tmpLeft = execSync(`find "${ws}" -name '*.leafor-tmp-*' | wc -l`).toString().trim();
  ok(tmpLeft === "0", "no temp files left after atomic writes");
  // Book publishing (real PDF generation inside WebKitGTK)
  await exec("location.hash = '#/'"); await sleep(600);
  await clickText(".lf-card-title", "Clocks and Clouds"); await find(".lf-modes");
  await clickText(".lf-modes button", "排版"); await sleep(800);
  await clickText(".lf-publish-bar button", "生成成品预览");
  await find(".lf-pdf-page canvas", 90000); await sleep(2500);
  await shot("d03-publish");
  const cache = execSync(`find "${ws}/.leafor/cache/preview" -name '*.pdf' | head -1`).toString().trim();
  ok(cache && readFileSync(cache).subarray(0, 5).toString() === "%PDF-", "generated PDF cached at .leafor/cache/preview");
  // Reader
  await clickText(".lf-modes button", "书籍"); await sleep(1500); await shot("d04-reader");
  // Read-only PDF
  await exec("location.hash = '#/'"); await sleep(600);
  await clickText(".lf-card-title", "Ligeti"); await find(".lf-pdf-page canvas", 30000); await sleep(1500);
  await shot("d05-pdf");
  // Photo album via asset protocol
  await exec("location.hash = '#/'"); await sleep(600);
  await clickText(".lf-card-title", "东欧旅行摄影"); await find(".lf-photo-tile img"); await sleep(1200);
  const loaded = await exec("return [...document.querySelectorAll('.lf-photo-tile img')].filter(i=>i.complete && i.naturalWidth>0).length");
  ok(loaded > 0, `photos served through asset protocol (${loaded} decoded)`);
  await shot("d06-photos");
  // Search uses the SQLite-backed index
  await exec("location.hash = '#/search?q=' + encodeURIComponent('蝴蝶')"); await sleep(1500);
  const hits = await exec("return document.querySelectorAll('.lf-result').length");
  ok(hits >= 1, `full-text search hit in chapter body (${hits})`);
  await shot("d07-search");
  // Traversal attempt through IPC is rejected by Rust
  const rej = await exec(`return window.__TAURI_INTERNALS__.invoke('fs_read_text', { path: '../../etc/passwd' }).then(() => 'READ', (e) => e.kind || String(e));`, []).catch((e) => String(e));
  const rej2 = await req("POST", S("/execute/async"), { script: "const done = arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke('fs_read_text', { path: '../../etc/passwd' }).then(() => done('READ'), (e) => done(e.kind || String(e)));", args: [] });
  ok(rej2 === "invalid_path", "path traversal rejected by Rust scope check: " + rej2);
  const rej3 = await req("POST", S("/execute/async"), { script: "const done = arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke('import_read_bytes', { source: '/etc/hostname' }).then(() => done('READ'), (e) => done(e.kind || String(e)));", args: [] });
  ok(rej3 === "not_granted", "reading an unpicked external file rejected: " + rej3);
  const rej4 = await req("POST", S("/execute/async"), { script: "const done = arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke('fs_remove', { path: 'collections' }).then(() => done('DELETED'), (e) => done(e.kind || String(e)));", args: [] });
  ok(rej4 === "out_of_scope", "permanent delete outside .leafor rejected: " + rej4);
  void rej;
} catch (e) {
  console.log("ERROR", e.message);
  await shot("d99-error").catch(() => {});
} finally {
  await req("DELETE", `/session/${sid}`).catch(() => {});
}
