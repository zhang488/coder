import { invoke } from "@tauri-apps/api/core";

/** 标签记录，对应后端 tabs 表 */
export interface TabRecord {
  id: string;
  provider: string;
  cwd: string;
  sessionId: string | null;
  title: string;
  sortOrder: number;
  isActive: boolean;
  updatedAt: number;
  model: string | null;
  skipPermissions: boolean;
}

export async function tabsList(): Promise<TabRecord[]> {
  return invoke<TabRecord[]>("tabs_list");
}

/** 历史会话（已关闭，可恢复续接） */
export async function historyList(): Promise<TabRecord[]> {
  return invoke<TabRecord[]>("history_list");
}

export async function tabCreate(
  provider: string,
  cwd: string,
  title: string,
  model: string | null,
  skipPermissions: boolean,
): Promise<TabRecord> {
  return invoke<TabRecord>("tab_create", {
    provider,
    cwd,
    title,
    model,
    skipPermissions,
  });
}

export async function tabUpdate(
  id: string,
  fields: {
    title?: string;
    sessionId?: string;
    sortOrder?: number;
    isActive?: boolean;
  },
): Promise<void> {
  await invoke("tab_update", {
    id,
    title: fields.title ?? null,
    sessionId: fields.sessionId ?? null,
    sortOrder: fields.sortOrder ?? null,
    isActive: fields.isActive ?? null,
  });
}

export async function tabSetActive(id: string): Promise<void> {
  await invoke("tab_set_active", { id });
}

/** 软关闭：移入历史，保留对话 */
export async function tabClose(id: string): Promise<void> {
  await invoke("tab_close", { id });
}

/** 从历史恢复，返回完整记录 */
export async function tabReopen(id: string): Promise<TabRecord> {
  return invoke<TabRecord>("tab_reopen", { id });
}

/** 彻底删除历史记录 */
export async function tabDelete(id: string): Promise<void> {
  await invoke("tab_delete", { id });
}

export async function settingGet(key: string): Promise<string | null> {
  return invoke<string | null>("setting_get", { key });
}

export async function settingSet(key: string, value: string): Promise<void> {
  await invoke("setting_set", { key, value });
}
