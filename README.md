# Kroniker-kortet

`kroniker-kortet` is a greenfield dashboard and mapping frontend for exploring Danish chronic disease data published through [`steenhulthin/ruks-data`](https://github.com/steenhulthin/ruks-data).

The current scaffold is intentionally small:

- Vite + React + TypeScript for a fast SPA workflow
- a typed client for the upstream GitHub Releases API contract
- a Parquet-first data strategy for browser-side reads
- a visual dashboard shell with header, filter sidebar, and map-first main area
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

Municipality and region boundaries are loaded from static DAGI-derived FlatGeobuf artifacts at `public/data/dagi-municipalities.fgb` and `public/data/dagi-regions.fgb`. Set `VITE_DAGI_MUNICIPALITY_BOUNDARIES_URL` or `VITE_DAGI_REGION_BOUNDARIES_URL` to point at different static boundary artifacts.

The bundled `.fgb` files are generated from the local 1:2,000,000 DAGI shapefiles and reprojected from ETRS89 / UTM zone 32N to WGS84 for MapLibre:

```bash
npm run build:boundaries
```

Example:

```bash
VITE_RUKS_LATEST_RELEASE_URL=https://api.github.com/repos/steenhulthin/ruks-data/releases/latest npm run dev
```

## GitHub Pages deployment

The repository includes `.github/workflows/pages.yml`, which builds the Vite app and uploads `dist/` as a GitHub Pages artifact. In GitHub, configure Pages to use **GitHub Actions** as the source.

The workflow runs `npm run sync:ruks-release` before building. That step downloads the latest RUKS Parquet release asset into `public/data/` and rewrites the bundled release metadata to point at the local static copy, avoiding browser CORS issues with GitHub release assets.

Production builds default to the GitHub Pages project path `/kroniker-kortet/`. Override it for another static host with:

```bash
VITE_APP_BASE_PATH=/ npm run build
```

## Project layout

- `src/app/`: app shell and data loading
- `src/lib/`: types and release-resolution helpers for RUKS data
- `public/data/`: local fallback data for offline development
- `docs/roadmap.md`: product and engineering milestones
- `docs/spatial-data.md`: boundary-source and map-format notes
- `docs/dashboard-spec.md`: current product/UI requirements for the dashboard
- `AGENTS.md`: working agreements for agent-led development

## Current scope

Version `0.1.0` is a frontend scaffold, not a finished analytical product. It is meant to give us a stable place to build:

- latest release discovery and asset selection
- DuckDB-Wasm powered Parquet queries in the browser
- filters for disease, geography detail, year, age group, and sex
- a choropleth municipality/region map colored by `Antal personer pr. 100.000 borgere`
- deployment and refresh automation
