import { create } from "zustand";
import {
  type TabRecord,
  tabsList,
  historyList,
  tabCreate,
  tabClose,
  tabReopen,
  tabDelete,
  tabSetActive,
} from "../lib/db";
import { killPty } from "../lib/pty";
import type { LaunchMode } from "../lib/providers";

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
    // 重启恢复的标签都已有对话 → 用 resume 续接
    for (const t of tabs) runtime[t.id] = freshRuntime("resume");
    set({ tabs, history, activeId: active?.id ?? null, runtime });
  },

  async loadHistory() {
    const history = await historyList();
    set({ history });
  },

  async addTab(provider, cwd, title) {
    const rec = await tabCreate(provider, cwd, title);
    set((s) => ({
      tabs: [...s.tabs, rec],
      // 新建会话 → 用 --session-id 创建
      runtime: { ...s.runtime, [rec.id]: freshRuntime("new") },
    }));
    await get().setActive(rec.id);
  },

  async closeTab(id) {
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
      // 恢复历史会话 → 用 --resume 续接对话
      runtime: { ...s.runtime, [rec.id]: freshRuntime("resume") },
    }));
    await get().setActive(rec.id);
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
}));
