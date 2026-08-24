import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-bg/70 data-[state=open]:animate-[envoy-enter_250ms_var(--ease-smooth-out)]" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 bg-surface text-fg shadow-[var(--shadow-border)]",
          "inset-y-0 right-0 flex w-full max-w-md flex-col outline-none",
          "data-[state=open]:animate-[envoy-enter_250ms_var(--ease-smooth-out)]",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
