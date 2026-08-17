import * as React from "react"
import { cn } from "@/lib/utils"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'cta' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
  size?: 'default' | 'sm' | 'lg' | 'icon'
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    return (
      <button
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
          {
            'bg-primary text-primary-foreground hover:bg-primary/90': variant === 'default',
            // `cta` — the primary call to action of a surface, in the ONLY step of the
            // `primary` ramp that carries white text at AA: white on `#00719F` measures
            // 5.44:1, white on the `default`'s `#00A8E8` measures 2.70:1 and fails SC 1.4.3
            // (it fails even the 3:1 of the non-text criterion). Measured by the `design`,
            // DS-COR-002 — `spec-parceria-formulario-e-contrato-2026-08.md` §2.1: "toda CTA
            // primária das duas superfícies desta spec usa `bg-primary-800` com texto branco".
            //
            // IT IS A SECOND VARIANT AND NOT A NEW `default` ON PURPOSE. Repainting `default`
            // changes every screen in the CMS in one commit, and that is card #381; this one
            // only stops the new surfaces from being born with the defect.
            //
            // The hover DARKENS with a filter and never with `/90` opacity: opacity composes
            // with the white behind the button and LIGHTENS it, which is how the destructive
            // variant right below lost 4.5:1 in exactly the state the operator clicks in.
            'bg-primary-800 text-white hover:brightness-90': variant === 'cta',
            // `hover:bg-destructive-hover`, never `/90`: opacity composes with the surface
            // behind the button, and over the white of a dialog it LIGHTENS to 4.32:1
            // (SC 1.4.3 AA needs 4.5:1, and hover is the state the operator reads in).
            'bg-destructive text-destructive-foreground hover:bg-destructive-hover': variant === 'destructive',
            'border border-input bg-background hover:bg-accent hover:text-accent-foreground': variant === 'outline',
            'bg-secondary text-secondary-foreground hover:bg-secondary/80': variant === 'secondary',
            'hover:bg-accent hover:text-accent-foreground': variant === 'ghost',
            'text-primary underline-offset-4 hover:underline': variant === 'link',
          },
          {
            'h-10 px-4 py-2': size === 'default',
            'h-9 rounded-md px-3': size === 'sm',
            'h-11 rounded-md px-8': size === 'lg',
            'h-10 w-10': size === 'icon',
          },
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }
