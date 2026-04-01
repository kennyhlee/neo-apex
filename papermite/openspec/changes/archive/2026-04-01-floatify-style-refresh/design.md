## Context

Papermite's frontend uses a dark cyberpunk aesthetic with glassmorphism, DM Mono/DM Sans fonts, and purple accents. The Floatify design system uses a clean light theme with Inter font, blue/pink/green/amber accents, and soft shadows. All styling is in vanilla CSS with custom properties in `:root`, making a theme swap straightforward — update variables and adjust component styles.

There are 11 CSS files totaling ~1,981 lines. No CSS framework (Tailwind, etc.) is involved. Components reference CSS variables consistently, so most changes propagate through `:root` updates.

## Goals / Non-Goals

**Goals:**
- Match Floatify's light, airy visual aesthetic across all pages
- Increase readability with larger font sizes (16px+ body) and Inter font
- Preserve all existing functionality and component structure
- Maintain the existing CSS architecture (custom properties + per-component files)

**Non-Goals:**
- Introducing a CSS framework (Tailwind, CSS-in-JS, etc.)
- Restructuring component hierarchy or page layouts
- Adding responsive breakpoints beyond what exists
- Matching Floatify's landing page marketing elements (hero, feature rows, CTA)
- Changing the login page flow or app navigation structure

## Decisions

### 1. Variable-first approach

Update `:root` CSS variables in `index.css` first, then fix component-specific overrides. This maximizes the impact of a single file change before touching the other 10 files.

**Rationale:** Papermite already has well-structured CSS variables for colors, fonts, borders, radii, and shadows. Floatify's design tokens map cleanly to these. ~60% of the visual change comes from updating `:root` alone.

### 2. Inter font at 16px base

Replace DM Mono + DM Sans with Inter (weights 400, 500, 600, 700, 800). Set base font size to 16px. Use Inter for everything — no separate mono font for UI chrome.

**Rationale:** Inter is optimized for screen readability with open apertures and tall x-height. 16px base is the web accessibility sweet spot. Floatify uses Inter exclusively and it reads well at all sizes.

**Alternative considered:** Keep DM Sans for body, only swap headings. Rejected because mixing two sans-serif families creates visual noise without adding value.

### 3. Map Floatify's color system to papermite's variable structure

| Papermite Variable | Current Value | New Value |
|---|---|---|
| `--bg-primary` | `#0F0A1A` | `#F8FAFC` |
| `--bg-secondary` | `#1A1230` | `#FFFFFF` |
| `--bg-card` | `rgba(255,255,255,0.04)` | `#FFFFFF` |
| `--bg-input` | `rgba(255,255,255,0.06)` | `#FFFFFF` |
| `--border-primary` | `rgba(255,255,255,0.1)` | `#E2E8F0` |
| `--text-primary` | `#FFFFFF` | `#1A202C` |
| `--text-secondary` | `rgba(255,255,255,0.6)` | `#4A5568` |
| `--text-tertiary` | `rgba(255,255,255,0.35)` | `#A0AEC0` |
| `--accent` | `#667EEA` | `#378ADD` |
| `--accent-hover` | `#7C3AED` | `#2B6FB5` |
| `--accent-muted` | `rgba(102, 126, 234, 0.12)` | `rgba(55, 138, 221, 0.1)` |
| `--accent-glow` | `rgba(102, 126, 234, 0.06)` | `rgba(55, 138, 221, 0.06)` |
| `--success` | `#34D399` | `#639922` |
| `--success-muted` | `rgba(52, 211, 153, 0.1)` | `rgba(99, 153, 34, 0.1)` |
| `--danger` | `#F472B6` | `#D4537E` |
| `--danger-muted` | `rgba(244, 114, 182, 0.08)` | `rgba(212, 83, 126, 0.08)` |
| `--info` | `#60A5FA` | `#378ADD` |
| `--info-muted` | `rgba(96, 165, 250, 0.08)` | `rgba(55, 138, 221, 0.08)` |
| `--bg-tertiary` | `#15102A` | `#F1F5F9` |
| `--bg-elevated` | `rgba(255,255,255,0.06)` | `#FFFFFF` |
| `--border-subtle` | `rgba(255,255,255,0.06)` | `#EDF2F7` |
| `--border-accent` | `rgba(102, 126, 234, 0.4)` | `rgba(55, 138, 221, 0.4)` |
| `--shadow-card` | `0 4px 16px rgba(0,0,0,0.3), ...` | `0 4px 16px rgba(0,0,0,0.06)` |
| `--shadow-elevated` | `0 8px 32px rgba(0,0,0,0.4), ...` | `0 8px 24px rgba(0,0,0,0.08)` |
| `--font-mono` | `'DM Mono', 'Menlo', monospace` | `'Inter', system-ui, sans-serif` |

Note: `--info` and `--accent` both map to `#378ADD` intentionally — Floatify uses blue as both the primary accent and info color.

Add new Floatify tinted background pairs (e.g., `--tint-blue-bg: #E6F1FB`, `--tint-blue-text: #185FA5`) for badges and status indicators.

### 4. Remove glassmorphism, add clean card style

Replace `backdrop-filter: blur()` and `rgba()` overlays with white backgrounds, 1px solid borders (`#E2E8F0`), and soft box-shadows (`0 4px 16px rgba(0,0,0,0.06)`).

**Rationale:** Glassmorphism requires dark backgrounds to look correct. On a light background, clean cards with subtle shadows provide better visual hierarchy.

### 5. Remove background texture and gradient decorations

Remove the fractal noise texture overlay on body and gradient logo shimmer animations. Replace with clean solid backgrounds and simple colored text.

### 6. Remap entity TYPE_COLORS to Floatify palette

`EntityCard.tsx` has a `TYPE_COLORS` constant with 9 hardcoded hex colors for entity type headers. Remap these to Floatify's accent palette while keeping entity types visually distinct. Use the four Floatify accents plus derived shades:

| Entity Type | Current | New |
|---|---|---|
| TENANT | `#0969DA` | `#378ADD` (blue) |
| PROGRAM | `#1A7F37` | `#639922` (green) |
| STUDENT | `#CF8A2E` | `#EF9F27` (amber) |
| GUARDIAN | `#8250DF` | `#D4537E` (pink) |
| ENROLLMENT | `#BF3989` | `#993556` (dark pink) |
| REGAPP | `#CF222E` | `#854F0B` (dark amber) |
| EMERGENCY_CONTACT | `#BC4C00` | `#3B6D11` (dark green) |
| MEDICAL_CONTACT | `#0550AE` | `#185FA5` (dark blue) |
| ATTENDANCE | `#2DA44E` | `#639922` (green) |

**Rationale:** Keep colors from within the Floatify palette family so entity badges feel cohesive with the rest of the UI. Exact shades can be tuned during implementation.

### 7. Update login page to light theme

The login page currently has its own radial gradient dark glows. Align it with the new light aesthetic — white glass card on light background, blue accent button.

## Risks / Trade-offs

- **[Visual regression on edge cases]** → Manual review of all pages after variable swap. Entity card table rows, selection options editor, and toggle switches need careful attention since they use many layered opacity values.
- **[Login page glow effects lost]** → Replace with a subtle radial gradient using Floatify's blue at low opacity. The effect is lighter but still provides visual interest.
- **[Scrollbar styling]** → Current custom dark scrollbars need updating to light variants or removed to use system defaults.
- **[Hardcoded colors in TSX]** → Grep for any inline hex/rgba values in component files that bypass CSS variables. These need manual fixes.
