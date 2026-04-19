# AGENTS

This repository is intended to be primarily agent coded. Keep changes small, explain assumptions, and prefer extending the current structure over reshaping it casually.

## Product goal

Build a public-facing map/dashboard for RUKS chronic disease data with a strong path from upstream data release to frontend update.

## Current technical direction

- Frontend: Vite + React + TypeScript SPA
- First data contract: `latest-summary.json` from `steenhulthin/ruks-data`
- Future data sources: release manifest JSON, SQLite-derived API/export layer, municipality geometry

## Guardrails

- Do not invent geography fields that are not present upstream.
- Treat municipality mapping as a separate integration step that needs explicit geometry data and join keys.
- Keep data transforms in `src/lib/` and UI concerns in `src/app/`.
- Prefer typed helpers over ad hoc object access in components.
- If you add a new dependency, explain why in the final response.

## Near-term priorities

1. Add disease and measure filters.
2. Add chart components for trend comparison.
3. Define the geography contract for municipalities and regions.
4. Add a map component once joinable boundary data is selected.
5. Decide deployment target and automated data-refresh flow.

