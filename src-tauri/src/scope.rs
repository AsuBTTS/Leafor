//! Workspace path scoping and safe file primitives.
//!
//! Every path coming from the frontend is a *workspace-relative* path. It is
//! validated here before touching the disk: absolute paths, drive prefixes and
//! `..` segments are rejected, and the resolved location (after following
//! symlinks / junctions of the nearest existing ancestor) must stay inside the
//! canonical workspace root.

use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum ScopeError {
    #[error("没有打开的工作区")]
    NoWorkspace,
    #[error("路径不合法：{0}")]
    InvalidPath(String),
    #[error("路径越出工作区：{0}")]
    OutOfScope(String),
    #[error("文件已在磁盘上被修改（冲突）")]
    Conflict { disk_hash: String },
    #[error("未授权的外部路径：{0}")]
    NotGranted(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
}

impl serde::Serialize for ScopeError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("ScopeError", 3)?;
        let kind = match self {
            ScopeError::NoWorkspace => "no_workspace",
            ScopeError::InvalidPath(_) => "invalid_path",
            ScopeError::OutOfScope(_) => "out_of_scope",
            ScopeError::Conflict { .. } => "conflict",
            ScopeError::NotGranted(_) => "not_granted",
            ScopeError::Io(e) if e.kind() == std::io::ErrorKind::NotFound => "not_found",
            ScopeError::Io(_) => "io",
        };
        st.serialize_field("kind", kind)?;
        st.serialize_field("message", &self.to_string())?;
        let disk_hash = match self {
            ScopeError::Conflict { disk_hash } => Some(disk_hash.clone()),
            _ => None,
        };
        st.serialize_field("diskHash", &disk_hash)?;
        st.end()
    }
}

pub type Result<T> = std::result::Result<T, ScopeError>;

/// Canonicalize without the Windows `\\?\` prefix where possible.
pub fn canonical(p: &Path) -> std::io::Result<PathBuf> {
    dunce::canonicalize(p)
}

/// Validate a relative path string and split into safe components.
pub fn sanitize_rel(rel: &str) -> Result<PathBuf> {
    let rel = rel.replace('\\', "/");
    if rel.is_empty() || rel == "." {
        return Ok(PathBuf::new());
    }
    if rel.contains('\0') {
        return Err(ScopeError::InvalidPath(rel));
    }
    let mut out = PathBuf::new();
    for comp in Path::new(&rel).components() {
        match comp {
            Component::Normal(c) => {
                let s = c.to_string_lossy();
                // Reserved characters on Windows; reject everywhere for portability.
                if s.chars().any(|ch| matches!(ch, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
                {
                    return Err(ScopeError::InvalidPath(rel.clone()));
                }
                out.push(c)
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(ScopeError::InvalidPath(rel.clone()))
            }
        }
    }
    Ok(out)
}

/// Resolve a workspace-relative path against a canonical root, guaranteeing the
/// result (and the nearest existing ancestor after symlink resolution) stays
/// inside the root.
pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf> {
    let clean = sanitize_rel(rel)?;
    let joined = root.join(&clean);
    // Find nearest existing ancestor and canonicalize it.
    let mut probe = joined.clone();
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    loop {
        if probe.exists() {
            let canon = canonical(&probe)?;
            if !canon.starts_with(root) {
                return Err(ScopeError::OutOfScope(rel.to_string()));
            }
            let mut full = canon;
            for t in tail.iter().rev() {
                full.push(t);
            }
            return Ok(full);
        }
        match (probe.file_name().map(|s| s.to_os_string()), probe.parent()) {
            (Some(name), Some(parent)) => {
                tail.push(name);
                probe = parent.to_path_buf();
            }
            _ => return Err(ScopeError::OutOfScope(rel.to_string())),
        }
    }
}

pub fn sha256_bytes(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

pub fn sha256_file(path: &Path) -> Result<String> {
    let mut f = File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

/// Write bytes to `target` atomically: temp file in the same directory, flush +
/// fsync, then rename over the destination.
pub fn atomic_write(target: &Path, bytes: &[u8]) -> Result<()> {
    let dir = target
        .parent()
        .ok_or_else(|| ScopeError::InvalidPath(target.display().to_string()))?;
    fs::create_dir_all(dir)?;
    let name = target
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = dir.join(format!(".{}.leafor-tmp-{}", name, nonce));
    {
        let mut f = File::create(&tmp)?;
        f.write_all(bytes)?;
        f.flush()?;
        f.sync_all()?;
    }
    let mut last_err = None;
    // Windows may briefly lock files (antivirus, indexer). Retry a few times.
    for attempt in 0..5 {
        match fs::rename(&tmp, target) {
            Ok(()) => {
                last_err = None;
                break;
            }
            Err(e) => {
                last_err = Some(e);
                std::thread::sleep(std::time::Duration::from_millis(40 * (attempt + 1)));
            }
        }
    }
    if let Some(e) = last_err {
        let _ = fs::remove_file(&tmp);
        return Err(e.into());
    }
    #[cfg(unix)]
    {
        if let Ok(d) = File::open(dir) {
            let _ = d.sync_all();
        }
    }
    Ok(())
}

/// Atomic write that first verifies the on-disk content still matches the hash
/// the editor last saw. `expected = Some("")` means "file must not exist yet".
pub fn guarded_write(target: &Path, bytes: &[u8], expected: Option<&str>) -> Result<String> {
    if let Some(exp) = expected {
        let disk = if target.exists() { sha256_file(target)? } else { String::new() };
        if disk != exp {
            return Err(ScopeError::Conflict { disk_hash: disk });
        }
    }
    atomic_write(target, bytes)?;
    Ok(sha256_bytes(bytes))
}

pub fn copy_dir_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let dest = to.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &dest)?;
        } else if ty.is_file() {
            fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> (tempfile::TempDir, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let c = canonical(d.path()).unwrap();
        (d, c)
    }

    #[test]
    fn rejects_traversal_and_absolute() {
        let (_d, r) = root();
        assert!(resolve(&r, "../etc/passwd").is_err());
        assert!(resolve(&r, "a/../../b").is_err());
        assert!(resolve(&r, "/etc/passwd").is_err());
        assert!(resolve(&r, "C:/Windows").is_err());
        assert!(resolve(&r, "a/b:c").is_err());
    }

    #[test]
    fn resolves_inside_root_with_unicode() {
        let (_d, r) = root();
        let p = resolve(&r, "collections/文学 作品/items/章节 一.md").unwrap();
        assert!(p.starts_with(&r));
        assert!(p.ends_with("章节 一.md"));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        let (_d, r) = root();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), r.join("link")).unwrap();
        assert!(matches!(resolve(&r, "link/x.md"), Err(ScopeError::OutOfScope(_))));
    }

    #[test]
    fn atomic_and_guarded_write() {
        let (_d, r) = root();
        let p = resolve(&r, "a/b/c.md").unwrap();
        let h1 = guarded_write(&p, "第一版".as_bytes(), Some("")).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "第一版");
        // Correct expected hash succeeds.
        let h2 = guarded_write(&p, b"v2", Some(&h1)).unwrap();
        // Stale hash conflicts and leaves file untouched.
        let err = guarded_write(&p, b"v3", Some(&h1)).unwrap_err();
        assert!(matches!(err, ScopeError::Conflict { .. }));
        assert_eq!(fs::read(&p).unwrap(), b"v2");
        assert_eq!(sha256_file(&p).unwrap(), h2);
        // No temp files left behind.
        let leftovers: Vec<_> = fs::read_dir(p.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains("leafor-tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }
}
