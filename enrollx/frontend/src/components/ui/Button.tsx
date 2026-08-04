import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

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
  /**
   * Forwarded to the underlying `<button>`. React 19 passes `ref` to function
   * components as an ordinary prop, but `ButtonHTMLAttributes` doesn't declare
   * it, so it has to be named here for TypeScript. Needed by callers that must
   * move focus programmatically — e.g. the Flow Builder restoring focus after
   * a row is moved or removed and the focused control disappears.
   */
  ref?: Ref<HTMLButtonElement>;
}

/**
 * The single button component. Geometry comes from the density tokens, so a
 * density change restyles every button without a second rule.
 */
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
