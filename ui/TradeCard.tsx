"use client";

import { cn } from "@/lib/cn";
import { TradeForm } from "@/components/TradeForm";

type TradeCardProps = {
  className?: string;
};

export function TradeCard({ className }: TradeCardProps) {
  return <TradeForm className={cn(className)} />;
}
