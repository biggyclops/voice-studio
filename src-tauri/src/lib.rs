use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{ipc::Response, AppHandle, Manager};

const MAX_CLIPS: usize = 20;

#[derive(Serialize, Deserialize, Clone)]
struct Voice {
    id: String,
    name: String,
    duration: f64,
    transcript: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct Clip {
    id: String,
    voice: String,
    text: String,
    created: u64,
}

type R<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}

fn dir(app: &AppHandle, sub: &str) -> R<PathBuf> {
    let d = app.path().app_data_dir().map_err(err)?.join(sub);
    fs::create_dir_all(&d).map_err(err)?;
    Ok(d)
}

fn read_json<T: for<'de> Deserialize<'de>>(p: &Path) -> Vec<T> {
    fs::read(p).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn write_json<T: Serialize>(p: &Path, v: &[T]) -> R<()> {
    fs::write(p, serde_json::to_vec_pretty(v).map_err(err)?).map_err(err)
}

/// Bundled sidecar (Contents/MacOS/ffmpeg) first, then Homebrew installs.
fn ffmpeg_path() -> R<PathBuf> {
    let mut candidates = vec![];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(d) = exe.parent() {
            candidates.push(d.join("ffmpeg"));
        }
    }
    candidates.push("/opt/homebrew/bin/ffmpeg".into());
    candidates.push("/usr/local/bin/ffmpeg".into());
    candidates.push("/usr/bin/ffmpeg".into());
    candidates
        .into_iter()
        .find(|p| p.is_file())
        .ok_or_else(|| "ffmpeg was not found. Reinstall Voice Studio, or run `brew install ffmpeg`.".into())
}

fn voices_file(app: &AppHandle) -> R<PathBuf> {
    Ok(dir(app, "voices")?.join("voices.json"))
}
fn clips_file(app: &AppHandle) -> R<PathBuf> {
    Ok(dir(app, "clips")?.join("clips.json"))
}
fn safe_id(id: &str) -> R<&str> {
    if id.chars().all(|c| c.is_ascii_alphanumeric()) && !id.is_empty() {
        Ok(id)
    } else {
        Err("bad id".into())
    }
}

#[tauri::command]
fn list_voices(app: AppHandle) -> R<Vec<Voice>> {
    Ok(read_json(&voices_file(&app)?))
}

#[tauri::command]
fn add_voice(app: AppHandle, name: String, path: String, start: f64, end: f64, transcript: String) -> R<Voice> {
    if name.trim().is_empty() {
        return Err("Give the voice a name.".into());
    }
    if !(end > start && start >= 0.0 && end - start <= 30.0) {
        return Err("Pick a sample between 1 and 30 seconds long.".into());
    }
    let id = format!("v{}", now_ms());
    let out = dir(&app, "voices")?.join(format!("{id}.wav"));
    // Extract/convert to 24 kHz mono 16-bit wav, trimmed to [start, end].
    let res = Command::new(ffmpeg_path()?)
        .args(["-y", "-hide_banner", "-loglevel", "error", "-ss", &start.to_string(), "-t", &(end - start).to_string(), "-i"])
        .arg(&path)
        .args(["-vn", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le"])
        .arg(&out)
        .output()
        .map_err(err)?;
    if !res.status.success() || !out.is_file() {
        return Err(format!("Could not read audio from that file: {}", String::from_utf8_lossy(&res.stderr).trim()));
    }
    // Real length (file may be shorter than the requested range): 24000 samples * 2 bytes per second.
    let bytes = fs::metadata(&out).map_err(err)?.len().saturating_sub(44);
    let duration = bytes as f64 / 48000.0;
    if duration < 1.0 {
        let _ = fs::remove_file(&out);
        return Err("That range has no audio. Check the start and end times.".into());
    }
    let v = Voice { id, name: name.trim().into(), duration, transcript: transcript.trim().into() };
    let f = voices_file(&app)?;
    let mut all: Vec<Voice> = read_json(&f);
    all.push(v.clone());
    write_json(&f, &all)?;
    Ok(v)
}

#[tauri::command]
fn delete_voice(app: AppHandle, id: String) -> R<()> {
    let id = safe_id(&id)?;
    let f = voices_file(&app)?;
    let mut all: Vec<Voice> = read_json(&f);
    all.retain(|v| v.id != id);
    write_json(&f, &all)?;
    let _ = fs::remove_file(dir(&app, "voices")?.join(format!("{id}.wav")));
    Ok(())
}

#[tauri::command]
fn voice_audio(app: AppHandle, id: String) -> R<Response> {
    let p = dir(&app, "voices")?.join(format!("{}.wav", safe_id(&id)?));
    Ok(Response::new(fs::read(p).map_err(err)?))
}

#[tauri::command]
fn list_clips(app: AppHandle) -> R<Vec<Clip>> {
    Ok(read_json(&clips_file(&app)?))
}

#[tauri::command]
fn clip_audio(app: AppHandle, id: String) -> R<Response> {
    let p = dir(&app, "clips")?.join(format!("{}.wav", safe_id(&id)?));
    Ok(Response::new(fs::read(p).map_err(err)?))
}

#[tauri::command]
fn save_clip(app: AppHandle, id: String, dest: String) -> R<()> {
    let p = dir(&app, "clips")?.join(format!("{}.wav", safe_id(&id)?));
    fs::copy(p, dest).map_err(err)?;
    Ok(())
}

fn base(server: &str) -> String {
    server.trim().trim_end_matches('/').to_string()
}

#[tauri::command]
async fn health(server: String) -> R<String> {
    let r = reqwest::Client::new()
        .get(format!("{}/health", base(&server)))
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(err)?;
    if !r.status().is_success() {
        return Err(format!("Server returned {}", r.status()));
    }
    let j: serde_json::Value = r.json().await.map_err(err)?;
    if j["ok"] != serde_json::Value::Bool(true) {
        return Err("Server is not ready".into());
    }
    Ok(j["model"].as_str().unwrap_or("unknown model").to_string())
}

#[tauri::command]
async fn speak(app: AppHandle, server: String, voice_id: String, text: String, speed: f64) -> R<Clip> {
    let voice = list_voices(app.clone())?
        .into_iter()
        .find(|v| v.id == voice_id)
        .ok_or("Pick a voice first.")?;
    let sample = fs::read(dir(&app, "voices")?.join(format!("{}.wav", safe_id(&voice.id)?))).map_err(err)?;
    let form = reqwest::multipart::Form::new()
        .part("ref_audio", reqwest::multipart::Part::bytes(sample).file_name("ref.wav").mime_str("audio/wav").map_err(err)?)
        .text("ref_text", voice.transcript.clone())
        .text("text", text.clone())
        .text("speed", speed.clamp(0.7, 1.3).to_string());
    let r = reqwest::Client::new()
        .post(format!("{}/speak", base(&server)))
        .multipart(form)
        .timeout(std::time::Duration::from_secs(300))
        .send()
        .await
        .map_err(|e| format!("Could not reach Hades at {}: {e}", base(&server)))?;
    if !r.status().is_success() {
        let status = r.status();
        return Err(format!("Server returned {status}: {}", r.text().await.unwrap_or_default()));
    }
    let audio = r.bytes().await.map_err(err)?;
    let clip = Clip { id: format!("c{}", now_ms()), voice: voice.name, text, created: now_ms() };
    let d = dir(&app, "clips")?;
    fs::write(d.join(format!("{}.wav", clip.id)), &audio).map_err(err)?;
    // Keep the newest 20 clips.
    let f = clips_file(&app)?;
    let mut all: Vec<Clip> = read_json(&f);
    all.insert(0, clip.clone());
    for old in all.split_off(MAX_CLIPS.min(all.len())) {
        let _ = fs::remove_file(d.join(format!("{}.wav", old.id)));
    }
    write_json(&f, &all)?;
    Ok(clip)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_voices, add_voice, delete_voice, voice_audio, list_clips, clip_audio, save_clip, health, speak
        ])
        .run(tauri::generate_context!())
        .expect("error while running Voice Studio");
}
