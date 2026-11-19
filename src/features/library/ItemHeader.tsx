import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronDown, Download, Info, PanelLeft } from "lucide-react";
import { TopBar } from "@/components/navigation/Chrome";
import { MenuButton, type MenuItem } from "@/components/forms/Popover";
import { MarksButton, StatusBadge } from "@/components/marks/Marks";
import { ITEM_TYPE_LABEL, type LoadedItem } from "@/domain/models/types";
import { itemMenu } from "./actions";
import { PropertiesDialog } from "./PropertiesDialog";

export function ItemHeader({
  item,
  center,
  right,
  exportItems,
  onToggleToc,
  tocOpen,
}: {
  item: LoadedItem;
  center?: ReactNode;
  right?: ReactNode;
  exportItems?: MenuItem[];
  onToggleToc?: () => void;
  tocOpen?: boolean;
}) {
  const navigate = useNavigate();
  const [props, setProps] = useState(false);
  const m = item.meta;
  return (
    <>
      <TopBar
        className="lf-item-topbar"
        left={
          <div className="lf-item-head">
            <button className="lf-icon-btn" onClick={() => navigate(`/?c=${item.collectionId}`)} title="返回作品库" aria-label="返回作品库">
              <ArrowLeft size={17} />
            </button>
            {onToggleToc && (
              <button className={`lf-icon-btn ${tocOpen ? "on" : ""}`} onClick={onToggleToc} title={tocOpen ? "收起目录" : "展开目录"} aria-label="切换目录">
                <PanelLeft size={17} />
              </button>
            )}
            <MenuButton items={() => itemMenu(item, navigate, { onProps: () => setProps(true) }).filter((x) => x.label !== "打开" && x.label !== "状态与标签")} className="lf-item-title-btn" placement="bottom-start" title="作品操作">
              <span className="lf-item-title">{m.title}</span>
              <ChevronDown size={14} />
            </MenuButton>
            <span className="lf-item-type">{ITEM_TYPE_LABEL[m.type]}</span>
            <StatusBadge statusId={m.statusId} />
          </div>
        }
        center={center}
        right={
          <>
            {right}
            <MarksButton targets={[{ kind: "item", itemId: m.id }]} />
            {exportItems && exportItems.length > 0 && (
              <MenuButton items={exportItems} title="导出">
                <Download size={16} strokeWidth={1.6} />
              </MenuButton>
            )}
            <button className="lf-icon-btn" onClick={() => setProps(true)} title="属性与封面" aria-label="属性与封面">
              <Info size={16} strokeWidth={1.6} />
            </button>
          </>
        }
      />
      {props && <PropertiesDialog itemId={m.id} onClose={() => setProps(false)} />}
    </>
  );
}

export function ModeSwitch<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; icon?: ReactNode; title?: string }> }) {
  return (
    <div className="lf-modes" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)} title={o.title ?? o.label}>
          {o.icon}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
