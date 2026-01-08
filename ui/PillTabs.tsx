"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

type PillTabsProps = {
  tabs: string[];
  defaultValue?: string;
  size?: "sm" | "md";
  className?: string;
  onChange?: (value: string) => void;
};

export function PillTabs({
  tabs,
  defaultValue,
  size = "md",
  className,
  onChange,
}: PillTabsProps) {
  const [activeTab, setActiveTab] = useState(defaultValue ?? tabs[0]);

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-full bg-numo-pill p-1",
        size === "sm" ? "text-xs" : "text-sm",
        className,
      )}
      role="tablist"
    >
      {tabs.map((tab) => (
        <button
          className={cn(
            "rounded-full px-3 py-1 font-medium transition",
            size === "sm" ? "px-3" : "px-4",
            activeTab === tab
              ? "bg-numo-ink text-white shadow-sm"
              : "text-numo-muted hover:text-numo-ink",
          )}
          key={tab}
          onClick={() => {
            setActiveTab(tab);
            onChange?.(tab);
          }}
          role="tab"
          type="button"
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
