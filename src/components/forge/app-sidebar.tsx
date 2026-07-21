"use client";

import { useEffect, useState } from "react";
import { signOut } from "@/app/actions/auth";
import { ForgeMark } from "@/components/forge/forge-mark";
import { GitHubMark } from "@/components/forge/github-mark";
import type { WorkspaceStage } from "@/domain/forge-workspace";

type NavigationItem = {
  stage: WorkspaceStage;
  label: string;
  description: string;
  disabled?: boolean;
};

interface AppSidebarProps {
  activeStage: WorkspaceStage;
  githubLogin: string | null;
  githubConnected: boolean;
  mobileOpen: boolean;
  navigation: NavigationItem[];
  disconnecting: boolean;
  onClose: () => void;
  onDisconnect: () => void;
  onNavigate: (stage: WorkspaceStage) => void;
  onRestart: () => void;
}

function NavigationGlyph({ stage }: { stage: WorkspaceStage }) {
  if (stage === "repositories") {
    return <path d="M4 6.5h16M6.5 10h11v8h-11zM9 13h6" />;
  }
  if (stage === "scanning") {
    return <path d="M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z" />;
  }
  if (stage === "pull-requests") {
    return <path d="M7 5v10a3 3 0 0 0 3 3h3M7 5l-2 2M7 5l2 2M17 19V9a3 3 0 0 0-3-3h-1M17 19l-2-2M17 19l2-2" />;
  }
  if (stage === "passport") {
    return <path d="M6 3.5h9l3 3V20.5H6zM15 3.5v4h3M9 12h6M9 16h4" />;
  }
  return <path d="M4.5 12 12 5l7.5 7M7 10.5V19h10v-8.5M10 19v-5h4v5" />;
}

function SidebarIcon({ stage }: { stage: WorkspaceStage }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5">
        <NavigationGlyph stage={stage} />
      </g>
    </svg>
  );
}

export function AppSidebar({
  activeStage,
  githubLogin,
  githubConnected,
  mobileOpen,
  navigation,
  disconnecting,
  onClose,
  onDisconnect,
  onNavigate,
  onRestart,
}: AppSidebarProps) {
  const [compactNavigation, setCompactNavigation] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 980px)");
    const updateNavigationMode = () => setCompactNavigation(mediaQuery.matches);
    updateNavigationMode();
    mediaQuery.addEventListener("change", updateNavigationMode);
    return () => mediaQuery.removeEventListener("change", updateNavigationMode);
  }, []);

  const navigationHidden = compactNavigation && !mobileOpen;

  return (
    <>
      {mobileOpen && <button className="sidebar-scrim is-visible" type="button" aria-label="Close navigation" onClick={onClose} />}
      <aside
        className={"forge-sidebar" + (mobileOpen ? " is-open" : "")}
        id="forge-navigation"
        aria-label="Forge navigation"
        aria-hidden={navigationHidden || undefined}
        inert={navigationHidden || undefined}
      >
        <div className="sidebar-head">
          <button className="sidebar-brand" type="button" onClick={onRestart} aria-label="Open Forge overview">
            <ForgeMark />
          </button>
          <span className="sidebar-edition">Decision ledger</span>
        </div>

        <nav className="sidebar-nav" aria-label="Workspace views">
          <p>Workspace</p>
          {navigation.map((item) => (
            <button
              className="sidebar-nav-item"
              type="button"
              key={item.stage}
              aria-current={activeStage === item.stage ? "page" : undefined}
              disabled={item.disabled}
              onClick={() => {
                onNavigate(item.stage);
                onClose();
              }}
            >
              <SidebarIcon stage={item.stage} />
              <span><b>{item.label}</b><small>{item.description}</small></span>
              <i aria-hidden="true" />
            </button>
          ))}
        </nav>

        <div className="sidebar-account">
          <p>Connection</p>
          <div className="sidebar-connection">
            <GitHubMark />
            <div><b>{githubConnected ? "GitHub connected" : "GitHub not connected"}</b><small>{githubLogin ?? "Read-only repository access"}</small></div>
            <span className={githubConnected ? "is-online" : ""} aria-hidden="true" />
          </div>
          {githubConnected && (
            <button className="sidebar-quiet-action" type="button" onClick={onDisconnect} disabled={disconnecting}>
              {disconnecting ? "Disconnecting…" : "Disconnect GitHub"}
            </button>
          )}
          <form action={signOut}>
            <button className="sidebar-quiet-action" type="submit">Sign out</button>
          </form>
        </div>
      </aside>
    </>
  );
}
