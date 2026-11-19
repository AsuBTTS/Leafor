//! Leafor native shell.
//!
//! Responsibilities kept intentionally small (see technical design §2.1):
//! scoped workspace file access, atomic writes, hashing, native dialogs,
//! shell integration and the rebuildable SQLite index (plugin-sql).
//!
//! Portable data: Leafor stores its own settings, index database and WebView
//! profile in `LeaforData/` next to the executable when that folder is
//! writable, so nothing is written to the system drive's AppData.

pub mod commands;
pub mod index;
pub mod scope;

use std::path::PathBuf;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// `<exe dir>/LeaforData` if writable, otherwise None (fall back to AppData).
pub fn portable_data_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?.join("LeaforData");
    std::fs::create_dir_all(&dir).ok()?;
    let probe = dir.join(".write-test");
    std::fs::write(&probe, b"ok").ok()?;
    let _ = std::fs::remove_file(probe);
    Some(dir)
}

#[tauri::command]
fn data_dir(app: tauri::AppHandle) -> String {
    app.state::<DataDir>().0.display().to_string()
}

pub struct DataDir(pub PathBuf);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // In debug builds the exe lives in target/, which is fine for development.
    let portable = portable_data_dir();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(commands::AppState::default())
        .setup(move |app| {
            let dir = match &portable {
                Some(d) => d.clone(),
                None => app.path().app_data_dir()?,
            };
            std::fs::create_dir_all(&dir)?;
            app.manage(DataDir(dir.clone()));
            app.manage(index::IndexDb::new(dir.join("leafor-index.db")));
            commands::set_config_dir(dir.clone());

            let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Leafor")
                .inner_size(1440.0, 900.0)
                .min_inner_size(960.0, 600.0)
                .decorations(false)
                .center()
                .visible(true);
            // Keep the WebView profile (cache, storage) inside the data dir too.
            builder = builder.data_directory(dir.join("webview"));
            builder.build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            data_dir,
            index::index_execute,
            index::index_select,
            index::index_batch,
            index::index_reset,
            commands::pick_directory,
            commands::pick_files,
            commands::pick_save_file,
            commands::pick_export_dir,
            commands::ws_open,
            commands::ws_close,
            commands::recent_list,
            commands::recent_remove,
            commands::recent_rename,
            commands::fs_read_text,
            commands::fs_read_bytes,
            commands::fs_write_text,
            commands::fs_write_bytes,
            commands::fs_list,
            commands::fs_stat,
            commands::fs_mkdir,
            commands::fs_hash,
            commands::fs_copy,
            commands::fs_move,
            commands::fs_remove,
            commands::fs_abs_path,
            commands::import_copy,
            commands::import_read_bytes,
            commands::import_stat,
            commands::export_write_text,
            commands::export_write_bytes,
            commands::export_copy_from_ws,
            commands::export_mkdir,
            commands::open_in_system,
            commands::reveal_in_explorer,
            commands::reveal_export,
            commands::open_url,
            commands::app_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Leafor");
}
