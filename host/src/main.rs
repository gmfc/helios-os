use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::sync::Once;
use std::time::Duration;
use tauri::api::path::app_dir;
use tokio::time::timeout;
use v8;

#[tauri::command]
fn save_snapshot(json: String) -> Result<(), String> {
    let dir = app_dir(&tauri::Config::default()).ok_or("no app dir")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let db_path = dir.join("snapshot.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS snapshot_state (id INTEGER PRIMARY KEY, json TEXT)",
        [],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO snapshot_state (id, json) VALUES (0, ?1)",
        params![json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_snapshot() -> Result<Option<Value>, String> {
    let dir = app_dir(&tauri::Config::default()).ok_or("no app dir")?;
    let db_path = dir.join("snapshot.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS snapshot_state (id INTEGER PRIMARY KEY, json TEXT)",
        [],
    )
    .map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT json FROM snapshot_state WHERE id=0")
        .map_err(|e| e.to_string())?;
    let result: Option<String> =
        stmt.query_row([], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    Ok(result.map(|s| serde_json::from_str(&s).unwrap()))
}

#[tauri::command]
fn save_fs(json: String) -> Result<(), String> {
    let dir = app_dir(&tauri::Config::default()).ok_or("no app dir")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let db_path = dir.join("fs.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute("CREATE TABLE IF NOT EXISTS fs_state (id INTEGER PRIMARY KEY, json TEXT)", [])
        .map_err(|e| e.to_string())?;
    conn.execute("INSERT OR REPLACE INTO fs_state (id, json) VALUES (0, ?1)", params![json])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_fs() -> Result<Option<Value>, String> {
    let dir = app_dir(&tauri::Config::default()).ok_or("no app dir")?;
    let db_path = dir.join("fs.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute("CREATE TABLE IF NOT EXISTS fs_state (id INTEGER PRIMARY KEY, json TEXT)", [])
        .map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT json FROM fs_state WHERE id=0").map_err(|e| e.to_string())?;
    let result: Option<String> = stmt.query_row([], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    Ok(result.map(|s| serde_json::from_str(&s).unwrap()))
}

static INIT: Once = Once::new();

fn init_v8() {
    INIT.call_once(|| {
        let platform = v8::new_default_platform(0, false).make_shared();
        v8::V8::initialize_platform(platform);
        v8::V8::initialize();
    });
}

#[tauri::command]
async fn run_isolate(code: String, quota_ms: u64, quota_mem: usize) -> Result<i32, String> {
    init_v8();
    let fut = tokio::task::spawn_blocking(move || {
        let mut isolate = v8::Isolate::new(v8::CreateParams::default().heap_limits(0, quota_mem));
        let handle_scope = &mut v8::HandleScope::new(&mut isolate);
        let context = v8::Context::new(handle_scope, Default::default());
        let scope = &mut v8::ContextScope::new(handle_scope, context);
        let code_str = v8::String::new(scope, &code).ok_or("bad code")?;
        let script = v8::Script::compile(scope, code_str, None).ok_or("compile")?;
        let value = script.run(scope).ok_or("run")?;
        Ok::<i32, String>(value.int32_value(scope).unwrap_or_default())
    });
    match timeout(Duration::from_millis(quota_ms), fut).await {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err("timeout".into()),
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            save_fs,
            load_fs,
            save_snapshot,
            load_snapshot,
            run_isolate
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
