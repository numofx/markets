import { BorrowForm } from "@/components/BorrowForm";
import { cn } from "@/lib/cn";

type BorrowCardProps = {
  className?: string;
};

export function BorrowCard({ className }: BorrowCardProps) {
  return <BorrowForm className={cn(className)} />;
}
