import { startTransition, useEffect, useState } from "react";
import {
  DEFAULT_LATEST_RELEASE_URL,
  formatDateLabel,
  loadLatestRuksRelease,
  type RuksLatestRelease,
} from "../lib/ruks";

type ReleaseState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; release: RuksLatestRelease };

type FilterDefinition = {
  label: string;
  value: string;
};

const initialState: ReleaseState = { status: "loading" };

const sidebarFilters: Array<{
  title: string;
  hint?: string;
  options: FilterDefinition[];
}> = [
  {
    title: "Disease",
    options: [
      { label: "Astma", value: "astma" },
      { label: "Demens", value: "demens" },
      { label: "KOL", value: "kol" },
      { label: "Type 2-diabetes", value: "type-2-diabetes" },
    ],
  },
  {
    title: "Geographic detail",
    hint: "Switch the map between municipality and region boundaries.",
    options: [
      { label: "Kommune", value: "kommune" },
      { label: "Region", value: "region" },
    ],
  },
  {
    title: "Year",
    options: [
      { label: "2025", value: "2025" },
      { label: "2024", value: "2024" },
      { label: "2023", value: "2023" },
      { label: "2022", value: "2022" },
    ],
  },
  {
    title: "Age group",
    options: [
      { label: "Alle aldre", value: "all" },
      { label: "0-44", value: "0-44" },
      { label: "45-64", value: "45-64" },
      { label: "65+", value: "65plus" },
    ],
  },
  {
    title: "Sex",
    options: [
      { label: "Begge", value: "both" },
      { label: "Kvinder", value: "women" },
      { label: "Mænd", value: "men" },
    ],
  },
];

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
  return (
    <main className="dashboard-layout">
      <aside className="sidebar panel">
        <div className="panel__header">
          <h2>Filters</h2>
          <span className="pill">Sidebar</span>
        </div>

        <div className="filter-stack">
          {sidebarFilters.map((filter) => (
            <section key={filter.title} className="filter-group">
              <div className="filter-group__header">
                <h3>{filter.title}</h3>
                {filter.hint ? <p className="muted">{filter.hint}</p> : null}
              </div>
              <div className="filter-options">
                {filter.options.map((option, index) => (
                  <button
                    key={option.value}
                    type="button"
                    className={index === 0 ? "filter-chip filter-chip--active" : "filter-chip"}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </aside>

      <section className="main-stage">
        <article className="panel map-panel">
          <div className="panel__header">
            <div>
              <h2>Map</h2>
              <p className="muted">
                Choropleth view for kommune or region colored by rate per 100,000 inhabitants.
              </p>
            </div>
            <span className="pill">Main area</span>
          </div>

          <div className="map-canvas">
            <div className="map-canvas__wash" />
            <div className="map-canvas__legend">
              <span>Lav</span>
              <div className="legend-ramp" />
              <span>Høj</span>
            </div>
            <div className="map-canvas__focus">
              <p className="map-canvas__metric">Antal personer pr. 100.000 borgere</p>
              <h3>Municipality/region choropleth lands here</h3>
              <p className="muted">
                Next implementation step: join filtered RUKS rates to `dagi:Kommuneinddeling`
                and `dagi:Regionsinddeling`, then render a graduated thematic map.
              </p>
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
