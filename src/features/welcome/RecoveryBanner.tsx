import { useEffect, useState } from "react";
import { LifeBuoy } from "lucide-react";
import { useRepo, toast } from "@/app/store";
import type { RecoveryDraft } from "@/services/library/repository";
import { dirName, joinRel, stem } from "@/domain/policies/naming";

/** Startup check for unsaved drafts left by an unexpected exit (technical design §14.1). */
export function RecoveryBanner() {
  const repo = useRepo();
  const [drafts, setDrafts] = useState<RecoveryDraft[]>([]);
  const [hidden, setHidden] = useState(false);
  const root = repo.root;

  useEffect(() => {
    if (!root) return;
    repo.listRecovery().then(setDrafts).catch(() => setDrafts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  if (hidden || !drafts.length) return null;

  const restore = async (d: RecoveryDraft) => {
    try {
      const st = await repo.fs.stat(d.path);
      const disk = st ? await repo.fs.hash(d.path) : "";
      if (disk === d.baseHash) {
        await repo.fs.writeText(d.path, d.text, d.baseHash);
        toast.success(`已恢复《${d.title}》的未保存内容`);
      } else {
        // File changed since the draft: never overwrite — save beside it.
        const copy = joinRel(dirName(d.path), `${stem(d.path)}.recovered-${Date.now()}.md`);
        await repo.fs.writeText(copy, d.text, "");
        toast.warning(`《${d.title}》在磁盘上已有更新，草稿另存为 ${copy.split("/").pop()}`);
      }
      await repo.clearRecovery(d.unitId);
      setDrafts((x) => x.filter((y) => y.unitId !== d.unitId));
    } catch (e) {
      toast.error(e);
    }
  };
  const discard = async (d: RecoveryDraft) => {
    await repo.clearRecovery(d.unitId);
    setDrafts((x) => x.filter((y) => y.unitId !== d.unitId));
  };

  return (
    <div className="lf-recovery">
      <LifeBuoy size={16} />
      <div className="lf-recovery-body">
        <strong>发现 {drafts.length} 份上次未保存的编辑草稿</strong>
        <ul>
          {drafts.map((d) => (
            <li key={d.unitId}>
              《{d.title}》 <small>{new Date(d.savedAt).toLocaleString()}</small>
              <button className="lf-link-btn" onClick={() => restore(d)}>
                恢复
              </button>
              <button className="lf-link-btn muted" onClick={() => discard(d)}>
                丢弃
              </button>
            </li>
          ))}
        </ul>
      </div>
      <button className="lf-link-btn muted" onClick={() => setHidden(true)}>
        稍后
      </button>
    </div>
  );
}
