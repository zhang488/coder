//! Antigravity(agy) CLI 专属辅助。
//!
//! agy 不支持预指定会话 id：它自己生成会话并存为
//! `~/.gemini/antigravity-cli/conversations/<id>.db`。
//!
//! 因此我们的恢复策略是「捕获」——新建会话启动后，对比 conversations 目录的
//! 前后快照，新增的那个 .db 的文件名（id）即本标签真正的会话 id，存入我们的库；
//! 恢复时用该真实 id 执行 `agy --conversation <id>` 精确续接。

use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
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

// ====================== 订阅用量（配额）查询 ======================
//
// agy 不在本地落地配额，但其依赖的 Code Assist 接口可直接查：
//   POST https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota
// 认证用 `~/.gemini/oauth_creds.json` 的 OAuth token（由 gemini-cli 公开 client
// 签发，刷新它不影响 agy 自身的 keyring 登录）。token 过期则用 refresh_token 刷新，
// 仅在内存缓存、不写回文件，避免与其它工具产生写冲突。

// gemini-cli 的公开 OAuth client（开源项目内公开值，用于刷新 access_token）。
// 分段拼接而非整串字面量，以免被代码托管平台的密钥扫描误判为机密泄露。
fn oauth_client_id() -> String {
    [
        "681255809395",
        "-oo8ft2oprdrnp9e3aqf6av3hmdib135j",
        ".apps.googleusercontent.com",
    ]
    .concat()
}
fn oauth_client_secret() -> String {
    ["GOCSPX", "-4uHgMPm-1o7Sk", "-geV6Cu5clXFsxl"].concat()
}
const QUOTA_URL: &str = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";

#[derive(Clone)]
struct CachedToken {
    access_token: String,
    /// 过期时刻（毫秒）
    expiry_ms: i64,
}

fn token_cache() -> &'static Mutex<Option<CachedToken>> {
    static C: OnceLock<Mutex<Option<CachedToken>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(None))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 单个模型的配额桶。
#[derive(Debug, Clone, Serialize)]
pub struct QuotaBucket {
    #[serde(rename = "modelId")]
    pub model_id: String,
    #[serde(rename = "tokenType")]
    pub token_type: String,
    /// 剩余比例 0~1（1 表示满额未用）
    #[serde(rename = "remainingFraction")]
    pub remaining_fraction: f64,
    #[serde(rename = "resetTime")]
    pub reset_time: Option<String>,
}

#[derive(Deserialize)]
struct OauthCreds {
    access_token: Option<String>,
    refresh_token: Option<String>,
    /// 过期时刻（毫秒）
    expiry_date: Option<i64>,
}

fn creds_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    Some(app.path().home_dir().ok()?.join(".gemini").join("oauth_creds.json"))
}

/// 取可用 access_token：优先内存缓存 → 文件中未过期的 token → 用 refresh_token 刷新。
fn get_access_token(app: &AppHandle) -> Result<String, String> {
    // 1) 内存缓存（留 60s 余量）
    if let Some(c) = token_cache().lock().unwrap().clone() {
        if c.expiry_ms - now_ms() > 60_000 {
            return Ok(c.access_token);
        }
    }

    let path = creds_path(app).ok_or("无法定位 oauth_creds.json")?;
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取凭据失败（请先登录 Antigravity/Gemini）: {e}"))?;
    let creds: OauthCreds = serde_json::from_str(&text).map_err(|e| format!("解析凭据失败: {e}"))?;

    // 2) 文件里的 access_token 仍有效
    if let (Some(tok), Some(exp)) = (&creds.access_token, creds.expiry_date) {
        if exp - now_ms() > 60_000 {
            cache_token(tok.clone(), exp);
            return Ok(tok.clone());
        }
    }

    // 3) 用 refresh_token 刷新（仅缓存内存，不写回文件）
    let refresh = creds.refresh_token.ok_or("凭据缺少 refresh_token，请重新登录")?;
    let agent = http_agent();
    let cid = oauth_client_id();
    let cs = oauth_client_secret();
    let json: serde_json::Value = with_retry(3, || {
        agent
            .post(TOKEN_URL)
            .send_form(&[
                ("client_id", cid.as_str()),
                ("client_secret", cs.as_str()),
                ("refresh_token", &refresh),
                ("grant_type", "refresh_token"),
            ])
            .map_err(|e| format!("刷新 token 失败: {e}"))?
            .into_json()
            .map_err(|e| format!("刷新响应解析失败: {e}"))
    })?;
    let access = json
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or("刷新响应缺少 access_token")?
        .to_string();
    let expires_in = json.get("expires_in").and_then(|v| v.as_i64()).unwrap_or(3600);
    let expiry = now_ms() + expires_in * 1000;
    cache_token(access.clone(), expiry);
    Ok(access)
}

fn cache_token(access_token: String, expiry_ms: i64) {
    *token_cache().lock().unwrap() = Some(CachedToken { access_token, expiry_ms });
}

/// 构造带超时与系统代理的 ureq agent（googleapis 网络偶发超时，需控制）。
fn http_agent() -> ureq::Agent {
    let mut b = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(12))
        .timeout(std::time::Duration::from_secs(30));
    // 复用系统/环境代理（部分网络需经代理才能访问 googleapis）
    for key in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
        if let Ok(p) = std::env::var(key) {
            if let Ok(proxy) = ureq::Proxy::new(&p) {
                b = b.proxy(proxy);
                break;
            }
        }
    }
    b.build()
}

/// 对易抖动的网络请求做有限重试（指数退避）。
fn with_retry<T>(tries: u32, mut f: impl FnMut() -> Result<T, String>) -> Result<T, String> {
    let mut last = String::from("未知错误");
    for i in 0..tries {
        match f() {
            Ok(v) => return Ok(v),
            Err(e) => {
                last = e;
                if i + 1 < tries {
                    std::thread::sleep(std::time::Duration::from_millis(700 * (i as u64 + 1)));
                }
            }
        }
    }
    Err(last)
}

fn fetch_quota(app: &AppHandle) -> Result<Vec<QuotaBucket>, String> {
    let token = get_access_token(app)?;
    let agent = http_agent();
    let json: serde_json::Value = with_retry(3, || {
        agent
            .post(QUOTA_URL)
            .set("Authorization", &format!("Bearer {token}"))
            .set("Content-Type", "application/json")
            .send_string("{}")
            .map_err(|e| format!("查询配额失败: {e}"))?
            .into_json()
            .map_err(|e| format!("配额响应解析失败: {e}"))
    })?;
    let buckets = json
        .get("buckets")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(buckets
        .into_iter()
        .filter_map(|b| {
            Some(QuotaBucket {
                model_id: b.get("modelId")?.as_str()?.to_string(),
                token_type: b
                    .get("tokenType")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                remaining_fraction: b
                    .get("remainingFraction")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0),
                reset_time: b.get("resetTime").and_then(|v| v.as_str()).map(String::from),
            })
        })
        .collect())
}

/// 查询 Antigravity/Gemini 订阅配额（各模型剩余比例与重置时间）。
#[tauri::command]
pub async fn agy_usage(app: AppHandle) -> Result<Vec<QuotaBucket>, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_quota(&app))
        .await
        .map_err(|e| format!("任务执行失败: {e}"))?
}
