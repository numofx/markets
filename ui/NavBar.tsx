import { Bell, Menu } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/cn";
import { PillTabs } from "@/ui/PillTabs";
import { PrivyConnectPill } from "@/components/PrivyConnectPill";

type NavItem = {
  label: string;
};

type NavBarProps = {
  items: NavItem[];
  className?: string;
};

export function NavBar({ items, className }: NavBarProps) {
  return (
    <header className={cn("mx-auto w-full max-w-6xl px-6 pt-6", className)}>
      <div className="grid grid-cols-3 items-center">
        <div className="justify-self-start">
          <Image alt="Numo" height={40} priority src="/numo_logo.png" width={160} />
        </div>

        <div className="justify-self-center">
          <PillTabs
            className="gap-6"
            defaultValue={items[0]?.label}
            size="sm"
            tabs={items.map((item) => item.label)}
          />
        </div>

        <div className="flex items-center gap-2 justify-self-end">
          <PrivyConnectPill />
          <button
            aria-label="Notifications"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-numo-border bg-white text-numo-muted shadow-sm"
            type="button"
          >
            <Bell className="h-4 w-4" />
          </button>
          <button
            aria-label="Menu"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-numo-border bg-white text-numo-muted shadow-sm"
            type="button"
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
