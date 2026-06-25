import { useTabsStore } from "../stores/tabs";
import { PROVIDERS } from "../lib/providers";

interface TabBarProps {
  onNewTab: () => void;
}

/** 顶部标签栏：标签切换、关闭、新建 */
export default function TabBar({ onNewTab }: TabBarProps) {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const runtime = useTabsStore((s) => s.runtime);
  const setActive = useTabsStore((s) => s.setActive);
  const closeTab = useTabsStore((s) => s.closeTab);

  return (
    <div className="tabbar">
      {tabs.map((t) => {
        const rt = runtime[t.id];
        const dot =
          rt?.status === "running"
            ? "#4ec9b0"
            : rt?.status === "exited"
              ? "#f48771"
              : "#c9a26d"; // starting
        return (
          <div
            key={t.id}
            className={`tab ${t.id === activeId ? "active" : ""}`}
            onClick={() => setActive(t.id)}
            title={`${PROVIDERS[t.provider]?.label ?? t.provider} · ${t.cwd}`}
          >
            <span className="dot" style={{ background: dot }} />
            <span className="tab-title">{t.title}</span>
            <span
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
            >
              ×
            </span>
          </div>
        );
      })}
      <button className="tab-new" onClick={onNewTab} title="新建标签">
        ＋
      </button>
    </div>
  );
}
