mod capture;

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, State};
use tauri_plugin_deep_link::DeepLinkExt;

#[cfg(target_os = "macos")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

/// App state shared across commands.
pub struct AppState {
    pub config: Mutex<Option<SessionConfig>>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SessionConfig {
    pub token: String,
    pub api_base_url: String,
}

#[derive(Serialize)]
pub struct CaptureResult {
    /// Base64-encoded JPEG bytes
    pub base64: String,
    pub width: u32,
    pub height: u32,
    pub size_bytes: usize,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CaptureSource {
    #[serde(rename = "monitor")]
    Monitor { id: u32 },
    #[serde(rename = "window")]
    Window { id: u32 },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub id: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
    pub is_builtin: bool,
    pub scale_factor: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub id: u32,
    pub app_name: String,
    pub title: String,
    pub width: u32,
    pub height: u32,
    pub is_minimized: bool,
    pub is_focused: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSourceList {
    pub monitors: Vec<MonitorInfo>,
    pub windows: Vec<WindowInfo>,
}

#[derive(Serialize, Deserialize)]
pub struct UploadUrlResponse {
    #[serde(rename = "uploadUrl")]
    pub upload_url: String,
    #[serde(rename = "r2Key")]
    pub r2_key: String,
    #[serde(rename = "screenshotId")]
    pub screenshot_id: String,
    #[serde(rename = "minuteBucket")]
    pub minute_bucket: i32,
    #[serde(rename = "nextExpectedAt")]
    pub next_expected_at: String,
}

#[derive(Serialize, Deserialize)]
pub struct ConfirmResponse {
    pub confirmed: bool,
    #[serde(rename = "trackedSeconds")]
    pub tracked_seconds: i64,
    #[serde(rename = "nextExpectedAt")]
    pub next_expected_at: String,
}

/// Check if screen recording permission is granted.
/// Returns "granted" or "denied". Non-macOS platforms always return "granted".
///
/// CGPreflightScreenCaptureAccess is unreliable during `tauri dev` because the
/// debug binary runs under the terminal's identity. As a fallback we attempt an
/// actual screen capture — if xcap succeeds and returns a non-empty image,
/// permission is effectively granted regardless of what the CG API says.
#[tauri::command]
fn check_screen_permission() -> String {
    #[cfg(target_os = "macos")]
    {
        // Fast path: CG API says yes
        if unsafe { CGPreflightScreenCaptureAccess() } {
            return "granted".into();
        }

        // Fallback: try an actual capture. If it works, permission is granted
        // even though CGPreflight returned false (common in dev builds).
        if let Ok(monitors) = xcap::Monitor::all() {
            if let Some(m) = monitors.into_iter().next() {
                if let Ok(img) = m.capture_image() {
                    // A denied capture returns a fully-transparent/black image.
                    // Check if any pixel has non-zero RGB values.
                    let has_content = img.pixels().any(|p| p.0[0] > 0 || p.0[1] > 0 || p.0[2] > 0);
                    if has_content {
                        return "granted".into();
                    }
                }
            }
        }

        "denied".into()
    }
    #[cfg(not(target_os = "macos"))]
    {
        "granted".into()
    }
}

/// Request screen recording permission (macOS only).
/// On macOS 10.15+, this triggers the system prompt if permission hasn't been decided yet.
/// Returns true if permission was granted.
#[tauri::command]
fn request_screen_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe { CGRequestScreenCaptureAccess() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Open the system Screen Recording preferences pane (macOS only).
#[tauri::command]
fn open_screen_permission_settings() {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        // Opens System Settings > Privacy & Security > Screen Recording
        let _ = Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            .spawn();
    }
}

/// List available capture sources (monitors + windows).
#[tauri::command]
fn list_capture_sources() -> Result<CaptureSourceList, String> {
    use xcap::{Monitor, Window};

    let monitors: Vec<MonitorInfo> = Monitor::all()
        .map_err(|e| format!("Failed to list monitors: {e}"))?
        .into_iter()
        .filter_map(|m| {
            Some(MonitorInfo {
                id: m.id().ok()?,
                name: m.friendly_name().or_else(|_| m.name()).unwrap_or_default(),
                width: m.width().ok()?,
                height: m.height().ok()?,
                is_primary: m.is_primary().unwrap_or(false),
                is_builtin: m.is_builtin().unwrap_or(false),
                scale_factor: m.scale_factor().unwrap_or(1.0),
            })
        })
        .collect();

    // Window enumeration can fail on some platforms — treat as empty list, not error
    let windows: Vec<WindowInfo> = Window::all()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|w| {
            let title = w.title().ok().unwrap_or_default();
            let app_name = w.app_name().ok().unwrap_or_default();
            let width = w.width().ok()?;
            let height = w.height().ok()?;
            // Filter out tiny/invisible windows and our own app
            if width < 50 || height < 50 { return None; }
            if title.is_empty() && app_name.is_empty() { return None; }
            if app_name == "Collapse" { return None; }
            Some(WindowInfo {
                id: w.id().ok()?,
                app_name,
                title,
                width,
                height,
                is_minimized: w.is_minimized().unwrap_or(false),
                is_focused: w.is_focused().unwrap_or(false),
            })
        })
        .collect();

    Ok(CaptureSourceList { monitors, windows })
}

/// Initialize the session config so Rust knows where the server is.
#[tauri::command]
fn configure(token: String, api_base_url: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    *config = Some(SessionConfig { token, api_base_url });
    Ok(())
}

/// Take a native screenshot, encode as JPEG, return base64.
#[tauri::command]
fn take_screenshot(
    source: CaptureSource,
    max_width: u32,
    max_height: u32,
    jpeg_quality: u8,
) -> Result<CaptureResult, String> {
    capture::take_screenshot(source, max_width, max_height, jpeg_quality)
}

/// Full capture-upload-confirm pipeline in Rust (no browser CORS issues).
#[tauri::command]
async fn capture_and_upload(
    source: CaptureSource,
    max_width: u32,
    max_height: u32,
    jpeg_quality: u8,
    state: State<'_, AppState>,
) -> Result<ConfirmResponse, String> {
    let config = {
        let guard = state.config.lock().map_err(|e| e.to_string())?;
        guard.clone().ok_or("Not configured — call configure() first")?
    };

    // Step 1: Native screenshot
    let screenshot = capture::take_screenshot(source, max_width, max_height, jpeg_quality)?;
    let jpeg_bytes = base64_decode(&screenshot.base64)?;

    // Step 2: Get presigned URL from server
    let client = reqwest::Client::new();
    let upload_url_resp: UploadUrlResponse = client
        .get(format!(
            "{}/api/sessions/{}/upload-url",
            config.api_base_url, config.token
        ))
        .send()
        .await
        .map_err(|e| format!("Failed to get upload URL: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse upload URL response: {e}"))?;

    // Step 3: Upload JPEG to R2
    client
        .put(&upload_url_resp.upload_url)
        .header("Content-Type", "image/jpeg")
        .body(jpeg_bytes.clone())
        .send()
        .await
        .map_err(|e| format!("R2 upload failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("R2 upload rejected: {e}"))?;

    // Step 4: Confirm upload with server
    let confirm_resp: ConfirmResponse = client
        .post(format!(
            "{}/api/sessions/{}/screenshots",
            config.api_base_url, config.token
        ))
        .json(&serde_json::json!({
            "screenshotId": upload_url_resp.screenshot_id,
            "width": screenshot.width,
            "height": screenshot.height,
            "fileSize": screenshot.size_bytes,
        }))
        .send()
        .await
        .map_err(|e| format!("Confirmation failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse confirmation: {e}"))?;

    Ok(confirm_resp)
}

fn base64_decode(b64: &str) -> Result<Vec<u8>, String> {
    use base64_engine::*;
    ENGINE.decode(b64).map_err(|e| format!("Base64 decode failed: {e}"))
}

mod base64_engine {
    pub use base64::engine::general_purpose::STANDARD as ENGINE;
    pub use base64::Engine;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(AppState {
            config: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            check_screen_permission,
            request_screen_permission,
            open_screen_permission_settings,
            list_capture_sources,
            configure,
            take_screenshot,
            capture_and_upload,
        ])
        .setup(|app| {
            // Check if the app was launched via a deep link (cold start)
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                let url_strings: Vec<String> = urls.into_iter().map(|u| u.to_string()).collect();
                let handle = app.handle().clone();
                // Emit the deep link URLs to the frontend after window is ready
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    let _ = handle.emit("deep-link://new-url", url_strings);
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
