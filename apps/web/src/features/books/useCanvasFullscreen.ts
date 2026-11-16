import { useCallback, useEffect, useRef, useState } from "react";

const isTextEntryTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable);

/**
 * Expands the editor canvas to fill the window and, when the browser allows it, the whole screen.
 * The stage is laid out over the window with CSS so the view still works when the Fullscreen API
 * is unavailable or refused; leaving browser fullscreen (for example with Esc) also leaves the view.
 */
export function useCanvasFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const ownsBrowserFullscreenRef = useRef(false);

  const enter = useCallback(() => {
    setIsFullscreen(true);
    const root = document.documentElement;
    if (document.fullscreenElement || typeof root.requestFullscreen !== "function") return;
    root
      .requestFullscreen()
      .then(() => {
        ownsBrowserFullscreenRef.current = true;
      })
      .catch(() => {
        // The window-filling layout still applies when the browser refuses fullscreen.
      });
  }, []);

  const exit = useCallback(() => {
    setIsFullscreen(false);
    if (ownsBrowserFullscreenRef.current && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
    ownsBrowserFullscreenRef.current = false;
  }, []);

  const toggle = useCallback(() => {
    if (isFullscreen) exit();
    else enter();
  }, [enter, exit, isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return;

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && ownsBrowserFullscreenRef.current) {
        ownsBrowserFullscreenRef.current = false;
        setIsFullscreen(false);
      }
    };
    // Browsers consume Esc to leave real fullscreen; this covers the window-only fallback.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || isTextEntryTarget(event.target)) {
        return;
      }
      exit();
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [exit, isFullscreen]);

  useEffect(
    () => () => {
      if (ownsBrowserFullscreenRef.current && document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      }
    },
    [],
  );

  return { exit, isFullscreen, toggle };
}
