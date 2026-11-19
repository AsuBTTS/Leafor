import { createTauriBackend, isTauri } from "@/adapters/tauri/backend";
import { createMemoryBackend } from "@/adapters/mock/memoryBackend";
import type { Backend } from "@/services/persistence/ports";
import { Repository } from "@/services/library/repository";

/** Desktop builds use the scoped Tauri backend; plain browsers get an in-memory demo. */
export const backend: Backend = isTauri() ? createTauriBackend() : createMemoryBackend({ browserPickers: true });
export const repo = new Repository(backend);
export const isDesktop = backend.platform.kind === "tauri";

// Debug handle for automated UI checks in the browser preview only.
if (!isDesktop && typeof window !== "undefined") (window as unknown as { __leafor: unknown }).__leafor = { repo, backend };
