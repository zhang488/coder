import { useTabsStore } from "../stores/tabs";
import { PROVIDERS } from "../lib/providers";
import AntigravityUsage from "./AntigravityUsage";

/** 底部状态栏：显示当前会话的 provider、工作目录、运行状态 */
export default function StatusBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const runtime = useTabsStore((s) => s.runtime);
  const contextUsage = useTabsStore((s) => s.contextUsage);

  const tab = tabs.find((t) => t.id === activeId);
  if (!tab) {
    return (
      <div className="statusbar">
        <span className="seg muted">无活动会话</span>
      </div>
    );
  }

  const rt = runtime[tab.id];
  const ctx = contextUsage[tab.id];
  const statusText =
    rt?.status === "running"
      ? "● 运行中"
      : rt?.status === "exited"
        ? `○ 已退出${rt.exitCode != null ? ` (${rt.exitCode})` : ""}`
        : "◌ 启动中";
  const statusClass =
    rt?.status === "running"
      ? "running"
      : rt?.status === "exited"
        ? "exited"
        : "starting";

  return (
    <div className="statusbar">
      <span className={`seg status ${statusClass}`}>{statusText}</span>
      <span className="seg">{PROVIDERS[tab.provider]?.label ?? tab.provider}</span>
      <span className="seg path" title={tab.cwd}>
        {tab.cwd}
      </span>
      {tab.sessionId && <span className="seg muted">{tab.sessionId.slice(0, 8)}</span>}
      {ctx && (
        <span
          className="seg ctx"
          title={`上下文窗口用量（运行 /context 时更新）\n已用 ${ctx.used} / ${ctx.total}`}
        >
          🧠 上下文{" "}
          {ctx.percent != null ? (
            <span style={{ color: ctxColor(ctx.percent), fontWeight: 600 }}>
              {ctx.percent}%
            </span>
          ) : (
            <span>{ctx.used}</span>
          )}
          <span className="muted"> ({ctx.used}/{ctx.total})</span>
        </span>
      )}
      {tab.provider === "antigravity" && <AntigravityUsage />}
    </div>
  );
}

/** 上下文占比对应颜色 */
function ctxColor(p: number): string {
  return p < 60 ? "#4ec9b0" : p < 85 ? "#d7ba7d" : "#f14c4c";
}
