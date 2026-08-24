import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-md bg-elevated px-3 text-sm text-fg placeholder:text-subtle",
        "shadow-[var(--shadow-border)] transition-[box-shadow] duration-150 ease-out",
        "focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-bg),0_0_0_4px_var(--color-fg)]",
        "disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}
