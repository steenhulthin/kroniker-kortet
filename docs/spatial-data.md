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

## Open implementation questions

1. What stable identifiers are available in the chosen `kommuneinddeling` and `regionsinddeling` datasets?
2. Do the RUKS geography labels align directly with boundary names, or do we need a maintained lookup table?
3. Should region and municipality boundaries be stored as separate artifacts?
4. Do we want one display-oriented boundary artifact and one higher-fidelity source artifact in the repo pipeline?
