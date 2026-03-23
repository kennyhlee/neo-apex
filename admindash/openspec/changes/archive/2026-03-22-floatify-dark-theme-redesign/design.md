## Context

The admin dashboard uses plain CSS with CSS variables defined in `index.css`. All components import their own `.css` files. The current theme is light with warm gold/bronze accents (`#CF8A2E`), DM Sans font, and off-white backgrounds (`#FAF8F5`). The target is floatify.com's dark glassmorphism aesthetic — but adapted for an admin tool where users work with data tables and forms for extended periods.

## Goals / Non-Goals

**Goals:**
- Match the floatify.com visual identity across all dashboard pages (color palette, gradients, glass effects)
- Adapt data-dense areas (tables, forms) for readability during extended use
- Maintain the existing CSS architecture (CSS variables + component CSS files)
- Preserve all existing functionality and layout structure
- Ensure readability and contrast meet accessibility standards on dark backgrounds

**Non-Goals:**
- Adding a theme toggle or light/dark mode switcher (full replacement only)
- Changing component structure, HTML, or React logic (except adding `gradient-text` class to headings)
- Swapping fonts — DM Sans / DM Mono are visually close to Inter and avoid layout risk
- Adding new CSS tooling (Tailwind, CSS-in-JS, etc.)
- Matching floatify.com's landing page layout — only the visual design language

## Decisions

### Decision 1: CSS variable overhaul in index.css

Replace all existing CSS variables with the Floatify dark palette. This is the most efficient approach since the codebase already uses CSS variables consistently.

**New design tokens:**
- Backgrounds: `#0F0A1A` (deep), `#1A1230` (card), `rgba(255,255,255,0.1)` (glass)
- Text: `#FFFFFF` (primary), `rgba(255,255,255,0.7)` (secondary), `rgba(255,255,255,0.4)` (tertiary)
- Accent gradient: `#667EEA` → `#764BA2` (purple-violet)
- Borders: `rgba(255,255,255,0.2)` (glass borders)
- Shadows: glow-based with `rgba(102, 126, 234, 0.35)`

**Alternative considered:** Creating a separate theme file and toggling via class. Rejected because there's no requirement for theme switching and it adds complexity.

### Decision 2: Keep DM Sans / DM Mono fonts

Keep existing fonts rather than swapping to Inter. Both are clean geometric sans-serifs that look similar at body text sizes. This avoids layout shifts and keeps the change focused on color/effects.

**Alternative considered:** Swap to Inter for exact Floatify match. Rejected because the visual difference is minimal and font swaps risk subtle layout issues across every component.

### Decision 3: Two-tier glassmorphism — chrome vs. data areas

Apply full glassmorphism (`backdrop-filter: blur(20px)`, semi-transparent backgrounds, subtle borders) to **UI chrome**: navbar, card wrappers, page containers, login card.

Use **higher-contrast opaque backgrounds** for **data-dense areas**: table cells, form inputs, filter controls. These use `--bg-card` (`#1A1230`) or slightly lighter variants instead of translucent glass, ensuring text remains easy to scan during extended use.

**Alternative considered:** Full glassmorphism everywhere. Rejected because translucent backgrounds on table cells and form inputs reduce readability when users are scanning dense data for hours.

### Decision 4: Component-by-component style updates

Update each component's CSS file individually rather than trying to override everything globally. This preserves the existing architecture and makes changes traceable.

### Decision 5: Gradient text on brand + page headings

Add a `.gradient-text` utility class for the Floatify multi-color gradient text effect (purple → pink → green). Apply to the navbar brand text and page H1 headings. This requires minor TSX changes to add the class to heading elements.

## Risks / Trade-offs

- **Readability on dark backgrounds** → Use `rgba(255,255,255,0.7)` minimum for body text, pure white for headings. Higher-contrast opaque backgrounds for data areas.
- **Glassmorphism browser support** → `backdrop-filter` is well-supported in modern browsers. Fallback: solid dark background without blur.
- **StatusBadge inline colors** → Badge colors reference CSS variables that will change. The existing `--success-muted`, `--danger-muted` etc. variables will be updated to semi-transparent values that work on dark backgrounds.
- **Existing background texture SVG** → The current noise overlay on body will be removed and replaced with radial gradient decorations.
- **TSX changes for gradient text** → Adding `className="gradient-text"` to page headings is a minor but necessary React code change beyond pure CSS updates.
