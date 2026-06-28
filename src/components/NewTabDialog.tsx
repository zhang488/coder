import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { PROVIDERS } from "../lib/providers";

interface NewTabDialogProps {
  defaultProvider?: string;
  defaultCwd?: string;
  onConfirm: (provider: string, cwd: string, title: string) => void;
  onCancel: () => void;
}

/** 新建标签弹层：选择 provider、工作目录与标题 */
export default function NewTabDialog({
  defaultProvider,
  defaultCwd,
  onConfirm,
  onCancel,
}: NewTabDialogProps) {
  const [provider, setProvider] = useState(defaultProvider ?? "claude");
  const [cwd, setCwd] = useState(defaultCwd ?? "");
  const [title, setTitle] = useState("");

  const pickDir = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: cwd || undefined,
    });
    if (typeof selected === "string") {
      setCwd(selected);
      // 标题未填时，用目录名兜底
      if (!title.trim()) {
        const name = selected.split(/[\\/]/).filter(Boolean).pop() ?? "";
        setTitle(name);
      }
    }
  };

  const confirm = () => {
    if (!cwd.trim()) {
      alert("请选择工作目录");
      return;
    }
    const finalTitle =
      title.trim() ||
      cwd.split(/[\\/]/).filter(Boolean).pop() ||
      PROVIDERS[provider]?.label ||
      provider;
    onConfirm(provider, cwd.trim(), finalTitle);
  };

  return (
    <div className="modal-mask" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>新建标签</h3>

        <label>Provider</label>
        <select value={provider} onChange={(e) => setProvider(e.target.value)}>
          {Object.entries(PROVIDERS).map(([key, cfg]) => (
            <option key={key} value={key}>
              {cfg.label}
            </option>
          ))}
        </select>

        <label>工作目录</label>
        <div className="row">
          <input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="选择或输入工作目录"
          />
          <button onClick={pickDir}>浏览…</button>
        </div>

        <label>标题（可选）</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="默认取目录名"
        />

        <div className="modal-actions">
          <button className="secondary" onClick={onCancel}>
            取消
          </button>
          <button onClick={confirm}>创建</button>
        </div>
      </div>
    </div>
  );
}
