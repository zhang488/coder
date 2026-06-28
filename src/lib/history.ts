import { invoke } from "@tauri-apps/api/core";

/** 读取某会话的用户提问记录 */
export async function tabQuestions(
  provider: string,
  cwd: string,
  sessionId: string | null,
): Promise<string[]> {
  try {
    return await invoke<string[]>("tab_questions", {
      provider,
      cwd,
      sessionId,
    });
  } catch {
    return [];
  }
}

/** 用系统文件管理器打开目录 */
export async function openDir(path: string): Promise<void> {
  await invoke("open_dir", { path });
}
