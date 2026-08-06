// Ported from admindash/frontend/src/components/ui/Button.tsx (interface map §1f).
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Square icon-only button. Requires `aria-label`. */
  icon?: boolean;
  block?: boolean;
  /** Shows `loadingText` and disables the button. */
  loading?: boolean;
  loadingText?: string;
  children?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon = false,
  block = false,
  loading = false,
  loadingText,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    `btn-${variant}`,
    size !== 'md' ? `btn-${size}` : '',
    icon ? 'btn-icon' : '',
    block ? 'btn-block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={classes} disabled={disabled || loading} {...rest}>
      {loading && loadingText ? loadingText : children}
    </button>
  );
}

export default Button;
