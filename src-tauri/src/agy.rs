//! Antigravity(agy) CLI 专属辅助。
//!
//! agy 不支持预指定会话 id：它自己生成会话并存为
//! `~/.gemini/antigravity-cli/conversations/<id>.db`。
//!
//! 因此我们的恢复策略是「捕获」——新建会话启动后，对比 conversations 目录的
//! 前后快照，新增的那个 .db 的文件名（id）即本标签真正的会话 id，存入我们的库；
//! 恢复时用该真实 id 执行 `agy --conversation <id>` 精确续接。

use std::time::SystemTime;

use tauri::{AppHandle, Manager};

fn conversations_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    let home = app.path().home_dir().ok()?;
    Some(
        home.join(".gemini")
            .join("antigravity-cli")
            .join("conversations"),
    )
}

/// 列出 agy 现有会话 id（按最近修改时间倒序）。
/// 前端在「新建会话」启动前后各取一次，差集即新建出的会话 id。
#[tauri::command]
pub fn agy_list_conversations(app: AppHandle) -> Vec<String> {
    let dir = match conversations_dir(&app) {
        Some(d) => d,
        None => return Vec::new(),
    };
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    let mut items: Vec<(String, SystemTime)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("db") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let mtime = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        items.push((stem.to_string(), mtime));
    }
    items.sort_by(|a, b| b.1.cmp(&a.1)); // 最新在前
    items.into_iter().map(|(id, _)| id).collect()
}
