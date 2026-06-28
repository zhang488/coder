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

/** 单个模型的订阅配额桶 */
export interface QuotaBucket {
  modelId: string;
  tokenType: string;
  /** 剩余比例 0~1（1 表示满额未用） */
  remainingFraction: number;
  resetTime: string | null;
}

/** 查询 Antigravity/Gemini 订阅配额（各模型剩余比例与重置时间） */
export async function agyUsage(): Promise<QuotaBucket[]> {
  return invoke<QuotaBucket[]>("agy_usage");
}
