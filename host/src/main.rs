use once_cell::sync::Lazy;
use tauri::Manager;
use rusqlite::{params, OptionalExtension};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Mutex, Once};
use std::time::{Duration, Instant};
use tokio::time::timeout;
use v8;

mod db;

// Context data that will be passed to the V8 callback
struct SyscallContext {
    app_handle: tauri::AppHandle,
    pid: u32,
}

#[tauri::command]
fn save_snapshot(json: String) -> Result<(), String> {
    let conn = db::snapshot()?;
    conn.execute(
        "INSERT OR REPLACE INTO snapshot_state (id, json) VALUES (0, ?1)",
        params![json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_named_snapshot(name: String, json: String) -> Result<(), String> {
    let conn = db::snapshot()?;
    conn.execute(
        "INSERT OR REPLACE INTO snapshots (name, json) VALUES (?1, ?2)",
        params![name, json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_snapshot() -> Result<Option<Value>, String> {
    let conn = db::snapshot()?;
    let mut stmt = conn
        .prepare("SELECT json FROM snapshot_state WHERE id=0")
        .map_err(|e| e.to_string())?;
    let result: Option<String> = stmt
        .query_row([], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(result.map(|s| serde_json::from_str(&s).unwrap()))
}

#[tauri::command]
fn load_named_snapshot(name: String) -> Result<Option<Value>, String> {
    let conn = db::snapshot()?;
    let mut stmt = conn
        .prepare("SELECT json FROM snapshots WHERE name=?1")
        .map_err(|e| e.to_string())?;
    let result: Option<String> = stmt
        .query_row(params![name], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(result.map(|s| serde_json::from_str(&s).unwrap()))
}

#[tauri::command]
fn save_fs(json: String) -> Result<(), String> {
    let conn = db::fs()?;
    conn.execute(
        "INSERT OR REPLACE INTO fs_state (id, json) VALUES (0, ?1)",
        params![json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_fs() -> Result<Option<Value>, String> {
    let conn = db::fs()?;
    let mut stmt = conn
        .prepare("SELECT json FROM fs_state WHERE id=0")
        .map_err(|e| e.to_string())?;
    let result: Option<String> = stmt
        .query_row([], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(result.map(|s| serde_json::from_str(&s).unwrap()))
}

static INIT: Once = Once::new();
static NEXT_ID: AtomicUsize = AtomicUsize::new(1);
static RESPONSES: Lazy<Mutex<HashMap<usize, mpsc::Sender<Value>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn init_v8() {
    INIT.call_once(|| {
        let platform = v8::new_default_platform(0, false).make_shared();
        v8::V8::initialize_platform(platform);
        v8::V8::initialize();
    });
}

// Static callback function that retrieves context from v8::External
fn syscall_callback(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    // Get the context data from the function template's external data
    let data = args.data();
    let external = v8::Local::<v8::External>::try_from(data).unwrap();
    let context_ptr = external.value() as *mut SyscallContext;
    let context = unsafe { &*context_ptr };

    let call_val = args.get(0);
    let call = call_val.to_rust_string_lossy(scope);
    let mut argv: Vec<Value> = Vec::new();
    for i in 1..args.length() {
        let v = args.get(i);
        let value: Value = serde_v8::from_v8(scope, v).unwrap_or(Value::Null);
        argv.push(value);
    }

    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = mpsc::channel();
    RESPONSES.lock().unwrap().insert(id, tx);

    let payload = serde_json::json!({
        "id": id,
        "pid": context.pid,
        "call": call,
        "args": argv,
    });

    let _ = context.app_handle.emit_all("syscall", payload);

    let resolver = v8::PromiseResolver::new(scope).unwrap();
    let promise = resolver.get_promise(scope);
    rv.set(promise.into());

    if let Ok(result) = rx.recv() {
        let value =
            serde_v8::to_v8(scope, result).unwrap_or_else(|_| v8::undefined(scope).into());
        resolver.resolve(scope, value);
    } else {
        let err = v8::String::new(scope, "syscall failed").unwrap();
        resolver.reject(scope, err.into());
    }
}

#[tauri::command]
fn syscall_response(id: usize, result: Value) -> Result<(), String> {
    if let Some(tx) = RESPONSES.lock().unwrap().remove(&id) {
        tx.send(result).map_err(|_| "send failed".to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn run_isolate(
    app: tauri::AppHandle,
    code: String,
    quota_ms: u64,
    quota_mem: usize,
    pid: u32,
) -> Result<Value, String> {
    init_v8();
    let fut = tokio::task::spawn_blocking(move || {
        let start = Instant::now();
        let mut isolate = v8::Isolate::new(v8::CreateParams::default().heap_limits(0, quota_mem));
        let handle_scope = &mut v8::HandleScope::new(&mut isolate);
        let context = v8::Context::new(handle_scope, Default::default());
        let scope = &mut v8::ContextScope::new(handle_scope, context);

        // Create context data and wrap it in v8::External
        let syscall_context = Box::new(SyscallContext {
            app_handle: app.clone(),
            pid,
        });
        let context_ptr = Box::into_raw(syscall_context);
        let external = v8::External::new(scope, context_ptr as *mut std::ffi::c_void);

        // Create function template with the external data
        let syscall_tmpl = v8::FunctionTemplate::builder(syscall_callback)
            .data(external.into())
            .build(scope);
        
        let syscall_func = syscall_tmpl.get_function(scope).unwrap();
        let global = context.global(scope);
        let key = v8::String::new(scope, "syscall").unwrap();
        global.set(scope, key.into(), syscall_func.into());

        let code_str = v8::String::new(scope, &code).ok_or("bad code")?;
        let script = v8::Script::compile(scope, code_str, None).ok_or("compile")?;
        let value = script.run(scope).ok_or("run")?;
        
        // Clean up the context data
        unsafe {
            let _ = Box::from_raw(context_ptr);
        }
        
        let mut stats = v8::HeapStatistics::default();
        isolate.get_heap_statistics(&mut stats);
        let mem_bytes = stats.used_heap_size();
        let cpu_ms = start.elapsed().as_millis() as u64;
        Ok::<(i32, u64, usize), String>((value.int32_value(scope).unwrap_or_default(), cpu_ms, mem_bytes))
    });
    match timeout(Duration::from_millis(quota_ms), fut).await {
        Ok(Ok(Ok((exit, cpu_ms, mem_bytes)))) => Ok(serde_json::json!({
            "exitCode": exit,
            "cpuMs": cpu_ms,
            "memBytes": mem_bytes
        })),
        Ok(Ok(Err(e))) => Err(e),
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
            save_named_snapshot,
            load_named_snapshot,
            run_isolate,
            syscall_response
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
