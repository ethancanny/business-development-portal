"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { NamedTheme } from "@/lib/platform/focus-shared";

/**
 * Theme state: two independent axes (Focus & Theme, Oct 26, 2026).
 * - Mode (light/dark): as before — `.dark` class, localStorage
 *   `canny-portal-theme`, dark default.
 * - Named theme ("desert" | "classic"): drives the `data-theme`
 *   attribute the Aerospace Desert token layer in globals.css keys
 *   off. Per-user and stored server-side (core.user_preferences) so
 *   it follows the user across devices; localStorage
 *   `canny-portal-named-theme` caches it for first paint. Default
 *   "desert" (Ethan's spec); "classic" = the pre-Oct-26 look, whose
 *   tokens are untouched.
 */

type Theme = "light" | "dark";

const ThemeContext = createContext<{
  theme: Theme;
  toggle: () => void;
  namedTheme: NamedTheme;
  setNamedTheme: (t: NamedTheme) => void;
}>({ theme: "dark", toggle: () => {}, namedTheme: "desert", setNamedTheme: () => {} });

const STORAGE_KEY = "canny-portal-theme";
const NAMED_STORAGE_KEY = "canny-portal-named-theme";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

function applyNamedTheme(named: NamedTheme) {
  document.documentElement.dataset.theme = named;
  try {
    window.localStorage.setItem(NAMED_STORAGE_KEY, named);
  } catch { /* private mode — server pref still applies next load */ }
}

export function useTheme() {
  return useContext(ThemeContext);
}

export default function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [namedTheme, setNamedThemeState] = useState<NamedTheme>("desert");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const initial: Theme = stored === "light" ? "light" : "dark";
    setTheme(initial);
    applyTheme(initial);
    const storedNamed = window.localStorage.getItem(NAMED_STORAGE_KEY);
    const initialNamed: NamedTheme = storedNamed === "classic" ? "classic" : "desert";
    setNamedThemeState(initialNamed);
    applyNamedTheme(initialNamed);
    // Reconcile with the server-side per-user preference (the
    // cross-device source of truth). Plain fetch: one tiny payload,
    // once per app load, no polling.
    let cancelled = false;
    fetch("/api/platform/settings/theme")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { theme?: string } | null) => {
        if (cancelled || !d) return;
        const server: NamedTheme = d.theme === "classic" ? "classic" : "desert";
        if (server !== initialNamed) {
          setNamedThemeState(server);
          applyNamedTheme(server);
        }
      })
      .catch(() => { /* offline — local value stands */ });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      window.localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
      return next;
    });
  }, []);

  const setNamedTheme = useCallback((next: NamedTheme) => {
    setNamedThemeState(next);
    applyNamedTheme(next);
    // Persist server-side (fire-and-forget; local apply already done).
    fetch("/api/platform/settings/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: next }),
    }).catch(() => { /* will reconcile on next load */ });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggle, namedTheme, setNamedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Inline script (in <head>) that applies the saved themes before first paint. */
export function ThemeInitScript() {
  const script = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');var d=t!=='light';document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';var n=localStorage.getItem('${NAMED_STORAGE_KEY}');document.documentElement.dataset.theme=n==='classic'?'classic':'desert';}catch(e){document.documentElement.classList.add('dark');document.documentElement.dataset.theme='desert';}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
