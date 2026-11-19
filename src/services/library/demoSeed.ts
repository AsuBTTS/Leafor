/**
 * Creates a sample library (used by the browser preview, and offered as
 * "示例作品库" on the welcome screen). Everything is generated locally —
 * no network, no bundled third-party media.
 */
import type { Repository } from "./repository";
import type { Photo, PdfItem } from "@/domain/models/types";
import { joinRel, newId, nowIso } from "@/domain/policies/naming";

const enc = new TextEncoder();

function landscapeSvg(seed: number, title: string): string {
  const palettes = [
    ["#c9d8d3", "#8fb0a6", "#3f6b60", "#1f3d36", "#f1efe6"],
    ["#e9e2d0", "#c7b48f", "#8a7457", "#4d3f30", "#fbf6ea"],
    ["#d6e0e8", "#9fb4c4", "#5d7a8f", "#2c4252", "#f4f7f9"],
    ["#e8dcd6", "#d1a99a", "#9a6b5c", "#4e3730", "#fbf3ef"],
    ["#dfe6d8", "#aebf9c", "#6e865a", "#34452a", "#f6f8f1"],
    ["#e3e0ea", "#b3abc8", "#706694", "#3a345a", "#f6f5fa"],
  ];
  const p = palettes[seed % palettes.length];
  const r = (n: number) => ((Math.sin(seed * 99 + n * 7.3) + 1) / 2);
  const ridge = (base: number, amp: number, k: number) =>
    Array.from({ length: 9 }, (_, i) => `${i * 150},${Math.round(base - amp * r(i + k))}`).join(" L");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800">
  <rect width="1200" height="800" fill="${p[4]}"/>
  <rect width="1200" height="520" fill="${p[0]}"/>
  <circle cx="${300 + r(1) * 600}" cy="${150 + r(2) * 80}" r="${40 + r(3) * 30}" fill="${p[4]}" opacity="0.85"/>
  <path d="M0,800 L${ridge(430, 200, 1)} L1200,800 Z" fill="${p[1]}"/>
  <path d="M0,800 L${ridge(540, 160, 4)} L1200,800 Z" fill="${p[2]}"/>
  <path d="M0,800 L${ridge(660, 90, 8)} L1200,800 Z" fill="${p[3]}"/>
  <text x="40" y="770" font-family="serif" font-size="22" fill="${p[4]}" opacity="0.8">${title}</text>
</svg>`;
}

async function samplePdf(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle("Ligeti: Clocks and Clouds — Listening Notes");
  doc.setAuthor("Leafor sample");
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sections = [
    ["Clocks and Clouds", "A short listening guide. This PDF is an imported, read-only archive object: Leafor can display it, tag it and annotate it in side metadata, but never edits its bytes."],
    ["I. Clocks", "Mechanical pulsation, precise rhythmic grids and interlocking patterns. Listen for the moment the regular ticking starts to blur."],
    ["II. Clouds", "Micropolyphony dissolves pulse into texture. Individual lines are no longer audible as melodies; the ear perceives slow changes of colour."],
    ["III. Between", "The piece moves continuously between the two states. The transitions, not the states themselves, carry the form."],
    ["Notes", "Page numbers and bookmarks of the original file are preserved. Use the reader toolbar to zoom, jump to a page or switch between single-page and continuous view."],
  ];
  sections.forEach(([h, body], i) => {
    const page = doc.addPage([420, 595]);
    page.drawRectangle({ x: 0, y: 0, width: 420, height: 595, color: rgb(0.99, 0.985, 0.97) });
    if (i === 0) {
      page.drawText("Ligeti", { x: 48, y: 470, size: 40, font: bold, color: rgb(0.09, 0.31, 0.28) });
      page.drawText(h, { x: 48, y: 430, size: 22, font, color: rgb(0.1, 0.13, 0.12) });
      page.drawLine({ start: { x: 48, y: 410 }, end: { x: 160, y: 410 }, thickness: 0.8, color: rgb(0.4, 0.45, 0.43) });
    } else {
      page.drawText(h, { x: 48, y: 520, size: 18, font: bold, color: rgb(0.09, 0.31, 0.28) });
    }
    const words = body.split(" ");
    let line = "";
    let y = i === 0 ? 370 : 480;
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, 12) > 320) {
        page.drawText(line, { x: 48, y, size: 12, font, color: rgb(0.15, 0.18, 0.17) });
        y -= 20;
        line = w;
      } else line = next;
    }
    if (line) page.drawText(line, { x: 48, y, size: 12, font, color: rgb(0.15, 0.18, 0.17) });
    page.drawText(String(i + 1), { x: 205, y: 30, size: 10, font, color: rgb(0.45, 0.48, 0.47) });
  });
  return doc.save();
}

const CH1 = `# 第一章　钟

钟表是一种被驯服的时间。齿轮彼此咬合，每一次跳动都可以被预言。

> 世界上有两种东西：钟和云。——卡尔·波普尔

我们用一个简单的公式描述周期运动：$x(t) = A\\cos(\\omega t + \\varphi)$。

$$
T = \\frac{2\\pi}{\\omega}
$$

| 机制 | 可预测性 | 例子 |
| --- | --- | --- |
| 钟 | 高 | 摆钟、节拍器 |
| 云 | 低 | 天气、湍流 |

- [x] 写完钟的部分
- [ ] 补充云的段落
`;

const CH2 = `# 第二章　云

云没有齿轮。它在每一个瞬间重新决定自己的形状。

混沌系统对初始条件极端敏感：

$$
\\lambda = \\lim_{t \\to \\infty} \\frac{1}{t} \\ln \\frac{|\\delta Z(t)|}{|\\delta Z_0|}
$$

当 $\\lambda > 0$ 时，微小的差异会被指数放大。[^1]

[^1]: 这就是"蝴蝶效应"通俗说法的来源。
`;

const CH3 = `# 第三章　之间

真正有趣的事情发生在钟与云之间。

\`\`\`python
def between(clock, cloud, t):
    return (1 - t) * clock + t * cloud
\`\`\`

<!-- 作者备注：此处以后补插图 -->
`;

export async function seedDemoWorkspace(repo: Repository, root: string, title = "示例作品库"): Promise<void> {
  await repo.createWorkspace(root, title);
  if (repo.collections.size > 0) return;
  const lit = await repo.createCollection("文学");
  const music = await repo.createCollection("音乐");
  const image = await repo.createCollection("影像");
  const game = await repo.createCollection("游戏");
  await repo.createCollection("研究");
  const essay = await repo.createCollection("随笔");

  // Book
  const book = await repo.createItem(lit.id, "book", "Clocks and Clouds", { author: "阿苏", summary: "关于可预测与不可预测之物的小书。" } as never);
  const c1 = await repo.addUnit(book.meta.id, { title: "第一章　钟", text: CH1, statusId: "done" });
  await repo.addUnit(book.meta.id, { title: "第二章　云", text: CH2, statusId: "proofread", tagIds: ["essay"] });
  await repo.addUnit(book.meta.id, { title: "第三章　之间", text: CH3, statusId: "draft" });
  await repo.setMarks({ kind: "item", itemId: book.meta.id }, { statusId: "in_progress" });
  void c1;

  // Blog
  const blog = await repo.createItem(music.id, "blog", "音乐札记");
  await repo.addUnit(blog.meta.id, { title: "听德彪西的下午", publishedAt: "2026-09-12", tagIds: ["essay"], text: "# 听德彪西的下午\n\n《牧神午后》开头那支长笛，像一缕没有方向的风。\n\n和声在这里不再负责“解决”，只负责**颜色**。\n" });
  await repo.addUnit(blog.meta.id, { title: "关于复调的三个误会", publishedAt: "2026-06-03", text: "# 关于复调的三个误会\n\n1. 复调不等于复杂。\n2. 复调不等于古老。\n3. 复调不只属于巴赫。\n" });
  await repo.addUnit(blog.meta.id, { title: "游戏配乐里的留白（草稿）", publishedAt: null, statusId: "draft", text: "# 游戏配乐里的留白\n\n《风之旅人》的音乐在沙丘之间时有时无……\n" });

  // Series
  const series = await repo.createItem(music.id, "article_series", "现代音乐导论");
  const g1 = await repo.addSeriesGroup(series.meta.id, "第一部　声音的解放");
  const g2 = await repo.addSeriesGroup(series.meta.id, "第二部　结构与偶然");
  const s1 = await repo.addUnit(series.meta.id, { title: "序：为什么听现代音乐", text: "# 序：为什么听现代音乐\n\n这是一个关于耳朵如何被重新训练的系列。\n" });
  const s2 = await repo.addUnit(series.meta.id, { title: "勋伯格与十二音", groupId: g1.id, text: "# 勋伯格与十二音\n\n十二个音被平等对待：$\\{0,1,\\dots,11\\}$ 上的排列。\n" });
  const s3 = await repo.addUnit(series.meta.id, { title: "瓦雷兹：组织起来的声音", groupId: g1.id, statusId: "proofread", text: "# 瓦雷兹：组织起来的声音\n\n噪音进入音乐厅。\n" });
  const s4 = await repo.addUnit(series.meta.id, { title: "凯奇与偶然", groupId: g2.id, text: "# 凯奇与偶然\n\n《4′33″》真正的作品是听众自己。\n" });
  await repo.addUnit(series.meta.id, { title: "利盖蒂的微复调", groupId: g2.id, statusId: "draft", text: "# 利盖蒂的微复调\n\n参见本库中的 PDF 资料《Ligeti: Clocks and Clouds》。\n" });
  void s1; void s2; void s3; void s4;

  // Book 2
  const alps = await repo.createItem(lit.id, "book", "阿尔卑斯行记", { author: "阿苏" } as never);
  await repo.addUnit(alps.meta.id, { title: "第一章　出发", text: "# 第一章　出发\n\n火车在清晨六点离开苏黎世。\n" });

  // Document
  await repo.createItem(game.id, "document", "茶馆（设定集）");
  const daily = await repo.createItem(essay.id, "document", "日常杂记");
  const u = daily.meta.type === "document" ? daily.meta.data.content : null;
  if (u) {
    const { hash } = await repo.readUnitText(daily.meta.id, u.id);
    await repo.saveUnitText(daily.meta.id, u.id, "# 日常杂记\n\n今天把作品库整理了一遍。\n\n- 读完一本书\n- 拍了几张照片\n", hash);
  }

  await repo.createItem(image.id, "blog", "电影笔记");
  const gseries = await repo.createItem(game.id, "article_series", "游戏设计随想");
  await repo.addUnit(gseries.meta.id, { title: "Minecraft 教会我的事", text: "# Minecraft 教会我的事\n\n游戏的乐趣来自**自己定下的目标**。\n" });
  await repo.addUnit(gseries.meta.id, { title: "旅程感：风之旅人", text: "# 旅程感：风之旅人\n\n没有文字的叙事。\n" });

  // Photo album with generated images
  const album = await repo.createItem(image.id, "photo_album", "东欧旅行摄影");
  const names = ["布拉格清晨", "克鲁姆洛夫", "布达佩斯河岸", "塔特拉山", "克拉科夫广场", "布拉索夫"];
  const photos: Photo[] = [];
  for (let i = 0; i < names.length; i++) {
    const file = `photos/${String(i + 1).padStart(3, "0")}.svg`;
    const bytes = enc.encode(landscapeSvg(i, names[i]));
    const { hash } = await repo.fs.writeBytes(joinRel(album.dir, file), bytes);
    const now = nowIso();
    photos.push({ id: newId("u"), type: "photo", title: names[i], path: file, order: i, tagIds: i === 0 ? ["portrait"] : [], statusId: i === 1 ? "retouch" : i === 2 ? "done" : null, caption: i === 0 ? "旧城的第一缕光。" : "", width: 1200, height: 800, bytes: bytes.length, format: "SVG", sha256AtImport: hash, createdAt: now, updatedAt: now });
  }
  await repo.addPhotos(album.meta.id, photos);

  // Read-only PDF object
  const pdfBytes = await samplePdf();
  const pid = newId("i");
  const pdir = repo.newItemDir(music.id, "ligeti", pid);
  const { hash } = await repo.fs.writeBytes(joinRel(pdir, "originals/original.pdf"), pdfBytes);
  const now = nowIso();
  const pdfItem: PdfItem = {
    schemaVersion: 1,
    id: pid,
    type: "pdf",
    title: "Ligeti: Clocks and Clouds",
    tagIds: ["reference"],
    statusId: "organize",
    createdAt: now,
    updatedAt: now,
    data: { sourcePath: "originals/original.pdf", sourceName: "ligeti-clocks-and-clouds.pdf", sha256AtImport: hash, bytes: pdfBytes.length, pageCount: 5, importedAt: now, pdfTitle: "Ligeti: Clocks and Clouds — Listening Notes" },
  };
  await repo.registerPreparedItem(music.id, pdir, pdfItem);
  await repo.flushWrites();
}
