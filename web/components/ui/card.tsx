import React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

const cardVariants = cva(
  'rounded-[clamp(24px,6.25vw,32px)] border transition-all duration-200',
  {
    variants: {
      variant: {
        default: 'bg-card dark:bg-card/80 border-border/50 shadow-sm',
        elevated: 'bg-card dark:bg-card/80 border-border/50 shadow-lg hover:shadow-xl',
        ghost: 'bg-transparent border-border/30',
        glass: 'bg-white/5 dark:bg-white/10 backdrop-blur-sm border-border/50',
        accent: 'bg-primary/5 dark:bg-primary/10 border-primary/20',
      },
      padding: {
        none: 'p-0',
        sm: 'p-[clamp(12px,3.13vw,16px)]',
        md: 'p-[clamp(16px,4.69vw,24px)]',
        lg: 'p-[clamp(24px,6.25vw,32px)]',
      },
    },
    defaultVariants: {
      variant: 'default',
      padding: 'md',
    },
  }
)

interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, padding, ...props }, ref) => (
    <div
      className={cardVariants({ variant, padding, className })}
      ref={ref}
      {...props}
    />
  )
)

Card.displayName = 'Card'

interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, ...props }, ref) => (
    <div className={`flex flex-col space-y-1.5 ${className || ''}`} ref={ref} {...props} />
  )
)

CardHeader.displayName = 'CardHeader'

interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {}

const CardTitle = React.forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ className, ...props }, ref) => (
    <h3
      className={`text-[length:clamp(17px,3.91vw,20px)] font-bold text-foreground ${className || ''}`}
      ref={ref}
      {...props}
    />
  )
)

CardTitle.displayName = 'CardTitle'

interface CardDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {}

const CardDescription = React.forwardRef<HTMLParagraphElement, CardDescriptionProps>(
  ({ className, ...props }, ref) => (
    <p
      className={`text-sm text-muted-foreground ${className || ''}`}
      ref={ref}
      {...props}
    />
  )
)

CardDescription.displayName = 'CardDescription'

interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {}

const CardContent = React.forwardRef<HTMLDivElement, CardContentProps>(
  ({ className, ...props }, ref) => (
    <div className={`pt-[clamp(8px,3.13vw,16px)] ${className || ''}`} ref={ref} {...props} />
  )
)

CardContent.displayName = 'CardContent'

interface CardFooterProps extends React.HTMLAttributes<HTMLDivElement> {}

const CardFooter = React.forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, ...props }, ref) => (
    <div className={`flex items-center pt-[clamp(8px,3.13vw,16px)] ${className || ''}`} ref={ref} {...props} />
  )
)

CardFooter.displayName = 'CardFooter'

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  cardVariants,
}
