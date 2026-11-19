import type { OutlineEntry } from "@/components/markdown/pipeline";

export function OutlineList({ outline, onPick }: { outline: OutlineEntry[]; onPick: (o: OutlineEntry) => void }) {
  if (!outline.length) return <div className="lf-tree-empty">文档中还没有标题。使用 # 标题 建立大纲。</div>;
  const min = Math.min(...outline.map((o) => o.depth));
  return (
    <div className="lf-outline">
      {outline.map((o, i) => (
        <button key={i} className="lf-outline-row" style={{ paddingLeft: 12 + (o.depth - min) * 14 }} onClick={() => onPick(o)} title={o.text}>
          {o.text}
        </button>
      ))}
    </div>
  );
}
