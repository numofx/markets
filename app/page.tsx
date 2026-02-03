import { LoanCard } from "@/ui/LoanCard";
import { NavBar } from "@/ui/NavBar";

const GLOBAL_TABS = ["Trade", "Borrow", "Pools", "Portfolio"];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-numo-cream to-numo-sand">
      <NavBar items={GLOBAL_TABS.map((label) => ({ label }))} />
      <main className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 py-16">
        <LoanCard />
      </main>
    </div>
  );
}
