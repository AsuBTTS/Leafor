// Browser smoke test against the built app (memory/demo backend).
// Usage: node tests/e2e/smoke.mjs <url> <outdir>
import { chromium } from "playwright-core";
const url = process.argv[2] ?? "http://localhost:4173/";
const out = process.argv[3] ?? "/tmp/shots";
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const shot = async (name) => page.screenshot({ path: `${out}/${name}.png` });
const step = async (name, fn) => {
  try { await fn(); await page.waitForTimeout(700); await shot(name); console.log("OK", name); }
  catch (e) { console.log("FAIL", name, e.message); await shot(name + "-fail").catch(() => {}); }
};
await page.goto(url);
await page.waitForSelector(".lf-card", { timeout: 20000 });
await step("01-library", async () => {});
await step("02-book-split", async () => { await page.click('text=Clocks and Clouds >> nth=0'); await page.waitForSelector(".cm-content"); });
await step("03-book-read", async () => { await page.click('.lf-modes button:has-text("书籍")'); await page.waitForSelector(".lf-reader-flow"); });
await step("04-book-publish", async () => { await page.click('.lf-modes button:has-text("排版")'); await page.click('text=生成成品预览'); await page.waitForSelector(".lf-pdf-page canvas", { timeout: 60000 }); await page.waitForTimeout(1500); });
await step("05-blog", async () => { await page.goto(url + "#/"); await page.click("text=音乐札记 >> nth=0"); await page.waitForSelector(".lf-blog-index"); });
await step("06-blog-post", async () => { await page.click(".lf-blog-card >> nth=0"); await page.waitForSelector(".lf-md"); });
await step("07-series", async () => { await page.goto(url + "#/"); await page.click("text=现代音乐导论 >> nth=0"); await page.waitForSelector(".lf-series-index"); await page.click("text=从第一篇开始阅读"); await page.waitForSelector(".lf-pager"); });
await step("08-photos", async () => { await page.goto(url + "#/"); await page.click("text=东欧旅行摄影 >> nth=0"); await page.waitForSelector(".lf-photo-tile"); });
await step("09-lightbox", async () => { await page.click(".lf-photo-tile >> nth=1"); await page.waitForSelector(".lf-lightbox"); });
await step("10-pdf", async () => { await page.keyboard.press("Escape"); await page.goto(url + "#/"); await page.click("text=Ligeti: Clocks and Clouds >> nth=0"); await page.waitForSelector(".lf-pdf-page canvas", { timeout: 30000 }); await page.waitForTimeout(1200); });
await step("11-search", async () => { await page.goto(url + "#/search?status=retouch"); await page.waitForSelector(".lf-result"); });
await step("12-marks", async () => { await page.goto(url + "#/marks"); await page.waitForSelector(".lf-marks-page"); });
await step("13-collections", async () => { await page.goto(url + "#/collections"); await page.waitForSelector(".lf-collection-card"); });
await step("14-settings", async () => { await page.goto(url + "#/settings"); await page.waitForSelector(".lf-settings"); });
await step("15-doc", async () => { await page.goto(url + "#/"); await page.click("text=日常杂记 >> nth=0"); await page.waitForSelector(".cm-content"); });
await step("16-list", async () => { await page.goto(url + "#/"); await page.click('[aria-label="列表视图"]'); await page.waitForSelector(".lf-table"); });
console.log("ERRORS:\n" + errors.slice(0, 30).join("\n"));
await browser.close();
