import { useState, useEffect, useCallback } from "react";
import type { SessionSummary } from "@collapse/shared";

export interface UseGalleryOptions {
  apiBaseUrl: string;
  tokens: string[];
}

export interface UseGallery {
  sessions: SessionSummary[];
  loading: boolean;
  error: string | null;
  refresh(): void;
}

export function useGallery({ apiBaseUrl, tokens }: UseGalleryOptions): UseGallery {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);

  const refresh = useCallback(() => setRefreshCounter((c) => c + 1), []);

  useEffect(() => {
    if (tokens.length === 0) {
      setSessions([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetch(`${apiBaseUrl}/api/sessions/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokens }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: { sessions: SessionSummary[] }) => {
        if (!cancelled) {
          setSessions(data.sessions);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, tokens.join(","), refreshCounter]);

  // Re-fetch on tab focus
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [refresh]);

  return { sessions, loading, error, refresh };
}
