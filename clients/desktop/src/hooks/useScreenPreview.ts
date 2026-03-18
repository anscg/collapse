import { useState, useEffect, useRef, useCallback } from "react";
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

  const capture = useCallback(async () => {
    if (!source) return;
    try {
      const result = await invoke<PreviewResult>("take_screenshot", {
        source,
        maxWidth: 640,
        maxHeight: 360,
        jpegQuality: 50,
      });
      // Revoke old URL
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setPreviewUrl(url);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [source?.type, source?.type === "monitor" ? source.id : "", source?.type === "window" ? source.id : ""]);

  useEffect(() => {
    if (!source) {
      setPreviewUrl(null);
      setError(null);
      return;
    }

    // Capture immediately, then on interval
    capture();
    const id = setInterval(capture, intervalMs);
    return () => {
      clearInterval(id);
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [capture, intervalMs, source]);

  return { previewUrl, error };
}
