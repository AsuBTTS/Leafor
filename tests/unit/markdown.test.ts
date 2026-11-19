import { describe, expect, it } from "vitest";
import { markdownToHtml, outlineFromHast, markdownToHast, wordCount, imageRefs } from "@/components/markdown/pipeline";
import { resolveRef } from "@/domain/policies/naming";

describe("markdown pipeline", () => {
  it("renders GFM tables, task lists, math and sanitises scripts", () => {
    const html = markdownToHtml("| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n$a^2$\n\n$$\\frac{1}{2}$$\n\n<script>alert(1)</script><b onclick=\"x()\">粗</b>");
    expect(html).toContain("<table>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("katex");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
    expect(html).toContain("<b>粗</b>");
  });
  it("blocks remote images by default and resolves relative ones", () => {
    const html = markdownToHtml("![x](https://example.com/a.png) ![y](../assets/p.png)", { resolveImage: (s) => `asset://${s}` });
    expect(html).toContain("远程图片未自动加载");
    expect(html).toContain('src="asset://../assets/p.png"');
  });
  it("builds an outline with ids", () => {
    const o = outlineFromHast(markdownToHast("# 标题一\n\n## Second\n"));
    expect(o.map((x) => [x.depth, x.text])).toEqual([[1, "标题一"], [2, "Second"]]);
    expect(o[0].id).toBeTruthy();
  });
  it("counts CJK + latin words", () => {
    expect(wordCount("你好 world 世界")).toBe(5);
  });
  it("finds image refs", () => {
    expect(imageRefs("![a](img/a.png) <img src='b.jpg'> ![r](http://x/y.png)")).toEqual(["img/a.png", "b.jpg"]);
  });
  it("scopes relative refs to the item folder", () => {
    expect(resolveRef("items/b/chapters/01.md", "../assets/a.png", "items/b")).toBe("items/b/assets/a.png");
    expect(resolveRef("items/b/chapters/01.md", "../../c/x.png", "items/b")).toBeNull();
    expect(resolveRef("items/b/chapters/01.md", "https://x", "items/b")).toBeNull();
  });
});
