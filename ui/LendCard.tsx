"use client";

import { LendFixedRate } from "@/components/LendFixedRate";
import { cn } from "@/lib/cn";

type LendCardProps = {
  className?: string;
};

export function LendCard({ className }: LendCardProps) {
  return <LendFixedRate className={cn(className)} />;
}
