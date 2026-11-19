import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface PopoverProps {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  placement?: "bottom-start" | "bottom-end" | "right-start" | "top-start";
  width?: number;
  className?: string;
}

/** Fixed-position popover anchored to an element; closes on outside click / Escape. */
export function Popover({ anchor, open, onClose, children, placement = "bottom-start", width, className }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const el = ref.current;
      const w = el?.offsetWidth ?? width ?? 220;
      const h = el?.offsetHeight ?? 200;
      let left = r.left;
      let top = r.bottom + 6;
      if (placement === "bottom-end") left = r.right - w;
      if (placement === "right-start") {
        left = r.right + 6;
        top = r.top;
      }
      if (placement === "top-start") top = r.top - h - 6;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
      setPos({ left, top });
    };
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
    };
  }, [open, anchor, placement, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      // Nested dialogs (prompt/confirm) render in .lf-modal-root — ignore clicks there.
      if ((t as HTMLElement).closest?.(".lf-modal-backdrop")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, anchor, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={`lf-popover ${className ?? ""}`}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width }}
      role="dialog"
    >
      {children}
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
  separator?: boolean;
  submenu?: MenuItem[];
}

export function Menu({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return (
    <div className="lf-menu" role="menu">
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="lf-menu-sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`lf-menu-item ${it.danger ? "danger" : ""}`}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onSelect?.();
            }}
          >
            <span className="lf-menu-icon">{it.icon}</span>
            <span className="lf-menu-label">{it.label}</span>
            {it.hint && <span className="lf-menu-hint">{it.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}

/** Button that opens a dropdown menu. */
export function MenuButton({
  items,
  children,
  className,
  title,
  placement = "bottom-end",
}: {
  items: MenuItem[] | (() => MenuItem[]);
  children: ReactNode;
  className?: string;
  title?: string;
  placement?: PopoverProps["placement"];
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={setAnchor}
        className={className ?? "lf-icon-btn"}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {children}
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} placement={placement}>
        <Menu items={typeof items === "function" ? items() : items} onClose={() => setOpen(false)} />
      </Popover>
    </>
  );
}

/** Context menu at the mouse position. */
export function useContextMenu() {
  const [state, setState] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const open = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ x: e.clientX, y: e.clientY, items });
  };
  const node = state
    ? createPortal(
        <>
          <div ref={anchorRef} style={{ position: "fixed", left: state.x, top: state.y, width: 1, height: 1 }} />
          <ContextMenuPortal anchor={anchorRef} items={state.items} onClose={() => setState(null)} />
        </>,
        document.body,
      )
    : null;
  return { open, node };
}

function ContextMenuPortal({ anchor, items, onClose }: { anchor: React.RefObject<HTMLDivElement | null>; items: MenuItem[]; onClose: () => void }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => setEl(anchor.current), [anchor]);
  return (
    <Popover anchor={el} open={!!el} onClose={onClose}>
      <Menu items={items} onClose={onClose} />
    </Popover>
  );
}
