# Design: Dark Theme Redesign

## Context

The login page established a dark aesthetic: deep background (#0F0A1A), glassmorphism cards, purple/violet gradients, white text hierarchy. The rest of the app uses a warm light theme (cream #FAF8F5, white cards, amber #CF8A2E accent). The goal is to bring all pages into the dark design system.

## Goals / Non-Goals

**Goals:**
- Single coherent dark theme across all pages
- Leverage CSS variables so the change is mostly in `:root`
- Glass card treatment as the standard card style
- Purple/violet accent system replacing amber
- Zero JSX changes — purely CSS

**Non-Goals:**
- Theme toggle / light mode option
- Custom per-page color schemes
- Redesigning layouts or component structure

## Decisions

### Decision 1: Retheme via `:root` CSS variables

The biggest win is replacing the `:root` variables in `index.css`. Most components already reference `var(--bg-primary)`, `var(--accent)`, etc. Swapping these to dark values cascades everywhere.

**New palette:**
```css
--bg-primary: #0F0A1A;
--bg-secondary: #1A1230;
--bg-tertiary: #15102A;
--bg-card: rgba(255, 255, 255, 0.04);
--bg-elevated: rgba(255, 255, 255, 0.06);
--bg-input: rgba(255, 255, 255, 0.06);

--border-primary: rgba(255, 255, 255, 0.1);
--border-subtle: rgba(255, 255, 255, 0.06);
--border-accent: rgba(102, 126, 234, 0.4);

--text-primary: #FFFFFF;
--text-secondary: rgba(255, 255, 255, 0.6);
--text-tertiary: rgba(255, 255, 255, 0.35);
--text-inverse: #FFFFFF;

--accent: #667EEA;
--accent-hover: #7C3AED;
--accent-muted: rgba(102, 126, 234, 0.12);
--accent-glow: rgba(102, 126, 234, 0.06);

--success: #34D399;
--success-muted: rgba(52, 211, 153, 0.1);
--danger: #F472B6;
--danger-muted: rgba(244, 114, 182, 0.08);
--info: #60A5FA;
--info-muted: rgba(96, 165, 250, 0.08);
```

### Decision 2: Glass card as default `.card`

```css
.card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  backdrop-filter: blur(24px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}
```

### Decision 3: Gradient primary buttons

```css
.btn--primary {
  background: linear-gradient(135deg, #667EEA, #7C3AED);
  border: none;
  color: #FFFFFF;
}
.btn--primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(102, 126, 234, 0.35);
}
```

### Decision 4: App header gets gradient logo

The `Papermite` logo in the header uses the same gradient text treatment as the login page brand.

### Decision 5: Component-specific fixes

Some CSS files use hardcoded colors (e.g., `rgba(45, 42, 38, 0.35)` for overlay, `white` for toggle thumb). These need targeted updates to work on dark backgrounds. The noise texture overlay (`body::before`) stays but may need opacity adjustment for dark backgrounds.

### Decision 6: Shadows adjusted for dark

Light shadows don't work on dark backgrounds. All box-shadows shift to deeper black with higher opacity.
