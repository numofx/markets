import { BorrowFixedRate } from "@/components/BorrowFixedRate";
import { cn } from "@/lib/cn";

type BorrowCardProps = {
  className?: string;
};

export function BorrowCard({ className }: BorrowCardProps) {
  return <BorrowFixedRate className={cn(className)} />;
}
