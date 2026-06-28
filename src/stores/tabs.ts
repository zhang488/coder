import { create } from "zustand";
import {
  type TabRecord,
  tabsList,
  historyList,
  tabCreate,
  tabUpdate,
  tabClose,
  tabReopen,
  tabDelete,
  tabSetActive,
} from "../lib/db";
import { killPty } from "../lib/pty";
import type { LaunchMode } from "../lib/providers";
import { agyListConversations } from "../lib/antigravity";

/** 进程运行状态（仅前端运行时，不持久化） */
export type RunStatus = "starting" | "running" | "exited";

interface TabRuntime {
  status: RunStatus;
  exitCode: number | null;
  /** 该标签当前的 PTY 句柄 id（运行时） */
  ptyId: string | null;
  /** 启动模式：决定用 --session-id 还是 --resume */
  mode: LaunchMode;
}

const freshRuntime = (mode: LaunchMode): TabRuntime => ({
  status: "starting",
  exitCode: null,
  ptyId: null,
  mode,
});

/** 正在进行会话 id 捕获轮询的定时器，key 为 tab.id */
const captureTimers = new Map<string, ReturnType<typeof setInterval>>();

interface TabsState {
  tabs: TabRecord[];
  /** 历史会话（已关闭，可恢复） */
  history: TabRecord[];
  activeId: string | null;
  /** 各标签的运行时状态，key 为 tab.id */
  runtime: Record<string, TabRuntime>;

  loadAll: () => Promise<void>;
  loadHistory: () => Promise<void>;
  addTab: (provider: string, cwd: string, title: string) => Promise<void>;
  closeTab: (id: string) => Promise<void>;
  reopenTab: (id: string) => Promise<void>;
  deleteHistory: (id: string) => Promise<void>;
  setActive: (id: string) => Promise<void>;
  setRuntime: (id: string, patch: Partial<TabRuntime>) => void;
  /** 回填某标签解析/捕获到的真实会话 id */
  patchSessionId: (id: string, sessionId: string) => void;
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  history: [],
  activeId: null,
  runtime: {},

  async loadAll() {
    const [tabs, history] = await Promise.all([tabsList(), historyList()]);
    const active = tabs.find((t) => t.isActive) ?? tabs[0] ?? null;
    const runtime: Record<string, TabRuntime> = {};
    // 重启恢复的标签都已有对话 → 用 resume 续接（antigravity 用已捕获的真实 id）
    for (const t of tabs) runtime[t.id] = freshRuntime("resume");
    set({ tabs, history, activeId: active?.id ?? null, runtime });
  },

  async loadHistory() {
    const history = await historyList();
    set({ history });
  },

  async addTab(provider, cwd, title) {
    // antigravity：启动前快照现有会话，用于稍后捕获本次新建的真实会话 id
    const snapshot =
      provider === "antigravity" ? await agyListConversations() : [];
    const rec = await tabCreate(provider, cwd, title);
    set((s) => ({
      tabs: [...s.tabs, rec],
      // 新建会话 → new 模式（claude 用 --session-id，antigravity 直接启动）
      runtime: { ...s.runtime, [rec.id]: freshRuntime("new") },
    }));
    await get().setActive(rec.id);
    if (provider === "antigravity") {
      startAgyCapture(rec.id, snapshot, get);
    }
  },

  async closeTab(id) {
    stopAgyCapture(id);
    const rt = get().runtime[id];
    if (rt?.ptyId) await killPty(rt.ptyId).catch(() => {});
    await tabClose(id); // 软关闭：移入历史
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      const runtime = { ...s.runtime };
      delete runtime[id];
      let activeId = s.activeId;
      if (activeId === id) {
        const idx = s.tabs.findIndex((t) => t.id === id);
        const next = tabs[idx] ?? tabs[idx - 1] ?? null;
        activeId = next?.id ?? null;
      }
      return { tabs, runtime, activeId };
    });
    const activeId = get().activeId;
    if (activeId) await tabSetActive(activeId).catch(() => {});
    await get().loadHistory();
  },

  async reopenTab(id) {
    const rec = await tabReopen(id);
    set((s) => ({
      tabs: [...s.tabs, rec],
      history: s.history.filter((h) => h.id !== id),
      // 恢复历史会话 → resume 续接（antigravity 用已捕获的真实 id；无则 --continue）
      runtime: { ...s.runtime, [rec.id]: freshRuntime("resume") },
    }));
    await get().setActive(rec.id);
    // 历史会话从未捕获到 id（旧数据/未发消息）→ 再尝试捕获一次
    if (rec.provider === "antigravity" && !rec.sessionId) {
      const snapshot = await agyListConversations();
      startAgyCapture(rec.id, snapshot, get);
    }
  },

  async deleteHistory(id) {
    await tabDelete(id);
    set((s) => ({ history: s.history.filter((h) => h.id !== id) }));
  },

  async setActive(id) {
    set({ activeId: id });
    await tabSetActive(id).catch(() => {});
  },

  setRuntime(id, patch) {
    set((s) => ({
      runtime: {
        ...s.runtime,
        [id]: { ...(s.runtime[id] ?? freshRuntime("resume")), ...patch },
      },
    }));
  },

  patchSessionId(id, sessionId) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, sessionId } : t)),
    }));
  },
}));

/** 停止某标签的捕获轮询 */
function stopAgyCapture(id: string) {
  const timer = captureTimers.get(id);
  if (timer) {
    clearInterval(timer);
    captureTimers.delete(id);
  }
}

/**
 * 轮询捕获 agy 新建出的真实会话 id：对比启动前快照，新增的会话 id 即本标签会话。
 * 捕获到后写入 DB 并更新 store，供下次 `--conversation <id>` 精确恢复。
 * agy 可能在用户首次发消息后才落库，故持续轮询一段时间。
 */
function startAgyCapture(
  tabId: string,
  snapshot: string[],
  get: () => TabsState,
) {
  stopAgyCapture(tabId);
  const seen = new Set(snapshot);
  const maxTries = 120; // 120 * 3s ≈ 6 分钟
  let tries = 0;
  const timer = setInterval(async () => {
    tries += 1;
    // 标签已关闭则停止
    if (!get().tabs.some((t) => t.id === tabId) || tries > maxTries) {
      stopAgyCapture(tabId);
      return;
    }
    const list = await agyListConversations(); // 已按最近修改倒序
    const fresh = list.find((cid) => !seen.has(cid));
    if (fresh) {
      stopAgyCapture(tabId);
      get().patchSessionId(tabId, fresh);
      await tabUpdate(tabId, { sessionId: fresh }).catch(() => {});
    }
  }, 3000);
  captureTimers.set(tabId, timer);
}
