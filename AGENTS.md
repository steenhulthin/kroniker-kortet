# AGENTS

This repository is intended to be primarily agent coded. Keep changes small, explain assumptions, and prefer extending the current structure over reshaping it casually.

## Product goal

Build a public-facing map/dashboard for RUKS chronic disease data with a strong path from upstream data release to frontend update.

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
2. Add disease and measure filters.
3. Add chart components for trend comparison.
4. Define the geography contract for municipalities and regions.
5. Add a map component once joinable boundary data is selected.
