import React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-2xl font-semibold text-sm sm:text-base transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-0 dark:focus:ring-offset-background',
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
        sm: 'px-3 sm:px-4 py-2 sm:py-2.5',
        md: 'px-4 sm:px-6 py-2.5 sm:py-3',
        lg: 'px-6 sm:px-8 py-3 sm:py-4',
        icon: 'h-9 w-9 sm:h-10 sm:w-10',
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
          className="h-4 w-4 sm:h-5 sm:w-5 animate-spin"
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
