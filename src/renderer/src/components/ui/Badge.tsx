import { cva, type VariantProps } from 'class-variance-authority'
import React from 'react'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'bg-th-surface-hover text-th-text-primary',
        green:  'bg-emerald-900/50 text-emerald-400 light:bg-emerald-100 light:text-emerald-700',
        yellow: 'bg-amber-900/50   text-amber-400   light:bg-amber-100   light:text-amber-700',
        red:    'bg-rose-900/50    text-rose-400    light:bg-rose-100    light:text-rose-700',
        blue:   'bg-blue-900/50    text-blue-400    light:bg-blue-100    light:text-blue-700',
        orange: 'bg-orange-900/50  text-orange-400  light:bg-orange-100  light:text-orange-700',
        purple: 'bg-purple-900/50  text-purple-400  light:bg-purple-100  light:text-purple-700',
        grey:   'bg-th-surface-raised text-th-text-muted light:bg-gray-100 light:text-gray-600',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = ({ className, variant, ...props }: BadgeProps) => (
  <span className={cn(badgeVariants({ variant }), className)} {...props} />
)
