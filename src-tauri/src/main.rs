// Prevents an additional console window from popping up on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

struct RunningProcesses(Mutex<HashMap<String, Child>>);

#[derive(Serialize)]
struct FsEntry {
    name: String,
    path: String,
    is_dir: bool,
}

/// Lists a single directory level. The frontend calls this again for each
/// folder the user expands, so large trees stay lazy instead of walking the
/// whole project up front.
#[tauri::command]
fn read_dir_tree(path: String) -> Result<Vec<FsEntry>, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') && name != ".codelite" {
            continue;
        }
        if matches!(name.as_str(), "node_modules" | "target" | ".git") {
            continue;
        }
        let full_path = entry.path().to_string_lossy().replace('\\', "/");
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(FsEntry {
            name,
            path: full_path,
            is_dir,
        });
    }
    Ok(out)
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn pick_folder() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
fn pick_file() -> Option<String> {
    rfd::FileDialog::new()
        .pick_file()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
}

/// Creates `<project>/.codelite/runners.json` pre-filled with the bundled
/// defaults if it doesn't exist yet, then returns its path so the frontend
/// can open it as a normal editor tab. This file is the whole "extension"
/// mechanism: users add entries to teach CodeLite how to run new tools
/// (Love2D, a custom build script, anything) without touching the app itself.
#[tauri::command]
fn ensure_project_runners_config(
    project_path: String,
    defaults: serde_json::Value,
) -> Result<String, String> {
    let dir = std::path::Path::new(&project_path).join(".codelite");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join("runners.json");
    if !file.exists() {
        let pretty = serde_json::to_string_pretty(&defaults).map_err(|e| e.to_string())?;
        std::fs::write(&file, pretty).map_err(|e| e.to_string())?;
    }
    Ok(file.to_string_lossy().replace('\\', "/"))
}

fn spawn_reader<R: std::io::Read + Send + 'static>(
    app: AppHandle,
    id: String,
    reader: Option<R>,
    stream: &'static str,
) {
    if let Some(reader) = reader {
        thread::spawn(move || {
            let buffered = BufReader::new(reader);
            for line in buffered.lines() {
                match line {
                    Ok(line) => {
                        let _ = app.emit(
                            "run-output",
                            serde_json::json!({ "id": id, "stream": stream, "line": line }),
                        );
                    }
                    Err(_) => break,
                }
            }
        });
    }
}

#[tauri::command]
fn run_command(
    app: AppHandle,
    id: String,
    cwd: String,
    program: String,
    args: Vec<String>,
) -> Result<(), String> {
    let mut command = Command::new(&program);
    command
        .args(&args)
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to start '{program}': {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    spawn_reader(app.clone(), id.clone(), stdout, "stdout");
    spawn_reader(app.clone(), id.clone(), stderr, "stderr");

    {
        let procs = app.state::<RunningProcesses>();
        procs.0.lock().unwrap().insert(id.clone(), child);
    }

    // Polls for exit instead of calling `wait()` directly so the child can
    // stay addressable (for stop_command) in the shared map the whole time.
    let app_wait = app.clone();
    let id_wait = id.clone();
    thread::spawn(move || loop {
        thread::sleep(std::time::Duration::from_millis(80));
        let procs = app_wait.state::<RunningProcesses>();
        let mut map = procs.0.lock().unwrap();
        let Some(child) = map.get_mut(&id_wait) else {
            break;
        };
        match child.try_wait() {
            Ok(Some(status)) => {
                map.remove(&id_wait);
                drop(map);
                let _ = app_wait.emit(
                    "run-exit",
                    serde_json::json!({ "id": id_wait, "code": status.code().unwrap_or(-1) }),
                );
                break;
            }
            Ok(None) => continue,
            Err(_) => {
                map.remove(&id_wait);
                drop(map);
                let _ = app_wait.emit("run-exit", serde_json::json!({ "id": id_wait, "code": -1 }));
                break;
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn stop_command(app: AppHandle, id: String) -> Result<(), String> {
    let procs = app.state::<RunningProcesses>();
    let mut map = procs.0.lock().unwrap();
    if let Some(child) = map.get_mut(&id) {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(RunningProcesses(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            read_dir_tree,
            read_file,
            write_file,
            pick_folder,
            pick_file,
            ensure_project_runners_config,
            run_command,
            stop_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running CodeLite");
}
