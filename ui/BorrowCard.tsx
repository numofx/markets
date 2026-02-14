import { BorrowFixedRate } from "@/components/BorrowFixedRate";
import { cn } from "@/lib/cn";

type BorrowCardProps = {
  className?: string;
  selectedChain: number | null;
};

export function BorrowCard({ className, selectedChain }: BorrowCardProps) {
  return <BorrowFixedRate className={cn(className)} selectedChain={selectedChain} />;
}
