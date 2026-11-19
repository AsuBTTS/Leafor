import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { LibraryBig, FolderTree, Search, Tags, Archive, Settings, Minus, Square, X } from "lucide-react";
import { backend, isDesktop } from "@/app/backend";

export function LeaforMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <path d="M368 120c-120 6-212 70-228 186-4 30-2 60 6 86 20-62 66-120 132-158-54 46-92 104-110 172 22 10 48 14 76 10 112-16 150-140 124-296z" fill="currentColor" />
    </svg>
  );
}

const RAIL = [
  { to: "/", icon: LibraryBig, label: "作品库", end: true },
  { to: "/collections", icon: FolderTree, label: "集合" },
  { to: "/search", icon: Search, label: "搜索与筛选（Ctrl+K）" },
  { to: "/marks", icon: Tags, label: "标签与状态" },
  { to: "/archive", icon: Archive, label: "归档与回收站" },
];

/** 52px icon-only global navigation (technical design §13.2). */
export function IconRail() {
  const loc = useLocation();
  const inItem = loc.pathname.startsWith("/item/");
  return (
    <nav className="lf-rail" aria-label="全局导航">
      <div className="lf-rail-logo" data-tauri-drag-region>
        <LeaforMark size={22} />
      </div>
      <div className="lf-rail-sep" />
      {RAIL.map(({ to, icon: Icon, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => `lf-rail-btn ${isActive || (to === "/" && inItem) ? "active" : ""}`}
          data-tip={label}
          aria-label={label}
        >
          <Icon size={19} strokeWidth={1.6} />
        </NavLink>
      ))}
      <div className="lf-rail-spacer" data-tauri-drag-region />
      <NavLink to="/settings" className={({ isActive }) => `lf-rail-btn ${isActive ? "active" : ""}`} data-tip="设置" aria-label="设置">
        <Settings size={19} strokeWidth={1.6} />
      </NavLink>
    </nav>
  );
}

export function WindowControls() {
  if (!isDesktop) return null;
  const w = backend.platform.window;
  return (
    <div className="lf-winctl">
      <button onClick={() => w.minimize()} aria-label="最小化">
        <Minus size={15} strokeWidth={1.5} />
      </button>
      <button onClick={() => w.toggleMaximize()} aria-label="最大化">
        <Square size={12} strokeWidth={1.5} />
      </button>
      <button className="close" onClick={() => w.close()} aria-label="关闭">
        <X size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
}

/** Thin top bar: draggable title region + page actions + window controls. */
export function TopBar({ left, center, right, className }: { left?: ReactNode; center?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <header className={`lf-topbar ${className ?? ""}`} data-tauri-drag-region>
      <div className="lf-topbar-left">{left}</div>
      <div className="lf-topbar-center" data-tauri-drag-region>
        {center}
      </div>
      <div className="lf-topbar-right">
        {right}
        <WindowControls />
      </div>
    </header>
  );
}
