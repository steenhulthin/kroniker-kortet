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

const localGeographyOptions: FilterDefinition[] = [
  { label: "Kommune", value: "municipality" },
  { label: "Region", value: "region" },
];

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

  const filterOptions =
    filterLoadState.status === "ready" || filterLoadState.status === "empty"
      ? filterLoadState.options
      : null;

  const selectionSummary =
    filters && filterOptions
      ? buildSelectionSummary(filters, filterOptions)
      : "Loading filter options from DuckDB...";

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
              <p className="muted">
                Temporary project assumption: duplicate Bornholm rows are treated as a
                Christiansoe-related artifact and collapsed locally until clarified upstream.
              </p>
            </div>
            <span className="pill">Live DuckDB</span>
          </div>

          <div className="map-canvas">
            <div className="map-canvas__wash" />
            <div className="map-canvas__legend">
              <span>Loading</span>
              <div className="legend-ramp" />
              <span>Ready</span>
            </div>

            <div className="map-canvas__focus map-preview">
              <p className="map-canvas__metric">Antal personer pr. 100.000 borgere</p>
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
