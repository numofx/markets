"use client";

import { TradeForm } from "@/components/TradeForm";
import { cn } from "@/lib/cn";

type TradeCardProps = {
  className?: string;
};

export function TradeCard({ className }: TradeCardProps) {
  return <TradeForm className={cn(className)} />;
}
