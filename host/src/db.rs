use rusqlite::Connection;
use tauri::api::path::app_data_dir;

/// Open the snapshot database connection creating the DB if needed.
/// Errors are logged to stderr.
pub fn snapshot() -> Result<Connection, String> {
    let dir = match app_data_dir(&tauri::Config::default()) {
        Some(d) => d,
        None => {
            eprintln!("Database Error: no app dir");
            return Err("no app dir".into());
        }
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        let msg = e.to_string();
        eprintln!("Database Error: {}", msg);
        return Err(msg);
    }
    let db_path = dir.join("snapshot.db");
    let conn = match Connection::open(db_path) {
        Ok(c) => c,
        Err(e) => {
            let msg = e.to_string();
            eprintln!("Database Error: {}", msg);
            return Err(msg);
        }
    };
    if let Err(e) = conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;") {
        let msg = e.to_string();
        eprintln!("Database Error: {}", msg);
        return Err(msg);
    }
    if let Err(e) = conn.execute(
        "CREATE TABLE IF NOT EXISTS snapshot_state (id INTEGER PRIMARY KEY, json TEXT)",
        [],
    ) {
        let msg = e.to_string();
        eprintln!("Database Error: {}", msg);
        return Err(msg);
    }
    if let Err(e) = conn.execute(
        "CREATE TABLE IF NOT EXISTS snapshots (name TEXT PRIMARY KEY, json TEXT)",
        [],
    ) {
        let msg = e.to_string();
        eprintln!("Database Error: {}", msg);
        return Err(msg);
    }
    Ok(conn)
}

/// Open the filesystem database connection creating the DB if needed.
/// Errors are logged to stderr.
pub fn fs() -> Result<Connection, String> {
    let dir = match app_data_dir(&tauri::Config::default()) {
        Some(d) => d,
        None => {
            eprintln!("Database Error: no app dir");
            return Err("no app dir".into());
        }
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        let msg = e.to_string();
        eprintln!("Database Error: {}", msg);
        return Err(msg);
    }
    let db_path = dir.join("fs.db");
    let conn = match Connection::open(db_path) {
        Ok(c) => c,
        Err(e) => {
            let msg = e.to_string();
            eprintln!("Database Error: {}", msg);
            return Err(msg);
        }
    };
    if let Err(e) = conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;") {
        let msg = e.to_string();
        eprintln!("Database Error: {}", msg);
        return Err(msg);
    }
    if let Err(e) = conn.execute(
        "CREATE TABLE IF NOT EXISTS fs_state (id INTEGER PRIMARY KEY, json TEXT)",
        [],
    ) {
        let msg = e.to_string();
        eprintln!("Database Error: {}", msg);
        return Err(msg);
    }
    Ok(conn)
}
