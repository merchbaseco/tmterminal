import { HugeiconsIcon } from "@hugeicons/react";
import { ComputerIcon, Moon02Icon, Sun03Icon } from "@hugeicons-pro/core-stroke-rounded";
import { useCallback, useLayoutEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/ui/menu";

type Appearance = "light" | "dark" | "system";

const appearanceLabels: Record<Appearance, string> = {
  dark: "Dark",
  light: "Light",
  system: "System",
};
const appearanceIcons: Record<Appearance, typeof Sun03Icon> = {
  dark: Moon02Icon,
  light: Sun03Icon,
  system: ComputerIcon,
};

function savedAppearance(): Appearance {
  const value = localStorage.getItem("tmturtle-appearance");
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function AppearanceMenu() {
  const [appearance, setAppearance] = useState<Appearance>(savedAppearance);

  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = appearance === "dark" || (appearance === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
    };

    apply();
    if (appearance === "system") {
      media.addEventListener("change", apply);
      return () => media.removeEventListener("change", apply);
    }
  }, [appearance]);

  const changeAppearance = useCallback((value: string) => {
    const nextAppearance = value as Appearance;
    localStorage.setItem("tmturtle-appearance", nextAppearance);
    setAppearance(nextAppearance);
  }, []);
  const label = appearanceLabels[appearance];

  return (
    <Menu>
      <MenuTrigger
        aria-label={`Appearance: ${label}`}
        render={<Button size="icon" variant="ghost" />}
      >
        <HugeiconsIcon icon={appearanceIcons[appearance]} />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuRadioGroup onValueChange={changeAppearance} value={appearance}>
          <MenuRadioItem value="light">Light</MenuRadioItem>
          <MenuRadioItem value="dark">Dark</MenuRadioItem>
          <MenuRadioItem value="system">System</MenuRadioItem>
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
