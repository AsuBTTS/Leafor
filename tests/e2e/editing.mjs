// E2E: edit → autosave → disk; create collection/book/chapter; trash/restore; marks; import md.
import { chromium } from "playwright-core";
const url = process.argv[2] ?? "http://localhost:4173/";
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const ok = (c, m) => console.log(c ? "PASS" : "FAIL", m);
await p.goto(url); await p.waitForSelector(".lf-card");
// 1. edit a document and confirm autosave writes the .md
await p.click("text=日常杂记 >> nth=0"); await p.waitForSelector(".cm-content");
await p.click(".cm-content"); await p.keyboard.press("Control+End");
await p.keyboard.type("\n自动保存测试：$E=mc^2$ 中文输入");
await p.waitForTimeout(2200);
const disk = await p.evaluate(async () => { const { repo } = window.__leafor; const it = [...repo.items.values()].find((i) => i.meta.title === "日常杂记"); return (await repo.readUnitText(it.meta.id, it.meta.data.content.id)).text; });
ok(disk.includes("自动保存测试：$E=mc^2$ 中文输入"), "autosave wrote markdown to disk");
ok(await p.isVisible("text=已保存"), "save indicator shows 已保存");
// 2. switching modes must not rewrite the source
const before = disk;
await p.click('.lf-modes button:has-text("预览")'); await p.waitForTimeout(400);
await p.click('.lf-modes button:has-text("编辑")'); await p.waitForTimeout(400);
await p.click('.lf-modes button:has-text("分屏")'); await p.waitForTimeout(1200);
const after = await p.evaluate(async () => { const { repo } = window.__leafor; const it = [...repo.items.values()].find((i) => i.meta.title === "日常杂记"); return (await repo.readUnitText(it.meta.id, it.meta.data.content.id)).text; });
ok(before === after, "view switching leaves source byte-identical");
// 3. external modification → conflict dialog when dirty
await p.evaluate(async () => { const { repo } = window.__leafor; const it = [...repo.items.values()].find((i) => i.meta.title === "日常杂记"); await repo.fs.writeText(it.dir + "/content.md", "外部修改的版本\n"); });
await p.click(".cm-content"); await p.keyboard.type("本地修改");
await p.waitForTimeout(2000);
ok(await p.isVisible("text=文件冲突"), "conflict dialog shown instead of silent overwrite");
await p.click("text=将我的版本另存为副本，载入磁盘版本"); await p.waitForTimeout(600);
const files = await p.evaluate(() => [...window.__leafor.backend.files.keys()].filter((k) => k.includes("conflict")).length);
ok(files === 1, "conflict copy saved beside the file");
// 4. create collection + book + chapter via UI
await p.goto(url + "#/");
await p.click('button:has-text("新建")'); await p.click('.lf-menu-item:has-text("图书")');
await p.click('.lf-choice:has-text("文学")');
await p.fill(".lf-modal input", "测试之书"); await p.click('.lf-modal button:has-text("创建")');
await p.waitForSelector(".cm-content"); await p.waitForTimeout(500);
ok(await p.isVisible("text=第一章"), "new book opens with first chapter");
await p.click('[aria-label="新建章节"]'); await p.waitForTimeout(600);
const chapters = await p.locator(".lf-tree-row").count();
ok(chapters === 2, "added a second chapter (" + chapters + ")");
// 5. drag reorder chapters
const rows = p.locator(".lf-tree-row");
await rows.nth(1).dragTo(rows.nth(0), { targetPosition: { x: 20, y: 3 } }); await p.waitForTimeout(600);
const order = await p.locator(".lf-tree-label").allTextContents();
ok(order[0] === "第二章", "drag reorder chapters → " + order.join(","));
// 6. marks on a unit via context menu
await rows.nth(0).click({ button: "right" }); await p.click('.lf-menu-item:has-text("状态与标签")');
await p.click('.lf-popover .lf-chip:has-text("待校对")'); await p.waitForTimeout(300);
const st = await p.evaluate(() => { const { repo } = window.__leafor; const it = [...repo.items.values()].find((i) => i.meta.title === "测试之书"); return it.meta.data.chapters.map((c) => c.statusId); });
ok(st.includes("proofread"), "unit status set via popover");
await p.keyboard.press("Escape");
// 7. trash + restore item
await p.goto(url + "#/");
await p.click('.lf-card:has-text("测试之书") .lf-card-more'); await p.click('.lf-menu-item:has-text("移到回收站")'); await p.click('.lf-modal button:has-text("移到回收站")');
await p.waitForTimeout(500);
ok(!(await p.isVisible('.lf-card:has-text("测试之书")')), "item moved to trash");
await p.goto(url + "#/archive"); await p.click('button:has-text("恢复")'); await p.waitForTimeout(800);
await p.goto(url + "#/"); await p.waitForTimeout(300);
ok(await p.isVisible('.lf-card:has-text("测试之书")'), "item restored from trash");
// 8. PDF metadata change keeps bytes identical
const pdf = await p.evaluate(async () => { const { repo } = window.__leafor; const it = [...repo.items.values()].find((i) => i.meta.type === "pdf"); const h1 = await repo.fs.hash(it.dir + "/originals/original.pdf"); await repo.setMarks({ kind: "item", itemId: it.meta.id }, { tagIds: ["reference", "essay"], statusId: "done" }); await repo.updateItem(it.meta.id, { notes: "备注测试" }); const h2 = await repo.fs.hash(it.dir + "/originals/original.pdf"); return { h1, h2, sha: it.meta.data.sha256AtImport }; });
ok(pdf.h1 === pdf.h2 && pdf.h1 === pdf.sha, "PDF bytes unchanged after tags/notes (SHA-256)");
// 9. blog: set publish date for draft → moves to timeline
await p.goto(url + "#/"); await p.click("text=音乐札记 >> nth=0"); await p.waitForSelector(".lf-blog-index");
await p.click('.lf-blog-card:has-text("留白")'); await p.waitForSelector(".lf-postmeta");
await p.click('.lf-postmeta button:has-text("今天发布")'); await p.waitForTimeout(400);
const drafts = await p.evaluate(() => { const { repo } = window.__leafor; const it = [...repo.items.values()].find((i) => i.meta.title === "音乐札记"); return it.meta.data.posts.filter((x) => !x.publishedAt).length; });
ok(drafts === 0, "draft published via date");
// 10. export HTML (memory backend records exported files)
await p.goto(url + "#/"); await p.click("text=Clocks and Clouds >> nth=0"); await p.waitForSelector(".lf-modes");
await p.click('[title="导出"]'); await p.click('.lf-menu-item:has-text("导出 HTML")'); await p.waitForTimeout(2500);
const exp = await p.evaluate(() => [...window.__leafor.backend.exported.keys()]);
ok(exp.some((k) => k.endsWith("index.html")) && exp.some((k) => k.includes("katex")), "HTML export with katex assets (" + exp.length + " files)");
await p.click('[title="导出"]'); await p.click('.lf-menu-item:has-text("导出 Word")'); await p.waitForTimeout(2500);
const exp2 = await p.evaluate(() => [...window.__leafor.backend.exported.keys()].filter((k) => k.endsWith(".docx")));
ok(exp2.length === 1, "DOCX export");
console.log("page errors:", errs);
await b.close();
