## Context

AdminDash's frontend uses a dark glassmorphism aesthetic with DM Mono/DM Sans fonts, purple accents (#667EEA), backdrop-filter blur effects, and rgba overlays. All styling is vanilla CSS with custom properties in `:root` across 11 CSS files (~1,200 lines total). No CSS framework is used.

Papermite has already completed this same transition (see `papermite/openspec/changes/floatify-style-refresh`). The target is the Floatify design system: light backgrounds (#F8FAFC), Inter font, blue/pink/green/amber accents, clean white cards with subtle shadows. Both apps must look identical so users switching between them feel no style difference.

AdminDash has 5 pages (Login, Home, Students, Leads, Programs), a navbar, data table, filter form, footer, and status badge components.

## Goals / Non-Goals

**Goals:**
- Match papermite's Floatify-inspired light theme exactly — same colors, fonts, spacing, shadows
- Increase readability with Inter font at 16px base and larger headings
- Preserve all existing functionality and component structure
- Maintain existing CSS architecture (custom properties + per-component files)

**Non-Goals:**
- Introducing a CSS framework (Tailwind, CSS-in-JS)
- Restructuring component hierarchy or page layouts
- Adding responsive breakpoints beyond what exists
- Changing the login page flow or app navigation structure
- Matching Floatify's marketing/landing page elements

## Decisions

### Decision 1: Variable-first approach

Update `:root` CSS variables in `index.css` first, then fix component-specific overrides. This maximizes the impact of a single file change.

**Rationale:** AdminDash already has well-structured CSS variables for colors, fonts, borders, radii, and shadows. Floatify's design tokens map cleanly to these. ~60% of the visual change comes from updating `:root` alone.

### Decision 2: Inter font at 16px base

Replace DM Mono + DM Sans with Inter (weights 400, 500, 600, 700, 800). Set html base font size to 16px. Use Inter for everything — no separate mono font.

**Rationale:** Inter is optimized for screen readability. 16px base is the web accessibility sweet spot. Papermite uses Inter exclusively and it reads well at all sizes.

### Decision 3: Color mapping — match papermite exactly

Complete variable mapping:

| Variable | Current (dark) | New (light) |
|---|---|---|
| `--bg-primary` | `#0F0A1A` | `#F8FAFC` |
| `--bg-secondary` | `#151025` | `#FFFFFF` |
| `--bg-tertiary` | `rgba(255,255,255,0.05)` | `#F1F5F9` |
| `--bg-card` | `#1A1230` | `#FFFFFF` |
| `--bg-elevated` | `#201840` | `#FFFFFF` |
| `--bg-input` | `#1E1535` | `#FFFFFF` |
| `--bg-glass` | `rgba(255,255,255,0.1)` | `#FFFFFF` |
| `--border-primary` | `rgba(255,255,255,0.15)` | `#E2E8F0` |
| `--border-subtle` | `rgba(255,255,255,0.08)` | `#EDF2F7` |
| `--border-glass` | `rgba(255,255,255,0.2)` | `#E2E8F0` |
| `--border-accent` | `#667EEA` | `rgba(55, 138, 221, 0.4)` |
| `--text-primary` | `#FFFFFF` | `#1A202C` |
| `--text-secondary` | `rgba(255,255,255,0.7)` | `#4A5568` |
| `--text-tertiary` | `rgba(255,255,255,0.4)` | `#A0AEC0` |
| `--text-inverse` | `#FFFFFF` | `#FFFFFF` |
| `--accent` | `#667EEA` | `#378ADD` |
| `--accent-hover` | `#764BA2` | `#2B6FB5` |
| `--accent-muted` | `rgba(102,126,234,0.15)` | `rgba(55,138,221,0.1)` |
| `--accent-glow` | `rgba(102,126,234,0.08)` | `rgba(55,138,221,0.06)` |
| `--success` | `#34D399` | `#639922` |
| `--success-muted` | `rgba(52,211,153,0.2)` | `rgba(99,153,34,0.1)` |
| `--danger` | `#F87171` | `#D4537E` |
| `--danger-muted` | `rgba(248,113,113,0.15)` | `rgba(212,83,126,0.08)` |
| `--info` | `#60A5FA` | `#378ADD` |
| `--info-muted` | `rgba(96,165,250,0.15)` | `rgba(55,138,221,0.08)` |
| `--warning` | `#FBBF24` | `#EF9F27` |
| `--warning-muted` | `rgba(251,191,36,0.15)` | `rgba(239,159,39,0.1)` |
| `--shadow-card` | purple-tinted glow | `0 4px 16px rgba(0,0,0,0.06)` |
| `--shadow-elevated` | purple-tinted glow | `0 8px 24px rgba(0,0,0,0.08)` |
| `--font-mono` | `'DM Mono', monospace` | `'Inter', system-ui, sans-serif` |
| `--font-sans` | `'DM Sans', sans-serif` | `'Inter', system-ui, sans-serif` |

Add new tinted background pairs:
- `--tint-blue-bg: #E6F1FB` / `--tint-blue-text: #185FA5`
- `--tint-pink-bg: #FBEAF0` / `--tint-pink-text: #993556`
- `--tint-green-bg: #EAF3DE` / `--tint-green-text: #3B6D11`
- `--tint-amber-bg: #FAEEDA` / `--tint-amber-text: #854F0B`

### Decision 4: Remove glassmorphism, use clean cards

Replace `backdrop-filter: blur()` and `rgba()` overlays with white backgrounds, 1px solid borders (`#E2E8F0`), and soft shadows.

**Rationale:** Glassmorphism requires dark backgrounds to look correct. On light backgrounds, clean cards with subtle shadows provide better visual hierarchy. This matches papermite exactly.

### Decision 5: Remove decorative elements

Remove body background radial gradients, gradient-text utility, and gradient button backgrounds. Replace with:
- Clean solid `#F8FAFC` body background
- Accent-colored text (`#378ADD`) for branding
- Solid blue (`#378ADD`) button backgrounds

### Decision 6: Update StatusBadge inline colors

`StatusBadge.tsx` has inline style colors. Remap to tinted pairs for light background visibility:

| Status | Background | Text |
|---|---|---|
| Active/Enrolled | `#EAF3DE` | `#3B6D11` |
| On Leave | `#FAEEDA` | `#854F0B` |
| Suspended | `#E6F1FB` | `#185FA5` |
| Graduated | `#E6F1FB` | `#378ADD` |
| Dropped/Withdrawn | `#FBEAF0` | `#993556` |

### Decision 7: Update schedule event colors

HomePage schedule event color-coding needs adjustment for light backgrounds — use tinted pairs instead of bright saturated colors on dark.

## Risks / Trade-offs

- [Visual regression on edge cases] → Manual walkthrough of all 5 pages after variable swap. StatusBadge inline styles, schedule event colors, and stat card gradients need careful attention since they bypass CSS variables.
- [Scrollbar styling] → Current custom dark scrollbars need updating to light variants or removal to use system defaults.
- [Gradient stat cards on HomePage] → Current purple/blue/green gradient pills must be replaced with tinted pairs that work on white cards.
- [gradient-text removal] → All pages currently use `.gradient-text` on H1 headings. Replace with solid dark text color for consistency with papermite.
