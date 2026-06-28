import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { PROVIDERS, modelOptions, providerProgram } from "../lib/providers";

interface NewTabDialogProps {
  defaultProvider?: string;
  defaultCwd?: string;
  onConfirm: (
    provider: string,
    cwd: string,
    title: string,
    model: string,
    skipPermissions: boolean,
  ) => void;
  onCancel: () => void;
}

/** 新建标签弹层：选择 provider、工作目录、标题、模型与权限 */
export default function NewTabDialog({
  defaultProvider,
  defaultCwd,
  onConfirm,
  onCancel,
}: NewTabDialogProps) {
  const [provider, setProvider] = useState(defaultProvider ?? "claude");
  const [cwd, setCwd] = useState(defaultCwd ?? "");
  const [title, setTitle] = useState("");
  const [model, setModel] = useState("");
  // 默认开启跳过权限确认（bypass permissions on）
  const [skipPermissions, setSkipPermissions] = useState(true);

  const models = modelOptions(provider);

  const changeProvider = (p: string) => {
    setProvider(p);
    setModel(""); // 切换 provider 后模型重置为默认
  };

  const pickDir = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: cwd || undefined,
    });
    if (typeof selected === "string") {
      setCwd(selected);
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
    onConfirm(provider, cwd.trim(), finalTitle, model, skipPermissions);
  };

  // 预览将要执行的命令
  const program = providerProgram(provider);
  const previewArgs = [
    model ? `--model ${model}` : "",
    skipPermissions ? "--dangerously-skip-permissions" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="modal-mask" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>新建会话</h3>

        <label>命令行工具（CLI）</label>
        <div className="provider-tabs">
          {Object.entries(PROVIDERS).map(([key, cfg]) => (
            <button
              key={key}
              className={`provider-tab ${key === provider ? "on" : ""}`}
              style={
                key === provider
                  ? { borderColor: cfg.color, color: "#fff" }
                  : undefined
              }
              onClick={() => changeProvider(key)}
            >
              <span className="pill-badge" style={{ background: cfg.color }}>
                {cfg.badge}
              </span>
              {cfg.label}
            </button>
          ))}
        </div>

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

        <label>模型</label>
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          {models.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>

        <label>权限</label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={skipPermissions}
            onChange={(e) => setSkipPermissions(e.target.checked)}
          />
          <span>
            跳过权限确认（bypass permissions）
            <span className="toggle-hint">
              自动批准工具调用，不再逐次询问
            </span>
          </span>
        </label>

        <div className="cmd-preview">
          {program}
          {previewArgs ? ` ${previewArgs}` : ""}
        </div>

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
