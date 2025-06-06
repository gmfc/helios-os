use rusqlite::{Connection, params, OptionalExtension};
use serde_json::Value;
use tauri::api::path::app_dir;

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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![save_fs, load_fs])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
