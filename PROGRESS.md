# PROGRESS — bitácora de la rutina

Formato: `- YYYY-MM-DD HH:MM · Fase N · tarea · commit · notas`

- 2026-10-07 17:40 · Setup · Repo inicializado con PLAN.md, CLAUDE.md, docs/parsing-spec.md, README y LICENSE · (commit inicial) · La rutina automática empieza en la Fase 0.
- 2026-10-07 18:16 · Fase 0 · Create Next.js 15 project (App Router, TS, Tailwind, ESLint) · this commit · Used create-next-app@15 (Next 15.5.27, React 19.1) instead of @latest, which is Next 16, to match the stack in CLAUDE.md. Scaffolded in a temp subfolder and moved to the root because the root already had files; kept the existing README and merged .gitignore (template's `.env*` rule dropped so .env.example can be committed). lint, tsc --noEmit and next build pass; no tests yet. npm audit: high-severity postcss advisory nested in next 15.5.x, only fixed in Next 16 — needs a decision from Satoru later. Branch created from local main, which had 2 unpushed commits (PLAN/CLAUDE/spec); they ship with this branch.
