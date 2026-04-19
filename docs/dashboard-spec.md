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
- Default thematic value:
  `Antal personer pr. 100.000 borgere`

## Data implications

- The app needs filterable observations by disease, geography level, year, age group, and sex
- The metric should be read from the analytical RUKS dataset, not hardcoded
- Boundary geometry must be joinable to the filtered statistics layer

## Near-term UI intent

- Keep the first implementation simple and map-first
- Use supporting cards for release info and implementation status
- Add charts only as secondary elements after the map and filters are working
