import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
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
  type RuksFilterSelection,
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
  fetchTemporaryDagiRegionGeoJsonBoundaries,
  type RegionGeoJsonBoundaryCollection,
  type RegionGeoJsonBoundaryFeature,
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

type FilterState = Omit<Record<FilterGroup, string>, "year" | "ageGroup"> & {
  yearStart: string;
  yearEnd: string;
  ageGroups: string[];
};

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
  | { status: "ready"; boundaries: RegionGeoJsonBoundaryCollection }
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
    key: "measure",
    title: "Measure",
    source: "duckdb",
  },
  {
    key: "metric",
    title: "Metric",
    source: "duckdb",
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

const dataDrivenFilterKeys = [
  "disease",
  "geoLevel",
  "measure",
  "metric",
  "year",
  "ageGroup",
  "sex",
] as const;
const preferredDiseaseSlug = "kol";
const preferredMeasureLabel = "Antal personer med sygdom";
const preferredMetricLabel = "Antal personer pr. 100.000 borgere";
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
    measure: "measure_code",
    metric: "source_unit_label",
    year: "year",
    ageGroup: "age_group_code",
    sex: "sex_code",
  },
  distinctColumns: {
    disease: {
      value: "disease_slug",
      label: "disease_label",
    },
    geoLevel: {
      value: "geo_level",
    },
    measure: {
      value: "measure_code",
      label: "measure_label",
    },
    metric: {
      value: "source_unit_label",
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

function toGeographyOptions(values: readonly RuksDistinctValue[]): FilterDefinition[] {
  const knownLabels = new Map(localGeographyOptions.map((option) => [option.value, option.label]));

  return values.map((item) => ({
    label: knownLabels.get(item.value) ?? item.label,
    value: item.value,
  }));
}

function isAllAgesOption(option: FilterDefinition): boolean {
  const normalized = `${option.value} ${option.label}`.toLocaleLowerCase("da-DK");

  return normalized.includes("alle") && normalized.includes("aldr");
}

function getAgeGroupSortValue(option: FilterDefinition): number {
  if (isAllAgesOption(option)) {
    return Number.NEGATIVE_INFINITY;
  }

  const match = option.label.match(/\d+/) ?? option.value.match(/\d+/);

  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function getSortedAgeGroupOptions(options: readonly FilterDefinition[]): FilterDefinition[] {
  return [...options].sort((left, right) => {
    const ageComparison = getAgeGroupSortValue(left) - getAgeGroupSortValue(right);

    if (ageComparison !== 0) {
      return ageComparison;
    }

    return left.label.localeCompare(right.label, "da-DK");
  });
}

function isPreferredMapMeasureOption(option: FilterDefinition): boolean {
  const normalized = `${option.value} ${option.label}`.toLocaleLowerCase("da-DK");

  return (
    !normalized.includes("incidens") &&
    (normalized.includes("personer med sygdom") ||
      normalized.includes("prævalens") ||
      normalized.includes("praevalens") ||
      normalized.includes("prevalence"))
  );
}

function createInitialFilterState(options: DuckDbFilterOptions): FilterState {
  const preferredDisease =
    options.disease.find((option) => option.value === preferredDiseaseSlug) ??
    options.disease[0];
  const preferredMeasure =
    options.measure.find((option) => option.label === preferredMeasureLabel) ??
    options.measure.find((option) => option.value === preferredMeasureLabel) ??
    options.measure.find((option) => isPreferredMapMeasureOption(option)) ??
    options.measure[0];
  const preferredMetric =
    options.metric.find((option) => option.value === preferredMetricLabel) ??
    options.metric.find((option) => option.label === preferredMetricLabel) ??
    options.metric[0];
  const geographyOptions = toGeographyOptions(options.geoLevel);
  const preferredGeography =
    geographyOptions.find((option) => option.value === "region") ??
    geographyOptions[0];
  const years = getSortedYearOptions(toFilterDefinitions(options.year));
  const firstYear = years[0]?.value ?? "";
  const lastYear = years.at(-1)?.value ?? firstYear;
  const ageGroups = getSortedAgeGroupOptions(toFilterDefinitions(options.ageGroup));
  const defaultAgeGroup =
    ageGroups.find((option) => isAllAgesOption(option)) ?? ageGroups[0];

  return {
    disease: preferredDisease?.value ?? "",
    geoLevel: preferredGeography?.value ?? "",
    measure: preferredMeasure?.value ?? "",
    metric: preferredMetric?.value ?? "",
    yearStart: lastYear,
    yearEnd: lastYear,
    ageGroups: defaultAgeGroup ? [defaultAgeGroup.value] : [],
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
  const disease = getSelectedFilterLabel(
    filters.disease,
    toFilterDefinitions(filterOptions.disease),
  );
  const geography = getSelectedFilterLabel(
    filters.geoLevel,
    toGeographyOptions(filterOptions.geoLevel),
  );
  const measure = getSelectedFilterLabel(
    filters.measure,
    toFilterDefinitions(filterOptions.measure),
  );
  const metric = getSelectedFilterLabel(filters.metric, toFilterDefinitions(filterOptions.metric));
  const ageGroups = filters.ageGroups
    .map((ageGroup) =>
      getSelectedFilterLabel(ageGroup, toFilterDefinitions(filterOptions.ageGroup)),
    )
    .join(", ");
  const sex = getSelectedFilterLabel(filters.sex, toFilterDefinitions(filterOptions.sex));

  return `${disease}, ${geography}, ${measure}, ${metric}, ${formatYearRange(filters)}, ${ageGroups || "no age groups"}, ${sex}`;
}

function getSortedYearOptions(options: readonly FilterDefinition[]): FilterDefinition[] {
  return [...options].sort((left, right) => Number(left.value) - Number(right.value));
}

function getYearRangeIndexes(
  filters: FilterState,
  yearOptions: readonly FilterDefinition[],
): { startIndex: number; endIndex: number } {
  const startIndex = Math.max(
    0,
    yearOptions.findIndex((option) => option.value === filters.yearStart),
  );
  const endIndex = Math.max(
    startIndex,
    yearOptions.findIndex((option) => option.value === filters.yearEnd),
  );

  return { startIndex, endIndex };
}

function formatYearRange(filters: FilterState): string {
  return filters.yearStart === filters.yearEnd
    ? filters.yearStart
    : `${filters.yearStart}-${filters.yearEnd}`;
}

function toPreviewFilters(filters: FilterState): RuksFilterSelection {
  return {
    disease: filters.disease,
    geoLevel: filters.geoLevel,
    measure: filters.measure,
    metric: filters.metric,
    year: {
      min: filters.yearStart,
      max: filters.yearEnd,
    },
    ageGroup: filters.ageGroups,
    sex: filters.sex,
  };
}

function toMapSnapshotFilters(filters: FilterState): {
  disease: string;
  measure: string;
  year: string;
  ageGroup: string;
  sex: string;
  metric: string;
} {
  return {
    disease: filters.disease,
    measure: filters.measure,
    metric: filters.metric,
    year: filters.yearEnd,
    ageGroup: filters.ageGroups[0] ?? "",
    sex: filters.sex,
  };
}

function hasSingleMapSlice(filters: FilterState): boolean {
  return filters.yearStart === filters.yearEnd && filters.ageGroups.length === 1;
}

function formatMetricValue(value: number): string {
  return new Intl.NumberFormat("da-DK", {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);
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

  if (regionMetricState.status === "blocked") {
    return {
      start: "Table range",
      end: "Map paused",
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

  if (regionMetricState.status === "blocked") {
    return "single year and age group required";
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
        const boundaries = await fetchTemporaryDagiRegionGeoJsonBoundaries();

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
        const [disease, geoLevel, measure, metric, year, ageGroup, sex] = await Promise.all(
          dataDrivenFilterKeys.map((key) =>
            queryRuksDistinctFilterValues(release, ruksFilterContract, key),
          ),
        );

        if (cancelled) {
          return;
        }

        const options: DuckDbFilterOptions = {
          disease,
          geoLevel,
          measure,
          metric,
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

    const activeFilters = toPreviewFilters(filters);
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
            orderByColumns: [
              "geo_level",
              "region_name",
              "municipality_name",
              "disease_label",
              "year",
              "age_group_label",
              "sex_label",
              "measure_label",
            ],
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

    if (!hasSingleMapSlice(filters)) {
      setRegionMetricState({
        status: "blocked",
        message:
          "The table can show year ranges and multiple age groups, but the choropleth needs one year and one age group until an explicit aggregation rule is chosen.",
      });
      setRegionRateAuditState({ status: "idle" });
      return;
    }

    const activeFilters = toMapSnapshotFilters(filters);
    let cancelled = false;

    setRegionMetricState({ status: "loading" });
    setRegionRateAuditState({ status: "loading" });

    async function loadRegionMetrics() {
      try {
        const [audit, rows] = await Promise.all([
          auditRuksRegionRateCandidates(release, {
            disease: activeFilters.disease,
            measure: activeFilters.measure,
            metric: activeFilters.metric,
            year: activeFilters.year,
            ageGroup: activeFilters.ageGroup,
            sex: activeFilters.sex,
          }),
          queryRuksRegionRateMapRows(release, {
            disease: activeFilters.disease,
            measure: activeFilters.measure,
            metric: activeFilters.metric,
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
            measure: activeFilters.measure,
            metric: activeFilters.metric,
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

    const activeFilters = toPreviewFilters(filters);
    const boundaryRegionNames = regionBoundaryState.boundaries.features.map(
      (feature) => feature.properties.name,
    );
    let cancelled = false;

    setRegionJoinDiagnosticsState({ status: "loading" });

    async function loadRegionJoinDiagnostics() {
      try {
        const diagnostics = await queryRuksRegionJoinDiagnostics(
          release,
          {
            disease: activeFilters.disease,
            measure: activeFilters.measure,
            metric: activeFilters.metric,
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
  const selectedMetricLabel =
    filters && filterOptions
      ? getSelectedFilterLabel(filters.metric, toFilterDefinitions(filterOptions.metric))
      : preferredMetricLabel;
  const selectedMeasureLabel =
    filters && filterOptions
      ? getSelectedFilterLabel(filters.measure, toFilterDefinitions(filterOptions.measure))
      : preferredMeasureLabel;
  const diseaseOptions = filterOptions ? toFilterDefinitions(filterOptions.disease) : [];
  const geographyOptions = filterOptions ? toGeographyOptions(filterOptions.geoLevel) : [];
  const measureOptions = filterOptions ? toFilterDefinitions(filterOptions.measure) : [];
  const metricOptions = filterOptions ? toFilterDefinitions(filterOptions.metric) : [];
  const yearOptions = filterOptions
    ? getSortedYearOptions(toFilterDefinitions(filterOptions.year))
    : [];
  const ageGroupOptions = filterOptions
    ? getSortedAgeGroupOptions(toFilterDefinitions(filterOptions.ageGroup))
    : [];
  const sexOptions = filterOptions ? toFilterDefinitions(filterOptions.sex) : [];
  const sexSidebarFilter = sidebarFilters.find((filter) => filter.key === "sex");
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
  const isUsingFallbackRegionBoundaries =
    regionBoundaryState.status === "ready" &&
    regionBoundaryState.boundaries.source === "local-region-schematic-fallback";

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
          <DropdownFilterSection
            title="Disease"
            options={diseaseOptions}
            selectedValue={filters?.disease ?? ""}
            disabled={filters === null || diseaseOptions.length === 0}
            onSelect={(value) => {
              setFilters((current) => (current ? { ...current, disease: value } : current));
            }}
          />

          <DropdownFilterSection
            title="Geographic detail"
            hint="Switch the map between municipality and region boundaries."
            options={geographyOptions}
            selectedValue={filters?.geoLevel ?? ""}
            disabled={filters === null || geographyOptions.length === 0}
            onSelect={(value) => {
              setFilters((current) => (current ? { ...current, geoLevel: value } : current));
            }}
          />

          <DropdownFilterSection
            title="Metric"
            options={metricOptions}
            selectedValue={filters?.metric ?? ""}
            disabled={filters === null || metricOptions.length === 0}
            onSelect={(value) => {
              setFilters((current) => (current ? { ...current, metric: value } : current));
            }}
          />

          <DropdownFilterSection
            title="Measure"
            options={measureOptions}
            selectedValue={filters?.measure ?? ""}
            disabled={filters === null || measureOptions.length === 0}
            onSelect={(value) => {
              setFilters((current) => (current ? { ...current, measure: value } : current));
            }}
          />

          <YearRangeFilterSection
            options={yearOptions}
            filters={filters}
            disabled={filters === null || yearOptions.length === 0}
            onChange={(nextRange) => {
              setFilters((current) =>
                current
                  ? {
                      ...current,
                      yearStart: nextRange.yearStart,
                      yearEnd: nextRange.yearEnd,
                    }
                  : current,
              );
            }}
          />

          <CheckboxFilterSection
            title="Age group"
            options={ageGroupOptions}
            selectedValues={filters?.ageGroups ?? []}
            disabled={filters === null || ageGroupOptions.length === 0}
            onToggle={(value) => {
              setFilters((current) => {
                if (!current) {
                  return current;
                }

                const allAgesValue = ageGroupOptions.find((option) =>
                  isAllAgesOption(option),
                )?.value;
                const isTogglingAllAges = value === allAgesValue;

                if (isTogglingAllAges) {
                  return {
                    ...current,
                    ageGroups: [value],
                  };
                }

                const nextAgeGroups = current.ageGroups.includes(value)
                  ? current.ageGroups.filter((ageGroup) => ageGroup !== value)
                  : [
                      ...current.ageGroups.filter(
                        (ageGroup) => ageGroup !== allAgesValue,
                      ),
                      value,
                    ];

                return {
                  ...current,
                  ageGroups:
                    nextAgeGroups.length > 0
                      ? nextAgeGroups
                      : allAgesValue
                        ? [allAgesValue]
                        : current.ageGroups,
                };
              });
            }}
          />

          <SidebarFilterSection
            filter={sexSidebarFilter ?? sidebarFilters[4]}
            options={sexOptions}
            selectedValue={filters?.sex ?? ""}
            disabled={filters === null || sexOptions.length === 0}
            onSelect={(value) => {
              setFilters((current) => (current ? { ...current, sex: value } : current));
            }}
          />
        </div>
      </aside>

      <section className="main-stage">
        <article className="panel map-panel">
          <div className="panel__header">
            <div>
              <h2>Map preview</h2>
              <p className="muted">
                Choropleth view for the selected region snapshot.
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
              {isUsingFallbackRegionBoundaries
                ? "Schematic fallback"
                : isKOLRegionPrototype && regionMetricState.status === "ready"
                ? "Live region map"
                : isRegionView
                  ? "KOL-first region slice"
                  : "Live DuckDB"}
            </span>
          </div>

          <div className="map-canvas">
            <div className="map-canvas__wash" />
            {isRegionView && regionBoundaryState.status === "ready" ? (
              <RegionMapLibre
                boundaries={regionBoundaryState.boundaries}
                rowsByRegion={regionValueByName}
                minValue={regionMinValue}
                maxValue={regionMaxValue}
                emptyLabel={regionMapEmptyLabel}
                muted={!(isKOLRegionPrototype && regionMetricState.status === "ready")}
              />
            ) : null}
            <div className="map-canvas__legend">
              <span>{regionLegendLabels.start}</span>
              <div className="legend-ramp" />
              <span>{regionLegendLabels.end}</span>
            </div>
          </div>

          <div className="map-status-panel map-preview">
            <p className="map-canvas__metric">{selectedMetricLabel}</p>
            {isKOLRegionPrototype && regionMetricState.status === "ready" ? (
              <div className="preview-state">
                <h3>{selectedMeasureLabel}</h3>
                <p className="muted">
                  Region values are joined by exact region name and colored by the
                  selected non-standardized rate.
                </p>
                {isUsingFallbackRegionBoundaries ? (
                  <p className="muted">
                    DAGI WFS is currently unavailable, so the map is using a temporary
                    schematic region layer instead of official boundaries.
                  </p>
                ) : null}
              </div>
            ) : null}
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

            {isKOLRegionPrototype && regionMetricState.status === "blocked" ? (
              <div className="preview-state">
                <h3>Map slice paused</h3>
                <p className="muted">{regionMetricState.message}</p>
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
          </div>
        </article>

        <PreviewTablePanel
          releaseTag={release.tag}
          filters={filters}
          previewState={previewState}
        />

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

function PreviewTablePanel({
  releaseTag,
  filters,
  previewState,
}: {
  releaseTag: string;
  filters: FilterState | null;
  previewState: PreviewLoadState;
}) {
  return (
    <article className="panel data-panel">
      <div className="panel__header">
        <div>
          <h2>Data preview</h2>
          <p className="muted">
            Filtered DuckDB rows for validating the map slice separately from the map.
          </p>
        </div>
        <span className="pill">Table</span>
      </div>

      {previewState.status === "loading" ? (
        <div className="preview-state">
          <h3>Querying DuckDB</h3>
          <p className="muted">
            Re-running the filtered query for the current disease, geography, year range,
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
              <strong>
                {filters
                  ? getSelectedFilterLabel(filters.geoLevel, localGeographyOptions)
                  : "—"}
              </strong>
            </div>
            <div className="preview-summary__card">
              <span className="preview-summary__label">Release</span>
              <strong>{releaseTag}</strong>
            </div>
          </div>

          <div className="preview-table-wrap">
            <table className="preview-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Measure</th>
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
                    <td>{formatPreviewValue(row.measure_label)}</td>
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
    </article>
  );
}

type RegionMapFeature = Omit<RegionGeoJsonBoundaryFeature, "properties"> & {
  properties: RegionGeoJsonBoundaryFeature["properties"] & {
    value: number | null;
    valueLabel: string;
    hasValue: boolean;
  };
};

type RegionMapFeatureCollection = {
  type: "FeatureCollection";
  features: RegionMapFeature[];
};

const REGION_MAP_SOURCE_ID = "ruks-regions";
const REGION_MAP_FILL_LAYER_ID = "ruks-region-fill";
const REGION_MAP_LINE_LAYER_ID = "ruks-region-line";

function RegionMapLibre({
  boundaries,
  rowsByRegion,
  minValue,
  maxValue,
  emptyLabel,
  muted,
}: {
  boundaries: RegionGeoJsonBoundaryCollection;
  rowsByRegion: Map<string, RuksRegionRateMapRow>;
  minValue: number;
  maxValue: number;
  emptyLabel: string;
  muted: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const regionData = useMemo(
    () => buildRegionMapFeatureCollection(boundaries, rowsByRegion, emptyLabel),
    [boundaries, rowsByRegion, emptyLabel],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: {
              "background-color": "rgba(255, 255, 255, 0)",
            },
          },
        ],
      },
      center: [10.5, 56.1],
      zoom: 5.35,
      attributionControl: false,
    });

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );

    map.on("load", () => {
      loadedRef.current = true;
      applyRegionMapState(map, regionData, minValue, maxValue, muted);
      fitMapToRegionData(map, regionData);
      map.on("click", REGION_MAP_FILL_LAYER_ID, (event) => {
        const properties = event.features?.[0]?.properties as
          | RegionMapFeature["properties"]
          | undefined;

        if (!properties) {
          return;
        }

        new maplibregl.Popup({ closeButton: false })
          .setLngLat(event.lngLat)
          .setText(`${properties.name}: ${properties.valueLabel}`)
          .addTo(map);
      });
      map.on("mouseenter", REGION_MAP_FILL_LAYER_ID, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", REGION_MAP_FILL_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
      });
    });

    mapRef.current = map;

    return () => {
      loadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !loadedRef.current) {
      return;
    }

    applyRegionMapState(map, regionData, minValue, maxValue, muted);
    fitMapToRegionData(map, regionData);
  }, [maxValue, minValue, muted, regionData]);

  return <div ref={containerRef} className="region-maplibre" />;
}

function buildRegionMapFeatureCollection(
  boundaries: RegionGeoJsonBoundaryCollection,
  rowsByRegion: Map<string, RuksRegionRateMapRow>,
  emptyLabel: string,
): RegionMapFeatureCollection {
  return {
    type: "FeatureCollection",
    features: boundaries.features.map((feature) => {
      const row = rowsByRegion.get(feature.properties.name);
      const value = row?.value ?? null;

      return {
        ...feature,
        properties: {
          ...feature.properties,
          value,
          valueLabel:
            value === null ? emptyLabel : `${formatMetricValue(value)} pr. 100.000`,
          hasValue: value !== null,
        },
      };
    }),
  };
}

function applyRegionMapState(
  map: maplibregl.Map,
  regionData: RegionMapFeatureCollection,
  minValue: number,
  maxValue: number,
  muted: boolean,
) {
  const source = map.getSource(REGION_MAP_SOURCE_ID) as
    | maplibregl.GeoJSONSource
    | undefined;

  if (source) {
    source.setData(regionData as never);
  } else {
    map.addSource(REGION_MAP_SOURCE_ID, {
      type: "geojson",
      data: regionData,
    } as never);
  }

  if (!map.getLayer(REGION_MAP_FILL_LAYER_ID)) {
    map.addLayer({
      id: REGION_MAP_FILL_LAYER_ID,
      type: "fill",
      source: REGION_MAP_SOURCE_ID,
      paint: {},
    });
  }

  if (!map.getLayer(REGION_MAP_LINE_LAYER_ID)) {
    map.addLayer({
      id: REGION_MAP_LINE_LAYER_ID,
      type: "line",
      source: REGION_MAP_SOURCE_ID,
      paint: {
        "line-color": "rgba(20, 40, 29, 0.32)",
        "line-width": 1.2,
      },
    });
  }

  map.setPaintProperty(
    REGION_MAP_FILL_LAYER_ID,
    "fill-color",
    getMapLibreFillColorExpression(minValue, maxValue, muted),
  );
  map.setPaintProperty(
    REGION_MAP_FILL_LAYER_ID,
    "fill-opacity",
    muted ? 0.48 : 0.9,
  );
}

function getMapLibreFillColorExpression(
  minValue: number,
  maxValue: number,
  muted: boolean,
) {
  if (muted) {
    return [
      "case",
      ["==", ["get", "hasValue"], true],
      "rgba(31, 122, 90, 0.28)",
      "rgba(20, 40, 29, 0.12)",
    ];
  }

  if (maxValue <= minValue) {
    return [
      "case",
      ["==", ["get", "hasValue"], true],
      "#1f7a5a",
      "rgba(20, 40, 29, 0.12)",
    ];
  }

  return [
    "case",
    ["==", ["get", "hasValue"], true],
    [
      "interpolate",
      ["linear"],
      ["get", "value"],
      minValue,
      "#e5f1e8",
      maxValue,
      "#1f7a5a",
    ],
    "rgba(20, 40, 29, 0.12)",
  ];
}

function fitMapToRegionData(
  map: maplibregl.Map,
  regionData: RegionMapFeatureCollection,
) {
  const bounds = getRegionDataBounds(regionData);

  if (!bounds) {
    return;
  }

  map.fitBounds(bounds, {
    padding: 34,
    duration: 0,
  });
}

function getRegionDataBounds(
  regionData: RegionMapFeatureCollection,
): maplibregl.LngLatBoundsLike | null {
  let minLng = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  for (const feature of regionData.features) {
    for (const polygon of feature.geometry.coordinates) {
      for (const ring of polygon) {
        for (const [lng, lat] of ring) {
          minLng = Math.min(minLng, lng);
          minLat = Math.min(minLat, lat);
          maxLng = Math.max(maxLng, lng);
          maxLat = Math.max(maxLat, lat);
        }
      }
    }
  }

  if (
    !Number.isFinite(minLng) ||
    !Number.isFinite(minLat) ||
    !Number.isFinite(maxLng) ||
    !Number.isFinite(maxLat)
  ) {
    return null;
  }

  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
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

function DropdownFilterSection({
  title,
  hint,
  options,
  selectedValue,
  disabled,
  onSelect,
}: {
  title: string;
  hint?: string;
  options: FilterDefinition[];
  selectedValue: string;
  disabled: boolean;
  onSelect: (value: string) => void;
}) {
  return (
    <section className="filter-group">
      <div className="filter-group__header">
        <h3>{title}</h3>
        {hint ? <p className="muted">{hint}</p> : null}
      </div>
      <label className="select-control">
        <span className="sr-only">{title}</span>
        <select
          value={selectedValue}
          disabled={disabled}
          onChange={(event) => onSelect(event.target.value)}
        >
          {options.length === 0 ? <option value="">No options</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

function YearRangeFilterSection({
  options,
  filters,
  disabled,
  onChange,
}: {
  options: FilterDefinition[];
  filters: FilterState | null;
  disabled: boolean;
  onChange: (range: { yearStart: string; yearEnd: string }) => void;
}) {
  const selectedRange =
    filters && options.length > 0
      ? getYearRangeIndexes(filters, options)
      : { startIndex: 0, endIndex: Math.max(0, options.length - 1) };
  const yearStart = options[selectedRange.startIndex]?.value ?? "";
  const yearEnd = options[selectedRange.endIndex]?.value ?? "";
  const maxIndex = Math.max(0, options.length - 1);
  const rangeStartPercent =
    maxIndex > 0 ? (selectedRange.startIndex / maxIndex) * 100 : 0;
  const rangeEndPercent =
    maxIndex > 0 ? (selectedRange.endIndex / maxIndex) * 100 : 0;
  const sliderClassName =
    selectedRange.startIndex === selectedRange.endIndex
      ? "range-control__slider range-control__slider--locked"
      : "range-control__slider";

  return (
    <section className="filter-group">
      <div className="filter-group__header">
        <h3>Year</h3>
        <p className="muted">{yearStart && yearEnd ? `${yearStart} to ${yearEnd}` : "No years"}</p>
      </div>
      <div className="range-control">
        <div
          className={sliderClassName}
          style={
            {
              "--range-start": `${rangeStartPercent}%`,
              "--range-end": `${rangeEndPercent}%`,
            } as CSSProperties
          }
        >
          <div className="range-control__track" aria-hidden="true" />
          <label>
            <span className="sr-only">Year range start</span>
            <input
              className="range-control__input range-control__input--start"
              type="range"
              min={0}
              max={maxIndex}
              step={1}
              value={selectedRange.startIndex}
              disabled={disabled}
              aria-label="Year range start"
              onChange={(event) => {
                const nextStart = Math.min(
                  Number(event.target.value),
                  selectedRange.endIndex,
                );

                onChange({
                  yearStart: options[nextStart]?.value ?? "",
                  yearEnd,
                });
              }}
            />
          </label>
          <label>
            <span className="sr-only">Year range end</span>
            <input
              className="range-control__input range-control__input--end"
              type="range"
              min={0}
              max={maxIndex}
              step={1}
              value={selectedRange.endIndex}
              disabled={disabled}
              aria-label="Year range end"
              onChange={(event) => {
                const nextEnd = Math.max(
                  Number(event.target.value),
                  selectedRange.startIndex,
                );

                onChange({
                  yearStart,
                  yearEnd: options[nextEnd]?.value ?? "",
                });
              }}
            />
          </label>
        </div>
        <div className="range-control__ticks" aria-hidden="true">
          <span>{options[0]?.label ?? ""}</span>
          <span>{options.at(-1)?.label ?? ""}</span>
        </div>
      </div>
    </section>
  );
}

function CheckboxFilterSection({
  title,
  options,
  selectedValues,
  disabled,
  onToggle,
}: {
  title: string;
  options: FilterDefinition[];
  selectedValues: string[];
  disabled: boolean;
  onToggle: (value: string) => void;
}) {
  return (
    <section className="filter-group">
      <div className="filter-group__header">
        <h3>{title}</h3>
      </div>
      <div className="checkbox-list">
        {options.length === 0 ? (
          <p className="muted">No options</p>
        ) : (
          options.map((option) => (
            <label key={option.value} className="checkbox-option">
              <input
                type="checkbox"
                checked={selectedValues.includes(option.value)}
                disabled={disabled}
                onChange={() => onToggle(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))
        )}
      </div>
    </section>
  );
}
