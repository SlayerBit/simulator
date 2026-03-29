import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors', {
  variants: {
    variant: {
      default: 'bg-primary/15 text-primary border border-primary/30',
      success: 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30',
      warning: 'bg-yellow-500/15 text-yellow-500 border border-yellow-500/30',
      error: 'bg-destructive/15 text-destructive border border-destructive/30',
      neutral: 'bg-muted text-muted-foreground border border-border',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
