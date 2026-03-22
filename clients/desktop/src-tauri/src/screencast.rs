#[cfg(target_os = "linux")]
use ashpd::desktop::screencast::{CursorMode, PersistMode, ScreenCast, SourceType};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct StreamInfo {
    pub node_id: u32,
}

#[cfg(target_os = "linux")]
pub async fn request_screencast(state: tauri::State<'_, crate::AppState>) -> Result<Vec<StreamInfo>, String> {
    use std::os::fd::IntoRawFd;

    // Build the session. It asks the user to pick screen/window.
    let session = ScreenCast::builder()
        .multiple(true)
        .cursor_mode(CursorMode::Hidden)
        .persist_mode(PersistMode::DoNot)
        .source_type(SourceType::Monitor | SourceType::Window)
        .build()
        .await
        .map_err(|e| format!("Failed to create ScreenCast builder: {}", e))?;

    let response = session
        .response()
        .map_err(|e| format!("Failed to get ScreenCast response: {}", e))?;

    // Must get the fd to connect to pipewire, and keep session alive
    let fd = session.pipewire_fd().await
        .map_err(|e| format!("Failed to get PipeWire fd: {}", e))?;

    let mut streams = Vec::new();
    for stream in response.streams() {
        streams.push(StreamInfo {
            node_id: stream.pipe_wire_node_id(),
        });
    }

    // Save session and fd into AppState so they don't drop and invalidate our streams
    if let Ok(mut session_guard) = state.screencast_session.lock() {
        *session_guard = Some(session);
    }
    if let Ok(mut fd_guard) = state.pipewire_fd.lock() {
        *fd_guard = Some(fd.into_raw_fd());
    }

    Ok(streams)
}
