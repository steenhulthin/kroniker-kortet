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
  queryRuksMunicipalityRateMapRows,
  queryRuksRegionRateMapRows,
  type RuksMunicipalityRateMapRow,
  type RuksRegionRateCandidateAudit,
  type RuksRegionRateMapRow,
} from "../lib/ruks-map";
import {
  fetchStaticDagiFlatGeobufBoundaries,
  type DagiBoundaryCollection,
  type DagiBoundaryCollections,
  type DagiBoundaryFeature,
  type DagiGeoLevel,
} from "../lib/spatial-region-static";

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
  | { status: "ready"; boundaries: DagiBoundaryCollections }
  | { status: "error"; message: string };

type RegionMetricLoadState =
  | { status: "idle" }
  | { status: "blocked"; message: string }
  | { status: "loading" }
  | { status: "ready"; rows: RuksRegionRateMapRow[] }
  | { status: "empty" }
  | { status: "error"; message: string };

type MunicipalityMetricLoadState =
  | { status: "idle" }
  | { status: "blocked"; message: string }
  | { status: "loading" }
  | { status: "ready"; rows: RuksMunicipalityRateMapRow[] }
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
    title: "Sygdom",
    source: "duckdb",
  },
  {
    key: "geoLevel",
    title: "Geografisk niveau",
    hint: "Skift kortet mellem kommune- og regionsgrænser.",
    source: "local",
  },
  {
    key: "measure",
    title: "Mål",
    source: "duckdb",
  },
  {
    key: "metric",
    title: "Enhed",
    source: "duckdb",
  },
  {
    key: "year",
    title: "År",
    source: "duckdb",
  },
  {
    key: "ageGroup",
    title: "Aldersgruppe",
    source: "duckdb",
  },
  {
    key: "sex",
    title: "Køn",
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

  return `${disease}, ${geography}, ${measure}, ${metric}, ${formatYearRange(filters)}, ${ageGroups || "ingen aldersgrupper"}, ${sex}`;
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
  return message.includes("Regionskortets mål er tvetydigt");
}

function getRegionLegendLabels(
  filters: FilterState | null,
  regionMetricState: RegionMetricLoadState,
  regionMinValue: number,
  regionMaxValue: number,
) {
  if (filters?.geoLevel !== "region") {
    return {
      start: "Indlæser",
      end: "Klar",
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
      start: "Kun KOL",
      end: "Forhåndsvisning",
    };
  }

  if (
    regionMetricState.status === "error" &&
    isAmbiguousRegionMeasureMessage(regionMetricState.message)
  ) {
    return {
      start: "Kobling klar",
      end: "Mål afventer",
    };
  }

  if (regionMetricState.status === "blocked") {
    return {
      start: "Tabeludsnit",
      end: "Kort sat på pause",
    };
  }

  return {
    start: "Indlæser",
    end: "Klar",
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
    return "afventer eksplicit målvalg";
  }

  if (regionMetricState.status === "blocked") {
    return "kræver ét år og én aldersgruppe";
  }

  if (regionMetricState.status === "loading") {
    return "indlæser regionrater";
  }

  if (regionMetricState.status === "empty") {
    return "ingen regionrater fundet";
  }

  return "ingen rate fundet";
}

function getMunicipalityLegendLabels(
  municipalityMetricState: MunicipalityMetricLoadState,
  municipalityMinValue: number,
  municipalityMaxValue: number,
) {
  if (municipalityMetricState.status === "ready") {
    return {
      start: formatMetricValue(municipalityMinValue),
      end: formatMetricValue(municipalityMaxValue),
    };
  }

  if (municipalityMetricState.status === "blocked") {
    return {
      start: "Tabeludsnit",
      end: "Kort sat på pause",
    };
  }

  return {
    start: "Indlæser",
    end: "Klar",
  };
}

function getMunicipalityMapEmptyLabel(
  municipalityMetricState: MunicipalityMetricLoadState,
): string {
  if (municipalityMetricState.status === "blocked") {
    return "kræver ét år og én aldersgruppe";
  }

  if (municipalityMetricState.status === "loading") {
    return "indlæser kommunerater";
  }

  if (municipalityMetricState.status === "empty") {
    return "ingen kommunerater fundet";
  }

  return "ingen rate fundet";
}

function formatNameList(names: readonly string[]): string {
  return names.length === 0 ? "ingen" : names.join(", ");
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
          error instanceof Error ? error.message : "Ukendt fejl ved indlæsning af data";

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
          <h1>Kroniker-kortet</h1>
          <p className="app-header__subtitle">Kroniske sygdomme på kort</p>
        </div>

        <div className="github-repo-box">
          <a
            className="github-repo-link"
            href="https://github.com/steenhulthin/kroniker-kortet"
            target="_blank"
            rel="noreferrer"
            aria-label="Åbn kroniker-kortet på GitHub"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path
                fill="currentColor"
                d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.5 7.5 0 0 1 8 3.86c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
              />
            </svg>
            <span>GitHub</span>
          </a>
          <p className="github-repo-box__credit">
            Et #DagensDashboard af{" "}
            <a href="https://steen.hulthin.dk/" target="_blank" rel="noreferrer">
              Steenhulthin
            </a>
          </p>
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
        <h2>Indlæser dashboarddata</h2>
      </div>
      <p className="muted">
        Finder den nyeste RUKS-udgivelse og forbereder dashboardets kortvisning.
      </p>
    </section>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <section className="panel panel--wide">
      <div className="panel__header">
        <h2>Udgivelseskilde er ikke tilgængelig</h2>
      </div>
      <p className="muted">
        Dashboardet er klar, men metadata for den aktuelle udgivelse kunne ikke indlæses.
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
  const [municipalityMetricState, setMunicipalityMetricState] =
    useState<MunicipalityMetricLoadState>({
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

    async function loadBoundaries() {
      try {
        const boundaries = await fetchStaticDagiFlatGeobufBoundaries();

        if (cancelled) {
          return;
        }

        setRegionBoundaryState({ status: "ready", boundaries });
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Ukendt fejl ved indlæsning af geografi";

        setRegionBoundaryState({ status: "error", message });
      }
    }

    void loadBoundaries();

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
            "DuckDB returnerede ingen værdier for et eller flere filtre.";

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
          error instanceof Error ? error.message : "Ukendt DuckDB-fejl";

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
          error instanceof Error ? error.message : "Ukendt DuckDB-fejl";

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

    if (filters.geoLevel !== "municipality") {
      setMunicipalityMetricState({ status: "idle" });
      return;
    }

    if (!hasSingleMapSlice(filters)) {
      setMunicipalityMetricState({
        status: "blocked",
        message:
          "Tabellen kan vise årsspænd og flere aldersgrupper, men kortet kræver ét år og én aldersgruppe, indtil der er valgt en eksplicit aggregeringsregel.",
      });
      return;
    }

    const activeFilters = toMapSnapshotFilters(filters);
    let cancelled = false;

    setMunicipalityMetricState({ status: "loading" });

    async function loadMunicipalityMetrics() {
      try {
        const rows = await queryRuksMunicipalityRateMapRows(release, activeFilters);

        if (cancelled) {
          return;
        }

        setMunicipalityMetricState(
          rows.length === 0 ? { status: "empty" } : { status: "ready", rows },
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Ukendt fejl i kommuneopgørelsen";

        setMunicipalityMetricState({ status: "error", message });
      }
    }

    void loadMunicipalityMetrics();

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
          "Regionskortet er foreløbigt KOL-først. Andre sygdomme vises kun i forhåndsvisning og diagnostik, indtil regionssporet for KOL er valideret fra ende til ende.",
      });
      setRegionRateAuditState({ status: "idle" });
      return;
    }

    if (!hasSingleMapSlice(filters)) {
      setRegionMetricState({
        status: "blocked",
        message:
          "Tabellen kan vise årsspænd og flere aldersgrupper, men kortet kræver ét år og én aldersgruppe, indtil der er valgt en eksplicit aggregeringsregel.",
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
            metric: activeFilters.metric,
            year: activeFilters.year,
            ageGroup: activeFilters.ageGroup,
            sex: activeFilters.sex,
          }),
          queryRuksRegionRateMapRows(release, {
            disease: activeFilters.disease,
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
          error instanceof Error ? error.message : "Ukendt fejl i regionsopgørelsen";

        try {
          const audit = await auditRuksRegionRateCandidates(release, {
            disease: activeFilters.disease,
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
                  : "Ukendt fejl i regionsaudit",
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
    const boundaryRegionNames = regionBoundaryState.boundaries.region.features.map(
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
          error instanceof Error ? error.message : "Ukendt fejl i regionsdiagnostikken";

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
      : "Indlæser filtermuligheder fra DuckDB...";
  const selectedDiseaseLabel =
    filters && filterOptions
      ? getSelectedFilterLabel(filters.disease, toFilterDefinitions(filterOptions.disease))
      : "valgt sygdom";
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
  const activeBoundaryLevel: DagiGeoLevel =
    filters?.geoLevel === "region" ? "region" : "municipality";
  const isKOLRegionPrototype =
    isRegionView && filters.disease === preferredDiseaseSlug;
  const regionMapRows =
    regionMetricState.status === "ready" ? regionMetricState.rows : [];
  const regionValues = regionMapRows.map((row) => row.value);
  const regionMinValue =
    regionValues.length > 0 ? Math.min(...regionValues) : 0;
  const regionMaxValue =
    regionValues.length > 0 ? Math.max(...regionValues) : 0;
  const regionValueByName = new Map<string, DagiBoundaryMapMetricRow>(
    regionMapRows.map((row) => [row.regionName, row]),
  );
  const municipalityMapRows =
    municipalityMetricState.status === "ready" ? municipalityMetricState.rows : [];
  const municipalityValues = municipalityMapRows.map((row) => row.value);
  const municipalityMinValue =
    municipalityValues.length > 0 ? Math.min(...municipalityValues) : 0;
  const municipalityMaxValue =
    municipalityValues.length > 0 ? Math.max(...municipalityValues) : 0;
  const municipalityValueByName = new Map<string, DagiBoundaryMapMetricRow>(
    municipalityMapRows.map((row) => [row.municipalityName, row]),
  );
  const regionLegendLabels = getRegionLegendLabels(
    filters,
    regionMetricState,
    regionMinValue,
    regionMaxValue,
  );
  const municipalityLegendLabels = getMunicipalityLegendLabels(
    municipalityMetricState,
    municipalityMinValue,
    municipalityMaxValue,
  );
  const regionMapEmptyLabel = getRegionMapEmptyLabel(filters, regionMetricState);
  const municipalityMapEmptyLabel =
    getMunicipalityMapEmptyLabel(municipalityMetricState);
  const activeBoundaries =
    regionBoundaryState.status === "ready"
      ? regionBoundaryState.boundaries[activeBoundaryLevel]
      : null;
  const activeRowsByName = isRegionView ? regionValueByName : municipalityValueByName;
  const activeMinValue = isRegionView ? regionMinValue : municipalityMinValue;
  const activeMaxValue = isRegionView ? regionMaxValue : municipalityMaxValue;
  const activeLegendLabels = isRegionView ? regionLegendLabels : municipalityLegendLabels;
  const activeMapEmptyLabel = isRegionView
    ? regionMapEmptyLabel
    : municipalityMapEmptyLabel;
  const activeMapIsReady = isRegionView
    ? isKOLRegionPrototype && regionMetricState.status === "ready"
    : municipalityMetricState.status === "ready";
  return (
    <main className="dashboard-layout">
      <aside className="sidebar panel">
        <div className="panel__header">
          <h2>Filtre</h2>
          <span className="pill">Sidepanel</span>
        </div>

        {filterLoadState.status === "loading" ? (
          <p className="filter-stack__status">Indlæser filtermuligheder fra DuckDB…</p>
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
              ? "Regionstilstanden er foreløbigt KOL-først. KOL er den eneste sygdom, der kan aktivere det levende regionsudsnit, mens sporet valideres."
              : `${selectedDiseaseLabel} vises kun i forhåndsvisning og koblingsdiagnostik i regionsvisningen, indtil regionssporet for KOL er valideret fra ende til ende.`}
          </p>
        ) : null}

        <div className="filter-stack">
          <DropdownFilterSection
            title="Sygdom"
            options={diseaseOptions}
            selectedValue={filters?.disease ?? ""}
            disabled={filters === null || diseaseOptions.length === 0}
            onSelect={(value) => {
              setFilters((current) => (current ? { ...current, disease: value } : current));
            }}
          />

          <DropdownFilterSection
            title="Geografisk niveau"
            hint="Skift kortet mellem kommune- og regionsgrænser."
            options={geographyOptions}
            selectedValue={filters?.geoLevel ?? ""}
            disabled={filters === null || geographyOptions.length === 0}
            onSelect={(value) => {
              setFilters((current) => (current ? { ...current, geoLevel: value } : current));
            }}
          />

          <DropdownFilterSection
            title="Enhed"
            options={metricOptions}
            selectedValue={filters?.metric ?? ""}
            disabled={filters === null || metricOptions.length === 0}
            onSelect={(value) => {
              setFilters((current) => (current ? { ...current, metric: value } : current));
            }}
          />

          <DropdownFilterSection
            title="Mål"
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
            title="Aldersgruppe"
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
              <h2>Kortvisning</h2>
              <p className="muted">
                Koropletkort for det valgte geografiske udsnit.
              </p>
              <p className="muted">
                Viser {release.tag} for {selectionSummary}
              </p>
              {isRegionView ? (
                <p className="muted">
                  Regionstilstanden er eksplicit KOL-først. Andre sygdomme forbliver
                  i valideringstilstand, så de ikke fremstår produktionsklare.
                </p>
              ) : null}
              {isKOLRegionPrototype &&
              regionMetricState.status === "error" &&
              isAmbiguousRegionMeasureMessage(regionMetricState.message) ? (
                <p className="muted">
                  Den eksakte regionskobling er klar, men kortet er blokeret,
                  indtil der eksplicit er valgt ét regionsmål.
                </p>
              ) : null}
              <p className="muted">
                Midlertidig projektantagelse: dublerede Bornholm-rækker behandles
                som en Christiansø-relateret artefakt og foldes sammen lokalt,
                indtil det er afklaret opstrøms.
              </p>
            </div>
            <span className="pill">
              {isKOLRegionPrototype && regionMetricState.status === "ready"
                ? "Levende regionskort"
                : !isRegionView && municipalityMetricState.status === "ready"
                  ? "Levende kommunekort"
                : isRegionView
                  ? "Statiske DAGI-regioner"
                  : "Statiske DAGI-kommuner"}
            </span>
          </div>

          <div className="map-canvas">
            <div className="map-canvas__wash" />
            {activeBoundaries ? (
              <DagiBoundaryMapLibre
                boundaries={activeBoundaries}
                rowsByName={activeRowsByName}
                minValue={activeMinValue}
                maxValue={activeMaxValue}
                emptyLabel={activeMapEmptyLabel}
                muted={!activeMapIsReady}
              />
            ) : null}
            <div className="map-canvas__legend">
              <span>{activeLegendLabels.start}</span>
              <div className="legend-ramp" />
              <span>{activeLegendLabels.end}</span>
            </div>
          </div>

          <div className="map-status-panel map-preview">
            {isKOLRegionPrototype && regionMetricState.status === "ready" ? (
              <div className="preview-state">
                <h3>{selectedMeasureLabel}</h3>
                <p className="muted">
                  Regionsværdier kobles på eksakt regionsnavn og farves efter
                  den valgte ikke-standardiserede rate.
                </p>
              </div>
            ) : null}
            {filters?.geoLevel === "region" &&
            filters.disease !== preferredDiseaseSlug ? (
              <div className="preview-state">
                <h3>KOL-først regionsprototype</h3>
                <p className="muted">
                  Det første rigtige kort valideres kun på KOL. Andre sygdomme
                  forbliver i forhåndsvisning, indtil regionssporet for KOL er
                  kvalitetssikret, og et mål er valgt eksplicit.
                </p>
              </div>
            ) : null}

            {isKOLRegionPrototype && regionMetricState.status === "blocked" ? (
              <div className="preview-state">
                <h3>Kortudsnit sat på pause</h3>
                <p className="muted">{regionMetricState.message}</p>
              </div>
            ) : null}

            {isKOLRegionPrototype &&
            regionBoundaryState.status === "loading" ? (
              <div className="preview-state">
                <h3>Indlæser regionsgrænser</h3>
                <p className="muted">
                  Indlæser den statiske DAGI-regionsfil til den første rigtige
                  kortprototype.
                </p>
              </div>
            ) : null}

            {isKOLRegionPrototype &&
            regionBoundaryState.status === "error" ? (
              <div className="preview-state preview-state--error">
                <h3>Regionsgrænser kunne ikke indlæses</h3>
                <pre className="error-box">{regionBoundaryState.message}</pre>
              </div>
            ) : null}

            {isKOLRegionPrototype &&
            regionMetricState.status === "loading" ? (
              <div className="preview-state">
                <h3>Indlæser regionsrater</h3>
                <p className="muted">
                  Henter ikke-standardiserede rater for den valgte KOL-visning.
                </p>
              </div>
            ) : null}

            {isKOLRegionPrototype &&
            regionMetricState.status === "empty" ? (
              <div className="preview-state">
                <h3>Ingen regionsrater fundet</h3>
                <p className="muted">
                  DuckDB returnerede ingen regionsrater for de valgte filtre.
                </p>
              </div>
            ) : null}

            {isKOLRegionPrototype &&
            regionMetricState.status === "error" ? (
              <div className="preview-state preview-state--error">
                <h3>
                  {isAmbiguousRegionMeasureMessage(regionMetricState.message)
                    ? "Regionsmål er endnu ikke afklaret"
                    : "Forespørgsel efter regionsrate fejlede"}
                </h3>
                {isAmbiguousRegionMeasureMessage(regionMetricState.message) ? (
                  <p className="muted">
                    Den eksakte regionskobling er klar, men kortet forbliver
                    bevidst blokeret, indtil ét regionsmål vælges eksplicit.
                  </p>
                ) : null}
                <pre className="error-box">{regionMetricState.message}</pre>
              </div>
            ) : null}

            {filters?.geoLevel === "municipality" ? (
              <div className="preview-state">
                <h3>
                  {municipalityMetricState.status === "ready"
                    ? selectedMeasureLabel
                    : "Kommunekort"}
                </h3>
                <p className="muted">
                  Kommuneværdier kobles på eksakt kommunenavn og farves efter
                  den valgte ikke-standardiserede rate.
                </p>
              </div>
            ) : null}

            {filters?.geoLevel === "municipality" &&
            municipalityMetricState.status === "blocked" ? (
              <div className="preview-state">
                <h3>Kortudsnit sat på pause</h3>
                <p className="muted">{municipalityMetricState.message}</p>
              </div>
            ) : null}

            {filters?.geoLevel === "municipality" &&
            municipalityMetricState.status === "loading" ? (
              <div className="preview-state">
                <h3>Indlæser kommunerater</h3>
                <p className="muted">
                  Henter ikke-standardiserede rater for den valgte kommunevisning.
                </p>
              </div>
            ) : null}

            {filters?.geoLevel === "municipality" &&
            municipalityMetricState.status === "empty" ? (
              <div className="preview-state">
                <h3>Ingen kommunerater fundet</h3>
                <p className="muted">
                  DuckDB returnerede ingen kommunerater for de valgte filtre.
                </p>
              </div>
            ) : null}

            {filters?.geoLevel === "municipality" &&
            municipalityMetricState.status === "error" ? (
              <div className="preview-state preview-state--error">
                <h3>Forespørgsel efter kommunerate fejlede</h3>
                <pre className="error-box">{municipalityMetricState.message}</pre>
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
              <h2>Aktuel dashboardspecifikation</h2>
            </div>
            <div className="checklist">
              <p>1. Topfelt med titel.</p>
              <p>2. Sidepanel med filtre for sygdom, geografisk niveau, år, aldersgruppe og køn.</p>
              <p>3. Hovedkort farvet efter `Antal personer pr. 100.000 borgere`.</p>
              <p>4. Start med at validere KOL-sporet, før det udvides til andre sygdomme.</p>
            </div>
          </article>

          <article className="panel">
            <div className="panel__header">
              <h2>KOL-valideringsfokus</h2>
            </div>
            <div className="checklist">
              <p>1. KOL er standardsygdommen i det første valideringsudsnit.</p>
              <p>2. Brug datatabellen til at kontrollere geografi, køn, alder og år.</p>
              <p>3. Kontroller additive antal separat fra rater og standardiserede værdier.</p>
            </div>
          </article>

          <article className="panel">
            <div className="panel__header">
              <h2>Audit af regionsrater</h2>
            </div>
            {isKOLRegionPrototype && regionRateAuditState.status === "loading" ? (
              <p className="muted">
                Undersøger hvilke ikke-standardiserede ratemål der findes for de
                aktive KOL-regionsfiltre.
              </p>
            ) : null}
            {isKOLRegionPrototype && regionRateAuditState.status === "error" ? (
              <pre className="error-box">{regionRateAuditState.message}</pre>
            ) : null}
            {isKOLRegionPrototype && regionRateAuditState.status === "ready" ? (
              <div className="checklist">
                <p>
                  1. Matchende mål:{" "}
                  {regionRateAuditState.audit.measures.length === 0
                    ? "ingen"
                    : regionRateAuditState.audit.measures
                        .map(
                          (measure) =>
                            `${measure.measureLabel || measure.measureCode} (${measure.measureCode})`,
                        )
                        .join(", ")}
                </p>
                <p>
                  2. Kandidatrækker pr. mål:{" "}
                  {regionRateAuditState.audit.measures.length === 0
                    ? "ingen"
                    : regionRateAuditState.audit.measures
                        .map(
                          (measure) =>
                            `${measure.measureCode}: ${measure.rowCount} rækker / ${measure.distinctRegionCount} regioner`,
                        )
                        .join(", ")}
                </p>
                <p>
                  3. Dublerede kandidatregionsnavne:{" "}
                  {formatNameList(regionRateAuditState.audit.duplicateRegionNames)}
                </p>
              </div>
            ) : null}
            {!isKOLRegionPrototype ? (
              <p className="muted">
                Rateaudit vises kun for KOL-regionsprototypen, fordi det er det
                aktuelle acceptudsnit.
              </p>
            ) : null}
          </article>

          <article className="panel">
            <div className="panel__header">
              <h2>Regionskoblingsdiagnostik</h2>
            </div>
            {isRegionView && regionJoinDiagnosticsState.status === "loading" ? (
              <p className="muted">
                Kontrollerer eksakt kobling mellem `region_name` og DAGI-regionsnavne
                for det aktuelle regionsvalg.
              </p>
            ) : null}
            {isRegionView && regionJoinDiagnosticsState.status === "error" ? (
              <pre className="error-box">{regionJoinDiagnosticsState.message}</pre>
            ) : null}
            {isRegionView && regionJoinDiagnosticsState.status === "ready" ? (
              <>
                <div className="preview-summary">
                  <div className="preview-summary__card">
                    <span className="preview-summary__label">Kobling</span>
                    <strong>Eksakt `region_name = DAGI.Navn`</strong>
                  </div>
                  <div className="preview-summary__card">
                    <span className="preview-summary__label">Matchet</span>
                    <strong>
                      {regionJoinDiagnosticsState.diagnostics.matchedRegionNames.length}/
                      {regionJoinDiagnosticsState.diagnostics.totalRuksRegions}
                    </strong>
                  </div>
                  <div className="preview-summary__card">
                    <span className="preview-summary__label">DAGI-regioner</span>
                    <strong>{regionJoinDiagnosticsState.diagnostics.totalBoundaryRegions}</strong>
                  </div>
                </div>
                <div className="diagnostic-list">
                  <p>
                    Matchede regioner:{" "}
                    {formatNameList(regionJoinDiagnosticsState.diagnostics.matchedRegionNames)}
                  </p>
                  <p>
                    Ikke-matchede RUKS-regionsnavne:{" "}
                    {formatNameList(
                      regionJoinDiagnosticsState.diagnostics.unmatchedRuksRegionNames,
                    )}
                  </p>
                  <p>
                    Ikke-matchede DAGI-regioner:{" "}
                    {formatNameList(
                      regionJoinDiagnosticsState.diagnostics.unmatchedBoundaryRegionNames,
                    )}
                  </p>
                </div>
              </>
            ) : null}
            {isRegionView && regionJoinDiagnosticsState.status === "idle" ? (
              <p className="muted">
                Regionskoblingsdiagnostikken afventer, at DAGI-regionsgrænserne
                indlæses.
              </p>
            ) : null}
            {!isRegionView ? (
              <p className="muted">
                Skift geografisk niveau til `Region` for at se den eksakte
                koblingsdiagnostik for den aktuelle sygdom, år, aldersgruppe og køn.
              </p>
            ) : null}
          </article>

          <article className="panel panel--wide">
            <div className="panel__header">
              <h2>Kilde og metode</h2>
            </div>
            <div className="source-stack">
              <p className="source-note">{directRuksSourceNote}</p>
              <p className="source-note source-note--derived">{derivedRuksSourceNote}</p>
            </div>
            <div className="checklist">
              <p>1. Regionsdiagnostikken bruger en eksplicit eksakt kobling for `region_name = DAGI.Navn`.</p>
              <p>2. Den aktuelle håndtering af dublerede Bornholm-rækker er lokal, synlig og midlertidig, indtil problemet er afklaret opstrøms.</p>
              <p>3. Regionskortet forbliver blokeret, indtil ét mål vælges bevidst.</p>
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
              <h2>Implementeringsspor</h2>
            </div>
            <div className="checklist">
              <p>1. Læs rateværdierne fra det eksterne Parquet-datasæt.</p>
              <p>2. Byg filtertilstand for sygdom, geografisk niveau, år, aldersgruppe og køn.</p>
              <p>3. Kobl de filtrerede værdier til kommune- eller regionspolygoner.</p>
            </div>
          </article>

          <details className="panel panel--wide about-dashboard">
            <summary>Om dashboardet</summary>
            <div className="about-dashboard__content">
              <dl className="facts">
                <div>
                  <dt>Udgivelseskilde</dt>
                  <dd>
                    <code>{DEFAULT_LATEST_RELEASE_URL}</code>
                  </dd>
                </div>
                <div>
                  <dt>Udgivelse</dt>
                  <dd>{release.tag}</dd>
                </div>
                <div>
                  <dt>Publiceret</dt>
                  <dd>{formatDateLabel(release.publishedAt)}</dd>
                </div>
                <div>
                  <dt>Foretrukken datafil</dt>
                  <dd>{release.recommendedAsset.name}</dd>
                </div>
                <div>
                  <dt>Grænsekilde</dt>
                  <dd>Statisk DAGI FlatGeobuf</dd>
                </div>
              </dl>
            </div>
          </details>
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
          <h2>Datavisning</h2>
          <p className="muted">
            Filtrerede DuckDB-rækker til validering af kortudsnittet uden for kortet.
          </p>
        </div>
        <span className="pill">Tabel</span>
      </div>

      {previewState.status === "loading" ? (
        <div className="preview-state">
          <h3>Forespørger DuckDB</h3>
          <p className="muted">
            Kører den filtrerede forespørgsel igen for den aktuelle sygdom,
            geografi, årsperiode, aldersgruppe og køn.
          </p>
        </div>
      ) : null}

      {previewState.status === "empty" ? (
        <div className="preview-state">
          <h3>Ingen matchende rækker</h3>
          <p className="muted">
            DuckDB returnerede ingen rækker for den aktuelle filterkombination.
          </p>
        </div>
      ) : null}

      {previewState.status === "error" ? (
        <div className="preview-state preview-state--error">
          <h3>DuckDB-forespørgsel fejlede</h3>
          <pre className="error-box">{previewState.message}</pre>
        </div>
      ) : null}

      {previewState.status === "ready" ? (
        <div className="preview-table-shell">
          <div className="preview-summary">
            <div className="preview-summary__card">
              <span className="preview-summary__label">Viste rækker</span>
              <strong>{previewState.rows.length}</strong>
            </div>
            <div className="preview-summary__card">
              <span className="preview-summary__label">Geografi</span>
              <strong>
                {filters
                  ? getSelectedFilterLabel(filters.geoLevel, localGeographyOptions)
                  : "—"}
              </strong>
            </div>
            <div className="preview-summary__card">
              <span className="preview-summary__label">Udgivelse</span>
              <strong>{releaseTag}</strong>
            </div>
          </div>

          <div className="preview-table-wrap">
            <table className="preview-table">
              <thead>
                <tr>
                  <th>Enhed</th>
                  <th>Mål</th>
                  <th>Geografi</th>
                  <th>Sygdom</th>
                  <th>År</th>
                  <th>Aldersgruppe</th>
                  <th>Køn</th>
                  <th>Værdi</th>
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

type DagiBoundaryMapFeature = Omit<DagiBoundaryFeature, "properties"> & {
  properties: DagiBoundaryFeature["properties"] & {
    value: number | null;
    valueLabel: string;
    hasValue: boolean;
  };
};

type DagiBoundaryMapFeatureCollection = {
  type: "FeatureCollection";
  features: DagiBoundaryMapFeature[];
};

type DagiBoundaryMapMetricRow = {
  value: number;
};

const DAGI_MAP_SOURCE_ID = "ruks-dagi-boundaries";
const DAGI_MAP_FILL_LAYER_ID = "ruks-dagi-boundary-fill";
const DAGI_MAP_LINE_LAYER_ID = "ruks-dagi-boundary-line";

function DagiBoundaryMapLibre({
  boundaries,
  rowsByName,
  minValue,
  maxValue,
  emptyLabel,
  muted,
}: {
  boundaries: DagiBoundaryCollection;
  rowsByName: Map<string, DagiBoundaryMapMetricRow>;
  minValue: number;
  maxValue: number;
  emptyLabel: string;
  muted: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const boundaryData = useMemo(
    () => buildDagiBoundaryMapFeatureCollection(boundaries, rowsByName, emptyLabel),
    [boundaries, rowsByName, emptyLabel],
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
      applyDagiBoundaryMapState(map, boundaryData, minValue, maxValue, muted);
      fitMapToBoundaryData(map, boundaryData);
      map.on("click", DAGI_MAP_FILL_LAYER_ID, (event) => {
        const properties = event.features?.[0]?.properties as
          | DagiBoundaryMapFeature["properties"]
          | undefined;

        if (!properties) {
          return;
        }

        new maplibregl.Popup({ closeButton: false })
          .setLngLat(event.lngLat)
          .setText(`${properties.name}: ${properties.valueLabel}`)
          .addTo(map);
      });
      map.on("mouseenter", DAGI_MAP_FILL_LAYER_ID, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", DAGI_MAP_FILL_LAYER_ID, () => {
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

    applyDagiBoundaryMapState(map, boundaryData, minValue, maxValue, muted);
    fitMapToBoundaryData(map, boundaryData);
  }, [maxValue, minValue, muted, boundaryData]);

  return <div ref={containerRef} className="region-maplibre" />;
}

function buildDagiBoundaryMapFeatureCollection(
  boundaries: DagiBoundaryCollection,
  rowsByName: Map<string, DagiBoundaryMapMetricRow>,
  emptyLabel: string,
): DagiBoundaryMapFeatureCollection {
  return {
    type: "FeatureCollection",
    features: boundaries.features.map((feature) => {
      const row = rowsByName.get(feature.properties.name);
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

function applyDagiBoundaryMapState(
  map: maplibregl.Map,
  boundaryData: DagiBoundaryMapFeatureCollection,
  minValue: number,
  maxValue: number,
  muted: boolean,
) {
  const source = map.getSource(DAGI_MAP_SOURCE_ID) as
    | maplibregl.GeoJSONSource
    | undefined;

  if (source) {
    source.setData(boundaryData as never);
  } else {
    map.addSource(DAGI_MAP_SOURCE_ID, {
      type: "geojson",
      data: boundaryData,
    } as never);
  }

  if (!map.getLayer(DAGI_MAP_FILL_LAYER_ID)) {
    map.addLayer({
      id: DAGI_MAP_FILL_LAYER_ID,
      type: "fill",
      source: DAGI_MAP_SOURCE_ID,
      paint: {},
    });
  }

  if (!map.getLayer(DAGI_MAP_LINE_LAYER_ID)) {
    map.addLayer({
      id: DAGI_MAP_LINE_LAYER_ID,
      type: "line",
      source: DAGI_MAP_SOURCE_ID,
      paint: {
        "line-color": "rgba(44, 62, 80, 0.34)",
        "line-width": 1.2,
      },
    });
  }

  map.setPaintProperty(
    DAGI_MAP_FILL_LAYER_ID,
    "fill-color",
    getMapLibreFillColorExpression(minValue, maxValue, muted),
  );
  map.setPaintProperty(
    DAGI_MAP_FILL_LAYER_ID,
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
      "rgba(0, 102, 204, 0.2)",
      "rgba(44, 62, 80, 0.08)",
    ];
  }

  if (maxValue <= minValue) {
    return [
      "case",
      ["==", ["get", "hasValue"], true],
      "#0066cc",
      "rgba(44, 62, 80, 0.08)",
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
      "#e5f0fb",
      (minValue + maxValue) / 2,
      "#5ca5eb",
      maxValue,
      "#0052a3",
    ],
    "rgba(44, 62, 80, 0.08)",
  ];
}

function fitMapToBoundaryData(
  map: maplibregl.Map,
  boundaryData: DagiBoundaryMapFeatureCollection,
) {
  const bounds = getBoundaryDataBounds(boundaryData);

  if (!bounds) {
    return;
  }

  map.fitBounds(bounds, {
    padding: 34,
    duration: 0,
  });
}

function getBoundaryDataBounds(
  boundaryData: DagiBoundaryMapFeatureCollection,
): maplibregl.LngLatBoundsLike | null {
  let minLng = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  for (const feature of boundaryData.features) {
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
            Ingen muligheder
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
          {options.length === 0 ? <option value="">Ingen muligheder</option> : null}
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
        <h3>År</h3>
        <p className="muted">{yearStart && yearEnd ? `${yearStart} til ${yearEnd}` : "Ingen år"}</p>
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
            <span className="sr-only">Startår</span>
            <input
              className="range-control__input range-control__input--start"
              type="range"
              min={0}
              max={maxIndex}
              step={1}
              value={selectedRange.startIndex}
              disabled={disabled}
              aria-label="Startår"
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
            <span className="sr-only">Slutår</span>
            <input
              className="range-control__input range-control__input--end"
              type="range"
              min={0}
              max={maxIndex}
              step={1}
              value={selectedRange.endIndex}
              disabled={disabled}
              aria-label="Slutår"
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
          <p className="muted">Ingen muligheder</p>
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
