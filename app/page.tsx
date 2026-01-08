import { LoanCard } from "@/ui/LoanCard";
import { NavBar } from "@/ui/NavBar";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-numo-cream to-numo-sand">
      <NavBar items={[{ label: "Trade" }, { label: "Pools" }, { label: "Portfolio" }]} />
      <main className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 pt-10 pb-16">
        <LoanCard />
      </main>
    </div>
  );
}
