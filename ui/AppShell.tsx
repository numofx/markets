"use client";

import { useState } from "react";
import { BorrowCard } from "@/ui/BorrowCard";
import { NavBar } from "@/ui/NavBar";
import { PoolsCard } from "@/ui/PoolsCard";
import { PositionsCard } from "@/ui/PositionsCard";
import { TradeCard } from "@/ui/TradeCard";

const GLOBAL_TABS = ["Lend", "Borrow", "Pools", "Positions"] as const;

type TabValue = (typeof GLOBAL_TABS)[number];

export function AppShell() {
  const [activeTab, setActiveTab] = useState<TabValue>("Lend");

  return (
    <div className="min-h-screen bg-gradient-to-b from-numo-cream to-numo-sand">
      <NavBar
        activeTab={activeTab}
        items={GLOBAL_TABS.map((label) => ({ label }))}
        onTabChange={(value) => setActiveTab(value as TabValue)}
      />
      <main className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 py-16">
        {activeTab === "Lend" ? <TradeCard /> : null}
        {activeTab === "Borrow" ? <BorrowCard /> : null}
        {activeTab === "Pools" ? <PoolsCard /> : null}
        {activeTab === "Positions" ? <PositionsCard /> : null}
      </main>
    </div>
  );
}
