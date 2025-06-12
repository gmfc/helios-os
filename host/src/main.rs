use once_cell::sync::Lazy;
use tauri::Manager;
use rusqlite::{params, OptionalExtension};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Mutex, Once};
use std::time::{Duration, Instant};
use tokio::time::timeout;
use v8;
use v8::Global;

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
static ISOLATES: Lazy<Mutex<HashMap<u32, JsRuntime>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static NIC_QUEUES: Lazy<Mutex<HashMap<String, std::collections::VecDeque<Value>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static NIC_IDS: Lazy<Mutex<HashMap<String, String>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static WIFI_APS: Lazy<Mutex<Vec<(String, String)>>> = Lazy::new(|| {
    Mutex::new(vec![
        ("helios".to_string(), "password".to_string()),
        ("guest".to_string(), "guest".to_string()),
    ])
});

struct JsRuntime {
    isolate: Option<v8::OwnedIsolate>,
    context: Global<v8::Context>,
    script: Option<Global<v8::Script>>,
    context_ptr: *mut SyscallContext,
}

impl Drop for JsRuntime {
    fn drop(&mut self) {
        unsafe { let _ = Box::from_raw(self.context_ptr); }
    }
}

impl JsRuntime {
    fn new(app: tauri::AppHandle, pid: u32, code: String, quota_mem: usize) -> Result<Self, String> {
        let mut isolate = v8::Isolate::new(v8::CreateParams::default().heap_limits(0, quota_mem));
        let handle_scope = &mut v8::HandleScope::new(&mut isolate);
        let context = v8::Context::new(handle_scope, Default::default());
        let mut ctx_global = Global::new();
        ctx_global.set(handle_scope, context);
        let scope = &mut v8::ContextScope::new(handle_scope, context);

        let syscall_context = Box::new(SyscallContext { app_handle: app, pid });
        let context_ptr = Box::into_raw(syscall_context);
        let external = v8::External::new(scope, context_ptr as *mut std::ffi::c_void);

        let syscall_tmpl = v8::FunctionTemplate::builder(syscall_callback)
            .data(external.into())
            .build(scope);

        let syscall_func = syscall_tmpl.get_function(scope).unwrap();
        let global = context.global(scope);
        let key = v8::String::new(scope, "syscall").unwrap();
        global.set(scope, key.into(), syscall_func.into());

        let code_str = v8::String::new(scope, &code).ok_or("bad code")?;
        let script = v8::Script::compile(scope, code_str, None).ok_or("compile")?;
        let mut script_global = Global::new();
        script_global.set(scope, script);

        Ok(Self { isolate: Some(isolate), context: ctx_global, script: Some(script_global), context_ptr })
    }

    fn execute(&mut self) -> Result<(Option<i32>, u64, usize), String> {
        let mut isolate = self.isolate.take().unwrap();
        let start = Instant::now();
        let handle_scope = &mut v8::HandleScope::new(&mut isolate);
        let ctx = v8::Local::new(handle_scope, &self.context);
        let scope = &mut v8::ContextScope::new(handle_scope, ctx);

        if let Some(script_global) = self.script.take() {
            let script = v8::Local::new(scope, script_global);
            let _ = script.run(scope);
        }

        let mut stats = v8::HeapStatistics::default();
        isolate.get_heap_statistics(&mut stats);
        let mem_bytes = stats.used_heap_size();
        let cpu_ms = start.elapsed().as_millis() as u64;
        self.isolate = Some(isolate);
        Ok((None, cpu_ms, mem_bytes))
    }
}

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
fn drop_isolate(pid: u32) -> Result<(), String> {
    ISOLATES.lock().unwrap().remove(&pid);
    Ok(())
}

#[tauri::command]
fn register_nic(id: String, mac: String) -> Result<(), String> {
    NIC_IDS.lock().unwrap().insert(id, mac.clone());
    NIC_QUEUES
        .lock()
        .unwrap()
        .entry(mac)
        .or_insert_with(VecDeque::new);
    Ok(())
}

#[tauri::command]
fn send_frame(nic_id: String, frame: Value) -> Result<(), String> {
    let macs = NIC_IDS.lock().unwrap();
    let src_mac = match macs.get(&nic_id) {
        Some(m) => m.clone(),
        None => return Err("unknown nic".into()),
    };
    drop(macs);
    let dst = frame
        .get("dst")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let mut q = NIC_QUEUES.lock().unwrap();
    if let Some(queue) = q.get_mut(&dst) {
        queue.push_back(frame);
    } else {
        for (mac, queue) in q.iter_mut() {
            if *mac != src_mac {
                queue.push_back(frame.clone());
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn receive_frames(nic_id: String) -> Result<Value, String> {
    let macs = NIC_IDS.lock().unwrap();
    let mac = match macs.get(&nic_id) {
        Some(m) => m.clone(),
        None => return Ok(Value::Array(vec![])),
    };
    drop(macs);
    let mut q = NIC_QUEUES.lock().unwrap();
    if let Some(queue) = q.get_mut(&mac) {
        let frames: Vec<Value> = queue.drain(..).collect();
        Ok(Value::Array(frames))
    } else {
        Ok(Value::Array(vec![]))
    }
}

#[tauri::command]
fn wifi_scan() -> Result<Value, String> {
    let aps = WIFI_APS.lock().unwrap();
    let list: Vec<Value> = aps.iter().map(|(s, _)| Value::String(s.clone())).collect();
    Ok(Value::Array(list))
}

#[tauri::command]
fn wifi_join(nic_id: String, ssid: String, passphrase: String) -> Result<bool, String> {
    let aps = WIFI_APS.lock().unwrap();
    for (s, p) in aps.iter() {
        if *s == ssid && *p == passphrase {
            // registration already done when NIC created
            return Ok(true);
        }
    }
    Ok(false)
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
            "exit_code": exit,
            "cpu_ms": cpu_ms,
            "mem_bytes": mem_bytes
        })),
        Ok(Ok(Err(e))) => Err(e),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err("timeout".into()),
    }
}

#[tauri::command]
async fn run_isolate_slice(
    app: tauri::AppHandle,
    pid: u32,
    code: Option<String>,
    slice_ms: u64,
    quota_mem: usize,
) -> Result<Value, String> {
    init_v8();
    let fut = tokio::task::spawn_blocking(move || {
        let mut runtime = {
            let mut map = ISOLATES.lock().unwrap();
            if let Some(rt) = map.remove(&pid) {
                rt
            } else {
                let src = code.ok_or("no code")?;
                let rt = JsRuntime::new(app.clone(), pid, src, quota_mem)?;
                rt
            }
        };

        let res = runtime.execute();

        let mut map = ISOLATES.lock().unwrap();
        map.insert(pid, runtime);

        let (exit, cpu_ms, mem_bytes) = res?;
        Ok::<(Option<i32>, u64, usize), String>((exit, cpu_ms, mem_bytes))
    });

    match timeout(Duration::from_millis(slice_ms), fut).await {
        Ok(Ok(Ok((exit, cpu_ms, mem_bytes)))) => Ok(serde_json::json!({
            "exit_code": exit,
            "cpu_ms": cpu_ms,
            "mem_bytes": mem_bytes,
            "running": false
        })),
        Ok(Ok(Err(e))) => Err(e),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Ok(serde_json::json!({
            "running": true,
            "cpu_ms": slice_ms,
            "mem_bytes": quota_mem
        })),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            save_fs,
            load_fs,
            save_snapshot,
            load_snapshot,
            save_named_snapshot,
            load_named_snapshot,
            run_isolate,
            run_isolate_slice,
            register_nic,
            send_frame,
            receive_frames,
            wifi_scan,
            wifi_join,
            syscall_response,
            drop_isolate
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
