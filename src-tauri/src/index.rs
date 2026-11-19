//! Rebuildable SQLite index cache (technical design §7). Lives in the portable
//! data folder; if the file is missing or corrupt it is recreated — workspace
//! files remain the only authoritative data.

use rusqlite::{types::Value as SqlValue, Connection};
use serde_json::{Map, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

const SCHEMA: &str = include_str!("../migrations/001_index.sql");

pub struct IndexDb {
    path: PathBuf,
    conn: Mutex<Option<Connection>>,
}

impl IndexDb {
    pub fn new(path: PathBuf) -> Self {
        Self { path, conn: Mutex::new(None) }
    }

    fn open(&self) -> Result<Connection, String> {
        let try_open = || -> rusqlite::Result<Connection> {
            let c = Connection::open(&self.path)?;
            c.pragma_update(None, "journal_mode", "WAL")?;
            c.pragma_update(None, "foreign_keys", "ON")?;
            c.execute_batch(SCHEMA)?;
            c.query_row("PRAGMA quick_check", [], |r| r.get::<_, String>(0)).and_then(|s| {
                if s == "ok" { Ok(()) } else { Err(rusqlite::Error::InvalidQuery) }
            })?;
            Ok(c)
        };
        match try_open() {
            Ok(c) => Ok(c),
            Err(_) => {
                // Corrupt cache: delete and rebuild from scratch.
                for suffix in ["", "-wal", "-shm"] {
                    let mut p = self.path.clone().into_os_string();
                    p.push(suffix);
                    let _ = std::fs::remove_file(PathBuf::from(p));
                }
                try_open().map_err(|e| e.to_string())
            }
        }
    }

    fn with<T>(&self, f: impl FnOnce(&mut Connection) -> Result<T, String>) -> Result<T, String> {
        let mut guard = self.conn.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            *guard = Some(self.open()?);
        }
        f(guard.as_mut().unwrap())
    }
}

fn to_sql(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => n.as_i64().map(SqlValue::Integer).unwrap_or_else(|| SqlValue::Real(n.as_f64().unwrap_or(0.0))),
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn from_sql(v: rusqlite::types::ValueRef<'_>) -> Value {
    use rusqlite::types::ValueRef::*;
    match v {
        Null => Value::Null,
        Integer(i) => Value::from(i),
        Real(f) => Value::from(f),
        Text(t) => Value::from(String::from_utf8_lossy(t).to_string()),
        Blob(_) => Value::Null,
    }
}

#[derive(serde::Deserialize)]
pub struct Stmt {
    sql: String,
    #[serde(default)]
    params: Vec<Value>,
}

#[tauri::command]
pub fn index_execute(db: State<'_, IndexDb>, sql: String, params: Vec<Value>) -> Result<usize, String> {
    db.with(|c| {
        let p: Vec<SqlValue> = params.iter().map(to_sql).collect();
        c.execute(&sql, rusqlite::params_from_iter(p)).map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn index_batch(db: State<'_, IndexDb>, statements: Vec<Stmt>) -> Result<(), String> {
    db.with(|c| {
        let tx = c.transaction().map_err(|e| e.to_string())?;
        for s in &statements {
            let p: Vec<SqlValue> = s.params.iter().map(to_sql).collect();
            tx.execute(&s.sql, rusqlite::params_from_iter(p)).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn index_select(db: State<'_, IndexDb>, sql: String, params: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
    db.with(|c| {
        let mut stmt = c.prepare(&sql).map_err(|e| e.to_string())?;
        let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let p: Vec<SqlValue> = params.iter().map(to_sql).collect();
        let rows = stmt
            .query_map(rusqlite::params_from_iter(p), |row| {
                let mut m = Map::new();
                for (i, n) in names.iter().enumerate() {
                    m.insert(n.clone(), from_sql(row.get_ref(i)?));
                }
                Ok(m)
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

/// Drop and recreate the cache (Settings → 重建索引).
#[tauri::command]
pub fn index_reset(db: State<'_, IndexDb>) -> Result<(), String> {
    let mut guard = db.conn.lock().map_err(|e| e.to_string())?;
    *guard = None;
    for suffix in ["", "-wal", "-shm"] {
        let mut p = db.path.clone().into_os_string();
        p.push(suffix);
        let _ = std::fs::remove_file(PathBuf::from(p));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn creates_and_recovers_from_corruption() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("idx.db");
        std::fs::write(&p, b"this is not a sqlite database at all, just garbage bytes................").unwrap();
        let db = IndexDb::new(p.clone());
        let n = db
            .with(|c| c.execute("INSERT INTO workspaces(id, root_path, title) VALUES ('w','/r','t')", []).map_err(|e| e.to_string()))
            .unwrap();
        assert_eq!(n, 1);
    }
}
