//! PTY 进程管理：每个标签对应一个伪终端进程。
//!
//! 通过 `portable-pty` 启动真实 CLI 进程（Windows 走 ConPTY），
//! 后台线程读取输出并经 Tauri `Channel` 推送到前端；前端输入经
//! `pty_write` 写回；尺寸变化经 `pty_resize` 同步。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use tauri::State;
use tauri::ipc::Channel;

/// 推送给前端的 PTY 事件。
/// 序列化为 `{ event: "output", data: [..] }` 或 `{ event: "exit", code }`。
#[derive(Clone, Serialize)]
#[serde(tag = "event", rename_all = "lowercase")]
pub enum PtyEvent {
    Output { data: Vec<u8> },
    Exit { code: Option<i32> },
}

/// 单个 PTY 的句柄，保存写入端、主控端（用于 resize）与终止器。
struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    /// 子进程 pid，用于在 Windows 上 taskkill 整个进程树
    #[allow(dead_code)]
    pid: Option<u32>,
}

/// 全局 PTY 管理器，作为 Tauri 托管状态。
#[derive(Default)]
pub struct PtyManager {
    map: Mutex<HashMap<String, PtyHandle>>,
}

/// 在 PATH 中把命令名解析为可直接执行的 `.exe` 全路径。
/// - 已带路径分隔符：直接判断其存在性（必要时补 `.exe`）。
/// - 纯命令名：遍历 PATH 查找 `<program>.exe`。
/// 找不到返回 None，调用方回退到 `cmd /c`（适配 .cmd/.bat 脚本）。
#[cfg(windows)]
fn resolve_exe(program: &str) -> Option<std::path::PathBuf> {
    use std::path::{Path, PathBuf};
    let p = Path::new(program);
    if program.contains('\\') || program.contains('/') {
        if p.is_file() {
            return Some(p.to_path_buf());
        }
        let exe = p.with_extension("exe");
        return exe.is_file().then_some(exe);
    }
    let has_ext = p.extension().is_some();
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        // 命令本身可能已带扩展名
        if has_ext {
            let cand = dir.join(program);
            if cand.is_file() {
                return Some(cand);
            }
        }
        let cand: PathBuf = dir.join(format!("{program}.exe"));
        if cand.is_file() {
            return Some(cand);
        }
    }
    None
}

/// 启动一个 PTY 进程，返回后端分配的句柄 id。
#[tauri::command]
pub fn pty_spawn(
    state: State<'_, PtyManager>,
    program: String,
    args: Vec<String>,
    cwd: String,
    cols: u16,
    rows: u16,
    on_event: Channel<PtyEvent>,
) -> Result<String, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty 失败: {e}"))?;

    // Windows 进程启动策略：
    // 1) 优先在 PATH 中解析出真正的 `<program>.exe` 并【直接启动】。
    //    这样像 agy.exe / claude.exe 这类原生程序不经 cmd 中转——避免多一层
    //    cmd 进程改变进程上下文，导致 Windows 凭据管理器(keyring)访问异常
    //    （表现为 agy 每次启动都要求重新登录 Google 账号）。
    // 2) 解析不到 .exe（如 npm 安装的 .cmd/.bat 脚本）才回退 `cmd.exe /c`，
    //    让其按 PATHEXT 解析（否则 CreateProcessW 报 os error 193）。
    #[cfg(windows)]
    let mut cmd = {
        match resolve_exe(&program) {
            Some(exe) => {
                let mut c = CommandBuilder::new(exe);
                for a in &args {
                    c.arg(a);
                }
                c
            }
            None => {
                let mut c = CommandBuilder::new("cmd.exe");
                c.arg("/c");
                c.arg(&program);
                for a in &args {
                    c.arg(a);
                }
                c
            }
        }
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = CommandBuilder::new(&program);
        for a in &args {
            c.arg(a);
        }
        c
    };
    cmd.cwd(&cwd);

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("启动进程失败 ({program}): {e}"))?;

    // slave 在 spawn 后即可释放，避免句柄泄漏导致 EOF 收不到
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("获取输出流失败: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("获取输入流失败: {e}"))?;
    let killer = child.clone_killer();
    let pid = child.process_id();

    let id = uuid::Uuid::new_v4().to_string();

    // 读线程：持续读取 PTY 输出，EOF 后等待子进程退出并上报退出码
    let event_channel = on_event.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    if event_channel
                        .send(PtyEvent::Output {
                            data: buf[..n].to_vec(),
                        })
                        .is_err()
                    {
                        break; // 前端通道已关闭
                    }
                }
                Err(_) => break,
            }
        }
        let code = child.wait().ok().map(|s| s.exit_code() as i32);
        let _ = event_channel.send(PtyEvent::Exit { code });
    });

    state.map.lock().unwrap().insert(
        id.clone(),
        PtyHandle {
            master: pair.master,
            writer,
            killer,
            pid,
        },
    );

    Ok(id)
}

/// 向 PTY 写入输入。
#[tauri::command]
pub fn pty_write(state: State<'_, PtyManager>, id: String, data: String) -> Result<(), String> {
    let mut map = state.map.lock().unwrap();
    let handle = map.get_mut(&id).ok_or("PTY 不存在")?;
    handle
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("写入失败: {e}"))?;
    handle.writer.flush().map_err(|e| format!("flush 失败: {e}"))?;
    Ok(())
}

/// 同步终端尺寸到 PTY。
#[tauri::command]
pub fn pty_resize(
    state: State<'_, PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let map = state.map.lock().unwrap();
    let handle = map.get(&id).ok_or("PTY 不存在")?;
    handle
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize 失败: {e}"))?;
    Ok(())
}

/// 强制结束 PTY 进程并清理句柄。
#[tauri::command]
pub fn pty_kill(state: State<'_, PtyManager>, id: String) -> Result<(), String> {
    let mut map = state.map.lock().unwrap();
    if let Some(mut handle) = map.remove(&id) {
        // Windows 上 cmd /c 启动的进程为父进程，需 taskkill /T 杀整棵树，
        // 否则 node 等子进程会残留为僵尸。
        #[cfg(windows)]
        if let Some(pid) = handle.pid {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
        let _ = handle.killer.kill();
    }
    Ok(())
}
