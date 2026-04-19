# Roadmap

## Phase 1: Frontend foundation

- Establish a stable TypeScript app shell
- Load and validate the latest upstream release payload
- Resolve the newest Parquet asset from the release metadata
- Create reusable layout blocks for KPIs, trends, and the future map panel

## Phase 2: Data integration

- Point the app at the live `ruks-data` latest release endpoint by default
- Introduce DuckDB-Wasm and query the remote Parquet asset in-browser
- Add a lightweight validation layer for expected columns and value domains
- Introduce manifest and summary JSON as secondary metadata sources

## Phase 3: Geography

- Select Danish municipality and region boundary data
- Define join keys between geometry and RUKS geography labels
- Build the first choropleth or bubble map for regional and municipal views

## Phase 4: Product polish

- Add persistent filters and shareable URLs
- Add annotation, methodology, and source links
- Prepare deployment and an update checklist for new upstream releases
