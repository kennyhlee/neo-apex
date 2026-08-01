/**
 * Lets any control open the command palette without threading state through
 * the shell. Kept in its own module so the component file only exports a
 * component (react-refresh).
 */
export const PALETTE_EVENT = 'admindash:open-palette';

export function openCommandPalette(): void {
  window.dispatchEvent(new CustomEvent(PALETTE_EVENT));
}
