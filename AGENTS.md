# AGENTS

This repository is intended to be primarily agent coded. Keep changes small, explain assumptions, and prefer extending the current structure over reshaping it casually.

## Product goal

Build a public-facing map/dashboard for RUKS chronic disease data with a strong path from upstream data release to frontend update.

## Product shape

- Header with the dashboard title
- Sidebar with filters for disease, geography detail, year, age group, and sex
- Main area centered on a choropleth map
- Primary map metric: `Antal personer pr. 100.000 borgere`
- User-facing UI copy must be Danish. Keep internal code names, comments, logs, and technical identifiers in English when they already are.

## Current technical direction

- Frontend: Vite + React + TypeScript SPA
- Release discovery: GitHub Releases API for `steenhulthin/ruks-data`
- First analytical artifact: `ruks_hovedresultater_long.parquet`
- Query engine: DuckDB-Wasm in the browser
- Future data sources: release manifest JSON, Dataforsyningen municipality/region geometry, and derived app-side aggregates
- Current boundary source: Dataforsyningen DAGI WFS with `dagi:Kommuneinddeling` and `dagi:Regionsinddeling`

## Guardrails

- If there are several viable implementation options with meaningful tradeoffs, stop and ask the user before committing to one.
- Do not invent geography fields that are not present upstream.
- Prefer Parquet over CSV or SQLite for static browser reads unless the user asks otherwise or a verified blocker appears.
- Keep disease data and boundary geometry as separate delivery artifacts unless there is a strong reason to combine them.
- Treat municipality mapping as a separate integration step that needs explicit geometry data and join keys.
- Keep data transforms in `src/lib/` and UI concerns in `src/app/`.
- Prefer typed helpers over ad hoc object access in components.
- If you add a new dependency, explain why in the final response.

## Near-term priorities

1. Add DuckDB-Wasm query helpers for the remote Parquet asset.
2. Add sidebar filters for disease, geography detail, year, age group, and sex.
3. Define the geography contract for municipalities and regions.
4. Add a choropleth map driven by `Antal personer pr. 100.000 borgere`.
5. Add chart components for supporting trend comparison.
