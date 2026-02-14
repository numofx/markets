"use client";

import { useState } from "react";
import { BorrowCard } from "@/ui/BorrowCard";
import { LendCard } from "@/ui/LendCard";
import { NavBar } from "@/ui/NavBar";
import { PoolsCard } from "@/ui/PoolsCard";

const GLOBAL_TABS = ["Lend", "Borrow", "Pools"] as const;

type TabValue = (typeof GLOBAL_TABS)[number];

export function AppShell() {
  const [activeTab, setActiveTab] = useState<TabValue>("Lend");
  const [selectedChain, setSelectedChain] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-gradient-to-b from-numo-cream to-numo-sand">
      <NavBar
        activeTab={activeTab}
        items={GLOBAL_TABS.map((label) => ({ label }))}
        onSelectChain={setSelectedChain}
        onTabChange={(value) => setActiveTab(value as TabValue)}
        selectedChain={selectedChain}
      />
      <main className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 py-16">
        {activeTab === "Lend" ? <LendCard selectedChain={selectedChain} /> : null}
        {activeTab === "Borrow" ? <BorrowCard selectedChain={selectedChain} /> : null}
        {activeTab === "Pools" ? <PoolsCard /> : null}
      </main>
    </div>
  );
}
