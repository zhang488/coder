import { invoke } from "@tauri-apps/api/core";

/**
 * 列出 agy 现有会话 id（按最近修改时间倒序）。
 * 用于「新建会话」前后快照对比，捕获本次新建出的真实会话 id。
 */
export async function agyListConversations(): Promise<string[]> {
  try {
    return await invoke<string[]>("agy_list_conversations");
  } catch {
    return [];
  }
}
