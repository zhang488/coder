import { useState } from "react";
import { useTabsStore } from "../stores/tabs";
import { PROVIDERS, PROVIDER_KEYS } from "../lib/providers";

interface SidebarProps {
  /** 当前选中的 provider（筛选 + 新建默认） */
  provider: string;
  onProviderChange: (provider: string) => void;
  onNewTab: () => void;
  onCollapse: () => void;
}

/** 指示灯颜色：打开且运行=亮；关闭=熄灭(灰) */
const dotColor = (isOpen: boolean, status?: string) => {
  if (!isOpen) return "#4a4a4a"; // 已关闭，熄灭
  if (status === "exited") return "#f48771";
  if (status === "starting") return "#c9a26d";
  return "#4ec9b0"; // 运行中，亮起
};

/**
 * 左侧边栏：顶部 provider 切换器、新建会话、搜索、统一会话列表。
 * 切换器选中的 provider 同时用于：筛选会话列表 + 作为新建会话默认。
 */
export default function Sidebar({
  provider,
  onProviderChange,
  onNewTab,
  onCollapse,
}: SidebarProps) {
  const tabs = useTabsStore((s) => s.tabs);
  const history = useTabsStore((s) => s.history);
  const activeId = useTabsStore((s) => s.activeId);
  const runtime = useTabsStore((s) => s.runtime);
  const setActive = useTabsStore((s) => s.setActive);
  const closeTab = useTabsStore((s) => s.closeTab);
  const reopenTab = useTabsStore((s) => s.reopenTab);
  const deleteHistory = useTabsStore((s) => s.deleteHistory);

  const [keyword, setKeyword] = useState("");
  const kw = keyword.trim().toLowerCase();

  const openIds = new Set(tabs.map((t) => t.id));
  // 按 provider 筛选 + 关键词过滤；打开的在前，历史在后
  const items = [...tabs, ...history].filter(
    (t) =>
      t.provider === provider &&
      (!kw ||
        t.title.toLowerCase().includes(kw) ||
        t.cwd.toLowerCase().includes(kw)),
  );

  const cur = PROVIDERS[provider];

  return (
    <div className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <span
            className="brand-badge"
            style={{ background: cur?.color ?? "#5865f2" }}
          >
            {cur?.badge ?? "AI"}
          </span>
          <span className="brand-name">Coder</span>
        </div>
        <button className="icon-btn" title="折叠侧边栏" onClick={onCollapse}>
          «
        </button>
      </div>

      {/* Provider 切换器 */}
      <div className="provider-switch">
        {PROVIDER_KEYS.map((key) => {
          const p = PROVIDERS[key];
          const on = key === provider;
          return (
            <button
              key={key}
              className={`provider-pill ${on ? "on" : ""}`}
              style={on ? { borderColor: p.color, color: "#fff" } : undefined}
              onClick={() => onProviderChange(key)}
            >
              <span className="pill-badge" style={{ background: p.color }}>
                {p.badge}
              </span>
              {p.short}
            </button>
          );
        })}
      </div>

      <button
        className="new-session"
        style={{ background: cur?.color ?? "#5865f2" }}
        onClick={onNewTab}
      >
        ＋ 新建会话
      </button>

      <input
        className="search"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="搜索会话…"
      />

      <div className="section-title">{cur?.label ?? "会话"}</div>
      <div className="session-list">
        {items.length === 0 ? (
          <div className="hint">{kw ? "无匹配会话" : "暂无会话"}</div>
        ) : (
          items.map((t) => {
            const isOpen = openIds.has(t.id);
            const dir = t.cwd.split(/[\\/]/).filter(Boolean).pop() ?? t.cwd;
            return (
              <div
                key={t.id}
                className={`session-item ${t.id === activeId ? "active" : ""} ${
                  isOpen ? "" : "closed"
                }`}
                onClick={() => (isOpen ? setActive(t.id) : reopenTab(t.id))}
                title={isOpen ? t.cwd : `${t.cwd}\n点击恢复并续接上次对话`}
              >
                <span
                  className="dot"
                  style={{ background: dotColor(isOpen, runtime[t.id]?.status) }}
                />
                <div className="meta">
                  <div className="name">{t.title}</div>
                  <div className="sub">{dir}</div>
                </div>
                <span
                  className="close"
                  title={isOpen ? "关闭会话" : "删除历史记录"}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isOpen) {
                      closeTab(t.id);
                    } else if (
                      confirm(`删除历史会话「${t.title}」？对话文件不会被删除。`)
                    ) {
                      deleteHistory(t.id);
                    }
                  }}
                >
                  ×
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
