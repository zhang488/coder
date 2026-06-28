mod agy;
mod db;
mod pty;
mod tray;

use pty::PtyManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(PtyManager::default())
        .setup(|app| {
            // 初始化 SQLite 并托管连接
            let database = db::init(app.handle()).map_err(|e| std::io::Error::other(e))?;
            app.manage(database);
            // 构建系统托盘
            tray::setup_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            db::tabs_list,
            db::history_list,
            db::tab_create,
            db::tab_update,
            db::tab_set_active,
            db::tab_close,
            db::tab_reopen,
            db::tab_delete,
            db::setting_get,
            db::setting_set,
            tray::hide_to_tray,
            tray::quit_app,
            agy::agy_list_conversations,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
