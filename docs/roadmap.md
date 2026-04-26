# Roadmap

## Current checkpoint

- The temporary live DAGI region WFS/GML path has been replaced in the app by a static DAGI-derived region GeoJSON artifact.
- The geography join contract is documented.
- Region join diagnostics and source/methodology copy are visible in the UI.
- The surviving KOL region-rate candidates are surfaced in the product instead of being hidden behind a generic map failure.
- The first region choropleth now has an explicit default measure contract: `KOL`, `Region`, `Antal personer med sygdom`, latest year, `Alle aldre`, `Begge`, and `Antal personer pr. 100.000 borgere`.
- Municipality mode is still the next geography blocker because it needs municipality geometry, join diagnostics, and duplicate-row handling before it can be called map-ready.

## Phase 1: Frontend foundation

- Establish a stable TypeScript app shell
- Load and validate the latest upstream release payload
- Resolve the newest Parquet asset from the release metadata
- Create the core dashboard layout: header, sidebar filters, and map-focused main area

## Phase 2: Data integration

- Point the app at the live `ruks-data` latest release endpoint by default
- Introduce DuckDB-Wasm and query the remote Parquet asset in-browser
- Add a lightweight validation layer for expected columns and value domains
- Introduce manifest and summary JSON as secondary metadata sources
- Add a KOL-first validation pass for country, region, municipality, and sex consistency on additive rows
- Document upstream caveats that affect interpretation, especially rounding, algorithm changes, and KOL's weaker pre-2015 comparability
- Add a temporary local normalization step for the Bornholm duplicate-row issue, then remove it once the upstream data project is clarified
- Audit which region-rate measures survive the current KOL filter and unit constraints
- Keep the first map's measure contract explicit when both prevalence and incidence satisfy the chosen rate filters

## Phase 3: Geography

- Select Danish municipality and region boundary data from Dataforsyningen
- Define join keys between geometry and RUKS geography labels
- Add a temporary static region-boundary JSON artifact so the first region prototype can ship before the final boundary artifact format is settled
- Add join diagnostics for the temporary region join so missing or duplicate matches are visible before map sign-off
- Choose the browser delivery format for boundaries, with `PMTiles` and `FlatGeobuf` as the primary candidates
- Prove the first real choropleth with `KOL` only after the measure contract and join diagnostics remain closed
- Build the first completed choropleth for the regional view, then municipal view
- Color the first completed map by the explicitly chosen `Antal personer pr. 100.000 borgere` measure

## Phase 4: Product polish

- Add persistent filters and shareable URLs
- Add annotation, methodology, source links, and the required RUKS credit wording
- Prepare deployment and an update checklist for new upstream releases
