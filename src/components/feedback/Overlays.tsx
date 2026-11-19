import { useEffect, useRef, useState, type ReactNode } from "react";
import { X, CheckCircle2, AlertTriangle, Info, XCircle, Loader2 } from "lucide-react";
import { useUi } from "@/app/store";

export function Modal({
  title,
  children,
  onClose,
  footer,
  width = 440,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  width?: number;
  className?: string;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="lf-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`lf-modal ${className ?? ""}`} style={{ width }} role="dialog" aria-modal="true">
        <header className="lf-modal-head">
          <h2>{title}</h2>
          <button className="lf-icon-btn" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </header>
        <div className="lf-modal-body">{children}</div>
        {footer && <footer className="lf-modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function DialogHost() {
  const dialog = useUi((s) => s.dialog);
  const setDialog = useUi((s) => s.setDialog);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => {
    if (dialog?.type === "prompt") {
      setValue(dialog.value ?? "");
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 20);
    }
  }, [dialog]);

  if (!dialog) return null;
  const close = (v: unknown) => {
    setDialog(null);
    (dialog.resolve as (x: unknown) => void)(v);
  };

  if (dialog.type === "prompt") {
    const ok = () => value.trim() && close(value.trim());
    return (
      <Modal
        title={dialog.title}
        onClose={() => close(null)}
        footer={
          <>
            <button className="lf-btn" onClick={() => close(null)}>
              取消
            </button>
            <button className="lf-btn primary" disabled={!value.trim()} onClick={ok}>
              {dialog.okText ?? "确定"}
            </button>
          </>
        }
      >
        <label className="lf-field">
          {dialog.label && <span>{dialog.label}</span>}
          {dialog.multiline ? (
            <textarea ref={inputRef} rows={4} value={value} placeholder={dialog.placeholder} onChange={(e) => setValue(e.target.value)} />
          ) : (
            <input
              ref={inputRef}
              value={value}
              placeholder={dialog.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && ok()}
            />
          )}
        </label>
      </Modal>
    );
  }
  if (dialog.type === "confirm") {
    return (
      <Modal
        title={dialog.title}
        onClose={() => close(false)}
        footer={
          <>
            <button className="lf-btn" onClick={() => close(false)}>
              取消
            </button>
            <button className={`lf-btn ${dialog.danger ? "danger" : "primary"}`} autoFocus onClick={() => close(true)}>
              {dialog.okText ?? "确定"}
            </button>
          </>
        }
      >
        <p className="lf-dialog-text">{dialog.message}</p>
      </Modal>
    );
  }
  return (
    <Modal title={dialog.title} onClose={() => close(null)} footer={<button className="lf-btn" onClick={() => close(null)}>取消</button>}>
      {dialog.message && <p className="lf-dialog-text">{dialog.message}</p>}
      <div className="lf-choice-list">
        {dialog.options.map((o) => (
          <button key={o.value} className="lf-choice" onClick={() => close(o.value)}>
            <strong>{o.label}</strong>
            {o.hint && <small>{o.hint}</small>}
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  const icon = { info: <Info size={16} />, success: <CheckCircle2 size={16} />, warning: <AlertTriangle size={16} />, error: <XCircle size={16} /> };
  return (
    <div className="lf-toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`lf-toast ${t.kind}`}>
          {icon[t.kind]}
          <span>{t.text}</span>
          {t.action && (
            <button
              className="lf-link-btn"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="lf-icon-btn tiny" onClick={() => dismiss(t.id)} aria-label="关闭">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function BusyOverlay() {
  const busy = useUi((s) => s.busy);
  if (!busy) return null;
  return (
    <div className="lf-busy">
      <div className="lf-busy-card">
        <Loader2 className="spin" size={18} />
        <span>{busy}</span>
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, hint, children }: { icon?: ReactNode; title: string; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="lf-empty">
      {icon && <div className="lf-empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {hint && <p>{hint}</p>}
      {children && <div className="lf-empty-actions">{children}</div>}
    </div>
  );
}
