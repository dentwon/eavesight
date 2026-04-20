import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Badge — for status chips, severity tags, counts. Semantic variants map to
 * success/warning/destructive tokens so "Hot Lead" / "Cold" / "Error" read
 * the same way everywhere.
 */
const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
        secondary:
          'border-transparent bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]',
        outline:
          'border-[hsl(var(--border))] text-[hsl(var(--foreground))]',
        success:
          'border-transparent bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]',
        warning:
          'border-transparent bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]',
        destructive:
          'border-transparent bg-[hsl(var(--destructive)/0.15)] text-[hsl(var(--destructive))]',
        info:
          'border-transparent bg-[hsl(var(--info)/0.15)] text-[hsl(var(--info))]',
        accent:
          'border-transparent bg-[hsl(var(--accent)/0.15)] text-[hsl(var(--accent))]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
