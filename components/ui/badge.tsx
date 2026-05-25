import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium tracking-tight border transition-colors",
  {
    variants: {
      variant: {
        default:
          "bg-secondary text-secondary-foreground border-transparent",
        outline:
          "bg-transparent text-foreground border-border",
        brand:
          "bg-brand-500/10 text-brand-500 border-brand-500/20 dark:text-brand-300 dark:border-brand-300/20",
        success:
          "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/20",
        warning:
          "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
        danger:
          "bg-destructive/10 text-destructive border-destructive/20",
        muted:
          "bg-muted text-muted-foreground border-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
