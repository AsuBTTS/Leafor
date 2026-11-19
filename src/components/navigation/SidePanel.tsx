import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { usePref } from "@/app/store";

/** Collapsible, resizable (190–320px, default 204px) content directory panel (§13.2). */
export function SidePanel({ title, actions, children, open, onClose, prefKey = "toc.width", footer }: { title: ReactNode; actions?: ReactNode; children: ReactNode; open: boolean; onClose: () => void; prefKey?: string; footer?: ReactNode }) {
  const [width, setWidth] = usePref<number>(prefKey, 204);
  const [w, setW] = useState(width);
  const dragging = useRef(false);
  useEffect(() => setW(width), [width]);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return;
      const panel = document.querySelector(".lf-sidepanel") as HTMLElement | null;
      const left = panel?.getBoundingClientRect().left ?? 52;
      setW(Math.max(190, Math.min(320, e.clientX - left)));
    };
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.classList.remove("lf-resizing");
      setWidth(w);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [w, setWidth]);

  if (!open) return null;
  return (
    <aside className="lf-sidepanel" style={{ width: w }}>
      <div className="lf-sidepanel-head">
        <h2>{title}</h2>
        <div className="lf-sidepanel-actions">
          {actions}
          <button className="lf-icon-btn" onClick={onClose} title="收起目录" aria-label="收起目录">
            <ChevronLeft size={16} />
          </button>
        </div>
      </div>
      <div className="lf-sidepanel-body">{children}</div>
      {footer && <div className="lf-sidepanel-foot">{footer}</div>}
      <div
        className="lf-sidepanel-resize"
        onMouseDown={(e) => {
          e.preventDefault();
          dragging.current = true;
          document.body.classList.add("lf-resizing");
        }}
        onDoubleClick={() => setWidth(204)}
        title="拖动调整宽度（双击恢复默认）"
      />
    </aside>
  );
}

/** Auto-hide the directory on narrow windows (§13.2); the user can still reopen it. */
export function useTocOpen(key: string): [boolean, (v: boolean) => void] {
  const [open, setOpen] = usePref<boolean>(`toc.open.${key}`, true);
  const [narrow, setNarrow] = useState(typeof window !== "undefined" && window.innerWidth < 980);
  const [override, setOverride] = useState<boolean | null>(null);
  useEffect(() => {
    const on = () => {
      const n = window.innerWidth < 980;
      setNarrow((prev) => {
        if (prev !== n) setOverride(null);
        return n;
      });
    };
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const effective = override ?? (open && !narrow);
  return [
    effective,
    (v: boolean) => {
      if (narrow) setOverride(v);
      else {
        setOverride(null);
        setOpen(v);
      }
    },
  ];
}
