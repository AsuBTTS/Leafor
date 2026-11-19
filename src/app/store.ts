import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { repo } from "./backend";
import type { Repository } from "@/services/library/repository";

/** Re-render when repository data changes; returns the repository. */
export function useRepo(): Repository {
  useSyncExternalStore(
    (cb) => repo.subscribe(cb),
    () => repo.version,
  );
  return repo;
}

export interface Toast {
  id: number;
  kind: "info" | "success" | "error" | "warning";
  text: string;
  action?: { label: string; run: () => void };
}

export type DialogRequest =
  | { type: "prompt"; title: string; label?: string; value?: string; placeholder?: string; okText?: string; multiline?: boolean; resolve: (v: string | null) => void }
  | { type: "confirm"; title: string; message: string; okText?: string; danger?: boolean; resolve: (v: boolean) => void }
  | { type: "choice"; title: string; message?: string; options: Array<{ value: string; label: string; hint?: string }>; resolve: (v: string | null) => void };

interface UiState {
  toasts: Toast[];
  dialog: DialogRequest | null;
  busy: string | null;
  pushToast(t: Omit<Toast, "id">): void;
  dismissToast(id: number): void;
  setDialog(d: DialogRequest | null): void;
  setBusy(b: string | null): void;
}

let toastSeq = 1;

export const useUi = create<UiState>((set) => ({
  toasts: [],
  dialog: null,
  busy: null,
  pushToast: (t) => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.kind === "error" ? 8000 : 4200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  setDialog: (dialog) => set({ dialog }),
  setBusy: (busy) => set({ busy }),
}));

export const toast = {
  info: (text: string) => useUi.getState().pushToast({ kind: "info", text }),
  success: (text: string, action?: Toast["action"]) => useUi.getState().pushToast({ kind: "success", text, action }),
  error: (text: string | unknown) => useUi.getState().pushToast({ kind: "error", text: errorText(text) }),
  warning: (text: string) => useUi.getState().pushToast({ kind: "warning", text }),
};

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function prompt(opts: Omit<Extract<DialogRequest, { type: "prompt" }>, "type" | "resolve">): Promise<string | null> {
  return new Promise((resolve) => useUi.getState().setDialog({ type: "prompt", ...opts, resolve }));
}
export function confirmDialog(opts: Omit<Extract<DialogRequest, { type: "confirm" }>, "type" | "resolve">): Promise<boolean> {
  return new Promise((resolve) => useUi.getState().setDialog({ type: "confirm", ...opts, resolve }));
}
export function choose(opts: Omit<Extract<DialogRequest, { type: "choice" }>, "type" | "resolve">): Promise<string | null> {
  return new Promise((resolve) => useUi.getState().setDialog({ type: "choice", ...opts, resolve }));
}

/** Run an async task with a busy overlay and error toast. */
export async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  useUi.getState().setBusy(label);
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    toast.error(e);
    return undefined;
  } finally {
    useUi.getState().setBusy(null);
  }
}

/** UI preferences persisted per WebView profile (light conveniences only). */
export function usePref<T>(key: string, fallback: T): [T, (v: T) => void] {
  const k = `leafor:${key}`;
  const read = (): T => {
    try {
      const raw = localStorage.getItem(k);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  };
  const value = useSyncExternalStore(
    (cb) => {
      const h = (e: Event) => (e as CustomEvent).detail === k && cb();
      window.addEventListener("leafor-pref", h);
      return () => window.removeEventListener("leafor-pref", h);
    },
    () => {
      try {
        return localStorage.getItem(k) ?? "";
      } catch {
        return "";
      }
    },
  );
  void value;
  return [
    read(),
    (v: T) => {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch {
        /* storage unavailable */
      }
      window.dispatchEvent(new CustomEvent("leafor-pref", { detail: k }));
    },
  ];
}
