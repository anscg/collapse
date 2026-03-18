import React, { useState, useEffect, useCallback } from "react";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  CollapseProvider,
  useSession,
  useSessionTimer,
  StatusBar,
  ResultView,
  Gallery,
  SessionDetail,
  useTokenStore,
  useGallery,
  useHashRouter,
} from "@collapse/react";
import { useNativeCapture } from "./hooks/useNativeCapture.js";
import type { CaptureSource } from "./hooks/useNativeCapture.js";
import { SourcePicker } from "./components/SourcePicker.js";

const API_BASE = "http://localhost:3001"; // TODO: make configurable

// ── Helpers ──────────────────────────────────────────────────

function isValidToken(token: string): boolean {
  return /^[a-f0-9]{64}$/i.test(token);
}

function extractToken(url: string): string | null {
  try {
    const normalized = url.replace("collapse://", "https://collapse.local/");
    const parsed = new URL(normalized);
    const fromQuery = parsed.searchParams.get("token");
    if (fromQuery && isValidToken(fromQuery)) return fromQuery;
    const segments = parsed.pathname.split("/").filter(Boolean);
    const candidate =
      segments.length >= 2
        ? segments[1]
        : segments.length === 1 && segments[0] !== "session"
          ? segments[0]
          : null;
    if (candidate && isValidToken(candidate)) return candidate;
    return null;
  } catch {
    return null;
  }
}

// ── Permission Screen ────────────────────────────────────────

type PermissionStatus = "checking" | "granted" | "denied";

function PermissionScreen({ onGranted }: { onGranted: () => void }) {
  const [status, setStatus] = useState<PermissionStatus>("checking");
  const [requested, setRequested] = useState(false);

  const checkPermission = useCallback(async () => {
    const result = await invoke<string>("check_screen_permission");
    if (result === "granted") {
      setStatus("granted");
      onGranted();
    } else {
      setStatus("denied");
    }
  }, [onGranted]);

  useEffect(() => { checkPermission(); }, [checkPermission]);

  useEffect(() => {
    if (status !== "denied" || !requested) return;
    const interval = setInterval(checkPermission, 2000);
    return () => clearInterval(interval);
  }, [status, requested, checkPermission]);

  const handleRequest = useCallback(async () => {
    const granted = await invoke<boolean>("request_screen_permission");
    if (granted) {
      setStatus("granted");
      onGranted();
    } else {
      setRequested(true);
    }
  }, [onGranted]);

  const handleOpenSettings = useCallback(async () => {
    await invoke("open_screen_permission_settings");
    setRequested(true);
  }, []);

  if (status === "checking") {
    return (
      <div style={styles.center}>
        <p style={styles.text}>Checking screen recording permission...</p>
      </div>
    );
  }

  return (
    <div style={styles.center}>
      <div style={styles.permissionCard}>
        <div style={styles.permissionIcon}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        </div>
        <h2 style={styles.permissionHeading}>Screen Recording Permission</h2>
        <p style={styles.permissionText}>
          Collapse needs screen recording access to capture screenshots of your work.
          Your screen is captured locally and only periodic screenshots are uploaded.
        </p>
        {!requested ? (
          <button style={styles.permissionBtn} onClick={handleRequest}>
            Grant Permission
          </button>
        ) : (
          <>
            <p style={{ ...styles.permissionText, color: "#f59e0b", marginBottom: 12 }}>
              Please enable "Collapse" in System Settings, then return here.
              This page will update automatically.
            </p>
            <button style={styles.permissionBtn} onClick={handleOpenSettings}>
              Open System Settings
            </button>
            <button
              style={{ ...styles.permissionBtnSecondary, marginTop: 8 }}
              onClick={checkPermission}
            >
              Check Again
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Desktop Recorder ─────────────────────────────────────────

function DesktopRecorder({ token, source, onChangeSource, onBack }: {
  token: string;
  source: CaptureSource;
  onChangeSource: () => void;
  onBack: () => void;
}) {
  const session = useSession();
  const capture = useNativeCapture(token, API_BASE, source);
  const displaySeconds = useSessionTimer(
    capture.trackedSeconds || session.trackedSeconds,
    capture.isCapturing,
  );

  useEffect(() => {
    if (capture.trackedSeconds > 0) {
      session.updateTrackedSeconds(capture.trackedSeconds);
    }
  }, [capture.trackedSeconds, session.updateTrackedSeconds]);

  const handleStart = useCallback(async () => {
    await capture.startCapturing();
  }, [capture.startCapturing]);

  const handlePause = useCallback(async () => {
    capture.stopCapturing();
    await session.pause();
  }, [capture, session]);

  const handleResume = useCallback(async () => {
    await session.resume();
    await capture.startCapturing();
  }, [capture, session]);

  const handleStop = useCallback(async () => {
    capture.stopCapturing();
    await session.stop();
  }, [capture, session]);

  if (session.status === "loading") {
    return <div style={styles.center}><p style={styles.text}>Loading session...</p></div>;
  }

  if (session.status === "error") {
    return (
      <div style={styles.center}>
        <h2 style={{ ...styles.heading, color: "#ef4444" }}>Error</h2>
        <p style={styles.text}>{session.error}</p>
        <button style={{ ...styles.backBtn, marginTop: 12 }} onClick={onBack}>
          &larr; Gallery
        </button>
      </div>
    );
  }

  if (["stopped", "compiling", "complete", "failed"].includes(session.status)) {
    return (
      <div style={styles.container}>
        <button style={styles.backBtn} onClick={onBack}>&larr; Gallery</button>
        <ResultView status={session.status} trackedSeconds={session.trackedSeconds} />
      </div>
    );
  }

  const isActive = session.status === "active" || session.status === "pending";
  const isPaused = session.status === "paused";

  return (
    <div style={styles.container}>
      <button style={styles.backBtn} onClick={onBack}>&larr; Gallery</button>
      <StatusBar
        displaySeconds={displaySeconds}
        screenshotCount={capture.screenshotCount}
        uploads={{ pending: 0, completed: capture.screenshotCount, failed: 0 }}
      />

      {capture.lastScreenshotUrl && (
        <div style={styles.preview}>
          <img src={capture.lastScreenshotUrl} alt="Latest" style={styles.previewImg} />
          <span style={styles.previewLabel}>Latest screenshot</span>
        </div>
      )}

      {capture.error && (
        <div style={styles.errorBanner}><span>{capture.error}</span></div>
      )}

      <div style={styles.controls}>
        {!capture.isCapturing && isActive && (
          <>
            <button style={styles.startBtn} onClick={handleStart}>Start Recording</button>
            <button style={styles.changeSrcBtn} onClick={onChangeSource}>Change Source</button>
          </>
        )}
        {!capture.isCapturing && isPaused && (
          <>
            <button style={styles.resumeBtn} onClick={handleResume}>Resume</button>
            <button style={styles.stopBtn} onClick={handleStop}>Stop Session</button>
          </>
        )}
        {capture.isCapturing && (
          <>
            <div style={styles.recordingDot} />
            <span style={styles.recordingText}>Recording</span>
            <button style={styles.pauseBtn} onClick={handlePause}>Pause</button>
            <button style={styles.stopBtn} onClick={handleStop}>Stop</button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Recording Page (source picker + recorder) ────────────────

function RecordPage({ token, onBack }: { token: string; onBack: () => void }) {
  const [captureSource, setCaptureSource] = useState<CaptureSource | null>(null);

  if (!captureSource) {
    return (
      <div>
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "16px 16px 0" }}>
          <button style={styles.backBtn} onClick={onBack}>&larr; Gallery</button>
        </div>
        <SourcePicker onSelect={setCaptureSource} />
      </div>
    );
  }

  return (
    <CollapseProvider token={token} apiBaseUrl={API_BASE}>
      <DesktopRecorder
        token={token}
        source={captureSource}
        onChangeSource={() => setCaptureSource(null)}
        onBack={onBack}
      />
    </CollapseProvider>
  );
}

// ── App ──────────────────────────────────────────────────────

export function App() {
  const [permissionGranted, setPermissionGranted] = useState(false);
  const { route, navigate } = useHashRouter();
  const tokenStore = useTokenStore();
  const gallery = useGallery({
    apiBaseUrl: API_BASE,
    tokens: tokenStore.getAllTokenValues(),
  });

  // Deep link handler — saves token and navigates to record
  const handleDeepLinkUrls = useCallback(
    (urls: string[]) => {
      for (const url of urls) {
        const token = extractToken(url);
        if (token) {
          tokenStore.addToken(token);
          navigate({ page: "record", token });
          return;
        }
      }
    },
    [tokenStore, navigate],
  );

  useEffect(() => {
    const unlistenPlugin = onOpenUrl(handleDeepLinkUrls);
    const unlistenRust = listen<string[]>("deep-link://new-url", (event) => {
      handleDeepLinkUrls(event.payload);
    });
    return () => {
      unlistenPlugin.then((fn) => fn());
      unlistenRust.then((fn) => fn());
    };
  }, [handleDeepLinkUrls]);

  // Handle ?token= query param (dev mode)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token && isValidToken(token)) {
      tokenStore.addToken(token);
      navigate({ page: "record", token });
    }
  }, []);

  // Step 1: Permission check (macOS)
  if (!permissionGranted) {
    return <PermissionScreen onGranted={() => setPermissionGranted(true)} />;
  }

  // Step 2: Route
  switch (route.page) {
    case "gallery":
      return (
        <Gallery
          sessions={gallery.sessions}
          loading={gallery.loading}
          error={gallery.error}
          onSessionClick={(token) => {
            const session = gallery.sessions.find((s) => s.token === token);
            if (session && ["pending", "active", "paused"].includes(session.status)) {
              navigate({ page: "record", token });
            } else {
              navigate({ page: "session", token });
            }
          }}
          onArchive={(token) => {
            tokenStore.archiveToken(token);
            gallery.refresh();
          }}
          onRefresh={gallery.refresh}
        />
      );

    case "record":
      return (
        <RecordPage
          token={route.token}
          onBack={() => {
            gallery.refresh();
            navigate({ page: "gallery" });
          }}
        />
      );

    case "session":
      return (
        <SessionDetail
          token={route.token}
          apiBaseUrl={API_BASE}
          onBack={() => navigate({ page: "gallery" })}
          onArchive={() => {
            tokenStore.archiveToken(route.token);
            navigate({ page: "gallery" });
          }}
        />
      );
  }
}

// ── Styles ───────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 480, margin: "20px auto", padding: 16 },
  center: {
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", minHeight: "100vh", padding: 24,
  },
  heading: { fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 8 },
  text: { fontSize: 14, color: "#888", textAlign: "center" },
  backBtn: {
    padding: "6px 12px", fontSize: 13, fontWeight: 500,
    background: "transparent", color: "#888", border: "1px solid #444",
    borderRadius: 6, cursor: "pointer", marginBottom: 12,
  },
  preview: {
    position: "relative", marginBottom: 12, borderRadius: 8,
    overflow: "hidden", background: "#111", border: "1px solid #333",
  },
  previewImg: { width: "100%", display: "block" },
  previewLabel: {
    position: "absolute", bottom: 6, right: 6, fontSize: 11,
    color: "#aaa", background: "rgba(0,0,0,0.7)", padding: "2px 6px", borderRadius: 4,
  },
  errorBanner: {
    padding: "10px 14px", marginBottom: 12, background: "rgba(239,68,68,0.15)",
    border: "1px solid #ef4444", borderRadius: 8, color: "#fca5a5", fontSize: 13,
  },
  controls: {
    display: "flex", alignItems: "center", gap: 10,
    justifyContent: "center", flexWrap: "wrap",
  },
  startBtn: {
    padding: "12px 24px", fontSize: 15, fontWeight: 600,
    background: "#22c55e", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer",
  },
  pauseBtn: {
    padding: "8px 16px", fontSize: 13, fontWeight: 600,
    background: "#f59e0b", color: "#000", border: "none", borderRadius: 8, cursor: "pointer",
  },
  resumeBtn: {
    padding: "12px 24px", fontSize: 15, fontWeight: 600,
    background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer",
  },
  stopBtn: {
    padding: "8px 16px", fontSize: 13, fontWeight: 600,
    background: "#ef4444", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer",
  },
  recordingDot: {
    width: 10, height: 10, borderRadius: "50%", background: "#ef4444",
    animation: "pulse 1.5s ease-in-out infinite",
  },
  recordingText: { fontSize: 13, fontWeight: 600, color: "#ef4444", marginRight: 6 },
  changeSrcBtn: {
    padding: "8px 16px", fontSize: 12, fontWeight: 500,
    background: "transparent", color: "#888", border: "1px solid #444",
    borderRadius: 8, cursor: "pointer",
  },
  permissionCard: {
    maxWidth: 360, padding: 32, background: "#1a1a1a", borderRadius: 16,
    border: "1px solid #333", textAlign: "center" as const,
  },
  permissionIcon: { marginBottom: 16 },
  permissionHeading: {
    fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 12,
  },
  permissionText: {
    fontSize: 13, color: "#999", lineHeight: 1.6, marginBottom: 20,
  },
  permissionBtn: {
    width: "100%", padding: "12px 24px", fontSize: 14, fontWeight: 600,
    background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8,
    cursor: "pointer",
  },
  permissionBtnSecondary: {
    width: "100%", padding: "10px 24px", fontSize: 13, fontWeight: 500,
    background: "transparent", color: "#888", border: "1px solid #444",
    borderRadius: 8, cursor: "pointer",
  },
};
