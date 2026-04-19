# Kroniker-kortet

`kroniker-kortet` is a greenfield dashboard and mapping frontend for exploring Danish chronic disease data published through [`steenhulthin/ruks-data`](https://github.com/steenhulthin/ruks-data).

The current scaffold is intentionally small:

- Vite + React + TypeScript for a fast SPA workflow
- a typed client for the upstream GitHub Releases API contract
- a Parquet-first data strategy for browser-side reads
- a visual dashboard shell ready for charts, filters, and a municipality map
- repo docs so future agents can add features without re-deciding the basics

## Upstream relationship

The upstream data project currently publishes:

- a latest release record via the GitHub Releases API
- release artifacts including normalized CSV, Parquet, and SQLite outputs

This repo now treats the latest GitHub release as the live source of truth. The frontend resolves the newest release, identifies the Parquet asset, and is being shaped around browser-side analytics on static hosting.

## Getting started

```bash
npm install
npm run dev
```

The app looks for `VITE_RUKS_LATEST_RELEASE_URL` first. If that variable is unset, it defaults to the public GitHub endpoint for the latest `steenhulthin/ruks-data` release. If that request fails, it falls back to the bundled sample at `public/data/latest-release.json`.

Example:

```bash
VITE_RUKS_LATEST_RELEASE_URL=https://api.github.com/repos/steenhulthin/ruks-data/releases/latest npm run dev
```

## Project layout

- `src/app/`: app shell and data loading
- `src/lib/`: types and release-resolution helpers for RUKS data
- `public/data/`: local fallback data for offline development
- `docs/roadmap.md`: product and engineering milestones
- `docs/spatial-data.md`: boundary-source and map-format notes
- `AGENTS.md`: working agreements for agent-led development

## Current scope

Version `0.1.0` is a frontend scaffold, not a finished analytical product. It is meant to give us a stable place to build:

- latest release discovery and asset selection
- DuckDB-Wasm powered Parquet queries in the browser
- filters for disease, measure, year, and geography
- a choropleth or proportional-symbol municipality map
- deployment and refresh automation
