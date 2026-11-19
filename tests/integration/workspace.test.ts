// Integration: real temporary workspace on disk (technical design §16.1-3).
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createNodeBackend } from "./nodeBackend";
import { Repository } from "@/services/library/repository";
import { seedDemoWorkspace } from "@/services/library/demoSeed";
import { importMarkdownAsDocuments, importPdfs, splitByHeading } from "@/services/import-export/importService";
import { getUnits } from "@/domain/policies/units";

describe("workspace on a real filesystem", () => {
  it("seeds, reopens from disk alone and keeps PDF bytes intact", async () => {
    const dir = process.env.LEAFOR_SEED_DIR ?? mkdtempSync(path.join(tmpdir(), "leafor-"));
    const root = path.join(dir, "示例作品库");
    const repo = new Repository(createNodeBackend());
    await seedDemoWorkspace(repo, root);
    await repo.flushWrites();
    expect(existsSync(path.join(root, ".leafor", "workspace.json"))).toBe(true);
    const cols = readdirSync(path.join(root, "collections"));
    expect(cols.length).toBe(6);

    // Reopen with a fresh repository: everything comes back from files.
    const repo2 = new Repository(createNodeBackend());
    await repo2.openWorkspace(root);
    expect(repo2.items.size).toBe(repo.items.size);
    expect(repo2.loadIssues).toEqual([]);
    const book = [...repo2.items.values()].find((i) => i.meta.title === "Clocks and Clouds")!;
    const ch = getUnits(book.meta)[0];
    const md = readFileSync(path.join(root, book.dir, ch.path), "utf8");
    expect(md).toContain("$$");

    const pdf = [...repo2.items.values()].find((i) => i.meta.type === "pdf")!;
    const before = await repo2.fs.hash(`${pdf.dir}/originals/original.pdf`);
    await repo2.setMarks({ kind: "item", itemId: pdf.meta.id }, { tagIds: ["reference"], statusId: "done" });
    await repo2.updateItem(pdf.meta.id, { notes: "笔记" });
    await repo2.flushWrites();
    expect(await repo2.fs.hash(`${pdf.dir}/originals/original.pdf`)).toBe(before);

    // A corrupt item.json is reported and skipped, never deleted.
    const victim = [...repo2.items.values()].find((i) => i.meta.title === "日常杂记")!;
    const victimFile = path.join(root, victim.dir, "item.json");
    const good = readFileSync(victimFile, "utf8");
    writeFileSync(victimFile, "{ not json");
    const repo3 = new Repository(createNodeBackend());
    await repo3.openWorkspace(root);
    expect(repo3.loadIssues.length).toBe(1);
    expect(existsSync(victimFile)).toBe(true);
    writeFileSync(victimFile, good);
  });

  it("imports Markdown with relative images and PDFs by copy", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "leafor-imp-"));
    const ext = path.join(dir, "外部 文件");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(path.join(ext, "img"), { recursive: true });
    writeFileSync(path.join(ext, "img", "a b.png"), Buffer.from([137, 80, 78, 71]));
    writeFileSync(path.join(ext, "笔记.md"), "# 我的笔记\n\n![图](img/a%20b.png)\n\n![缺](missing.png)\n");
    const { PDFDocument } = await import("pdf-lib");
    const d = await PDFDocument.create();
    d.addPage();
    writeFileSync(path.join(ext, "doc.pdf"), await d.save());
    const pdfBytes = readFileSync(path.join(ext, "doc.pdf"));

    const repo = new Repository(createNodeBackend());
    await repo.createWorkspace(path.join(dir, "ws"), "ws");
    const c = await repo.createCollection("导入");
    const r = await importMarkdownAsDocuments(repo, c.id, [path.join(ext, "笔记.md")]);
    expect(r.warnings.length).toBe(1);
    const doc = repo.getItem(r.created[0])!;
    const text = readFileSync(path.join(repo.root, doc.dir, "content.md"), "utf8");
    expect(text).toContain("](assets/a-b.png)");
    expect(text).toContain("](missing.png)");
    expect(existsSync(path.join(repo.root, doc.dir, "assets", "a-b.png"))).toBe(true);

    const p = await importPdfs(repo, c.id, [path.join(ext, "doc.pdf")]);
    const item = repo.getItem(p.created[0])!;
    expect(readFileSync(path.join(repo.root, item.dir, "originals", "original.pdf")).equals(pdfBytes)).toBe(true);
    expect(readFileSync(path.join(ext, "doc.pdf")).equals(pdfBytes)).toBe(true);
  });

  it("splits converted DOCX markdown by headings", () => {
    const parts = splitByHeading("intro\n\n# 一\n\na\n\n## 小节\n\nb\n\n# 二\n\nc\n```\n# not a heading\n```\n", 1);
    expect(parts.map((p) => p.title)).toEqual(["前言", "一", "二"]);
    expect(splitByHeading("# 一\n## 小节\n# 二\n", 2).map((p) => p.title)).toEqual(["一", "小节", "二"]);
  });
});
