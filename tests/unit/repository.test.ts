import { describe, expect, it } from "vitest";
import { createMemoryBackend, sha256Hex } from "@/adapters/mock/memoryBackend";
import { Repository } from "@/services/library/repository";
import { getUnits, blogTimeline, seriesNavigation } from "@/domain/policies/units";
import { FsError } from "@/services/persistence/ports";
import type { BlogItem, SeriesItem } from "@/domain/models/types";

async function fresh() {
  const be = createMemoryBackend();
  const repo = new Repository(be);
  await repo.createWorkspace("/ws/我的作品库", "我的作品库");
  return { be, repo };
}

describe("workspace → collection → book → chapters (AC-01 vertical slice)", () => {
  it("persists and fully restores after reopening", async () => {
    const { be, repo } = await fresh();
    const col = await repo.createCollection("文学作品");
    const book = await repo.createItem(col.id, "book", "Clocks and Clouds");
    const c1 = await repo.addUnit(book.meta.id, { title: "序章" });
    const c2 = await repo.addUnit(book.meta.id, { title: "第一章" });
    const { hash } = await repo.readUnitText(book.meta.id, c1.id);
    const md = "# 序章\n\n行内公式 $e^{i\\pi}+1=0$\n\n$$\\int_0^1 x^2\\,dx$$\n";
    await repo.saveUnitText(book.meta.id, c1.id, md, hash);
    await repo.reorderUnits(book.meta.id, [c2.id, c1.id]);
    await repo.setMarks({ kind: "unit", itemId: book.meta.id, unitId: c1.id }, { statusId: "proofread", tagIds: ["essay"] });
    await repo.flushWrites();

    const repo2 = new Repository(be);
    await repo2.openWorkspace("/ws/我的作品库");
    const b = repo2.getItem(book.meta.id)!;
    const units = getUnits(b.meta);
    expect(units.map((u) => u.title)).toEqual(["第一章", "序章"]);
    expect(units[1].statusId).toBe("proofread");
    expect(units[1].tagIds).toEqual(["essay"]);
    expect((await repo2.readUnitText(book.meta.id, c1.id)).text).toBe(md);
    // Chapters are real .md files on disk.
    const file = [...be.files.keys()].find((k) => k.endsWith(".md") && k.includes("chapters"));
    expect(file).toBeTruthy();
  });

  it("detects conflicting external edits instead of overwriting", async () => {
    const { repo } = await fresh();
    const col = await repo.createCollection("随笔");
    const doc = await repo.createItem(col.id, "document", "日常杂记");
    const unit = getUnits(doc.meta)[0];
    const { hash, path } = await repo.readUnitText(doc.meta.id, unit.id);
    await repo.fs.writeText(path, "外部编辑器修改");
    await expect(repo.saveUnitText(doc.meta.id, unit.id, "应用内修改", hash)).rejects.toBeInstanceOf(FsError);
    expect(await repo.fs.readText(path)).toBe("外部编辑器修改");
  });

  it("keeps item-level and unit-level marks independent", async () => {
    const { repo } = await fresh();
    const col = await repo.createCollection("摄影作品");
    const book = await repo.createItem(col.id, "book", "书");
    const ch = await repo.addUnit(book.meta.id, {});
    await repo.setMarks({ kind: "item", itemId: book.meta.id }, { statusId: "done" });
    await repo.setMarks({ kind: "unit", itemId: book.meta.id, unitId: ch.id }, { statusId: "draft" });
    expect(repo.marks({ kind: "item", itemId: book.meta.id }).statusId).toBe("done");
    expect(repo.marks({ kind: "unit", itemId: book.meta.id, unitId: ch.id }).statusId).toBe("draft");
  });

  it("mixes all text item types in one collection and trashes/restores", async () => {
    const { repo } = await fresh();
    const col = await repo.createCollection("混合");
    for (const t of ["book", "blog", "article_series", "photo_album", "document"] as const) await repo.createItem(col.id, t, t);
    expect(repo.orderedItems(col.id).map((i) => i.meta.type)).toEqual(["book", "blog", "article_series", "photo_album", "document"]);
    const blog = repo.orderedItems(col.id)[1];
    await repo.trashItem(blog.meta.id);
    expect(repo.getItem(blog.meta.id)).toBeUndefined();
    const trash = await repo.listTrash();
    expect(trash).toHaveLength(1);
    await repo.restoreTrash(trash[0].id);
    expect(repo.getItem(blog.meta.id)?.meta.title).toBe("blog");
  });

  it("deleting a status definition clears references", async () => {
    const { repo } = await fresh();
    const col = await repo.createCollection("x");
    const b = await repo.createItem(col.id, "book", "b");
    await repo.setMarks({ kind: "item", itemId: b.meta.id }, { statusId: "retouch" });
    expect(repo.usage("status", "retouch")).toBe(1);
    await repo.deleteDefinition("status", "retouch");
    expect(repo.getItem(b.meta.id)!.meta.statusId).toBeNull();
  });

  it("refuses path traversal", async () => {
    const { repo } = await fresh();
    await expect(repo.fs.readText("../etc/passwd")).rejects.toBeInstanceOf(FsError);
    await expect(repo.fs.remove("collections")).rejects.toBeInstanceOf(FsError);
  });
});

describe("blog timeline & series navigation (AC-05, AC-06)", () => {
  it("separates drafts from published and sorts by date", async () => {
    const { repo } = await fresh();
    const col = await repo.createCollection("博客");
    const blog = await repo.createItem(col.id, "blog", "音乐札记");
    const p1 = await repo.addUnit(blog.meta.id, { title: "旧文", publishedAt: "2025-03-01" });
    const p2 = await repo.addUnit(blog.meta.id, { title: "新文", publishedAt: "2026-10-01" });
    const d = await repo.addUnit(blog.meta.id, { title: "草稿" });
    const tl = blogTimeline((repo.getItem(blog.meta.id)!.meta as BlogItem).data.posts);
    expect(tl.published.map((p) => p.id)).toEqual([p2.id, p1.id]);
    expect(tl.drafts.map((p) => p.id)).toEqual([d.id]);
    expect(tl.years.map((y) => y.year)).toEqual([2026, 2025]);
  });

  it("series order follows user order, not creation time", async () => {
    const { repo } = await fresh();
    const col = await repo.createCollection("系列");
    const s = await repo.createItem(col.id, "article_series", "现代音乐导论");
    const a = await repo.addUnit(s.meta.id, { title: "一" });
    const b = await repo.addUnit(s.meta.id, { title: "二" });
    const c = await repo.addUnit(s.meta.id, { title: "三" });
    await repo.reorderUnits(s.meta.id, [c.id, a.id, b.id]);
    const item = repo.getItem(s.meta.id)!.meta as SeriesItem;
    const nav = seriesNavigation(item.data.articles, item.data.groups ?? [], a.id);
    expect(nav.index).toBe(1);
    expect(nav.prev?.id).toBe(c.id);
    expect(nav.next?.id).toBe(b.id);
    const g = await repo.addSeriesGroup(s.meta.id, "第一部");
    await repo.placeSeriesArticle(s.meta.id, a.id, g.id, [c.id, b.id, a.id]);
    const item2 = repo.getItem(s.meta.id)!.meta as SeriesItem;
    expect(getUnits(item2).map((u) => u.title)).toEqual(["三", "二", "一"]);
  });
});

describe("hash helper", () => {
  it("sha256 matches known vector", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
