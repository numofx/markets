"use client";

import { useEffect, useMemo, useState } from "react";
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
  const tabsKey = useMemo(() => tabs.join("|"), [tabs]);
  const [activeTab, setActiveTab] = useState(value ?? defaultValue ?? tabs[0]);

  useEffect(() => {
    if (!isControlled) {
      return;
    }

    const nextTab =
      value !== undefined && tabs.includes(value) ? value : tabs[0];
    setActiveTab(nextTab);
  }, [isControlled, value, tabsKey]);

  useEffect(() => {
    if (isControlled) {
      return;
    }

    if (activeTab && tabs.includes(activeTab)) {
      return;
    }

    const nextTab =
      defaultValue !== undefined && tabs.includes(defaultValue)
        ? defaultValue
        : tabs[0];
    setActiveTab(nextTab);
  }, [isControlled, activeTab, defaultValue, tabsKey]);

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
