//! Tauri commands exposed to the frontend. All file access goes through the
//! currently opened, user-authorised workspace root (see `scope.rs`), or
//! through external paths the user picked in a native dialog this session.

use crate::scope::{self, Result, ScopeError};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
pub struct AppState {
    pub root: Mutex<Option<PathBuf>>,
    /// External files/dirs the user picked via a dialog in this session.
    pub granted_read: Mutex<HashSet<PathBuf>>,
    /// Export targets (files or dirs) the user picked via a dialog.
    pub granted_write: Mutex<HashSet<PathBuf>>,
    /// Directories picked via the workspace folder dialog this session.
    pub picked_dirs: Mutex<HashSet<PathBuf>>,
}

impl AppState {
    fn root(&self) -> Result<PathBuf> {
        self.root.lock().unwrap().clone().ok_or(ScopeError::NoWorkspace)
    }
    fn ws(&self, rel: &str) -> Result<PathBuf> {
        scope::resolve(&self.root()?, rel)
    }
    fn check_read(&self, abs: &str) -> Result<PathBuf> {
        let p = scope::canonical(Path::new(abs)).map_err(|_| ScopeError::NotGranted(abs.into()))?;
        let g = self.granted_read.lock().unwrap();
        if g.iter().any(|x| &p == x || p.starts_with(x)) {
            Ok(p)
        } else {
            Err(ScopeError::NotGranted(abs.into()))
        }
    }
    fn check_write(&self, abs: &str) -> Result<PathBuf> {
        let raw = PathBuf::from(abs);
        if raw.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            return Err(ScopeError::InvalidPath(abs.into()));
        }
        let g = self.granted_write.lock().unwrap();
        // Match the closest existing ancestor (target may not exist yet).
        let mut probe = raw.clone();
        loop {
            if let Ok(c) = scope::canonical(&probe) {
                let full = c.join(raw.strip_prefix(&probe).unwrap_or(Path::new("")));
                if g.iter().any(|x| &full == x || full.starts_with(x)) {
                    return Ok(full);
                }
                return Err(ScopeError::NotGranted(abs.into()));
            }
            match probe.parent() {
                Some(p) => probe = p.to_path_buf(),
                None => return Err(ScopeError::NotGranted(abs.into())),
            }
        }
    }
}

static CONFIG_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

pub fn set_config_dir(dir: PathBuf) {
    let _ = CONFIG_DIR.set(dir);
}

fn recent_file(app: &AppHandle) -> Option<PathBuf> {
    CONFIG_DIR
        .get()
        .cloned()
        .or_else(|| app.path().app_config_dir().ok())
        .map(|d| d.join("recent-workspaces.json"))
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RecentWorkspace {
    pub path: String,
    pub title: String,
    pub opened_at: String,
}

fn read_recent(app: &AppHandle) -> Vec<RecentWorkspace> {
    recent_file(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_recent(app: &AppHandle, list: &[RecentWorkspace]) {
    if let Some(p) = recent_file(app) {
        let _ = scope::atomic_write(&p, serde_json::to_string_pretty(list).unwrap_or_default().as_bytes());
    }
}

// ---------------------------------------------------------------- dialogs

#[derive(Deserialize)]
pub struct Filter {
    name: String,
    extensions: Vec<String>,
}

fn path_of(fp: tauri_plugin_dialog::FilePath) -> Option<PathBuf> {
    fp.into_path().ok()
}

#[tauri::command]
pub async fn pick_directory(app: AppHandle, state: State<'_, AppState>, title: String) -> Result<Option<String>> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().set_title(title).blocking_pick_folder()
    })
    .await
    .map_err(|e| ScopeError::Io(std::io::Error::other(e.to_string())))?;
    let Some(p) = picked.and_then(path_of) else { return Ok(None) };
    let c = scope::canonical(&p)?;
    state.picked_dirs.lock().unwrap().insert(c.clone());
    Ok(Some(c.display().to_string()))
}

#[tauri::command]
pub async fn pick_files(
    app: AppHandle,
    state: State<'_, AppState>,
    title: String,
    filters: Vec<Filter>,
    multiple: bool,
) -> Result<Vec<String>> {
    let app2 = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut d = app2.dialog().file().set_title(title);
        for f in &filters {
            let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
            d = d.add_filter(&f.name, &exts);
        }
        if multiple {
            d.blocking_pick_files().unwrap_or_default()
        } else {
            d.blocking_pick_file().map(|x| vec![x]).unwrap_or_default()
        }
    })
    .await
    .map_err(|e| ScopeError::Io(std::io::Error::other(e.to_string())))?;
    let mut out = Vec::new();
    let mut g = state.granted_read.lock().unwrap();
    for fp in picked {
        if let Some(p) = path_of(fp) {
            if let Ok(c) = scope::canonical(&p) {
                g.insert(c.clone());
                // Allow sibling resources (e.g. images referenced by a Markdown file).
                if c.extension().map(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown")).unwrap_or(false) {
                    if let Some(parent) = c.parent() {
                        g.insert(parent.to_path_buf());
                    }
                }
                out.push(c.display().to_string());
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn pick_save_file(
    app: AppHandle,
    state: State<'_, AppState>,
    title: String,
    default_name: String,
    filters: Vec<Filter>,
) -> Result<Option<String>> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut d = app.dialog().file().set_title(title).set_file_name(default_name);
        for f in &filters {
            let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
            d = d.add_filter(&f.name, &exts);
        }
        d.blocking_save_file()
    })
    .await
    .map_err(|e| ScopeError::Io(std::io::Error::other(e.to_string())))?;
    let Some(p) = picked.and_then(path_of) else { return Ok(None) };
    let parent = p.parent().and_then(|x| scope::canonical(x).ok());
    let full = match (parent, p.file_name()) {
        (Some(par), Some(n)) => par.join(n),
        _ => return Ok(None),
    };
    state.granted_write.lock().unwrap().insert(full.clone());
    Ok(Some(full.display().to_string()))
}

#[tauri::command]
pub async fn pick_export_dir(app: AppHandle, state: State<'_, AppState>, title: String) -> Result<Option<String>> {
    let picked = tauri::async_runtime::spawn_blocking(move || app.dialog().file().set_title(title).blocking_pick_folder())
        .await
        .map_err(|e| ScopeError::Io(std::io::Error::other(e.to_string())))?;
    let Some(p) = picked.and_then(path_of) else { return Ok(None) };
    let c = scope::canonical(&p)?;
    state.granted_write.lock().unwrap().insert(c.clone());
    Ok(Some(c.display().to_string()))
}

// ---------------------------------------------------------------- workspace

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedWorkspace {
    root: String,
}

/// Open a workspace root. Only directories the user picked in this session
/// (pick_directory result passed straight back) or ones previously recorded
/// in the recent list are accepted.
#[tauri::command]
pub fn ws_open(app: AppHandle, state: State<'_, AppState>, root: String, title: Option<String>, create: bool) -> Result<OpenedWorkspace> {
    let raw = PathBuf::from(&root);
    if raw.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err(ScopeError::InvalidPath(root));
    }
    // Authorisation: picked this session (or a direct child of a picked dir
    // when creating a new workspace), or previously opened (recent list).
    {
        let picked = state.picked_dirs.lock().unwrap();
        let recent = read_recent(&app);
        let probe = if create { raw.parent().map(|p| p.to_path_buf()).unwrap_or_default() } else { raw.clone() };
        let probe_c = scope::canonical(&probe).ok();
        let raw_c = scope::canonical(&raw).ok();
        let ok = probe_c.as_ref().map(|p| picked.contains(p)).unwrap_or(false)
            || raw_c.as_ref().map(|p| picked.contains(p)).unwrap_or(false)
            || raw_c.as_ref().map(|p| recent.iter().any(|r| Path::new(&r.path) == p)).unwrap_or(false);
        if !ok {
            return Err(ScopeError::NotGranted(root));
        }
    }
    if create {
        fs::create_dir_all(&raw)?;
    }
    let canon = scope::canonical(&raw)?;
    if !canon.is_dir() {
        return Err(ScopeError::InvalidPath(root));
    }
    // Refuse to use a filesystem root or the user's home directory as workspace.
    if canon.parent().is_none() || dirs_home().map(|h| h == canon).unwrap_or(false) {
        return Err(ScopeError::InvalidPath("不能将磁盘根目录或用户主目录作为工作区".into()));
    }
    *state.root.lock().unwrap() = Some(canon.clone());
    let _ = app.asset_protocol_scope().allow_directory(&canon, true);
    let mut recent = read_recent(&app);
    let path_s = canon.display().to_string();
    let existing_title = recent.iter().find(|r| r.path == path_s).map(|r| r.title.clone());
    recent.retain(|r| r.path != path_s);
    recent.insert(
        0,
        RecentWorkspace {
            path: path_s.clone(),
            title: title.or(existing_title).unwrap_or_else(|| canon.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()),
            opened_at: now_iso(),
        },
    );
    recent.truncate(12);
    write_recent(&app, &recent);
    Ok(OpenedWorkspace { root: path_s })
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .and_then(|p| scope::canonical(&p).ok())
}

fn now_iso() -> String {
    let secs = std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    secs.to_string()
}

#[tauri::command]
pub fn ws_close(state: State<'_, AppState>) {
    *state.root.lock().unwrap() = None;
}

#[tauri::command]
pub fn recent_list(app: AppHandle) -> Vec<RecentWorkspace> {
    read_recent(&app)
}

#[tauri::command]
pub fn recent_remove(app: AppHandle, path: String) {
    let mut r = read_recent(&app);
    r.retain(|x| x.path != path);
    write_recent(&app, &r);
}

#[tauri::command]
pub fn recent_rename(app: AppHandle, path: String, title: String) {
    let mut r = read_recent(&app);
    for x in r.iter_mut() {
        if x.path == path {
            x.title = title.clone();
        }
    }
    write_recent(&app, &r);
}

// ---------------------------------------------------------------- fs (workspace)

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    name: String,
    is_dir: bool,
    size: u64,
    mtime_ms: f64,
}

fn meta_entry(name: String, m: &fs::Metadata) -> Entry {
    Entry {
        name,
        is_dir: m.is_dir(),
        size: m.len(),
        mtime_ms: m
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as f64)
            .unwrap_or(0.0),
    }
}

#[tauri::command]
pub fn fs_read_text(state: State<'_, AppState>, path: String) -> Result<String> {
    let p = state.ws(&path)?;
    let bytes = fs::read(p)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
pub fn fs_read_bytes(state: State<'_, AppState>, path: String) -> Result<tauri::ipc::Response> {
    let p = state.ws(&path)?;
    Ok(tauri::ipc::Response::new(fs::read(p)?))
}

#[derive(Serialize)]
pub struct WriteResult {
    hash: String,
}

#[tauri::command]
pub fn fs_write_text(state: State<'_, AppState>, path: String, text: String, expected_hash: Option<String>) -> Result<WriteResult> {
    let p = state.ws(&path)?;
    let hash = scope::guarded_write(&p, text.as_bytes(), expected_hash.as_deref())?;
    Ok(WriteResult { hash })
}

fn header(req: &tauri::ipc::Request<'_>, key: &str) -> Result<String> {
    let v = req
        .headers()
        .get(key)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| ScopeError::InvalidPath(format!("missing header {key}")))?;
    percent_decode(v)
}

fn percent_decode(s: &str) -> Result<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let h = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|x| u8::from_str_radix(x, 16).ok());
            if let Some(b) = h {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).map_err(|_| ScopeError::InvalidPath(s.into()))
}

fn body_bytes(req: &tauri::ipc::Request<'_>) -> Result<Vec<u8>> {
    match req.body() {
        tauri::ipc::InvokeBody::Raw(b) => Ok(b.clone()),
        tauri::ipc::InvokeBody::Json(_) => Err(ScopeError::InvalidPath("expected raw body".into())),
    }
}

#[tauri::command]
pub fn fs_write_bytes(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<WriteResult> {
    let rel = header(&request, "x-path")?;
    let p = state.ws(&rel)?;
    let bytes = body_bytes(&request)?;
    scope::atomic_write(&p, &bytes)?;
    Ok(WriteResult { hash: scope::sha256_bytes(&bytes) })
}

#[tauri::command]
pub fn fs_list(state: State<'_, AppState>, path: String) -> Result<Vec<Entry>> {
    let p = state.ws(&path)?;
    if !p.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for e in fs::read_dir(p)? {
        let e = e?;
        let name = e.file_name().to_string_lossy().to_string();
        if name.contains(".leafor-tmp-") {
            continue;
        }
        if let Ok(m) = e.metadata() {
            out.push(meta_entry(name, &m));
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
pub fn fs_stat(state: State<'_, AppState>, path: String) -> Result<Option<Entry>> {
    let p = state.ws(&path)?;
    match fs::metadata(&p) {
        Ok(m) => Ok(Some(meta_entry(p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(), &m))),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn fs_mkdir(state: State<'_, AppState>, path: String) -> Result<()> {
    fs::create_dir_all(state.ws(&path)?)?;
    Ok(())
}

#[tauri::command]
pub fn fs_hash(state: State<'_, AppState>, path: String) -> Result<String> {
    scope::sha256_file(&state.ws(&path)?)
}

#[tauri::command]
pub fn fs_copy(state: State<'_, AppState>, from: String, to: String) -> Result<()> {
    let a = state.ws(&from)?;
    let b = state.ws(&to)?;
    if let Some(parent) = b.parent() {
        fs::create_dir_all(parent)?;
    }
    if a.is_dir() {
        scope::copy_dir_recursive(&a, &b)?;
    } else {
        fs::copy(a, b)?;
    }
    Ok(())
}

#[tauri::command]
pub fn fs_move(state: State<'_, AppState>, from: String, to: String) -> Result<()> {
    let a = state.ws(&from)?;
    let b = state.ws(&to)?;
    if b.exists() {
        return Err(ScopeError::InvalidPath(format!("目标已存在：{to}")));
    }
    if let Some(parent) = b.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(a, b)?;
    Ok(())
}

/// Permanent deletion is only allowed inside the app-managed `.leafor/`
/// directory (trash emptying, recovery drafts, caches). User content is only
/// ever *moved* to `.leafor/trash/` via `fs_move`.
#[tauri::command]
pub fn fs_remove(state: State<'_, AppState>, path: String) -> Result<()> {
    let clean = scope::sanitize_rel(&path)?;
    let first = clean.components().next().map(|c| c.as_os_str().to_string_lossy().to_string());
    if first.as_deref() != Some(".leafor") || clean.components().count() < 2 {
        return Err(ScopeError::OutOfScope(format!("只允许删除 .leafor 内部文件：{path}")));
    }
    let p = state.ws(&path)?;
    if p.is_dir() {
        fs::remove_dir_all(p)?;
    } else if p.exists() {
        fs::remove_file(p)?;
    }
    Ok(())
}

#[tauri::command]
pub fn fs_abs_path(state: State<'_, AppState>, path: String) -> Result<String> {
    Ok(state.ws(&path)?.display().to_string())
}

// ---------------------------------------------------------------- import (granted external reads)

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    hash: String,
    size: u64,
}

#[tauri::command]
pub fn import_copy(state: State<'_, AppState>, source: String, dest: String) -> Result<ImportResult> {
    let src = state.check_read(&source)?;
    let dst = state.ws(&dest)?;
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent)?;
    }
    if dst.exists() {
        return Err(ScopeError::InvalidPath(format!("目标已存在：{dest}")));
    }
    // Copy to a temp name first, then rename, so an interrupted import never
    // leaves a half-written file at the final path.
    let tmp = dst.with_file_name(format!(".{}.leafor-tmp-import", dst.file_name().unwrap().to_string_lossy()));
    fs::copy(&src, &tmp)?;
    fs::rename(&tmp, &dst)?;
    let hash = scope::sha256_file(&dst)?;
    let size = fs::metadata(&dst)?.len();
    Ok(ImportResult { hash, size })
}

#[tauri::command]
pub fn import_read_bytes(state: State<'_, AppState>, source: String) -> Result<tauri::ipc::Response> {
    Ok(tauri::ipc::Response::new(fs::read(state.check_read(&source)?)?))
}

#[tauri::command]
pub fn import_stat(state: State<'_, AppState>, source: String) -> Result<Entry> {
    let p = state.check_read(&source)?;
    let m = fs::metadata(&p)?;
    Ok(meta_entry(p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(), &m))
}

// ---------------------------------------------------------------- export (granted external writes)

#[tauri::command]
pub fn export_write_text(state: State<'_, AppState>, target: String, text: String) -> Result<()> {
    let p = state.check_write(&target)?;
    scope::atomic_write(&p, text.as_bytes())
}

#[tauri::command]
pub fn export_write_bytes(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<()> {
    let target = header(&request, "x-target")?;
    let p = state.check_write(&target)?;
    scope::atomic_write(&p, &body_bytes(&request)?)
}

#[tauri::command]
pub fn export_copy_from_ws(state: State<'_, AppState>, path: String, target: String) -> Result<()> {
    let src = state.ws(&path)?;
    let dst = state.check_write(&target)?;
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent)?;
    }
    if src.is_dir() {
        scope::copy_dir_recursive(&src, &dst)?;
    } else {
        fs::copy(src, dst)?;
    }
    Ok(())
}

#[tauri::command]
pub fn export_mkdir(state: State<'_, AppState>, target: String) -> Result<()> {
    let p = state.check_write(&target)?;
    fs::create_dir_all(p)?;
    Ok(())
}

// ---------------------------------------------------------------- shell integration

#[tauri::command]
pub fn open_in_system(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<()> {
    let p = state.ws(&path)?;
    app.opener()
        .open_path(p.display().to_string(), None::<&str>)
        .map_err(|e| ScopeError::Io(std::io::Error::other(e.to_string())))
}

#[tauri::command]
pub fn reveal_in_explorer(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<()> {
    let p = state.ws(&path)?;
    app.opener()
        .reveal_item_in_dir(p)
        .map_err(|e| ScopeError::Io(std::io::Error::other(e.to_string())))
}

#[tauri::command]
pub fn reveal_export(app: AppHandle, state: State<'_, AppState>, target: String) -> Result<()> {
    let p = state.check_write(&target)?;
    app.opener()
        .reveal_item_in_dir(p)
        .map_err(|e| ScopeError::Io(std::io::Error::other(e.to_string())))
}

#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> Result<()> {
    if !(url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:")) {
        return Err(ScopeError::InvalidPath(url));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| ScopeError::Io(std::io::Error::other(e.to_string())))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    platform: String,
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.into(),
    }
}
