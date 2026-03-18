import React from "react";
import type { SessionSummary } from "@collapse/shared";
import { formatTime } from "../hooks/useSessionTimer.js";

export interface SessionCardProps {
  session: SessionSummary;
  onClick?: () => void;
  onArchive?: () => void;
}

const statusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: "#888" },
  active: { label: "Recording", color: "#22c55e" },
  paused: { label: "Paused", color: "#f59e0b" },
  stopped: { label: "Processing", color: "#3b82f6" },
  compiling: { label: "Compiling", color: "#3b82f6" },
  complete: { label: "Complete", color: "#22c55e" },
  failed: { label: "Failed", color: "#ef4444" },
};

export function SessionCard({ session, onClick, onArchive }: SessionCardProps) {
  const st = statusLabels[session.status] ?? { label: session.status, color: "#888" };
  const date = new Date(session.createdAt);
  const dateStr = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });

  return (
    <div style={styles.card} onClick={onClick} role="button" tabIndex={0}>
      {/* Thumbnail */}
      <div style={styles.thumbnailWrap}>
        {session.thumbnailUrl ? (
          <img
            src={session.thumbnailUrl}
            alt="Timelapse thumbnail"
            style={styles.thumbnail}
            loading="lazy"
          />
        ) : (
          <div style={styles.placeholder}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.5">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
        )}
        <span style={{ ...styles.badge, color: st.color, borderColor: st.color }}>
          {st.label}
        </span>
      </div>

      {/* Info */}
      <div style={styles.info}>
        <div style={styles.row}>
          <span style={styles.time}>{formatTime(session.trackedSeconds)}</span>
          <span style={styles.date}>{dateStr}</span>
        </div>
        <div style={styles.meta}>
          {session.screenshotCount} screenshot{session.screenshotCount !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Archive button */}
      {onArchive && (
        <button
          style={styles.archiveBtn}
          onClick={(e) => {
            e.stopPropagation();
            onArchive();
          }}
          title="Archive"
        >
          &times;
        </button>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: "#1a1a1a",
    border: "1px solid #333",
    borderRadius: 10,
    overflow: "hidden",
    cursor: "pointer",
    position: "relative",
    transition: "border-color 0.15s",
  },
  thumbnailWrap: {
    position: "relative",
    aspectRatio: "16/9",
    background: "#111",
    overflow: "hidden",
  },
  thumbnail: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  placeholder: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#111",
  },
  badge: {
    position: "absolute",
    top: 8,
    right: 8,
    fontSize: 10,
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: 4,
    background: "rgba(0,0,0,0.7)",
    border: "1px solid",
  },
  info: { padding: "10px 12px" },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  time: { fontSize: 14, fontWeight: 600, color: "#fff" },
  date: { fontSize: 11, color: "#666" },
  meta: { fontSize: 11, color: "#888" },
  archiveBtn: {
    position: "absolute",
    top: 6,
    left: 6,
    width: 24,
    height: 24,
    borderRadius: "50%",
    background: "rgba(0,0,0,0.6)",
    color: "#888",
    border: "none",
    cursor: "pointer",
    fontSize: 14,
    lineHeight: "24px",
    textAlign: "center",
    padding: 0,
  },
};
