# Kroniker-kortet

`kroniker-kortet` is a greenfield dashboard and mapping frontend for exploring Danish chronic disease data published through [`steenhulthin/ruks-data`](https://github.com/steenhulthin/ruks-data).

The initial scaffold is intentionally small:

- Vite + React + TypeScript for a fast SPA workflow
- a typed client for the upstream `latest-summary.json` contract
- a visual dashboard shell ready for charts, filters, and a municipality map
- repo docs so future agents can add features without re-deciding the basics

## Upstream relationship

The upstream data project currently publishes:

- `site/data/latest-summary.json` for lightweight frontend reads
- `data/manifests/latest.json` for release metadata
- release artifacts including normalized CSV, Parquet, and SQLite outputs

This repo starts by consuming the summary JSON. The next major step is to add municipality geometry and a richer query layer for map interactions.

## Getting started

```bash
npm install
npm run dev
```

The app looks for `VITE_RUKS_SUMMARY_URL` first. If that variable is unset, it falls back to the bundled sample at `public/data/latest-summary.json`.

Example:

```bash
VITE_RUKS_SUMMARY_URL=https://raw.githubusercontent.com/steenhulthin/ruks-data/main/site/data/latest-summary.json npm run dev
```

## Project layout

- `src/app/`: app shell and data loading
- `src/lib/`: types and summary helpers for RUKS data
- `public/data/`: local sample data for offline development
- `docs/roadmap.md`: product and engineering milestones
- `AGENTS.md`: working agreements for agent-led development

## Current scope

Version `0.1.0` is a frontend scaffold, not a finished analytical product. It is meant to give us a stable place to build:

- filters for disease, measure, year, and geography
- a choropleth or proportional-symbol municipality map
- richer trend panels backed by the upstream normalized outputs
- deployment and refresh automation

