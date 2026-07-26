"use client";

/**
 * components/ThemeToggle.tsx
 * Sun/moon icon button that toggles data-theme="light" | "dark" on <html>.
 * Persists the chosen theme in localStorage under "arb:theme".
 * Reads the current theme from the attribute so it stays in sync with the
 * no-flash inline script in layout.tsx.
 */

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  // Sync with whatever the no-flash script already applied on first paint
  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    if (current === "light") setTheme("light");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("arb:theme", next); } catch { /* quota */ }
  }

  const isDark = theme === "dark";

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        fontFamily: "var(--font-geist-mono)",
        fontSize: "0.75rem",
        background: "none",
        border: "1px solid var(--col-rule)",
        borderRadius: "3px",
        padding: "2px 7px",
        cursor: "pointer",
        color: "var(--col-muted)",
        lineHeight: 1,
        display: "flex",
        alignItems: "center",
        gap: "4px",
        userSelect: "none",
      }}
    >
      {isDark ? "☀" : "☾"}
    </button>
  );
}
