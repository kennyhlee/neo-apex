## Why

Papermite's current UI uses a dark cyberpunk aesthetic (deep purples, glassmorphism, monospace fonts) that feels heavy and strains the eyes during extended admin sessions. The Floatify design system — a clean, light, airy aesthetic with Inter font, generous spacing, and soft color accents — is significantly more readable and professional. Adopting this style improves usability for tenant admins who spend time reviewing and editing model definitions.

## What Changes

- **Replace dark theme with light theme**: Swap deep dark backgrounds (#0F0A1A) for light slate (#F8FAFC) with white card surfaces
- **Replace color palette**: Move from purple/violet accent (#667EEA) to Floatify's multi-accent system (blue #378ADD, pink #D4537E, green #639922, amber #EF9F27) with tinted background pairs for status/semantic elements
- **Replace typography**: Swap DM Mono/DM Sans for Inter with larger base font size (16px+), heavier heading weights (700-800), and tighter letter-spacing (-0.02em) on headings for modern feel
- **Increase font sizes**: Body text from 14px → 16px, headings scaled up proportionally, labels from 10-11px → 12-13px minimum
- **Soften visual treatment**: Replace glassmorphism (backdrop-blur, rgba overlays) with clean white cards, subtle 1px borders (#E2E8F0), and soft box-shadows
- **Update spacing**: Increase card padding to 20-24px, section gaps to 24-32px, button padding to 14px × 28px, aligned with Floatify's spacing system
- **Update border radius**: Standardize to 12-16px for cards, 10-12px for buttons/inputs, 8px for badges
- **Update button styles**: Solid accent-blue backgrounds with subtle shadow lift on hover instead of gradient treatments
- **Update input styles**: White backgrounds with light borders, blue focus state
- **Preserve all functionality**: No layout restructuring or component API changes — purely visual

## Capabilities

### New Capabilities

_None — this is a restyling of existing UI, not new functionality._

### Modified Capabilities

- `theme`: Replacing dark visual language with Floatify-inspired light theme, new color palette, new typography, and updated component styling

## Impact

- **CSS files** (all 11): Every CSS file under `frontend/src/` needs variable and style updates
- **index.html**: Google Fonts import changes from DM Mono/DM Sans to Inter
- **No backend changes**: Purely frontend visual update
- **No component API changes**: TSX files only change if they have inline styles or hardcoded colors
- **No dependency changes**: No new npm packages required
