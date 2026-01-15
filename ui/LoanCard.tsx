"use client";

import { cn } from "@/lib/cn";
import { LoanForm } from "@/components/LoanForm";

type LoanCardProps = {
  className?: string;
};

export function LoanCard({ className }: LoanCardProps) {
  return <LoanForm className={cn(className)} />;
}
