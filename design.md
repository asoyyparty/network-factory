# Design — Network Factory Control System

A locked design system for this app, produced following the Hallmark anti-AI-slop design methodology. Every page redesign reads this file before emitting code.

## Genre
**Modern-Minimal / Industrial Telemetry Workbench**
Precision engineering aesthetic. Replaces video-game cyberpunk or generic SaaS dark-mode templates with clean, tactile mission-control instrumentation inspired by Braun, Teenage Engineering, and Linear.

## Macrostructure Family
- **App Dashboard (`public/index.html`)**: **05 · The Workbench** (dense telemetry status header, collapsible zone rail, multi-tab instrument views with orthogonal schematic network topology, data-dense tabular alignment).
- **Authentication Portal (`public/login.html`)**: **Instrument Access Terminal** (crisp hairline card, honest physical materials, zero floating orbs or scanline gimmicks).

## Theme Tokens (OKLCH Precision Palette)
```css
:root {
  /* Surfaces (Carbon & Slate) */
  --color-paper:       oklch(0.13 0.012 255); /* Base obsidian canvas */
  --color-paper-2:     oklch(0.17 0.016 255); /* Elevated panel */
  --color-paper-3:     oklch(0.22 0.020 255); /* Recessed/active surface */
  --color-paper-hover: oklch(0.25 0.022 255); /* Hover surface */

  /* Inks (Zinc & Silver) */
  --color-ink:         oklch(0.96 0.005 255); /* Primary text */
  --color-ink-2:       oklch(0.72 0.015 255); /* Muted telemetry text */
  --color-ink-3:       oklch(0.50 0.018 255); /* De-emphasized labels */

  /* Hairline Rules */
  --color-rule:        oklch(0.26 0.018 255); /* 1px crisp structural divider */
  --color-rule-focus:  oklch(0.46 0.035 255); /* Active element boundary */

  /* Telemetry Accents */
  --color-accent:      oklch(0.68 0.160 225); /* Cobalt telemetry primary */
  --color-accent-hover:oklch(0.74 0.175 225);
  --color-focus:       oklch(0.68 0.160 225);

  /* Functional Status Indicators */
  --color-ok:          oklch(0.72 0.170 150); /* Phosphor Emerald (Online) */
  --color-warn:        oklch(0.78 0.160 75);  /* Industrial Amber (Latency/Warning) */
  --color-alert:       oklch(0.64 0.210 25);  /* Signal Vermilion (Down/Critical) */
  --color-idle:        oklch(0.40 0.020 255); /* Standby/Unknown Slate */
}
```

## Typography (The 2+1 Discipline)
- **UI & Display**: `Plus Jakarta Sans`, sans-serif (weights: 400, 500, 600, 700). Normal style (no italic display headers).
- **Data & Telemetry**: `JetBrains Mono` / `IBM Plex Mono`, monospace (weights: 400, 500, 600) with `font-variant-numeric: tabular-nums` for rock-solid column and metric alignment.
- **Letter Spacing**: Display tracking `-0.02em`, Mono tracking `-0.01em` to `+0.04em` on micro-labels.

## Hairline Architecture (No Glassmorphism Blur)
- Standardize all borders on `1px solid var(--color-rule)`.
- Strip `backdrop-filter: blur()`, faux cyan drop-shadow glows, and decorative background grid lines.
- Modals and cards use tactile solid surfaces with crisp micro-bevels:
  `box-shadow: 0 16px 32px -8px rgba(0,0,0,0.65), 0 0 0 1px var(--color-rule), inset 0 1px 0 rgba(255,255,255,0.06);`

## Tactile Microinteractions & State Discipline
Every interactive control (switch, button, input, tab) adheres strictly to the **8 Hallmark states**:
1. `default`
2. `hover`
3. `:focus-visible` (crisp 2px solid `var(--color-focus)` with 2px offset)
4. `:active` (tactile `transform: translateY(1px)`)
5. `disabled`
6. `loading`
7. `error`
8. `success`

## CTA Voice
- **Primary Action**: Solid cobalt button, crisp micro-radius (`6px`), high-contrast ink, tactile press state.
- **Secondary Action**: Outline hairline border (`1px solid var(--color-rule)`), recessed hover fill.
- **Destructive Action**: Signal Vermilion outline with subtle crimson wash on active.
