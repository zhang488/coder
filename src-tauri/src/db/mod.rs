//! 本地存储：SQLite（rusqlite，bundled）。
//!
//! 仅存应用元数据——标签、工作目录、绑定的 session_id、打开状态、设置；
//! **不存对话内容**（对话由 CLI 自身存于 JSONL，通过 session_id 续接）。

use std::sync::Mutex;

use rusqlite::{Connection, Row};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

/// 托管的数据库连接。
pub struct Db(pub Mutex<Connection>);

/// 标签记录，对应 `tabs` 表一行。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabRecord {
    pub id: String,
    pub provider: String,
    pub cwd: String,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
    pub title: String,
    #[serde(rename = "sortOrder")]
    pub sort_order: i64,
    #[serde(rename = "isActive")]
    pub is_active: bool,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}

const TAB_COLUMNS: &str =
    "id, provider, cwd, session_id, title, sort_order, is_active, updated_at";

fn row_to_tab(r: &Row) -> rusqlite::Result<TabRecord> {
    Ok(TabRecord {
        id: r.get(0)?,
        provider: r.get(1)?,
        cwd: r.get(2)?,
        session_id: r.get(3)?,
        title: r.get(4)?,
        sort_order: r.get(5)?,
        is_active: r.get::<_, i64>(6)? != 0,
        updated_at: r.get(7)?,
    })
}

/// 在 app_data_dir 下初始化数据库并建表。
pub fn init(app: &AppHandle) -> Result<Db, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取数据目录失败: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    let conn = Connection::open(dir.join("coder.db")).map_err(|e| format!("打开数据库失败: {e}"))?;

    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS tabs (
            id          TEXT PRIMARY KEY,
            provider    TEXT NOT NULL,
            cwd         TEXT NOT NULL,
            session_id  TEXT,
            title       TEXT NOT NULL,
            sort_order  INTEGER NOT NULL,
            is_active   INTEGER NOT NULL DEFAULT 0,
            is_open     INTEGER NOT NULL DEFAULT 1,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        "#,
    )
    .map_err(|e| format!("建表失败: {e}"))?;

    // 旧库升级：补 is_open 列（列已存在时报错，忽略）
    let _ = conn.execute(
        "ALTER TABLE tabs ADD COLUMN is_open INTEGER NOT NULL DEFAULT 1",
        [],
    );

    Ok(Db(Mutex::new(conn)))
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 列出打开中的标签（is_open=1），按 sort_order 升序。
#[tauri::command]
pub fn tabs_list(db: State<'_, Db>) -> Result<Vec<TabRecord>, String> {
    let conn = db.0.lock().unwrap();
    let sql = format!(
        "SELECT {TAB_COLUMNS} FROM tabs WHERE is_open = 1 ORDER BY sort_order ASC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_to_tab).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// 列出历史会话（已关闭，is_open=0），按更新时间倒序。
#[tauri::command]
pub fn history_list(db: State<'_, Db>) -> Result<Vec<TabRecord>, String> {
    let conn = db.0.lock().unwrap();
    let sql = format!(
        "SELECT {TAB_COLUMNS} FROM tabs WHERE is_open = 0 ORDER BY updated_at DESC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_to_tab).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// 新建标签：后端生成 id 与 session_id（uuid，用于 claude --session-id）。
#[tauri::command]
pub fn tab_create(
    db: State<'_, Db>,
    provider: String,
    cwd: String,
    title: String,
) -> Result<TabRecord, String> {
    let conn = db.0.lock().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    // 仅 claude 支持用我们指定的 id 创建会话（--session-id）；
    // antigravity 等由 CLI 自行生成会话 id，启动后再捕获回填，初始留空。
    let session_id = if provider == "claude" {
        Some(uuid::Uuid::new_v4().to_string())
    } else {
        None
    };
    let ts = now();
    let sort_order: i64 = conn
        .query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tabs", [], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO tabs (id, provider, cwd, session_id, title, sort_order, is_active, is_open, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 1, ?7, ?7)",
        rusqlite::params![id, provider, cwd, session_id, title, sort_order, ts],
    )
    .map_err(|e| e.to_string())?;
    Ok(TabRecord {
        id,
        provider,
        cwd,
        session_id,
        title,
        sort_order,
        is_active: false,
        updated_at: ts,
    })
}

/// 更新标签的可变字段（仅传入的字段会被更新）。
#[tauri::command]
pub fn tab_update(
    db: State<'_, Db>,
    id: String,
    title: Option<String>,
    session_id: Option<String>,
    sort_order: Option<i64>,
    is_active: Option<bool>,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let ts = now();
    if let Some(v) = title {
        conn.execute("UPDATE tabs SET title = ?1, updated_at = ?2 WHERE id = ?3", rusqlite::params![v, ts, id])
            .map_err(|e| e.to_string())?;
    }
    if let Some(v) = session_id {
        conn.execute("UPDATE tabs SET session_id = ?1, updated_at = ?2 WHERE id = ?3", rusqlite::params![v, ts, id])
            .map_err(|e| e.to_string())?;
    }
    if let Some(v) = sort_order {
        conn.execute("UPDATE tabs SET sort_order = ?1, updated_at = ?2 WHERE id = ?3", rusqlite::params![v, ts, id])
            .map_err(|e| e.to_string())?;
    }
    if let Some(v) = is_active {
        conn.execute("UPDATE tabs SET is_active = ?1, updated_at = ?2 WHERE id = ?3", rusqlite::params![v as i64, ts, id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 将某标签设为唯一激活（其余清除 active）。
#[tauri::command]
pub fn tab_set_active(db: State<'_, Db>, id: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("UPDATE tabs SET is_active = 0", [])
        .map_err(|e| e.to_string())?;
    conn.execute("UPDATE tabs SET is_active = 1 WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 软关闭标签：移入历史（is_open=0），保留记录与对话，可日后恢复。
#[tauri::command]
pub fn tab_close(db: State<'_, Db>, id: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE tabs SET is_open = 0, is_active = 0, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 从历史恢复标签：重新置为打开（is_open=1），返回完整记录用于续接。
#[tauri::command]
pub fn tab_reopen(db: State<'_, Db>, id: String) -> Result<TabRecord, String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "UPDATE tabs SET is_open = 1, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now(), id],
    )
    .map_err(|e| e.to_string())?;
    let sql = format!("SELECT {TAB_COLUMNS} FROM tabs WHERE id = ?1");
    conn.query_row(&sql, [&id], row_to_tab)
        .map_err(|e| e.to_string())
}

/// 彻底删除标签记录（用于清理历史；不删除官方对话 JSONL）。
#[tauri::command]
pub fn tab_delete(db: State<'_, Db>, id: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM tabs WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 读取设置项。
#[tauri::command]
pub fn setting_get(db: State<'_, Db>, key: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().unwrap();
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [&key], |r| r.get(0))
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other.to_string()),
        })
}

/// 写入设置项。
#[tauri::command]
pub fn setting_set(db: State<'_, Db>, key: String, value: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
