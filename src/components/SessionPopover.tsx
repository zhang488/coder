import { useEffect, useState } from "react";
import { tabQuestions, openDir } from "../lib/history";

interface SessionPopoverProps {
  provider: string;
  cwd: string;
  sessionId: string | null;
  /** 锚点元素的屏幕坐标（右侧、顶部） */
  anchor: { x: number; y: number };
}

/**
 * 会话悬停浮层：顶部展示可点击跳转的目录路径，下方展示该会话的提问记录。
 */
export default function SessionPopover({
  provider,
  cwd,
  sessionId,
  anchor,
}: SessionPopoverProps) {
  const [questions, setQuestions] = useState<string[] | null>(null);

  useEffect(() => {
    let alive = true;
    tabQuestions(provider, cwd, sessionId).then((qs) => {
      if (alive) setQuestions(qs);
    });
    return () => {
      alive = false;
    };
  }, [provider, cwd, sessionId]);

  // 防止浮层超出窗口底部
  const maxTop = Math.min(anchor.y, window.innerHeight - 320);

  return (
    <div
      className="session-popover"
      style={{ left: anchor.x + 8, top: Math.max(8, maxTop) }}
      // 浮层自身不触发会话项的 mouseleave（由父级 onMouseEnter/Leave 控制）
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="pop-path"
        title="点击在文件管理器中打开"
        onClick={() => openDir(cwd).catch(() => {})}
      >
        <span className="pop-folder">📂</span>
        <span className="pop-path-text">{cwd}</span>
        <span className="pop-open">↗</span>
      </div>

      <div className="pop-title">提问记录</div>
      <div className="pop-list">
        {questions === null ? (
          <div className="pop-hint">加载中…</div>
        ) : questions.length === 0 ? (
          <div className="pop-hint">暂无提问记录</div>
        ) : (
          // 最近的在上
          [...questions].reverse().map((q, i) => (
            <div className="pop-item" key={i} title={q}>
              {q}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
