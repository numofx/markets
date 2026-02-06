import { Bell, Menu } from "lucide-react";
import Image from "next/image";
import { PrivyConnectPill } from "@/components/PrivyConnectPill";
import { cn } from "@/lib/cn";
import { PillTabs } from "@/ui/PillTabs";

type NavItem = {
  label: string;
};

type NavBarProps = {
  items: NavItem[];
  className?: string;
  activeTab?: string;
  onTabChange?: (value: string) => void;
};

export function NavBar({ items, className, activeTab, onTabChange }: NavBarProps) {
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
            onChange={onTabChange}
            size="sm"
            tabs={items.map((item) => item.label)}
            value={activeTab}
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
