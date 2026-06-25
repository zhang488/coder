import { invoke, Channel } from "@tauri-apps/api/core";

/** PTY 后端推送的事件 */
export type PtyEvent =
  | { event: "output"; data: number[] }
  | { event: "exit"; code: number | null };

export interface SpawnOptions {
  /** 可执行文件，如 "claude" */
  program: string;
  /** 启动参数 */
  args?: string[];
  /** 工作目录 */
  cwd: string;
  /** 初始列数 */
  cols: number;
  /** 初始行数 */
  rows: number;
}

/**
 * 启动一个 PTY 进程。
 * @param opts 启动参数
 * @param onEvent 接收输出字节与退出事件的回调
 * @returns 后端分配的 PTY 句柄 id
 */
export async function spawnPty(
  opts: SpawnOptions,
  onEvent: (ev: PtyEvent) => void,
): Promise<string> {
  const channel = new Channel<PtyEvent>();
  channel.onmessage = onEvent;
  return await invoke<string>("pty_spawn", {
    program: opts.program,
    args: opts.args ?? [],
    cwd: opts.cwd,
    cols: opts.cols,
    rows: opts.rows,
    onEvent: channel,
  });
}

/** 向 PTY 写入输入（用户键入） */
export async function writePty(id: string, data: string): Promise<void> {
  await invoke("pty_write", { id, data });
}

/** 同步终端尺寸到 PTY */
export async function resizePty(
  id: string,
  cols: number,
  rows: number,
): Promise<void> {
  await invoke("pty_resize", { id, cols, rows });
}

/** 强制结束 PTY 进程 */
export async function killPty(id: string): Promise<void> {
  await invoke("pty_kill", { id });
}
