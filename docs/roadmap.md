# Roadmap

## Phase 1: Frontend foundation

- Establish a stable TypeScript app shell
- Load and validate the upstream summary payload
- Create reusable layout blocks for KPIs, trends, and the future map panel

## Phase 2: Data integration

- Point the app at the live `ruks-data` summary endpoint by default
- Add a lightweight validation layer for expected series structure
- Introduce manifest and release metadata alongside the summary payload

## Phase 3: Geography

- Select Danish municipality and region boundary data
- Define join keys between geometry and RUKS geography labels
- Build the first choropleth or bubble map for regional and municipal views

## Phase 4: Product polish

- Add persistent filters and shareable URLs
- Add annotation, methodology, and source links
- Prepare deployment and an update checklist for new upstream releases

