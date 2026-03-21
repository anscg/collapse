import { useState, useEffect, useRef } from "react";
import { invoke } from "../logger.js";
import type { CaptureSource } from "./useNativeCapture.js";

const sharedPreviewUrlCache = new Map<string, string>();
const previewListeners = new Map<string, Set<(url: string) => void>>();

function setSharedPreviewUrl(key: string, url: string) {
  const oldUrl = sharedPreviewUrlCache.get(key);
  if (oldUrl && oldUrl !== url) {
    URL.revokeObjectURL(oldUrl);
  }
  sharedPreviewUrlCache.set(key, url);
  const subs = previewListeners.get(key);
  if (subs) {
    for (const cb of subs) cb(url);
  }
}

interface PreviewResult {
  base64: string;
  width: number;
  height: number;
  size_bytes: number;
}

/**
 * Periodically captures a low-res preview screenshot from the given source.
 * Updates every `intervalMs` (default 2s). Returns an object URL for display.
 */
export function useScreenPreview(
  source: CaptureSource | null,
  intervalMs = 2000,
  live = true,
) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  // Derive a stable key from the source for dependency tracking
  const sourceKey = source ? `${source.type}:${source.id}` : "";

  // Subscribe to URL updates for this source key
  useEffect(() => {
    if (!sourceKey) return;

    // Load initial cached value if available
    const cached = sharedPreviewUrlCache.get(sourceKey);
    if (cached) setPreviewUrl(cached);

    const handler = (url: string) => setPreviewUrl(url);
    
    let subs = previewListeners.get(sourceKey);
    if (!subs) {
      subs = new Set();
      previewListeners.set(sourceKey, subs);
    }
    subs.add(handler);

    return () => {
      subs?.delete(handler);
    };
  }, [sourceKey]);

  useEffect(() => {
    if (!source) {
      setPreviewUrl(null);
      setError(null);
      return;
    }

    let cancelled = false;
    console.debug(`[preview] starting preview for ${source.type} id=${source.id} every ${intervalMs}ms`);

    const capture = async () => {
      const s = sourceRef.current;
      if (!s || cancelled) return;
      try {
        const result = await invoke<PreviewResult>("take_screenshot", {
          source: s,
          maxWidth: 640,
          maxHeight: 360,
          jpegQuality: 50,
        });
        if (cancelled) return;
        const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);
        
        setSharedPreviewUrl(sourceKey, url);
        setError(null);
        console.debug(`[preview] got preview ${result.width}x${result.height} (${result.size_bytes} bytes)`);
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[preview] preview failed: ${msg}`);
          setError(msg);
        }
      }
    };

    const cached = sharedPreviewUrlCache.get(sourceKey);
    if (live || !cached) {
      capture();
    }

    if (!live) {
      return () => {
        cancelled = true;
        console.debug("[preview] stopping preview");
      };
    }

    const id = setInterval(capture, intervalMs);

    return () => {
      cancelled = true;
      console.debug("[preview] stopping preview");
      clearInterval(id);
    };
  }, [sourceKey, intervalMs, live]);

  return { previewUrl, error };
}
