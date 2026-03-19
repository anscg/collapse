import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CaptureSource } from "./useNativeCapture.js";

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
) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  // Derive a stable key from the source for dependency tracking
  const sourceKey = source ? `${source.type}:${source.id}` : "";

  useEffect(() => {
    if (!source) {
      setPreviewUrl(null);
      setError(null);
      return;
    }

    let cancelled = false;

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
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setPreviewUrl(url);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    capture();
    const id = setInterval(capture, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(id);
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [sourceKey, intervalMs]);

  return { previewUrl, error };
}
