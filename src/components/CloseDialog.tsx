import { useState } from "react";

interface CloseDialogProps {
  /** 选择"最小化到托盘" */
  onTray: (remember: boolean) => void;
  /** 选择"退出应用" */
  onQuit: (remember: boolean) => void;
  /** 取消关闭 */
  onCancel: () => void;
}

/** 关闭窗口时的询问：后台运行 / 退出 */
export default function CloseDialog({
  onTray,
  onQuit,
  onCancel,
}: CloseDialogProps) {
  const [remember, setRemember] = useState(false);

  return (
    <div className="modal-mask" onClick={onCancel}>
      <div className="modal close-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>关闭应用</h3>
        <p className="tip">
          关闭窗口后，正在运行的会话将保持后台运行；也可以直接退出。
        </p>

        <label className="remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          记住我的选择，下次不再询问
        </label>

        <div className="modal-actions">
          <button className="secondary" onClick={onCancel}>
            取消
          </button>
          <button className="secondary" onClick={() => onQuit(remember)}>
            退出应用
          </button>
          <button onClick={() => onTray(remember)}>最小化到托盘</button>
        </div>
      </div>
    </div>
  );
}
