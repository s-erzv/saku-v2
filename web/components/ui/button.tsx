import React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-2xl font-semibold text-[length:clamp(13px,3.13vw,16px)] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-0 dark:focus:ring-offset-background',
  {
    variants: {
      variant: {
        primary: 'bg-primary hover:bg-primary/90 text-primary-foreground shadow-md hover:shadow-lg',
        secondary: 'bg-secondary hover:bg-secondary/80 text-secondary-foreground shadow-sm hover:shadow-md',
        accent: 'bg-accent hover:bg-accent/90 text-accent-foreground shadow-md hover:shadow-lg',
        outline: 'border border-border bg-transparent hover:bg-muted text-foreground',
        ghost: 'bg-transparent hover:bg-muted text-foreground',
        destructive: 'bg-destructive hover:bg-destructive/90 text-destructive-foreground shadow-md',
      },
      size: {
        sm: 'px-[clamp(12px,3.13vw,16px)] py-[clamp(8px,1.95vw,10px)]',
        md: 'px-[clamp(16px,4.69vw,24px)] py-[clamp(9px,2.34vw,12px)]',
        lg: 'px-[clamp(24px,6.25vw,32px)] py-[clamp(12px,3.13vw,16px)]',
        icon: 'h-[clamp(36px,7.81vw,40px)] w-[clamp(36px,7.81vw,40px)]',
        iconSm: 'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
)

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  isLoading?: boolean
  icon?: React.ReactNode
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, isLoading, icon, children, disabled, ...props }, ref) => (
    <button
      className={buttonVariants({ variant, size, className })}
      disabled={disabled || isLoading}
      ref={ref}
      {...props}
    >
      {isLoading && (
        <svg
          className="h-[clamp(16px,3.91vw,20px)] w-[clamp(16px,3.91vw,20px)] animate-spin"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}
      {icon && !isLoading && <span className="flex-shrink-0">{icon}</span>}
      {children}
    </button>
  )
)

Button.displayName = 'Button'

export { Button, buttonVariants }
