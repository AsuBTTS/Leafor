import type { LayoutProfile, StatusDefinition, TagDefinition, WorkspaceMeta, WorkspaceSettings } from "../models/types";
import { newId, nowIso } from "./naming";

export const DEFAULT_STATUSES: StatusDefinition[] = [
  { id: "draft", name: "草稿", color: "#9aa39f", order: 0 },
  { id: "in_progress", name: "进行中", color: "#3f7d72", order: 1 },
  { id: "proofread", name: "待校对", color: "#b88a2e", order: 2 },
  { id: "retouch", name: "待P图", color: "#b5654a", order: 3 },
  { id: "organize", name: "待整理", color: "#7d6aa6", order: 4 },
  { id: "done", name: "已完成", color: "#164f47", order: 5 },
];

export const DEFAULT_TAGS: TagDefinition[] = [
  { id: "essay", name: "随笔", color: "#5d7f74" },
  { id: "reference", name: "资料", color: "#6b7a8f" },
  { id: "portrait", name: "人像", color: "#a0705a" },
  { id: "shortlist", name: "待选入集", color: "#8d8a5a" },
];

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  autosaveDelayMs: 1000,
  editorFontSize: 16,
  readerFontScale: 1,
  defaultImportMode: "copy",
};

export function newWorkspaceMeta(title: string): WorkspaceMeta {
  return {
    schemaVersion: 1,
    id: newId("x"),
    title,
    createdAt: nowIso(),
    app: "leafor",
    collectionOrder: [],
    tags: DEFAULT_TAGS.map((t) => ({ ...t })),
    statuses: DEFAULT_STATUSES.map((s) => ({ ...s })),
    settings: { ...DEFAULT_SETTINGS },
  };
}

export const SONG_FONT_STACK = '"SimSun", "宋体", "Songti SC", "STSong", "Source Han Serif SC", "Noto Serif CJK SC", "Noto Serif SC", serif';

export const PAGE_SIZES_MM: Record<Exclude<LayoutProfile["page"]["size"], "custom">, [number, number]> = {
  A4: [210, 297],
  A5: [148, 210],
  B5: [176, 250],
  "32K": [130, 184],
};

export function defaultLayoutProfile(): LayoutProfile {
  return {
    id: "default",
    name: "A5 文学书",
    page: { size: "A5", orientation: "portrait" },
    marginsMm: { top: 20, bottom: 22, inner: 20, outer: 16 },
    typography: {
      fontFamily: SONG_FONT_STACK,
      fontSizePt: 10.5,
      lineHeight: 1.75,
      paragraphIndentEm: 2,
      paragraphSpacingPt: 0,
    },
    chapters: { startOnNewPage: true, startOnOddPage: false, titleStyle: "centered" },
    headerFooter: {
      showPageNumbers: true,
      pageNumberPosition: "center",
      headerChapterTitle: true,
      headerText: "",
      footerText: "",
      mirrorOddEven: true,
    },
    includeToc: true,
    includeTitlePage: true,
    includeCover: false,
    exportDpi: 200,
  };
}

export const LAYOUT_PRESETS: Array<{ name: string; make: () => LayoutProfile }> = [
  { name: "A5 文学书", make: defaultLayoutProfile },
  {
    name: "32 开小说",
    make: () => ({ ...defaultLayoutProfile(), name: "32 开小说", page: { size: "32K", orientation: "portrait" }, marginsMm: { top: 16, bottom: 18, inner: 16, outer: 13 }, typography: { ...defaultLayoutProfile().typography, fontSizePt: 10 } }),
  },
  {
    name: "B5 讲义",
    make: () => ({ ...defaultLayoutProfile(), name: "B5 讲义", page: { size: "B5", orientation: "portrait" }, marginsMm: { top: 22, bottom: 24, inner: 22, outer: 18 }, typography: { ...defaultLayoutProfile().typography, fontSizePt: 11, lineHeight: 1.7 } }),
  },
  {
    name: "A4 文稿",
    make: () => ({ ...defaultLayoutProfile(), name: "A4 文稿", page: { size: "A4", orientation: "portrait" }, marginsMm: { top: 25, bottom: 25, inner: 25, outer: 25 }, typography: { ...defaultLayoutProfile().typography, fontSizePt: 12, paragraphIndentEm: 2 }, chapters: { startOnNewPage: true, titleStyle: "left" }, headerFooter: { ...defaultLayoutProfile().headerFooter, mirrorOddEven: false } }),
  },
];

export function pageSizeMm(p: LayoutProfile): [number, number] {
  let [w, h] = p.page.size === "custom" ? [p.page.widthMm ?? 148, p.page.heightMm ?? 210] : PAGE_SIZES_MM[p.page.size];
  if (p.page.orientation === "landscape") [w, h] = [h, w];
  return [w, h];
}
