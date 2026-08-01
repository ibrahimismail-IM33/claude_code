# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Overview

This repository is set up as a design/UI workspace powered by the
**UI/UX Pro Max** skill pack. The skills live in `.claude/skills/` and are
picked up automatically by Claude Code sessions in this repo.

## Installed Skills

All skills were installed via the `ui-ux-pro-max-cli` (`uipro init --ai claude`).

| Skill | Use it for |
|-------|-----------|
| `ui-ux-pro-max` | UI/UX design intelligence — searchable database of 67 styles, 161 palettes, 57 font pairings, 25 charts across 21+ tech stacks. Start here for design decisions, color schemes, typography, layout, accessibility. |
| `design` | Comprehensive design: brand identity, logos, corporate identity programs, HTML presentations, banners, icons, social photos. |
| `design-system` | Token architecture (primitive → semantic → component), CSS variables, spacing/type scales, component specs, slide generation. |
| `ui-styling` | Accessible UIs with shadcn/ui (Radix + Tailwind), utility-first styling, responsive layouts, dark mode, themes. |
| `brand` | Brand voice, visual identity, messaging frameworks, asset management, consistency checks. |
| `banner-design` | Banners for social media, ads, website heroes, and print — multiple art directions. |
| `slides` | Strategic HTML presentations with Chart.js, design tokens, and copywriting formulas. |

## How to Use

Just describe what you want in natural language and the relevant skill
triggers automatically, e.g.:

- "Build a landing page for a SaaS product"
- "Create a design token system for a fintech brand"
- "Design a LinkedIn banner in a minimalist style"
- "Generate a pitch deck about our Q3 results"

## Notes

- The skills include helper scripts (Python `.py` / Node `.cjs`) under each
  skill's `scripts/` directory and reference data under `data/` and
  `references/`. Prefer using these over reimplementing equivalent logic.
- To update the skill pack, re-run `uipro init --ai claude`.
