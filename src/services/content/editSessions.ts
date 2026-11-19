/** Registry of open editors so the app can flush unsaved text before closing/switching. */
export interface EditSession {
  isDirty(): boolean;
  flush(): Promise<boolean>;
  /** Check the file on disk after the window regains focus. */
  checkExternal?(): Promise<void>;
}

const sessions = new Map<string, EditSession>();

export function registerSession(id: string, s: EditSession): () => void {
  sessions.set(id, s);
  return () => {
    if (sessions.get(id) === s) sessions.delete(id);
  };
}

export function anyDirty(): boolean {
  return [...sessions.values()].some((s) => s.isDirty());
}

/** Flush all editors; resolves false if any save failed (e.g. conflict). */
export async function flushAll(): Promise<boolean> {
  const results = await Promise.all([...sessions.values()].map((s) => s.flush().catch(() => false)));
  return results.every(Boolean);
}

export async function checkAllExternal(): Promise<void> {
  await Promise.all([...sessions.values()].map((s) => s.checkExternal?.().catch(() => undefined)));
}
