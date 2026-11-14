import { Button } from "@fluentui/react-components";
import {
  BookRegular,
  ChevronLeftRegular,
  ChevronRightRegular,
  EmojiRegular,
  GridRegular,
  ImageRegular,
  SettingsRegular,
  SignOutRegular,
} from "@fluentui/react-icons";
import { editorFontFaceCss } from "@zakka/editor-core";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";

import { ApiClientError, apiClient } from "./apiClient";
import { LoadingScreen } from "./components/layout";
import { AuthPage } from "./features/auth/AuthPage";
import { BookEditorView } from "./features/books/BookEditorView";
import { BooksView } from "./features/books/BooksView";
import { ChangelogModal } from "./features/changelog/ChangelogModal";
import { ImageGridView } from "./features/image-grid/ImageGridView";
import { LibraryView } from "./features/library/LibraryView";
import { SettingsView } from "./features/settings/SettingsView";
import { StickerPacksView } from "./features/stickers/StickerPacksView";
import { useTheme } from "./features/theme/ThemeProvider";
import { WashiTapeIcon, WashiTapeView } from "./features/washi-tape/WashiTapeView";
import { appVersion } from "./generated/changelog";
import { getErrorMessage } from "./lib/errors";
import type { AuthMode, AuthSession, SessionState } from "./types";

const navItems = [
  { to: "/books", label: "Books", icon: <BookRegular /> },
  { to: "/library", label: "Photos", icon: <ImageRegular /> },
  { to: "/stickers", label: "Stickers", icon: <EmojiRegular /> },
  { to: "/washi-tape", label: "Washi Tape", icon: <WashiTapeIcon /> },
  { to: "/image-grid", label: "Grid", icon: <GridRegular /> },
  { to: "/settings", label: "Settings", icon: <SettingsRegular /> },
] satisfies { to: string; label: string; icon: ReactNode }[];

const sidebarCollapsedStorageKey = "scrapbook:sidebar-collapsed";

function getInitialSidebarCollapsed() {
  try {
    return window.localStorage.getItem(sidebarCollapsedStorageKey) === "true";
  } catch {
    return false;
  }
}

function saveSidebarCollapsedPreference(isCollapsed: boolean) {
  try {
    window.localStorage.setItem(sidebarCollapsedStorageKey, String(isCollapsed));
  } catch {
    // Keep the in-memory toggle usable if localStorage is unavailable.
  }
}

export function App() {
  return (
    <BrowserRouter>
      <style>{editorFontFaceCss}</style>
      <AppRoutes />
    </BrowserRouter>
  );
}

function AppRoutes() {
  const [sessionState, setSessionState] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    let isMounted = true;

    apiClient
      .getCurrentSession()
      .then((session) => {
        if (isMounted) {
          setSessionState({ status: "authenticated", session });
        }
      })
      .catch((error: unknown) => {
        if (!isMounted) {
          return;
        }

        if (error instanceof ApiClientError && error.status === 401) {
          setSessionState({ status: "anonymous" });
          return;
        }

        setSessionState({ status: "anonymous", message: getErrorMessage(error) });
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const authenticate = async (mode: AuthMode, form: FormData) => {
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const session =
      mode === "login"
        ? await apiClient.login({ email, password })
        : await apiClient.register({
            displayName: String(form.get("displayName") ?? ""),
            email,
            password,
          });

    setSessionState({ status: "authenticated", session });
  };

  const logout = async () => {
    await apiClient.logout();
    setSessionState({ status: "anonymous" });
  };

  if (sessionState.status === "loading") {
    return <LoadingScreen />;
  }

  return (
    <Routes>
      <Route
        path="/auth"
        element={
          sessionState.status === "authenticated" ? (
            <Navigate to="/books" replace />
          ) : (
            <AuthPage initialMessage={sessionState.message} onAuthenticate={authenticate} />
          )
        }
      />
      <Route
        path="/*"
        element={
          sessionState.status === "authenticated" ? (
            <ProtectedShell session={sessionState.session} onLogout={logout} />
          ) : (
            <Navigate to="/auth" replace />
          )
        }
      />
    </Routes>
  );
}

function ProtectedShell({
  session,
  onLogout,
}: {
  session: AuthSession;
  onLogout: () => Promise<void>;
}) {
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(getInitialSidebarCollapsed);
  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const { syncPreference, endAccountSession } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const editorLayout = /^\/books\/[^/]+\/?$/.test(location.pathname) ? "book" : undefined;

  useEffect(() => {
    syncPreference(async () => (await apiClient.getAccountPreferences()).uiTheme).catch(() => {
      // Keep the device-cached theme when account preferences cannot be loaded.
    });

    return endAccountSession;
  }, [syncPreference, endAccountSession]);

  const toggleSidebar = () => {
    setIsSidebarCollapsed((currentValue) => {
      const nextValue = !currentValue;
      saveSidebarCollapsedPreference(nextValue);

      return nextValue;
    });
  };

  const logout = async () => {
    setLogoutError(null);

    try {
      await onLogout();
      navigate("/auth", { replace: true });
    } catch (error: unknown) {
      setLogoutError(getErrorMessage(error));
    }
  };

  return (
    <main
      className="app-shell"
      data-sidebar-collapsed={isSidebarCollapsed}
      data-editor-layout={editorLayout}
    >
      <aside
        className="sidebar"
        data-collapsed={isSidebarCollapsed}
        aria-label="Primary navigation"
      >
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            Z
          </div>
          <div className="sidebar-copy">
            <h1>Zakka</h1>
            <p>{session.account.displayName}</p>
          </div>
        </div>

        <nav className="nav-list" aria-label="Workspace sections">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} aria-label={item.label} title={item.label}>
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="sidebar-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <p className="sidebar-label">{session.account.primaryEmail}</p>
          <Button
            className="secondary-button"
            icon={<SignOutRegular />}
            type="button"
            aria-label="Sign out"
            title="Sign out"
            onClick={logout}
          >
            <span className="sidebar-label">Sign out</span>
          </Button>
          <Button
            className="secondary-button sidebar-toggle"
            icon={isSidebarCollapsed ? <ChevronRightRegular /> : <ChevronLeftRegular />}
            type="button"
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={toggleSidebar}
          >
            <span className="sidebar-label">{isSidebarCollapsed ? "Expand" : "Collapse"}</span>
          </Button>
          <button
            type="button"
            className="sidebar-version"
            aria-label={`View changelog (current version v${appVersion})`}
            title={`View changelog (v${appVersion})`}
            onClick={() => setIsChangelogOpen(true)}
          >
            <span className="sidebar-label">v{appVersion}</span>
          </button>
          {logoutError ? (
            <p className="sidebar-alert" role="alert">
              {logoutError}
            </p>
          ) : null}
        </div>
      </aside>
      {isChangelogOpen ? <ChangelogModal onClose={() => setIsChangelogOpen(false)} /> : null}

      <section className="workspace" aria-label="Zakka workspace">
        <Routes>
          <Route index element={<Navigate to="/books" replace />} />
          <Route path="library" element={<LibraryView />} />
          <Route path="stickers" element={<StickerPacksView />} />
          <Route path="washi-tape" element={<WashiTapeView />} />
          <Route path="image-grid" element={<ImageGridView />} />
          <Route path="books" element={<BooksView />} />
          <Route path="books/:bookId" element={<BookEditorView />} />
          <Route path="pages/*" element={<Navigate to="/books" replace />} />
          <Route path="settings" element={<SettingsView session={session} />} />
          <Route path="*" element={<Navigate to="/books" replace />} />
        </Routes>
      </section>
    </main>
  );
}
