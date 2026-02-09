"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

type PillTabsProps = {
  tabs: string[];
  defaultValue?: string;
  value?: string;
  size?: "sm" | "md";
  className?: string;
  onChange?: (value: string) => void;
};

export function PillTabs({
  tabs,
  defaultValue,
  value,
  size = "md",
  className,
  onChange,
}: PillTabsProps) {
  const isControlled = typeof value !== "undefined";
  const firstTab = tabs[0];
  const [activeTab, setActiveTab] = useState(value ?? defaultValue ?? firstTab);

  useEffect(() => {
    if (!isControlled) {
      return;
    }

    const nextTab = value !== undefined && tabs.includes(value) ? value : firstTab;
    setActiveTab(nextTab);
  }, [firstTab, isControlled, tabs, value]);

  useEffect(() => {
    if (isControlled) {
      return;
    }

    if (activeTab && tabs.includes(activeTab)) {
      return;
    }

    const nextTab =
      defaultValue !== undefined && tabs.includes(defaultValue) ? defaultValue : firstTab;
    setActiveTab(nextTab);
  }, [activeTab, defaultValue, firstTab, isControlled, tabs]);

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-full bg-numo-pill p-1",
        size === "sm" ? "text-xs" : "text-sm",
        className
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
              : "text-numo-muted hover:text-numo-ink"
          )}
          key={tab}
          onClick={() => {
            if (!isControlled) {
              setActiveTab(tab);
            }
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
