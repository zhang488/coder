//! 会话提问记录读取与打开目录。
//!
//! - claude：遍历 `~/.claude/projects/*/<session-id>.jsonl`，提取 user 文本提问。
//! - antigravity：读 `~/.gemini/antigravity-cli/history.jsonl`，按 workspace(cwd)
//!   或 conversationId 过滤 display 文本。

use tauri::{AppHandle, Manager};

/// 规整路径用于匹配：统一分隔符为反斜杠、去结尾分隔符、小写。
fn normalize(p: &str) -> String {
    p.replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

/// 提取 claude jsonl 某会话的用户提问（按时间顺序，去命令/工具噪声）。
fn claude_questions(app: &AppHandle, session_id: &str) -> Vec<String> {
    let Some(home) = app.path().home_dir().ok() else {
        return Vec::new();
    };
    let projects = home.join(".claude").join("projects");
    let target = format!("{session_id}.jsonl");

    // 在所有项目目录里找该 session 的 jsonl（不依赖 cwd 编码规则，更稳）
    let mut file: Option<std::path::PathBuf> = None;
    if let Ok(dirs) = std::fs::read_dir(&projects) {
        for d in dirs.flatten() {
            let cand = d.path().join(&target);
            if cand.is_file() {
                file = Some(cand);
                break;
            }
        }
    }
    let Some(file) = file else {
        return Vec::new();
    };
    let Ok(text) = std::fs::read_to_string(&file) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if v.get("type").and_then(|t| t.as_str()) != Some("user") {
            continue;
        }
        let content = v.get("message").and_then(|m| m.get("content"));
        let q = match content {
            Some(serde_json::Value::String(s)) => s.clone(),
            Some(serde_json::Value::Array(arr)) => arr
                .iter()
                .filter(|p| p.get("type").and_then(|t| t.as_str()) == Some("text"))
                .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join(" "),
            _ => String::new(),
        };
        let q = q.trim();
        // 过滤系统/命令/工具结果类消息
        if q.is_empty()
            || q.starts_with('<')
            || q.starts_with("[Request interrupted")
            || q.contains("tool_use_id")
        {
            continue;
        }
        out.push(q.to_string());
    }
    out
}

/// 提取 antigravity 某 cwd / 会话的用户提问（去重保序）。
fn antigravity_questions(app: &AppHandle, cwd: &str, session_id: Option<&str>) -> Vec<String> {
    let Some(home) = app.path().home_dir().ok() else {
        return Vec::new();
    };
    let file = home
        .join(".gemini")
        .join("antigravity-cli")
        .join("history.jsonl");
    let Ok(text) = std::fs::read_to_string(&file) else {
        return Vec::new();
    };

    let target_cwd = normalize(cwd);
    let mut out: Vec<String> = Vec::new();
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if v.get("type").and_then(|t| t.as_str()) == Some("slash_command") {
            continue;
        }
        // 优先按 conversationId 精确匹配，否则退回 workspace==cwd
        let matched = match session_id {
            Some(sid) if v.get("conversationId").is_some() => {
                v.get("conversationId").and_then(|c| c.as_str()) == Some(sid)
            }
            _ => v
                .get("workspace")
                .and_then(|w| w.as_str())
                .map(|w| normalize(w) == target_cwd)
                .unwrap_or(false),
        };
        if !matched {
            continue;
        }
        if let Some(d) = v.get("display").and_then(|d| d.as_str()) {
            let d = d.trim();
            if !d.is_empty() && !out.iter().any(|x| x == d) {
                out.push(d.to_string());
            }
        }
    }
    out
}

/// 读取某会话的用户提问记录（最多返回 limit 条，取最近的）。
#[tauri::command]
pub fn tab_questions(
    app: AppHandle,
    provider: String,
    cwd: String,
    session_id: Option<String>,
) -> Vec<String> {
    let mut list = match provider.as_str() {
        "claude" => session_id
            .as_deref()
            .map(|s| claude_questions(&app, s))
            .unwrap_or_default(),
        "antigravity" => antigravity_questions(&app, &cwd, session_id.as_deref()),
        _ => Vec::new(),
    };
    // 仅保留最近 30 条
    if list.len() > 30 {
        list = list.split_off(list.len() - 30);
    }
    list
}

/// 用系统文件管理器打开目录。
#[tauri::command]
pub fn open_dir(path: String) -> Result<(), String> {
    #[cfg(windows)]
    let r = std::process::Command::new("explorer").arg(&path).spawn();
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").arg(&path).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let r = std::process::Command::new("xdg-open").arg(&path).spawn();

    // explorer 打开成功也可能返回非零退出码，spawn 成功即视为已触发
    r.map(|_| ()).map_err(|e| format!("打开目录失败: {e}"))
}
