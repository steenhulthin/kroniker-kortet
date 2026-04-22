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
- Default thematic value:
  `Antal personer pr. 100.000 borgere`

## Data implications

- The app needs filterable observations by disease, geography level, year, age group, and sex
- The metric should be read from the analytical RUKS dataset, not hardcoded
- Boundary geometry must be joinable to the filtered statistics layer

## KOL-first validation gate

- Treat `KOL` as the reference disease until the full map path is proven end to end
- Before broadening to more diseases, verify that KOL can be shown correctly for country, region, and municipality
- Use `Antal personer med sygdom` for additive consistency checks
- Do not expect `Antal personer pr. 100.000 borgere` or standardized rates to sum across geography or sex
- Keep any data-quality handling explicit, especially if duplicate dimensional rows appear in upstream extracts
- Temporary project assumption: duplicate KOL rows for Bornholm municipality are treated as a Christiansø-related artifact until the upstream data issue is clarified
- In this project, when identical dimensional rows appear with both `0` and a non-zero value, keep the non-zero value and document that the normalization happened locally

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
