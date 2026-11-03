import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

function storedTheme(): Theme | null {
  try {
    const t = localStorage.getItem("theme");
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

/** Light-first theme for clean white background design. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? "light");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* storage blocked: still switch for this session */
    }
    setTheme(next);
  };

  return { theme, toggle };
}
