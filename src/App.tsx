import { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import TabBar from "./components/TabBar";
import TerminalPane from "./components/TerminalPane";
import StatusBar from "./components/StatusBar";
import NewTabDialog from "./components/NewTabDialog";
import ErrorBoundary from "./components/ErrorBoundary";
import CloseDialog from "./components/CloseDialog";
import { useTabsStore } from "./stores/tabs";
import { providerProgram, buildArgs } from "./lib/providers";
import { settingGet, settingSet } from "./lib/db";
import { hideToTray, quitApp } from "./lib/window";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** 是否运行在 Tauri 桌面环境（非浏览器） */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export default function App() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const runtime = useTabsStore((s) => s.runtime);
  const loadAll = useTabsStore((s) => s.loadAll);
  const addTab = useTabsStore((s) => s.addTab);

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [lastCwd, setLastCwd] = useState<string | undefined>(undefined);
  const [collapsed, setCollapsed] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [provider, setProvider] = useState("claude");

  // 启动恢复：从 DB 读取标签布局（P2-3）
  useEffect(() => {
    (async () => {
      // 非 Tauri 环境（如浏览器里跑 pnpm dev）没有后端，提前给出提示
      if (!isTauri()) {
        setLoadError(
          "未检测到桌面后端。请用 `pnpm tauri dev` 启动桌面应用，而不是在浏览器打开。",
        );
        setLoaded(true);
        return;
      }
      try {
        await loadAll();
        setLastCwd((await settingGet("lastCwd")) ?? undefined);
      } catch (e) {
        setLoadError(`加载失败：${e}`);
      } finally {
        setLoaded(true);
      }
    })();
  }, [loadAll]);

  // 拦截窗口关闭：按记住的选择直接执行，否则弹询问对话框
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        const remembered = await settingGet("closeAction").catch(() => null);
        if (remembered === "tray") {
          await hideToTray();
        } else if (remembered === "quit") {
          await quitApp();
        } else {
          setShowClose(true);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  const handleCloseChoice = async (action: "tray" | "quit", remember: boolean) => {
    setShowClose(false);
    if (remember) await settingSet("closeAction", action).catch(() => {});
    if (action === "tray") await hideToTray();
    else await quitApp();
  };

  const handleConfirm = async (prov: string, cwd: string, title: string) => {
    setShowNew(false);
    setProvider(prov); // 同步切换器，使新会话出现在筛选后的列表中
    await addTab(prov, cwd, title);
    setLastCwd(cwd);
    await settingSet("lastCwd", cwd).catch(() => {});
  };

  if (!loaded) {
    return <div className="app loading">加载中…</div>;
  }

  if (loadError) {
    return (
      <div className="app loading">
        <p style={{ color: "#f48771", maxWidth: 480, textAlign: "center" }}>
          {loadError}
        </p>
        <code style={{ color: "#9d9d9d" }}>pnpm tauri dev</code>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="body">
        {collapsed ? (
          <button
            className="expand-btn"
            title="展开侧边栏"
            onClick={() => setCollapsed(false)}
          >
            »
          </button>
        ) : (
          <Sidebar
            provider={provider}
            onProviderChange={setProvider}
            onNewTab={() => setShowNew(true)}
            onCollapse={() => setCollapsed(true)}
          />
        )}

        <div className="main">
          <TabBar onNewTab={() => setShowNew(true)} />

          <div className="panes">
            {tabs.length === 0 ? (
              <div className="empty">
                <p>还没有会话</p>
                <button onClick={() => setShowNew(true)}>＋ 新建会话</button>
              </div>
            ) : (
              tabs.map((t) => (
                <ErrorBoundary key={t.id}>
                  <TerminalPane
                    tabId={t.id}
                    provider={t.provider}
                    program={providerProgram(t.provider)}
                    args={buildArgs(
                      t.provider,
                      t.sessionId,
                      runtime[t.id]?.mode ?? "resume",
                    )}
                    cwd={t.cwd}
                    active={t.id === activeId}
                  />
                </ErrorBoundary>
              ))
            )}
          </div>

          <StatusBar />
        </div>
      </div>

      {showNew && (
        <NewTabDialog
          defaultProvider={provider}
          defaultCwd={lastCwd}
          onConfirm={handleConfirm}
          onCancel={() => setShowNew(false)}
        />
      )}

      {showClose && (
        <CloseDialog
          onTray={(remember) => handleCloseChoice("tray", remember)}
          onQuit={(remember) => handleCloseChoice("quit", remember)}
          onCancel={() => setShowClose(false)}
        />
      )}
    </div>
  );
}
