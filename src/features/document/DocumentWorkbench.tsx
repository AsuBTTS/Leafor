import { useCallback, useRef, useState } from "react";
import { PenLine, Columns2, Eye, FileText, FileCode2, FileDown, Printer } from "lucide-react";
import type { WorkbenchProps } from "@/features/library/ItemPage";
import { ItemHeader, ModeSwitch } from "@/features/library/ItemHeader";
import { SidePanel, useTocOpen } from "@/components/navigation/SidePanel";
import { TextWorkbench, type TextMode, type TextWorkbenchHandle } from "@/components/editor/TextWorkbench";
import type { OutlineEntry } from "@/components/markdown/pipeline";
import { OutlineList } from "@/components/navigation/OutlineList";
import { usePref } from "@/app/store";
import { runExport } from "@/features/library/unitActions";
import { exportHtml, exportMarkdown } from "@/services/import-export/exportService";
import { exportDocx } from "@/services/import-export/docxExport";
import { PublishDialog } from "@/features/book/PublishPanel";

export const TEXT_MODES = [
  { value: "edit" as const, label: "编辑", icon: <PenLine size={14} /> },
  { value: "split" as const, label: "分屏", icon: <Columns2 size={14} /> },
  { value: "preview" as const, label: "预览", icon: <Eye size={14} /> },
];

export function DocumentWorkbench({ item }: WorkbenchProps) {
  const [mode, setMode] = usePref<TextMode>("doc.mode", "split");
  const [tocOpen, setTocOpen] = useTocOpen("document");
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  const [publish, setPublish] = useState(false);
  const wb = useRef<TextWorkbenchHandle>(null);
  const onOutline = useCallback((o: OutlineEntry[]) => setOutline(o), []);
  if (item.meta.type !== "document") return null;
  const unit = item.meta.data.content;
  const id = item.meta.id;

  return (
    <div className="lf-page lf-item-page">
      <ItemHeader
        item={item}
        tocOpen={tocOpen}
        onToggleToc={() => setTocOpen(!tocOpen)}
        center={<ModeSwitch value={mode} onChange={setMode} options={TEXT_MODES} />}
        exportItems={[
          { label: "导出 Markdown", icon: <FileText size={14} />, onSelect: () => runExport("导出 Markdown", () => exportMarkdown(id)) },
          { label: "导出 HTML", icon: <FileCode2 size={14} />, onSelect: () => runExport("导出 HTML", () => exportHtml(id)) },
          { label: "导出 Word", icon: <FileDown size={14} />, onSelect: () => runExport("导出 Word", () => exportDocx(id)) },
          { label: "排版并导出 PDF…", icon: <Printer size={14} />, onSelect: () => setPublish(true) },
        ]}
      />
      <div className="lf-item-body">
        <SidePanel title="大纲" open={tocOpen} onClose={() => setTocOpen(false)}>
          <OutlineList outline={outline} onPick={(o) => wb.current?.scrollToHeading(o.id)} />
        </SidePanel>
        <div className="lf-item-main">
          <TextWorkbench ref={wb} itemId={id} unitId={unit.id} mode={mode} onOutline={onOutline} />
        </div>
      </div>
      {publish && <PublishDialog item={item} onClose={() => setPublish(false)} />}
    </div>
  );
}
