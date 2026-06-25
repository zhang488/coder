import { useState } from "react";
import { useTabsStore } from "../stores/tabs";
import { PROVIDERS } from "../lib/providers";

interface SidebarProps {
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
 * 左侧边栏：新建会话、搜索、统一会话列表（打开的与历史合并）。
 * - 打开的会话：指示灯亮，点击切换，× 关闭（移入历史）
 * - 历史会话：指示灯灭，点击恢复续接，× 彻底删除
 */
export default function Sidebar({ onNewTab, onCollapse }: SidebarProps) {
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
  // 打开的在前，历史在后，合并为单一列表
  const items = [...tabs, ...history].filter(
    (t) =>
      !kw ||
      t.title.toLowerCase().includes(kw) ||
      t.cwd.toLowerCase().includes(kw),
  );

  return (
    <div className="sidebar">
      <div className="sidebar-head">
        <span className="brand">AI Coder</span>
        <button className="icon-btn" title="折叠侧边栏" onClick={onCollapse}>
          «
        </button>
      </div>

      <button className="new-session" onClick={onNewTab}>
        ＋ 新建会话
      </button>

      <input
        className="search"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="搜索会话…"
      />

      <div className="section-title">会话</div>
      <div className="session-list">
        {items.length === 0 ? (
          <div className="hint">{kw ? "无匹配会话" : "暂无会话"}</div>
        ) : (
          items.map((t) => {
            const isOpen = openIds.has(t.id);
            return (
              <div
                key={t.id}
                className={`session-item ${t.id === activeId ? "active" : ""} ${
                  isOpen ? "" : "closed"
                }`}
                onClick={() => (isOpen ? setActive(t.id) : reopenTab(t.id))}
                title={
                  isOpen ? t.cwd : `${t.cwd}\n点击恢复并续接上次对话`
                }
              >
                <span
                  className="dot"
                  style={{ background: dotColor(isOpen, runtime[t.id]?.status) }}
                />
                <div className="meta">
                  <div className="name">{t.title}</div>
                  <div className="sub">
                    {PROVIDERS[t.provider]?.label ?? t.provider} · {t.cwd}
                  </div>
                </div>
                <span
                  className="close"
                  title={isOpen ? "关闭会话" : "删除历史记录"}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isOpen) {
                      closeTab(t.id);
                    } else if (
                      confirm(
                        `删除历史会话「${t.title}」？对话文件不会被删除。`,
                      )
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
