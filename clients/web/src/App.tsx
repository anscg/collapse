import React, { useEffect } from "react";
import {
  CollapseProvider,
  CollapseRecorder,
  Gallery,
  SessionDetail,
  useTokenStore,
  useGallery,
  useHashRouter,
} from "@collapse/react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "https://collapse.b.selfhosted.hackclub.com";

export function App() {
  const { route, navigate } = useHashRouter();
  const tokenStore = useTokenStore();
  const gallery = useGallery({
    apiBaseUrl: API_BASE,
    tokens: tokenStore.getAllTokenValues(),
  });

  // Handle incoming ?token= from external service
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token && /^[a-f0-9]{64}$/i.test(token)) {
      tokenStore.addToken(token);
      // Clear query string and navigate to record
      window.history.replaceState({}, "", window.location.pathname);
      navigate({ page: "record", token });
    }
  }, []);

  switch (route.page) {
    case "gallery":
      return (
        <Gallery
          sessions={gallery.sessions}
          loading={gallery.loading}
          error={gallery.error}
          onSessionClick={(token) => {
            navigate({ page: "session", token });
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
        <CollapseProvider token={route.token} apiBaseUrl={API_BASE}>
          <div style={{ maxWidth: 640, margin: "0 auto", padding: 16 }}>
            <button
              onClick={() => navigate({ page: "gallery" })}
              style={backBtnStyle}
            >
              &larr; Gallery
            </button>
            <CollapseRecorder />
          </div>
        </CollapseProvider>
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

const backBtnStyle: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 13,
  fontWeight: 500,
  background: "transparent",
  color: "#888",
  border: "1px solid #444",
  borderRadius: 6,
  cursor: "pointer",
  marginBottom: 12,
};
