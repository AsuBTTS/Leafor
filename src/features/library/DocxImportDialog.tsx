import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Modal } from "@/components/feedback/Overlays";
import { repo } from "@/app/backend";
import { toast, withBusy } from "@/app/store";
import { importDocx, splitByHeading, type DocxConversion } from "@/services/import-export/importService";
import { stem } from "@/domain/policies/naming";

interface Req {
  source: string;
  collectionId: string;
  conv: DocxConversion;
}

/** Chapter-split confirmation for DOCX import (spec AC-03). */
export function useDocxImport() {
  const [req, setReq] = useState<Req | null>(null);
  const navigate = useNavigate();
  const node = req ? <DocxDialog req={req} onClose={() => setReq(null)} onDone={(id) => (setReq(null), navigate(`/item/${id}`))} /> : null;
  return { open: setReq, node };
}

function DocxDialog({ req, onClose, onDone }: { req: Req; onClose: () => void; onDone: (id: string) => void }) {
  const [level, setLevel] = useState<1 | 2>(1);
  const [asBook, setAsBook] = useState(true);
  const [title, setTitle] = useState(stem(req.source));
  const candidates = useMemo(() => splitByHeading(req.conv.markdown, level), [req.conv.markdown, level]);
  const [titles, setTitles] = useState<Record<number, string>>({});

  const run = async () => {
    const list = candidates.map((c, i) => ({ ...c, title: titles[i] ?? c.title }));
    const r = await withBusy("正在创建工作副本…", () => importDocx(repo, req.collectionId, req.source, req.conv, list, { asBook, title: title.trim() || "未命名" }));
    if (!r) return;
    if (r.warnings.length) toast.warning(`转换完成，有 ${r.warnings.length} 条格式提示（例如不支持的样式或公式），请检查工作副本。`);
    else toast.success("已导入为 Markdown 工作副本，原 .docx 保存在 originals/");
    onDone(r.created[0]);
  };

  return (
    <Modal
      title="导入 Word 文档"
      width={560}
      onClose={onClose}
      footer={
        <>
          <button className="lf-btn" onClick={onClose}>
            取消
          </button>
          <button className="lf-btn primary" onClick={run}>
            导入
          </button>
        </>
      }
    >
      <div className="lf-form">
        <label className="lf-field">
          <span>标题</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="lf-seg">
          <button className={asBook ? "on" : ""} onClick={() => setAsBook(true)}>
            按标题拆分为图书章节
          </button>
          <button className={!asBook ? "on" : ""} onClick={() => setAsBook(false)}>
            作为单个纯文本
          </button>
        </div>
        {asBook && (
          <>
            <div className="lf-seg small">
              <span>拆分层级：</span>
              <button className={level === 1 ? "on" : ""} onClick={() => setLevel(1)}>
                一级标题
              </button>
              <button className={level === 2 ? "on" : ""} onClick={() => setLevel(2)}>
                一、二级标题
              </button>
            </div>
            <div className="lf-docx-candidates">
              <small>共 {candidates.length} 个章节候选（可直接修改章节名）</small>
              <ol>
                {candidates.map((c, i) => (
                  <li key={i}>
                    <input value={titles[i] ?? c.title} onChange={(e) => setTitles({ ...titles, [i]: e.target.value })} />
                    <small>{c.markdown.length} 字符</small>
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}
        {req.conv.messages.length > 0 && (
          <div className="lf-note warn">
            <AlertTriangle size={14} /> 转换提示 {req.conv.messages.length} 条：{req.conv.messages.slice(0, 3).join("；")}
          </div>
        )}
        <p className="lf-note">原 .docx 文件将被复制到单品的 originals/ 中并保持不变；Leafor 编辑的是转换得到的 Markdown 工作副本。Word 中的公式、批注、修订等可能无法完整转换。</p>
      </div>
    </Modal>
  );
}
