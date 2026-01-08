import { Bell, ChevronDown, Menu, Wallet } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/cn";
import { PillTabs } from "@/ui/PillTabs";

type NavItem = {
  label: string;
};

type NavBarProps = {
  items: NavItem[];
  className?: string;
};

export function NavBar({ items, className }: NavBarProps) {
  return (
    <header className={cn("w-full", className)}>
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center">
            <Image
              alt="Numo"
              height={40}
              priority
              src="/numo_logo.png"
              width={160}
            />
          </div>
          <PillTabs
            className="hidden sm:flex"
            defaultValue={items[0]?.label}
            size="sm"
            tabs={items.map((item) => item.label)}
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border border-numo-border bg-white px-3 py-2 font-semibold text-numo-ink text-xs shadow-sm">
            <Wallet className="h-4 w-4 text-numo-muted" />
            0x71C7...976F
            <ChevronDown className="h-3 w-3 text-numo-muted" />
          </div>
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
