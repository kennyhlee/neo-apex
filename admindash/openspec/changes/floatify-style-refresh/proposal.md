## Why

AdminDash currently uses a dark glassmorphism theme (deep purples, blur effects, DM Mono/DM Sans fonts) that feels heavy and strains the eyes during extended admin sessions. Papermite has already adopted the Floatify light design system — a clean, airy aesthetic with Inter font, generous sizing, and soft color accents. Since admindash and papermite are used interchangeably by the same users, the visual style must be identical so switching between them feels seamless.

## What Changes

- Replace dark theme with light theme: swap deep dark backgrounds (#0F0A1A) for light slate (#F8FAFC) with white card surfaces
- Replace color palette: move from purple/violet accent (#667EEA) to Floatify's multi-accent system (blue #378ADD, pink #D4537E, green #639922, amber #EF9F27) with tinted background pairs
- Replace typography: swap DM Mono/DM Sans for Inter with larger base font size (16px), heavier heading weights (700-800), tighter letter-spacing (-0.02em) on headings
- Increase font sizes across the board: body from 15px to 16px, headings scaled up, labels minimum 12px
- Remove glassmorphism: replace backdrop-filter blur and rgba overlays with clean white cards, subtle 1px borders (#E2E8F0), and soft box-shadows
- Update spacing: increase card padding, section gaps, button padding to match Floatify/papermite spacing system
- Update border radius: standardize to 12-16px for cards, 8-12px for buttons/inputs, 20px for badges
- Update button styles: solid accent-blue backgrounds with shadow lift on hover instead of purple gradient treatments
- Update input styles: white backgrounds with light borders, blue focus state
- Remove decorative background gradients and gradient-text utility in favor of clean solid colors
- Preserve all functionality: no layout restructuring or component API changes — purely visual

## Capabilities

### New Capabilities

- `readable-typography`: Inter font system with 16px+ base size, readable heading hierarchy, and minimum 12px for all labels
- `tinted-status-indicators`: Colored tint pairs (background + text) for badges and status elements on light backgrounds

### Modified Capabilities

- `dark-glassmorphism-theme`: **BREAKING** — Replacing entire dark theme with Floatify-inspired light theme, new color palette, new shadows, removing glassmorphism and decorative gradients
- `floatify-component-styles`: **BREAKING** — Updating all component styles from dark to light: navbar, data table, filter form, login page, home page, status badges, footer, and page headings

## Impact

- All 11 CSS files under `frontend/src/` need variable and style updates
- `index.html`: Google Fonts import changes from DM Mono/DM Sans to Inter
- `StatusBadge.tsx`: inline style colors need updating for light background contrast
- No backend changes — purely frontend visual update
- No component API changes — TSX structure stays the same
- No dependency changes — no new npm packages required
