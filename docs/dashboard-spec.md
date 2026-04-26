# Dashboard Spec

## Current required layout

- Header with the product title
- Left sidebar for filters
- Main content area dominated by the map

## Required filter controls

- Disease
- Geography detail
  - `kommune`
  - `region`
- Year
- Age group
- Sex

## Primary map behavior

- Show a choropleth map in the main area
- Allow switching between municipality and region detail
- Color polygons with a graduated scale
- Use `KOL` as the default disease in the first production slice
- Intended default thematic value:
  `Antal personer pr. 100.000 borgere`

## Current implementation state

- The app shell includes a region-first choropleth path backed by static DAGI-derived region geometry and DuckDB-filtered KOL rate rows.
- The first-map measure contract is explicit: `Antal personer med sygdom` displayed as `Antal personer pr. 100.000 borgere`.
- The default map slice uses region, latest year, `Alle aldre`, and `Begge`.
- Temporary exact-name region join diagnostics are visible in the product.
- Source and methodology wording are visible in the product.
- Municipality mode is still a validation and preview path, not a completed choropleth implementation.

## Data implications

- The app needs filterable observations by disease, geography level, year, age group, and sex
- The metric should be read from the analytical RUKS dataset, not hardcoded
- Boundary geometry must be joinable to the filtered statistics layer
- If more than one rate-style measure survives the active filters, the app must surface that ambiguity instead of silently picking one
- Temporary region joins need diagnostics for missing matches and duplicate stat rows before the map is called production-ready

## KOL-first validation gate

- Treat `KOL` as the reference disease until the full map path is proven end to end
- Before broadening to more diseases, verify that KOL can be shown correctly for country, region, and municipality
- Use `Antal personer med sygdom` for additive consistency checks
- Do not expect `Antal personer pr. 100.000 borgere` or standardized rates to sum across geography or sex
- Keep any data-quality handling explicit, especially if duplicate dimensional rows appear in upstream extracts
- Temporary project assumption: duplicate KOL rows for Bornholm municipality are treated as a Christiansø-related artifact until the upstream data issue is clarified
- In this project, when identical dimensional rows appear with both `0` and a non-zero value, keep the non-zero value and document that the normalization happened locally
- Do not mark the first region choropleth complete until the measure choice is explicit and region join diagnostics are available

## Source And Credit

- The dashboard must show a visible source note when RUKS figures are displayed
- Use this source wording for direct presentation of the official figures:
  `Kilde: Sundhedsdatastyrelsen, Register for Udvalgte Kroniske Sygdomme og Svære Psykiske Lidelser (RUKS) (pr. 28. november 2025).`
- If the app shows derived values, joins, or validations beyond the raw published tables, use this wording:
  `Kilde: Egne beregninger baseret på tal fra Register for Udvalgte Kroniske Sygdomme og Svære Psykiske Lidelser (RUKS) (pr. 28. november 2025) fra Sundhedsdatastyrelsen.`

## Near-term UI intent

- Keep the first implementation simple and map-first
- Use supporting cards for release info and implementation status
- Add charts only as secondary elements after the map and filters are working
