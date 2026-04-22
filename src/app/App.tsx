import { startTransition, useEffect, useState } from "react";
import {
  DEFAULT_LATEST_RELEASE_URL,
  formatDateLabel,
  loadLatestRuksRelease,
  type RuksLatestRelease,
} from "../lib/ruks";
import {
  queryRuksDistinctFilterValues,
  queryRuksMetricRows,
  type RuksDistinctDomainKey,
  type RuksDistinctValue,
  type RuksFilterDomainKey,
  type RuksQueryContract,
} from "../lib/ruks-duckdb";
import {
  queryRuksRegionJoinDiagnostics,
  type RuksRegionJoinDiagnostics,
} from "../lib/ruks-region-join-diagnostics";
import {
  auditRuksRegionRateCandidates,
  queryRuksRegionRateMapRows,
  type RuksRegionRateCandidateAudit,
  type RuksRegionRateMapRow,
} from "../lib/ruks-map";
import {
  fetchTemporaryDagiRegionSvgBoundaries,
  type SvgRegionBoundaryCollection,
  type SvgRegionBoundaryFeature,
} from "../lib/spatial-region-wfs";

type ReleaseState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; release: RuksLatestRelease };

type FilterDefinition = {
  label: string;
  value: string;
};

type FilterGroup = RuksFilterDomainKey;

type FilterState = Record<FilterGroup, string>;

type SidebarFilter =
  | {
      key: RuksDistinctDomainKey;
      title: string;
      hint?: string;
      source: "duckdb";
    }
  | {
      key: "geoLevel";
      title: string;
      hint?: string;
      source: "local";
    };

type DuckDbFilterOptions = Record<RuksDistinctDomainKey, RuksDistinctValue[]>;

type FilterLoadState =
  | { status: "loading" }
  | { status: "ready"; options: DuckDbFilterOptions }
  | { status: "empty"; options: DuckDbFilterOptions; message: string }
  | { status: "error"; message: string };

type PreviewRow = {
  measure_label?: unknown;
  source_unit_label?: unknown;
  value_kind?: unknown;
  standardization?: unknown;
  disease_label?: unknown;
  geo_level?: unknown;
  region_name?: unknown;
  municipality_name?: unknown;
  sex_label?: unknown;
  age_group_label?: unknown;
  year?: unknown;
  value?: unknown;
};

type PreviewLoadState =
  | { status: "loading" }
  | { status: "ready"; rows: PreviewRow[] }
  | { status: "empty" }
  | { status: "error"; message: string };

type RegionBoundaryLoadState =
  | { status: "loading" }
  | { status: "ready"; boundaries: SvgRegionBoundaryCollection }
  | { status: "error"; message: string };

type RegionMetricLoadState =
  | { status: "idle" }
  | { status: "blocked"; message: string }
  | { status: "loading" }
  | { status: "ready"; rows: RuksRegionRateMapRow[] }
  | { status: "empty" }
  | { status: "error"; message: string };

type RegionJoinDiagnosticsLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; diagnostics: RuksRegionJoinDiagnostics }
  | { status: "error"; message: string };

type RegionRateAuditLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; audit: RuksRegionRateCandidateAudit }
  | { status: "error"; message: string };

const initialState: ReleaseState = { status: "loading" };

const sidebarFilters: SidebarFilter[] = [
  {
    key: "disease",
    title: "Disease",
    source: "duckdb",
  },
  {
    key: "geoLevel",
    title: "Geographic detail",
    hint: "Switch the map between municipality and region boundaries.",
    source: "local",
  },
  {
    key: "year",
    title: "Year",
    source: "duckdb",
  },
  {
    key: "ageGroup",
    title: "Age group",
    source: "duckdb",
  },
  {
    key: "sex",
    title: "Sex",
    source: "duckdb",
  },
];

const dataDrivenFilterKeys = ["disease", "year", "ageGroup", "sex"] as const;
const preferredDiseaseSlug = "kol";
const directRuksSourceNote =
  "Kilde: Sundhedsdatastyrelsen, Register for Udvalgte Kroniske Sygdomme og Svære Psykiske Lidelser (RUKS) (pr. 28. november 2025).";
const derivedRuksSourceNote =
  "Kilde: Egne beregninger baseret på tal fra Register for Udvalgte Kroniske Sygdomme og Svære Psykiske Lidelser (RUKS) (pr. 28. november 2025) fra Sundhedsdatastyrelsen.";

const localGeographyOptions: FilterDefinition[] = [
  { label: "Kommune", value: "municipality" },
  { label: "Region", value: "region" },
];

const methodologyLinks = [
  {
    href: "https://sundhedsdatabank.dk/sygdomme/kroniske-sygdomme-og-svaere-psykiske-lidelser",
    label: "Sundhedsdatabanken statistikside",
  },
  {
    href: "https://cdn1.gopublic.dk/sundhedsdatastyrelsen/Media/638941202140187084/Informationsfane%20for%20statistikken%20Udvalgte%20Kroniske%20Sygdomme%20og%20Sv%C3%A6re%20Psykiske%20Lidelser.pdf",
    label: "Informationsfane",
  },
  {
    href: "https://cdn1.gopublic.dk/sundhedsdatastyrelsen/Media/638941202130289791/Algoritmer%20for%20Udvalgte%20Kroniske%20Sygdomme%20og%20Sv%C3%A6re%20Psykiske%20Lidelser%20%28RUKS%29%202024.pdf",
    label: "Algoritmer",
  },
  {
    href: "https://cdn1.gopublic.dk/sundhedsdatastyrelsen/Media/638941202128671349/RUKS%20analysevariable%20og%20statistiske%20m%C3%A5l.pdf",
    label: "Analysevariable og statistiske mål",
  },
] as const;

const ruksFilterContract: RuksQueryContract = {
  filterColumns: {
    disease: "disease_slug",
    geoLevel: "geo_level",
    year: "year",
    ageGroup: "age_group_code",
    sex: "sex_code",
  },
  distinctColumns: {
    disease: {
      value: "disease_slug",
      label: "disease_label",
    },
    year: {
      value: "year",
    },
    ageGroup: {
      value: "age_group_code",
      label: "age_group_label",
    },
    sex: {
      value: "sex_code",
      label: "sex_label",
    },
  },
  selectColumns: [
    "measure_label",
    "source_unit_label",
    "value_kind",
    "standardization",
    "disease_label",
    "geo_level",
    "region_name",
    "municipality_name",
    "sex_label",
    "age_group_label",
    "year",
    "value",
  ],
};

const previewRowLimit = 6;
const previewDedupedKeyColumns = [
  "measure_label",
  "source_unit_label",
  "value_kind",
  "standardization",
  "disease_label",
  "geo_level",
  "region_name",
  "municipality_name",
  "sex_label",
  "age_group_label",
  "year",
] as const;

function toFilterDefinitions(values: readonly RuksDistinctValue[]): FilterDefinition[] {
  return values.map((item) => ({
    label: item.label,
    value: item.value,
  }));
}

function getSelectedFilterLabel(selectedValue: string, options: readonly FilterDefinition[]): string {
  return options.find((option) => option.value === selectedValue)?.label ?? selectedValue;
}

function createInitialFilterState(options: DuckDbFilterOptions): FilterState {
  const preferredDisease =
    options.disease.find((option) => option.value === preferredDiseaseSlug) ??
    options.disease[0];

  return {
    disease: preferredDisease?.value ?? "",
    geoLevel: "municipality",
    year: options.year[0]?.value ?? "",
    ageGroup: options.ageGroup[0]?.value ?? "",
    sex: options.sex[0]?.value ?? "",
  };
}

function formatPreviewValue(value: unknown): string {
  if (value == null || value === "") {
    return "—";
  }

  if (typeof value === "number") {
    return new Intl.NumberFormat("da-DK").format(value);
  }

  return String(value);
}

function getGeographyValue(row: PreviewRow, geoLevel: string): string {
  if (geoLevel === "region") {
    return formatPreviewValue(row.region_name);
  }

  if (geoLevel === "municipality") {
    return formatPreviewValue(row.municipality_name);
  }

  return formatPreviewValue(row.geo_level);
}

function buildSelectionSummary(
  filters: FilterState,
  filterOptions: DuckDbFilterOptions,
): string {
  return sidebarFilters
    .map((filter) => {
      if (filter.source === "local") {
        return getSelectedFilterLabel(filters[filter.key], localGeographyOptions);
      }

      const options = toFilterDefinitions(filterOptions[filter.key]);

      return getSelectedFilterLabel(filters[filter.key], options);
    })
    .join(", ");
}

function formatMetricValue(value: number): string {
  return new Intl.NumberFormat("da-DK", {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);
}

function getRegionFillColor(
  value: number | null,
  minValue: number,
  maxValue: number,
): string {
  if (value === null) {
    return "rgba(20, 40, 29, 0.12)";
  }

  if (maxValue <= minValue) {
    return "#1f7a5a";
  }

  const ratio = (value - minValue) / (maxValue - minValue);
  const lightness = 92 - ratio * 40;

  return `hsl(152 42% ${lightness}%)`;
}

function isAmbiguousRegionMeasureMessage(message: string): boolean {
  return message.includes("Region map metric is ambiguous");
}

function getRegionLegendLabels(
  filters: FilterState | null,
  regionMetricState: RegionMetricLoadState,
  regionMinValue: number,
  regionMaxValue: number,
) {
  if (filters?.geoLevel !== "region") {
    return {
      start: "Loading",
      end: "Ready",
    };
  }

  if (regionMetricState.status === "ready") {
    return {
      start: formatMetricValue(regionMinValue),
      end: formatMetricValue(regionMaxValue),
    };
  }

  if (filters.disease !== preferredDiseaseSlug) {
    return {
      start: "KOL only",
      end: "Preview",
    };
  }

  if (
    regionMetricState.status === "error" &&
    isAmbiguousRegionMeasureMessage(regionMetricState.message)
  ) {
    return {
      start: "Join ready",
      end: "Measure pending",
    };
  }

  return {
    start: "Loading",
    end: "Ready",
  };
}

function getRegionMapEmptyLabel(
  filters: FilterState | null,
  regionMetricState: RegionMetricLoadState,
): string {
  if (filters?.geoLevel !== "region") {
    return "ingen regiondata aktiv";
  }

  if (filters.disease !== preferredDiseaseSlug) {
    return "regionkortet er kun aktivt for KOL endnu";
  }

  if (
    regionMetricState.status === "error" &&
    isAmbiguousRegionMeasureMessage(regionMetricState.message)
  ) {
    return "awaiting explicit measure contract";
  }

  if (regionMetricState.status === "loading") {
    return "indlaeser regionrater";
  }

  if (regionMetricState.status === "empty") {
    return "ingen regionrater fundet";
  }

  return "ingen rate fundet";
}

function formatNameList(names: readonly string[]): string {
  return names.length === 0 ? "none" : names.join(", ");
}

export function App() {
  const [state, setState] = useState<ReleaseState>(initialState);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const release = await loadLatestRuksRelease();

        if (cancelled) {
          return;
        }

        startTransition(() => {
          setState({ status: "ready", release });
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Unknown data loading error";

        startTransition(() => {
          setState({ status: "error", message });
        });
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page-shell">
      <header className="app-header">
        <div className="app-header__title">
          <p className="eyebrow">Kroniker-kortet</p>
          <h1>Kroniske sygdomme på kort</h1>
        </div>

        <div className="app-header__meta">
          <div className="meta-card">
            <span className="meta-card__label">Map metric</span>
            <strong>Antal personer pr. 100.000 borgere</strong>
          </div>
          <div className="meta-card">
            <span className="meta-card__label">Release source</span>
            <code>{DEFAULT_LATEST_RELEASE_URL}</code>
          </div>
        </div>
      </header>

      {state.status === "loading" ? <LoadingState /> : null}
      {state.status === "error" ? <ErrorState message={state.message} /> : null}
      {state.status === "ready" ? <Dashboard release={state.release} /> : null}
    </div>
  );
}

function LoadingState() {
  return (
    <section className="panel panel--wide">
      <div className="panel__header">
        <h2>Loading dashboard data</h2>
      </div>
      <p className="muted">
        Resolving the latest RUKS release and preparing the map-first dashboard
        scaffold.
      </p>
    </section>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <section className="panel panel--wide">
      <div className="panel__header">
        <h2>Release source unavailable</h2>
      </div>
      <p className="muted">
        The dashboard shell is ready, but the live release metadata did not load.
      </p>
      <pre className="error-box">{message}</pre>
    </section>
  );
}

function Dashboard({ release }: { release: RuksLatestRelease }) {
  const [filterLoadState, setFilterLoadState] = useState<FilterLoadState>({
    status: "loading",
  });
  const [filters, setFilters] = useState<FilterState | null>(null);
  const [previewState, setPreviewState] = useState<PreviewLoadState>({
    status: "loading",
  });
  const [regionBoundaryState, setRegionBoundaryState] = useState<RegionBoundaryLoadState>({
    status: "loading",
  });
  const [regionMetricState, setRegionMetricState] = useState<RegionMetricLoadState>({
    status: "idle",
  });
  const [regionJoinDiagnosticsState, setRegionJoinDiagnosticsState] =
    useState<RegionJoinDiagnosticsLoadState>({
      status: "idle",
    });
  const [regionRateAuditState, setRegionRateAuditState] = useState<RegionRateAuditLoadState>({
    status: "idle",
  });

  useEffect(() => {
    let cancelled = false;

    setRegionBoundaryState({ status: "loading" });

    async function loadRegionBoundaries() {
      try {
        const boundaries = await fetchTemporaryDagiRegionSvgBoundaries();

        if (cancelled) {
          return;
        }

        setRegionBoundaryState({ status: "ready", boundaries });
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Unknown spatial loading error";

        setRegionBoundaryState({ status: "error", message });
      }
    }

    void loadRegionBoundaries();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    setFilterLoadState({ status: "loading" });
    setFilters(null);
    setPreviewState({ status: "loading" });

    async function loadFilterOptions() {
      try {
        const [disease, year, ageGroup, sex] = await Promise.all(
          dataDrivenFilterKeys.map((key) =>
            queryRuksDistinctFilterValues(release, ruksFilterContract, key),
          ),
        );

        if (cancelled) {
          return;
        }

        const options: DuckDbFilterOptions = {
          disease,
          year,
          ageGroup,
          sex,
        };

        if (dataDrivenFilterKeys.some((key) => options[key].length === 0)) {
          const message =
            "DuckDB returned no distinct values for one or more filters.";

          setFilterLoadState({ status: "empty", options, message });
          setPreviewState({ status: "empty" });
          return;
        }

        setFilterLoadState({ status: "ready", options });
        setFilters(createInitialFilterState(options));
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Unknown DuckDB error";

        setFilterLoadState({ status: "error", message });
        setPreviewState({ status: "error", message });
      }
    }

    void loadFilterOptions();

    return () => {
      cancelled = true;
    };
  }, [release]);

  useEffect(() => {
    if (filterLoadState.status !== "ready" || filters === null) {
      return;
    }

    const activeFilters = filters;
    let cancelled = false;

    setPreviewState({ status: "loading" });

    async function loadPreview() {
      try {
        const rows = await queryRuksMetricRows<PreviewRow>(
          release,
          ruksFilterContract,
          activeFilters,
          {
            dedupe: {
              keyColumns: previewDedupedKeyColumns,
              valueColumn: "value",
            },
            limit: previewRowLimit,
            orderByColumns: ["geo_level", "disease_label", "year"],
          },
        );

        if (cancelled) {
          return;
        }

        setPreviewState(rows.length === 0 ? { status: "empty" } : { status: "ready", rows });
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Unknown DuckDB error";

        setPreviewState({ status: "error", message });
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [release, filters, filterLoadState.status]);

  useEffect(() => {
    if (filterLoadState.status !== "ready" || filters === null) {
      return;
    }

    if (filters.geoLevel !== "region") {
      setRegionMetricState({ status: "idle" });
      setRegionRateAuditState({ status: "idle" });
      return;
    }

    if (filters.disease !== preferredDiseaseSlug) {
      setRegionMetricState({
        status: "blocked",
        message:
          "Region choropleth is intentionally KOL-first. Non-KOL diseases stay in preview and diagnostics mode until the KOL region path is proven end to end.",
      });
      setRegionRateAuditState({ status: "idle" });
      return;
    }

    const activeFilters = filters;
    let cancelled = false;

    setRegionMetricState({ status: "loading" });
    setRegionRateAuditState({ status: "loading" });

    async function loadRegionMetrics() {
      try {
        const [audit, rows] = await Promise.all([
          auditRuksRegionRateCandidates(release, {
            disease: activeFilters.disease,
            year: activeFilters.year,
            ageGroup: activeFilters.ageGroup,
            sex: activeFilters.sex,
          }),
          queryRuksRegionRateMapRows(release, {
            disease: activeFilters.disease,
            year: activeFilters.year,
            ageGroup: activeFilters.ageGroup,
            sex: activeFilters.sex,
          }),
        ]);

        if (cancelled) {
          return;
        }

        setRegionRateAuditState({ status: "ready", audit });
        setRegionMetricState(
          rows.length === 0 ? { status: "empty" } : { status: "ready", rows },
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Unknown regional metric error";

        try {
          const audit = await auditRuksRegionRateCandidates(release, {
            disease: activeFilters.disease,
            year: activeFilters.year,
            ageGroup: activeFilters.ageGroup,
            sex: activeFilters.sex,
          });

          if (!cancelled) {
            setRegionRateAuditState({ status: "ready", audit });
          }
        } catch (auditError) {
          if (!cancelled) {
            setRegionRateAuditState({
              status: "error",
              message:
                auditError instanceof Error
                  ? auditError.message
                  : "Unknown region-rate audit error",
            });
          }
        }

        setRegionMetricState({ status: "error", message });
      }
    }

    void loadRegionMetrics();

    return () => {
      cancelled = true;
    };
  }, [release, filters, filterLoadState.status]);

  useEffect(() => {
    if (
      filterLoadState.status !== "ready" ||
      filters === null ||
      filters.geoLevel !== "region" ||
      regionBoundaryState.status !== "ready"
    ) {
      setRegionJoinDiagnosticsState({ status: "idle" });
      return;
    }

    const activeFilters = filters;
    const boundaryRegionNames = regionBoundaryState.boundaries.features.map(
      (feature) => feature.name,
    );
    let cancelled = false;

    setRegionJoinDiagnosticsState({ status: "loading" });

    async function loadRegionJoinDiagnostics() {
      try {
        const diagnostics = await queryRuksRegionJoinDiagnostics(
          release,
          {
            disease: activeFilters.disease,
            year: activeFilters.year,
            ageGroup: activeFilters.ageGroup,
            sex: activeFilters.sex,
          },
          boundaryRegionNames,
        );

        if (cancelled) {
          return;
        }

        setRegionJoinDiagnosticsState({ status: "ready", diagnostics });
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Unknown region join diagnostic error";

        setRegionJoinDiagnosticsState({ status: "error", message });
      }
    }

    void loadRegionJoinDiagnostics();

    return () => {
      cancelled = true;
    };
  }, [release, filters, filterLoadState.status, regionBoundaryState]);

  const filterOptions =
    filterLoadState.status === "ready" || filterLoadState.status === "empty"
      ? filterLoadState.options
      : null;

  const selectionSummary =
    filters && filterOptions
      ? buildSelectionSummary(filters, filterOptions)
      : "Loading filter options from DuckDB...";
  const selectedDiseaseLabel =
    filters && filterOptions
      ? getSelectedFilterLabel(filters.disease, toFilterDefinitions(filterOptions.disease))
      : "selected disease";
  const isRegionView = filters?.geoLevel === "region";
  const isKOLRegionPrototype =
    isRegionView && filters.disease === preferredDiseaseSlug;
  const regionMapRows =
    regionMetricState.status === "ready" ? regionMetricState.rows : [];
  const regionValues = regionMapRows.map((row) => row.value);
  const regionMinValue =
    regionValues.length > 0 ? Math.min(...regionValues) : 0;
  const regionMaxValue =
    regionValues.length > 0 ? Math.max(...regionValues) : 0;
  const regionValueByName = new Map(
    regionMapRows.map((row) => [row.regionName, row]),
  );
  const regionLegendLabels = getRegionLegendLabels(
    filters,
    regionMetricState,
    regionMinValue,
    regionMaxValue,
  );
  const regionMapEmptyLabel = getRegionMapEmptyLabel(filters, regionMetricState);

  return (
    <main className="dashboard-layout">
      <aside className="sidebar panel">
        <div className="panel__header">
          <h2>Filters</h2>
          <span className="pill">Sidebar</span>
        </div>

        {filterLoadState.status === "loading" ? (
          <p className="filter-stack__status">Loading filter options from DuckDB…</p>
        ) : null}
        {filterLoadState.status === "empty" ? (
          <p className="filter-stack__status">{filterLoadState.message}</p>
        ) : null}
        {filterLoadState.status === "error" ? (
          <pre className="error-box">{filterLoadState.message}</pre>
        ) : null}
        {isRegionView ? (
          <p className="filter-stack__status">
            {isKOLRegionPrototype
              ? "Region mode is intentionally KOL-first. KOL is the only disease that can activate the live region slice while the path is being validated."
              : `${selectedDiseaseLabel} remains in preview and join-diagnostics mode in region view until the KOL region path is proven end to end.`}
          </p>
        ) : null}

        <div className="filter-stack">
          {sidebarFilters.map((filter) => {
            const options =
              filter.source === "local"
                ? localGeographyOptions
                : filterOptions
                  ? toFilterDefinitions(filterOptions[filter.key])
                  : [];
            const selectedValue = filters?.[filter.key] ?? options[0]?.value ?? "";

            return (
              <SidebarFilterSection
                key={filter.key}
                filter={filter}
                options={options}
                selectedValue={selectedValue}
                disabled={filters === null}
                onSelect={(value) => {
                  setFilters((current) => {
                    if (current === null) {
                      return current;
                    }

                    return {
                      ...current,
                      [filter.key]: value,
                    };
                  });
                }}
              />
            );
          })}
        </div>
      </aside>

      <section className="main-stage">
        <article className="panel map-panel">
          <div className="panel__header">
            <div>
              <h2>Map preview</h2>
              <p className="muted">
                Choropleth view for kommune or region colored by rate per 100,000 inhabitants.
              </p>
              <p className="muted">
                Showing {release.tag} for {selectionSummary}
              </p>
              {isRegionView ? (
                <p className="muted">
                  Region mode is explicitly KOL-first. Non-KOL diseases stay in
                  preview-only validation mode so they do not read as production-ready.
                </p>
              ) : null}
              {isKOLRegionPrototype &&
              regionMetricState.status === "error" &&
              isAmbiguousRegionMeasureMessage(regionMetricState.message) ? (
                <p className="muted">
                  The exact-name region join is wired, but the choropleth remains blocked
                  until a single region measure contract is chosen explicitly.
                </p>
              ) : null}
              <p className="muted">
                Temporary project assumption: duplicate Bornholm rows are treated as a
                Christiansoe-related artifact and collapsed locally until clarified upstream.
              </p>
            </div>
            <span className="pill">
              {isRegionView ? "KOL-first region slice" : "Live DuckDB"}
            </span>
          </div>

          <div className="map-canvas">
            <div className="map-canvas__wash" />
            {isRegionView && regionBoundaryState.status === "ready" ? (
              <svg
                className={
                  isKOLRegionPrototype && regionMetricState.status === "ready"
                    ? "region-map"
                    : "region-map region-map--muted"
                }
                viewBox={regionBoundaryState.boundaries.viewBox}
                role="img"
                aria-label={
                  isKOLRegionPrototype && regionMetricState.status === "ready"
                    ? "Region choropleth for the selected KOL filter combination"
                    : "Region reference geometry shown in KOL-first validation mode"
                }
              >
                {regionBoundaryState.boundaries.features.map((feature) => (
                  <RegionMapShape
                    key={feature.localId}
                    feature={feature}
                    row={
                      isKOLRegionPrototype && regionMetricState.status === "ready"
                        ? (regionValueByName.get(feature.name) ?? null)
                        : null
                    }
                    minValue={regionMinValue}
                    maxValue={regionMaxValue}
                    emptyLabel={regionMapEmptyLabel}
                  />
                ))}
              </svg>
            ) : null}
            <div className="map-canvas__legend">
              <span>{regionLegendLabels.start}</span>
              <div className="legend-ramp" />
              <span>{regionLegendLabels.end}</span>
            </div>

            <div className="map-canvas__focus map-preview">
              <p className="map-canvas__metric">Antal personer pr. 100.000 borgere</p>
              {filters?.geoLevel === "region" &&
              filters.disease !== preferredDiseaseSlug ? (
                <div className="preview-state">
                  <h3>KOL-first region prototype</h3>
                  <p className="muted">
                    The first real choropleth is being proven on KOL only. Other diseases
                    remain in preview-only mode until the KOL region path passes QA and a
                    measure is chosen explicitly.
                  </p>
                </div>
              ) : null}

              {isKOLRegionPrototype &&
              regionBoundaryState.status === "loading" ? (
                <div className="preview-state">
                  <h3>Loading region boundaries</h3>
                  <p className="muted">
                    Fetching the temporary DAGI WFS region geometry path for the first real
                    choropleth prototype.
                  </p>
                </div>
              ) : null}

              {isKOLRegionPrototype &&
              regionBoundaryState.status === "error" ? (
                <div className="preview-state preview-state--error">
                  <h3>Region boundary load failed</h3>
                  <pre className="error-box">{regionBoundaryState.message}</pre>
                </div>
              ) : null}

              {isKOLRegionPrototype &&
              regionMetricState.status === "loading" ? (
                <div className="preview-state">
                  <h3>Loading region rates</h3>
                  <p className="muted">
                    Querying the non-standardized rate rows for the selected KOL view.
                  </p>
                </div>
              ) : null}

              {isKOLRegionPrototype &&
              regionMetricState.status === "empty" ? (
                <div className="preview-state">
                  <h3>No region rates found</h3>
                  <p className="muted">
                    DuckDB returned no regional rate rows for the selected filters.
                  </p>
                </div>
              ) : null}

              {isKOLRegionPrototype &&
              regionMetricState.status === "error" ? (
                <div className="preview-state preview-state--error">
                  <h3>
                    {isAmbiguousRegionMeasureMessage(regionMetricState.message)
                      ? "Region measure contract still unresolved"
                      : "Region rate query failed"}
                  </h3>
                  {isAmbiguousRegionMeasureMessage(regionMetricState.message) ? (
                    <p className="muted">
                      The exact-name region join is available, but the map stays
                      intentionally blocked until one region measure is selected on
                      purpose.
                    </p>
                  ) : null}
                  <pre className="error-box">{regionMetricState.message}</pre>
                </div>
              ) : null}

              {filters?.geoLevel === "municipality" ? (
                <div className="preview-state">
                  <h3>Region map is live first</h3>
                  <p className="muted">
                    Municipality mode still uses the validation preview while the region
                    choropleth prototype is being proven and QA-approved.
                  </p>
                </div>
              ) : null}

              {previewState.status === "loading" ? (
                <div className="preview-state">
                  <h3>Querying DuckDB</h3>
                  <p className="muted">
                    Re-running the filtered query for the current disease, geography, year,
                    age group, and sex selections.
                  </p>
                </div>
              ) : null}

              {previewState.status === "empty" ? (
                <div className="preview-state">
                  <h3>No matching rows</h3>
                  <p className="muted">
                    DuckDB returned no rows for the current filter combination.
                  </p>
                </div>
              ) : null}

              {previewState.status === "error" ? (
                <div className="preview-state preview-state--error">
                  <h3>DuckDB query failed</h3>
                  <pre className="error-box">{previewState.message}</pre>
                </div>
              ) : null}

              {previewState.status === "ready" ? (
                <div className="preview-table-shell">
                  <div className="preview-summary">
                    <div className="preview-summary__card">
                      <span className="preview-summary__label">Rows shown</span>
                      <strong>{previewState.rows.length}</strong>
                    </div>
                    <div className="preview-summary__card">
                      <span className="preview-summary__label">Geography</span>
                      <strong>{filters ? getSelectedFilterLabel(filters.geoLevel, localGeographyOptions) : "—"}</strong>
                    </div>
                    <div className="preview-summary__card">
                      <span className="preview-summary__label">Release</span>
                      <strong>{release.tag}</strong>
                    </div>
                  </div>

                  <div className="preview-table-wrap">
                    <table className="preview-table">
                      <thead>
                        <tr>
                          <th>Metric</th>
                          <th>Geography</th>
                          <th>Disease</th>
                          <th>Year</th>
                          <th>Age group</th>
                          <th>Sex</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewState.rows.map((row, index) => (
                          <tr key={`${index}-${String(row.year ?? "")}`}>
                            <td>{formatPreviewValue(row.source_unit_label ?? row.measure_label)}</td>
                            <td>{filters ? getGeographyValue(row, filters.geoLevel) : "—"}</td>
                            <td>{formatPreviewValue(row.disease_label)}</td>
                            <td>{formatPreviewValue(row.year)}</td>
                            <td>{formatPreviewValue(row.age_group_label)}</td>
                            <td>{formatPreviewValue(row.sex_label)}</td>
                            <td>{formatPreviewValue(row.value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </article>

        <section className="support-grid">
          <article className="panel">
            <div className="panel__header">
              <h2>Current dashboard spec</h2>
            </div>
            <div className="checklist">
              <p>1. Header with title.</p>
              <p>2. Sidebar for disease, geography detail, year, age group, and sex.</p>
              <p>3. Main map colored by `Antal personer pr. 100.000 borgere`.</p>
              <p>4. Start by proving the KOL path before broadening to other diseases.</p>
            </div>
          </article>

          <article className="panel">
            <div className="panel__header">
              <h2>Release context</h2>
            </div>
            <dl className="facts">
              <div>
                <dt>Release tag</dt>
                <dd>{release.tag}</dd>
              </div>
              <div>
                <dt>Published</dt>
                <dd>{formatDateLabel(release.publishedAt)}</dd>
              </div>
              <div>
                <dt>Preferred data file</dt>
                <dd>{release.recommendedAsset.name}</dd>
              </div>
              <div>
                <dt>Boundary source</dt>
                <dd>DAGI WFS</dd>
              </div>
            </dl>
          </article>

          <article className="panel">
            <div className="panel__header">
              <h2>KOL validation focus</h2>
            </div>
            <div className="checklist">
              <p>1. KOL is the default disease in this first validation slice.</p>
              <p>2. Use the preview table to sanity-check geography, sex, age, and year selections.</p>
              <p>3. Treat additive count checks separately from rates and standardized values.</p>
            </div>
          </article>

          <article className="panel">
            <div className="panel__header">
              <h2>Region rate audit</h2>
            </div>
            {isKOLRegionPrototype && regionRateAuditState.status === "loading" ? (
              <p className="muted">
                Auditing which non-standardized rate measures survive the active KOL
                region filters.
              </p>
            ) : null}
            {isKOLRegionPrototype && regionRateAuditState.status === "error" ? (
              <pre className="error-box">{regionRateAuditState.message}</pre>
            ) : null}
            {isKOLRegionPrototype && regionRateAuditState.status === "ready" ? (
              <div className="checklist">
                <p>
                  1. Matching measures:{" "}
                  {regionRateAuditState.audit.measures.length === 0
                    ? "none"
                    : regionRateAuditState.audit.measures
                        .map(
                          (measure) =>
                            `${measure.measureLabel || measure.measureCode} (${measure.measureCode})`,
                        )
                        .join(", ")}
                </p>
                <p>
                  2. Candidate rows per measure:{" "}
                  {regionRateAuditState.audit.measures.length === 0
                    ? "none"
                    : regionRateAuditState.audit.measures
                        .map(
                          (measure) =>
                            `${measure.measureCode}: ${measure.rowCount} rows / ${measure.distinctRegionCount} regions`,
                        )
                        .join(", ")}
                </p>
                <p>
                  3. Duplicate candidate region names:{" "}
                  {formatNameList(regionRateAuditState.audit.duplicateRegionNames)}
                </p>
              </div>
            ) : null}
            {!isKOLRegionPrototype ? (
              <p className="muted">
                The rate audit is shown only for the KOL region prototype because that
                is the current acceptance slice.
              </p>
            ) : null}
          </article>

          <article className="panel">
            <div className="panel__header">
              <h2>Region join diagnostics</h2>
            </div>
            {isRegionView && regionJoinDiagnosticsState.status === "loading" ? (
              <p className="muted">
                Checking the exact-name join between `region_name` and DAGI region names
                for the current region selection.
              </p>
            ) : null}
            {isRegionView && regionJoinDiagnosticsState.status === "error" ? (
              <pre className="error-box">{regionJoinDiagnosticsState.message}</pre>
            ) : null}
            {isRegionView && regionJoinDiagnosticsState.status === "ready" ? (
              <>
                <div className="preview-summary">
                  <div className="preview-summary__card">
                    <span className="preview-summary__label">Join mode</span>
                    <strong>Exact `region_name = DAGI.Navn`</strong>
                  </div>
                  <div className="preview-summary__card">
                    <span className="preview-summary__label">Matched</span>
                    <strong>
                      {regionJoinDiagnosticsState.diagnostics.matchedRegionNames.length}/
                      {regionJoinDiagnosticsState.diagnostics.totalRuksRegions}
                    </strong>
                  </div>
                  <div className="preview-summary__card">
                    <span className="preview-summary__label">DAGI regions</span>
                    <strong>{regionJoinDiagnosticsState.diagnostics.totalBoundaryRegions}</strong>
                  </div>
                </div>
                <div className="diagnostic-list">
                  <p>
                    Matched regions:{" "}
                    {formatNameList(regionJoinDiagnosticsState.diagnostics.matchedRegionNames)}
                  </p>
                  <p>
                    Unmatched RUKS region names:{" "}
                    {formatNameList(
                      regionJoinDiagnosticsState.diagnostics.unmatchedRuksRegionNames,
                    )}
                  </p>
                  <p>
                    Unmatched DAGI regions:{" "}
                    {formatNameList(
                      regionJoinDiagnosticsState.diagnostics.unmatchedBoundaryRegionNames,
                    )}
                  </p>
                </div>
              </>
            ) : null}
            {isRegionView && regionJoinDiagnosticsState.status === "idle" ? (
              <p className="muted">
                Region join diagnostics are waiting for the DAGI region boundaries to
                load.
              </p>
            ) : null}
            {!isRegionView ? (
              <p className="muted">
                Switch geography detail to `Region` to inspect the exact-name join
                diagnostics for the current disease, year, age group, and sex selection.
              </p>
            ) : null}
          </article>

          <article className="panel panel--wide">
            <div className="panel__header">
              <h2>Source and methodology</h2>
            </div>
            <div className="source-stack">
              <p className="source-note">{directRuksSourceNote}</p>
              <p className="source-note source-note--derived">{derivedRuksSourceNote}</p>
            </div>
            <div className="checklist">
              <p>1. Region diagnostics use an explicit exact-name join for `region_name = DAGI.Navn`.</p>
              <p>2. The current Bornholm duplicate handling remains local, visible, and temporary until the upstream issue is clarified.</p>
              <p>3. The region choropleth stays blocked until one measure contract is selected deliberately.</p>
            </div>
            <div className="resource-links">
              {methodologyLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="resource-link"
                  target="_blank"
                  rel="noreferrer"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </article>

          <article className="panel panel--wide">
            <div className="panel__header">
              <h2>Implementation track</h2>
            </div>
            <div className="checklist">
              <p>1. Read the rate metric from the remote Parquet dataset.</p>
              <p>2. Build filter state for disease, geography detail, year, age group, and sex.</p>
              <p>3. Join the filtered values to municipality or region polygons.</p>
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}

function RegionMapShape({
  feature,
  row,
  minValue,
  maxValue,
  emptyLabel,
}: {
  feature: SvgRegionBoundaryFeature;
  row: RuksRegionRateMapRow | null;
  minValue: number;
  maxValue: number;
  emptyLabel: string;
}) {
  const value = row?.value ?? null;

  return (
    <path
      d={feature.path}
      className="region-map__shape"
      fill={getRegionFillColor(value, minValue, maxValue)}
    >
      <title>
        {value === null
          ? `${feature.name}: ${emptyLabel}`
          : `${feature.name}: ${formatMetricValue(value)} pr. 100.000`}
      </title>
    </path>
  );
}

function SidebarFilterSection({
  filter,
  options,
  selectedValue,
  disabled,
  onSelect,
}: {
  filter: SidebarFilter;
  options: FilterDefinition[];
  selectedValue: string;
  disabled: boolean;
  onSelect: (value: string) => void;
}) {
  return (
    <section className="filter-group">
      <div className="filter-group__header">
        <h3>{filter.title}</h3>
        {filter.hint ? <p className="muted">{filter.hint}</p> : null}
      </div>
      <div className="filter-options">
        {options.length === 0 ? (
          <button type="button" className="filter-chip" disabled>
            No options
          </button>
        ) : (
          options.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={selectedValue === option.value}
              className={
                selectedValue === option.value
                  ? "filter-chip filter-chip--active"
                  : "filter-chip"
              }
              disabled={disabled}
              onClick={() => onSelect(option.value)}
            >
              {option.label}
            </button>
          ))
        )}
      </div>
    </section>
  );
}
