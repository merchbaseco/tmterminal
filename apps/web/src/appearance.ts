export type Appearance = "light" | "dark" | "system";

export const appearanceChangedEvent = "tmterminal:appearance-changed";

export function savedAppearance(): Appearance {
  const value = localStorage.getItem("tmterminal-appearance");
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function applyAppearance(appearance: Appearance, systemDark: boolean) {
  const dark = appearance === "dark" || (appearance === "system" && systemDark);
  document.documentElement.classList.toggle("dark", dark);
}

export function saveAppearance(appearance: Appearance) {
  localStorage.setItem("tmterminal-appearance", appearance);
  window.dispatchEvent(new Event(appearanceChangedEvent));
}
