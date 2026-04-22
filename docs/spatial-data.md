# Spatial Data Notes

This project will likely need Danish administrative boundary data for:

- `kommuneinddeling`
- `regionsinddeling`

The expected source is `Dataforsyningen`:

- https://dataforsyningen.dk/data

## Current source

For now, the working WFS source is:

- `DAGI_10MULTIGEOM_GMLSFP_DAF`
- capabilities URL:
  `https://api.dataforsyningen.dk/DAGI_10MULTIGEOM_GMLSFP_DAF?service=WFS&request=GetCapabilities&token=be8f1253b8642085ffb7d11d95685a72`

Verified from the current capabilities document:

- service title: `DAGI – Danmarks Administrative Geografiske Inddeling, multi geometrier`
- municipality layer: `dagi:Kommuneinddeling`
- region layer: `dagi:Regionsinddeling`
- default CRS: `EPSG:25832`
- alternate supported CRS values include `EPSG:3857`

## Working assumptions

- The analytical disease data remains separate from boundary geometry.
- RUKS observations should continue to live in a tabular analytical format.
- Geometry should be prepared in a web-friendly format for static hosting.
- Join logic between RUKS geography labels and boundary features must be explicit and documented.
- Temporary project assumption: duplicate KOL municipality rows for Bornholm are treated as a Christiansø-related artifact until the upstream data issue is clarified
- That assumption affects the statistical side before the geometry join, not the boundary geometry itself

## Join Contract

The WFS-side schema is good enough to support a first explicit join contract:

- `dagi:Kommuneinddeling` exposes:
  - `Navn`
  - `Kommunekode`
  - `RegionLokalID`
  - `Id_lokalid`
  - `Udenfor kommuneinddeling`
- `dagi:Regionsinddeling` exposes:
  - `Navn`
  - `Regionskode`
  - `Id_lokalid`

For the current KOL extract in `ruks_hovedresultater_long`, RUKS exposes:

- `municipality_name`
- `region_name`

but not municipality or region codes in the frontend-facing analytical file we are using here.

That means the practical contract for this project is:

- Region join:
  - first pass: `RUKS.region_name = DAGI.Navn`
  - preferred durable target: a small maintained mapping from `region_name -> Regionskode`
- Municipality join:
  - first pass: `RUKS.municipality_name = DAGI.Navn`
  - preferred durable target: a small maintained mapping from `municipality_name -> Kommunekode`

## Current Assessment

For the current KOL data slice:

- the five RUKS region names match standard DAGI region names exactly
- the 98 RUKS municipality names also look like standard DAGI municipality names
- this makes a first name-based join acceptable as a temporary contract

However, the project should still treat code-based joins as the desired long-term target because:

- names are more fragile than codes
- spelling normalization can drift between releases
- the Bornholm and Christiansø edge case is a reminder that geographic naming can hide administrative exceptions

## Municipality Exception

Klimadatastyrelsen's DAGI documentation explicitly says:

- `Udenfor kommuneinddeling` is `true` for Christiansø
- `Kommunekode=0411` is the Christiansø case
- Christiansø lies outside both normal municipality and region boundaries

Project implication:

- do not create a synthetic municipality polygon for Christiansø
- if RUKS values for Bornholm appear to include a Christiansø-related artifact, handle that on the statistical side before the join
- keep the local Bornholm normalization temporary and documented until the upstream data project is clarified

## Recommended Next Implementation

1. Implement a typed join contract in code with:
   - RUKS name column
   - DAGI name column
   - DAGI code column
   - join strategy and fallback strategy
2. Start with exact name matching for regions.
3. Reuse the same contract shape for municipalities.
4. Add an explicit lookup-table path as the fallback instead of scattering manual string fixes.

## Format direction

The Cloud-Native Geo guide suggests two especially relevant paths for a static app:

- `PMTiles` for visualization-first tiled delivery
- `FlatGeobuf` for direct vector access with spatial indexing

`GeoParquet` is also relevant, but mainly as an analytical storage format. The guide notes that GeoParquet does not yet provide a spatial index in the same way, so it is less attractive as the first browser-delivered boundary format for an interactive map.

## Recommended working split

- Disease data: `Parquet` queried in-browser with DuckDB-Wasm
- Boundary data: start with `PMTiles` or `FlatGeobuf`

This keeps the analytical and cartographic concerns separate:

- RUKS tables stay optimized for filtering and aggregation
- Boundary files stay optimized for map rendering and spatial fetch patterns

## Current preference

If the map is primarily for visualization, `PMTiles` is the strongest default candidate.

Reasoning:

- it is designed for tiled visualization
- it works well with static hosting and HTTP range requests
- it keeps large polygon datasets in a single archive rather than many tiny tile files

If we need more direct feature-level client-side access before tiling, `FlatGeobuf` is the next best option.

## Dashboard implication

The current product direction is:

- sidebar controls for disease, geography detail, year, age group, and sex
- main map view switching between municipalities and regions
- choropleth coloring based on `Antal personer pr. 100.000 borgere`

That means the final boundary delivery format must support smooth thematic rendering and hover/click interaction for a filtered statistical layer.

## Metric note

The first map should prioritize the rate-style measure:

- source label: `Antal personer pr. 100.000 borgere`

This is the intended default choropleth metric for the dashboard.

## Open implementation questions

1. Do we want to persist an explicit `RUKS name -> DAGI code` lookup file now, or wait until the first name mismatch appears?
2. Should municipality and region boundaries be stored as separate artifacts?
3. Do we want one display-oriented boundary artifact and one higher-fidelity source artifact in the repo pipeline?
4. Which transport should be first for the real map path: `PMTiles` or `FlatGeobuf`?
