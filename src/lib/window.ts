import { invoke } from "@tauri-apps/api/core";

/** 隐藏主窗口到系统托盘（后台运行） */
export async function hideToTray(): Promise<void> {
  await invoke("hide_to_tray");
}

/** 退出应用 */
export async function quitApp(): Promise<void> {
  await invoke("quit_app");
}
