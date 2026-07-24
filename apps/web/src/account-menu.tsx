import { useClerk, useUser } from "@clerk/react";
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

export function AccountMenu() {
  const { openUserProfile, signOut } = useClerk();
  const { user } = useUser();
  const [appearance, setAppearance] = useState<Appearance>(savedAppearance);

  const changeAppearance = useCallback((value: string) => {
    const nextAppearance = value as Appearance;
    saveAppearance(nextAppearance);
    setAppearance(nextAppearance);
  }, []);
  const manageAccount = useCallback(() => openUserProfile(), [openUserProfile]);
  const logOut = useCallback(() => signOut({ redirectUrl: "/search" }), [signOut]);

  if (!user) {
    return null;
  }

  const displayName = user.fullName ?? user.firstName ?? "Account";
  const email = user.primaryEmailAddress?.emailAddress ?? "Signed-in account";

  return (
    <Menu>
      <MenuTrigger
        aria-label={`Account menu for ${displayName}`}
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
        <img
          alt=""
          className="size-7 shrink-0 rounded-full outline-1 outline-black/10 -outline-offset-1 dark:outline-white/10"
          draggable={false}
          height="28"
          src={user.imageUrl}
          width="28"
        />
      </MenuTrigger>
      <MenuPopup
        align="end"
        className="w-72 rounded-xl border-border bg-popover shadow-none before:hidden [&>div]:flex [&>div]:flex-col [&>div]:gap-2 [&>div]:p-2"
      >
        <div className="flex min-w-0 items-center gap-3 px-2 py-2 text-base sm:text-sm">
          <img
            alt=""
            className="size-9 shrink-0 rounded-full outline-1 outline-black/10 -outline-offset-1 dark:outline-white/10"
            draggable={false}
            height="36"
            src={user.imageUrl}
            width="36"
          />
          <div className="min-w-0">
            <p className="m-0 truncate font-semibold">{displayName}</p>
            <p className="m-0 truncate text-muted-foreground">{email}</p>
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
