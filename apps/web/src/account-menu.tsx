import { HugeiconsIcon } from "@hugeicons/react";
import {
  AccountSetting01Icon,
  ArrowDown01Icon,
  ComputerIcon,
  Logout03Icon,
  Moon02Icon,
  Sun03Icon,
} from "@hugeicons-pro/core-stroke-rounded";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "@/components/ui/menu";
import { type Appearance, saveAppearance, savedAppearance } from "./appearance.ts";
import { useSession } from "./session.tsx";

export function AccountMenu() {
  const { manageAccount, signOut: logOut } = useSession();
  const [appearance, setAppearance] = useState<Appearance>(savedAppearance);

  const changeAppearance = useCallback((value: string) => {
    const nextAppearance = value as Appearance;
    saveAppearance(nextAppearance);
    setAppearance(nextAppearance);
  }, []);
  return (
    <Menu>
      <MenuTrigger
        aria-label={"Account menu"}
        render={
          <Button
            className="pill-button topbar-control hover:topbar-control-active group gap-1.5 border-border pr-1 pl-2"
            size="default"
            variant="ghost"
          />
        }
      >
        <HugeiconsIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-[120ms] ease-out group-data-[popup-open]:rotate-180"
          icon={ArrowDown01Icon}
        />
        <HugeiconsIcon
          aria-hidden="true"
          className="size-7 rounded-full"
          icon={AccountSetting01Icon}
        />
      </MenuTrigger>
      <MenuPopup
        align="end"
        className="w-72 rounded-xl border-border bg-popover shadow-none before:hidden [&>div]:flex [&>div]:flex-col [&>div]:gap-2 [&>div]:p-2"
      >
        <div className="flex min-w-0 items-center gap-3 px-2 py-2 text-base sm:text-sm">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-7 rounded-full"
            icon={AccountSetting01Icon}
          />
          <div className="min-w-0">
            <p className="m-0 truncate font-semibold">Merchbase account</p>
            <p className="m-0 truncate text-muted-foreground">Cloudflare Access</p>
          </div>
        </div>
        <MenuItem onClick={manageAccount}>
          <HugeiconsIcon
            aria-hidden="true"
            className="size-4 shrink-0"
            icon={AccountSetting01Icon}
          />
          Manage account
        </MenuItem>
        <MenuGroup className="grid gap-1">
          <MenuGroupLabel>Appearance</MenuGroupLabel>
          <MenuRadioGroup
            className="grid gap-0.5"
            onValueChange={changeAppearance}
            value={appearance}
          >
            <MenuRadioItem
              className="grid-cols-[0_1fr] gap-0 px-2 data-checked:bg-accent [&>span>svg]:hidden"
              value="light"
            >
              <span className="flex items-center gap-2">
                <HugeiconsIcon aria-hidden="true" className="size-4 shrink-0" icon={Sun03Icon} />
                Light
              </span>
            </MenuRadioItem>
            <MenuRadioItem
              className="grid-cols-[0_1fr] gap-0 px-2 data-checked:bg-accent [&>span>svg]:hidden"
              value="dark"
            >
              <span className="flex items-center gap-2">
                <HugeiconsIcon aria-hidden="true" className="size-4 shrink-0" icon={Moon02Icon} />
                Dark
              </span>
            </MenuRadioItem>
            <MenuRadioItem
              className="grid-cols-[0_1fr] gap-0 px-2 data-checked:bg-accent [&>span>svg]:hidden"
              value="system"
            >
              <span className="flex items-center gap-2">
                <HugeiconsIcon aria-hidden="true" className="size-4 shrink-0" icon={ComputerIcon} />
                System
              </span>
            </MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
        <MenuItem onClick={logOut} variant="destructive">
          <HugeiconsIcon aria-hidden="true" className="size-4 shrink-0" icon={Logout03Icon} />
          Sign out
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
