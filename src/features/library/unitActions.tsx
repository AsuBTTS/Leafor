import { Pencil, Tag, Copy, Download, Trash2, FileCode2, FileText, FileDown } from "lucide-react";
import type { NavigateFunction } from "react-router-dom";
import { repo } from "@/app/backend";
import { confirmDialog, prompt, toast, withBusy } from "@/app/store";
import type { ContentUnit, LoadedItem } from "@/domain/models/types";
import { UNIT_TYPE_LABEL } from "@/domain/models/types";
import type { MenuItem } from "@/components/forms/Popover";
import { describeExport, exportHtml, exportMarkdown } from "@/services/import-export/exportService";
import { exportDocx } from "@/services/import-export/docxExport";
import { flushAll } from "@/services/content/editSessions";

export async function runExport(label: string, fn: () => Promise<{ target: string; warnings: string[]; files: number } | null>) {
  await flushAll();
  const r = await withBusy(`正在${label}…`, fn);
  const msg = describeExport(r);
  if (msg) r!.warnings.length ? toast.warning(`${msg}：${r!.warnings.slice(0, 2).join("；")}`) : toast.success(msg);
}

export function unitMenu(item: LoadedItem, u: ContentUnit, navigate: NavigateFunction, opts: { onMarks?: () => void; extra?: MenuItem[] } = {}): MenuItem[] {
  const id = item.meta.id;
  const label = UNIT_TYPE_LABEL[u.type];
  return [
    {
      label: "重命名",
      icon: <Pencil size={14} />,
      onSelect: async () => {
        const t = await prompt({ title: `重命名${label}`, value: u.title });
        if (t) await repo.updateUnit(id, u.id, { title: t });
      },
    },
    { label: "状态与标签", icon: <Tag size={14} />, onSelect: opts.onMarks },
    ...(opts.extra ?? []),
    ...(u.type !== "photo" && u.type !== "text"
      ? [{
          label: "复制一份",
          icon: <Copy size={14} />,
          onSelect: async () => {
            const c = await repo.duplicateUnit(id, u.id);
            if (c) navigate(`/item/${id}/${c.id}`);
          },
        }]
      : []),
    { separator: true, label: "" },
    { label: "导出 Markdown", icon: <FileText size={14} />, onSelect: () => runExport("导出 Markdown", () => exportMarkdown(id, { unitId: u.id })) },
    { label: "导出 HTML", icon: <FileCode2 size={14} />, onSelect: () => runExport("导出 HTML", () => exportHtml(id, u.id)) },
    { label: "导出 Word", icon: <FileDown size={14} />, onSelect: () => runExport("导出 Word", () => exportDocx(id, u.id)) },
    { separator: true, label: "" },
    {
      label: `删除${label}`,
      icon: <Trash2 size={14} />,
      danger: true,
      onSelect: async () => {
        const ok = await confirmDialog({ title: `删除${label}`, message: `“${u.title}”将被移入作品库回收站，可在“归档与回收站”中恢复。`, okText: "移到回收站", danger: true });
        if (ok) {
          await repo.deleteUnit(id, u.id);
          navigate(`/item/${id}`);
        }
      },
    },
  ] as MenuItem[];
}

export const DownloadIcon = <Download size={14} />;
