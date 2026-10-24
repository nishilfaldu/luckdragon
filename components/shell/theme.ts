export const THEME_STORAGE_KEY = "luckdragon-theme";

export type ThemeChoice = "system" | "light" | "dark";

export function readTheme(): ThemeChoice {
  const current = document.documentElement.dataset.theme;
  return current === "light" || current === "dark" ? current : "system";
}

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") {
    delete root.dataset.theme;
    try {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } catch {
      /* storage can be blocked */
    }
    return;
  }
  root.dataset.theme = choice;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    /* storage can be blocked */
  }
}

/** Runs before paint. `?theme=dark` wins over the saved choice so screenshots can force a theme. */
export const themeInitScript = `try{var q=new URLSearchParams(location.search).get("theme");var t=q;if(t!=="light"&&t!=="dark"&&t!=="system"){try{t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});}catch(e){t=null;}}if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;else delete document.documentElement.dataset.theme;}catch(e){}`;
