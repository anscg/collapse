import React, { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CaptureSource } from "../hooks/useNativeCapture.js";
import { useScreenPreview } from "../hooks/useScreenPreview.js";

interface MonitorInfo {
  id: number;
  name: string;
  width: number;
  height: number;
  isPrimary: boolean;
  isBuiltin: boolean;
  scaleFactor: number;
}

interface WindowInfo {
  id: number;
  appName: string;
  title: string;
  width: number;
  height: number;
  isMinimized: boolean;
  isFocused: boolean;
}

interface CaptureSourceList {
  monitors: MonitorInfo[];
  windows: WindowInfo[];
}

interface SourcePickerProps {
  onSelect: (source: CaptureSource) => void;
}

/** Shows a live preview of the currently highlighted source */
function LivePreview({ source }: { source: CaptureSource | null }) {
  const { previewUrl, error } = useScreenPreview(source, 2000);

  if (!source) {
    return (
      <div style={previewStyles.wrap}>
        <div style={previewStyles.placeholder}>
          <p style={previewStyles.placeholderText}>
            Hover over a source to preview
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={previewStyles.wrap}>
      {previewUrl ? (
        <img src={previewUrl} alt="Preview" style={previewStyles.img} />
      ) : error ? (
        <div style={previewStyles.placeholder}>
          <p style={{ ...previewStyles.placeholderText, color: "#fca5a5" }}>
            {error}
          </p>
        </div>
      ) : (
        <div style={previewStyles.placeholder}>
          <p style={previewStyles.placeholderText}>Capturing preview...</p>
        </div>
      )}
    </div>
  );
}

export function SourcePicker({ onSelect }: SourcePickerProps) {
  const [sources, setSources] = useState<CaptureSourceList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"screens" | "windows">("screens");
  const [hoveredSource, setHoveredSource] = useState<CaptureSource | null>(null);
  const [selectedSource, setSelectedSource] = useState<CaptureSource | null>(null);

  // The source to preview: selected > hovered > primary monitor
  const previewSource =
    selectedSource ??
    hoveredSource ??
    (sources?.monitors.find((m) => m.isPrimary)
      ? { type: "monitor" as const, id: sources!.monitors.find((m) => m.isPrimary)!.id }
      : sources?.monitors[0]
        ? { type: "monitor" as const, id: sources.monitors[0].id }
        : null);

  const refresh = useCallback(async () => {
    try {
      const result = await invoke<CaptureSourceList>("list_capture_sources");
      setSources(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (error) {
    return (
      <div style={styles.center}>
        <h2 style={styles.heading}>Failed to detect displays</h2>
        <p style={styles.errorText}>{error}</p>
        <button style={styles.retryBtn} onClick={refresh}>Retry</button>
      </div>
    );
  }

  if (!sources) {
    return (
      <div style={styles.center}>
        <p style={styles.text}>Detecting displays...</p>
      </div>
    );
  }

  const hasWindows = sources.windows.length > 0;

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>What should Collapse capture?</h2>

      {/* Live preview */}
      <LivePreview source={previewSource} />

      {/* Tabs — only show if there are windows to pick from */}
      {hasWindows && (
        <div style={styles.tabs}>
          <button
            style={tab === "screens" ? styles.tabActive : styles.tab}
            onClick={() => setTab("screens")}
          >
            Screens ({sources.monitors.length})
          </button>
          <button
            style={tab === "windows" ? styles.tabActive : styles.tab}
            onClick={() => setTab("windows")}
          >
            Windows ({sources.windows.length})
          </button>
          <button style={styles.refreshBtn} onClick={refresh} title="Refresh">
            &#x21bb;
          </button>
        </div>
      )}

      {/* Source list */}
      <div style={styles.list}>
        {(tab === "screens" || !hasWindows) &&
          sources.monitors.map((m) => {
            const src: CaptureSource = { type: "monitor", id: m.id };
            const isSelected = selectedSource?.type === "monitor" && selectedSource.id === m.id;
            return (
              <button
                key={`m-${m.id}`}
                style={{
                  ...styles.sourceItem,
                  ...(isSelected ? styles.sourceItemSelected : {}),
                }}
                onClick={() => {
                  setSelectedSource(src);
                  onSelect(src);
                }}
                onMouseEnter={() => setHoveredSource(src)}
                onMouseLeave={() => setHoveredSource(null)}
              >
                <div style={styles.sourceIcon}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                </div>
                <div style={styles.sourceInfo}>
                  <span style={styles.sourceName}>
                    {m.name}
                    {m.isPrimary && <span style={styles.badge}>Primary</span>}
                  </span>
                  <span style={styles.sourceMeta}>
                    {m.width}x{m.height}
                    {m.scaleFactor > 1 && ` @ ${m.scaleFactor}x`}
                  </span>
                </div>
                <span style={styles.arrow}>&rsaquo;</span>
              </button>
            );
          })}

        {tab === "windows" && hasWindows &&
          sources.windows.map((w) => {
            const src: CaptureSource = { type: "window", id: w.id };
            const isSelected = selectedSource?.type === "window" && selectedSource.id === w.id;
            return (
              <button
                key={`w-${w.id}`}
                style={{
                  ...styles.sourceItem,
                  ...(isSelected ? styles.sourceItemSelected : {}),
                  ...(w.isMinimized ? { opacity: 0.5 } : {}),
                }}
                onClick={() => {
                  setSelectedSource(src);
                  onSelect(src);
                }}
                onMouseEnter={() => setHoveredSource(src)}
                onMouseLeave={() => setHoveredSource(null)}
              >
                <div style={styles.sourceIcon}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <circle cx="7" cy="6" r="1" fill="currentColor" />
                    <circle cx="10" cy="6" r="1" fill="currentColor" />
                  </svg>
                </div>
                <div style={styles.sourceInfo}>
                  <span style={styles.sourceName}>
                    {w.appName || w.title}
                    {w.isFocused && <span style={styles.badge}>Focused</span>}
                    {w.isMinimized && <span style={styles.badgeDim}>Minimized</span>}
                  </span>
                  <span style={styles.sourceMeta}>
                    {w.title && w.appName ? w.title + " — " : ""}
                    {w.width}x{w.height}
                  </span>
                </div>
                <span style={styles.arrow}>&rsaquo;</span>
              </button>
            );
          })}
      </div>
    </div>
  );
}

const previewStyles: Record<string, React.CSSProperties> = {
  wrap: {
    borderRadius: 10,
    overflow: "hidden",
    background: "#111",
    border: "1px solid #333",
    marginBottom: 14,
    aspectRatio: "16/9",
  },
  img: { width: "100%", height: "100%", objectFit: "contain", display: "block" },
  placeholder: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderText: { fontSize: 13, color: "#555", textAlign: "center" },
};

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 480, margin: "0 auto", padding: 16 },
  center: {
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", minHeight: 200, padding: 24,
  },
  heading: {
    fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 12, textAlign: "center",
  },
  text: { fontSize: 14, color: "#888", textAlign: "center" },
  errorText: { fontSize: 13, color: "#fca5a5", textAlign: "center", marginBottom: 12 },
  retryBtn: {
    padding: "8px 20px", fontSize: 13, fontWeight: 600,
    background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer",
  },
  tabs: {
    display: "flex", gap: 4, marginBottom: 10, background: "#1a1a1a",
    borderRadius: 8, padding: 4,
  },
  tab: {
    flex: 1, padding: "7px 10px", fontSize: 12, fontWeight: 500,
    background: "transparent", color: "#888", border: "none",
    borderRadius: 6, cursor: "pointer",
  },
  tabActive: {
    flex: 1, padding: "7px 10px", fontSize: 12, fontWeight: 600,
    background: "#333", color: "#fff", border: "none",
    borderRadius: 6, cursor: "pointer",
  },
  refreshBtn: {
    padding: "7px 10px", fontSize: 14, background: "transparent",
    color: "#888", border: "none", cursor: "pointer", borderRadius: 6,
  },
  list: {
    display: "flex", flexDirection: "column", gap: 4,
    maxHeight: 280, overflowY: "auto",
  },
  sourceItem: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "10px 12px", background: "#1a1a1a", border: "1px solid #333",
    borderRadius: 8, cursor: "pointer", textAlign: "left" as const,
    width: "100%", transition: "border-color 0.15s",
  },
  sourceItemSelected: {
    borderColor: "#3b82f6",
    background: "rgba(59,130,246,0.08)",
  },
  sourceIcon: { color: "#888", flexShrink: 0 },
  sourceInfo: {
    flex: 1, display: "flex", flexDirection: "column" as const, gap: 2,
    minWidth: 0,
  },
  sourceName: {
    fontSize: 13, fontWeight: 600, color: "#fff",
    display: "flex", alignItems: "center", gap: 6,
  },
  sourceMeta: {
    fontSize: 11, color: "#666", overflow: "hidden",
    textOverflow: "ellipsis", whiteSpace: "nowrap" as const,
  },
  badge: {
    fontSize: 10, fontWeight: 600, color: "#22c55e",
    background: "rgba(34,197,94,0.15)", padding: "1px 6px",
    borderRadius: 4,
  },
  badgeDim: {
    fontSize: 10, fontWeight: 500, color: "#888",
    background: "rgba(136,136,136,0.15)", padding: "1px 6px",
    borderRadius: 4,
  },
  arrow: { fontSize: 20, color: "#555", flexShrink: 0 },
};
