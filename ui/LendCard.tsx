"use client";

import { LendFixedRate } from "@/components/LendFixedRate";
import { cn } from "@/lib/cn";

type LendCardProps = {
  className?: string;
  selectedChain: number | null;
};

export function LendCard({ className, selectedChain }: LendCardProps) {
  return <LendFixedRate className={cn(className)} selectedChain={selectedChain} />;
}
