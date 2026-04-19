import { startTransition, useEffect, useState } from "react";
import {
  DEFAULT_SUMMARY_URL,
  formatCompactNumber,
  formatDelta,
  getDiseaseSnapshots,
  getLatestYear,
  loadRuksSummary,
  type RuksSummary,
} from "../lib/ruks";

type SummaryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; summary: RuksSummary };

const initialState: SummaryState = { status: "loading" };

export function App() {
  const [state, setState] = useState<SummaryState>(initialState);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const summary = await loadRuksSummary();

        if (cancelled) {
          return;
        }

        startTransition(() => {
          setState({ status: "ready", summary });
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
      <header className="hero">
        <div className="hero__copy">
          <p className="eyebrow">Kroniker-kortet</p>
          <h1>Map-first RUKS dashboard scaffold</h1>
          <p className="hero__lede">
            A frontend workspace for turning upstream RUKS releases into a public,
            explorable disease dashboard with mapping, trends, and release metadata.
          </p>
        </div>

        <div className="hero__meta">
          <div className="meta-card">
            <span className="meta-card__label">Summary source</span>
            <code>{DEFAULT_SUMMARY_URL}</code>
          </div>
          <div className="meta-card">
            <span className="meta-card__label">Current focus</span>
            <span>Typed summary ingestion and dashboard shell</span>
          </div>
        </div>
      </header>

      {state.status === "loading" ? <LoadingState /> : null}
      {state.status === "error" ? <ErrorState message={state.message} /> : null}
      {state.status === "ready" ? <Dashboard summary={state.summary} /> : null}
    </div>
  );
}

function LoadingState() {
  return (
    <section className="panel panel--wide">
      <div className="panel__header">
        <h2>Loading summary data</h2>
      </div>
      <p className="muted">
        Pulling the current RUKS summary payload and preparing the first dashboard
        view.
      </p>
    </section>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <section className="panel panel--wide">
      <div className="panel__header">
        <h2>Data source unavailable</h2>
      </div>
      <p className="muted">
        The scaffold is ready, but the configured summary endpoint did not load.
      </p>
      <pre className="error-box">{message}</pre>
    </section>
  );
}

function Dashboard({ summary }: { summary: RuksSummary }) {
  const latestYear = getLatestYear(summary);
  const snapshots = getDiseaseSnapshots(summary);

  return (
    <main className="dashboard">
      <section className="stats-grid">
        <MetricCard
          label="Diseases in payload"
          value={String(summary.diseases.length)}
          note="Bundled sample uses an excerpt. Live upstream data includes more series."
        />
        <MetricCard
          label="Observations in upstream release"
          value={
            summary.observation_count
              ? formatCompactNumber(summary.observation_count)
              : "n/a"
          }
          note="Taken from the upstream release metadata."
        />
        <MetricCard
          label="Rows in source sheet"
          value={
            summary.source_row_count
              ? formatCompactNumber(summary.source_row_count)
              : "n/a"
          }
          note="Current upstream focus is the Hovedresultater sheet."
        />
        <MetricCard
          label="Latest year represented"
          value={latestYear ? String(latestYear) : "n/a"}
          note={`Release tag ${summary.release_tag}`}
        />
      </section>

      <section className="content-grid">
        <article className="panel panel--map">
          <div className="panel__header">
            <h2>Map surface</h2>
            <span className="pill">Next integration</span>
          </div>
          <div className="map-placeholder">
            <div className="map-placeholder__glow" />
            <div className="map-placeholder__card">
              <p>Municipality and region geometry layer will land here.</p>
              <p className="muted">
                The upstream data already models geography. The missing piece is a
                joinable Danish boundary dataset and map interaction patterns.
              </p>
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel__header">
            <h2>Release overview</h2>
          </div>
          <dl className="facts">
            <div>
              <dt>Workbook</dt>
              <dd>{summary.workbook_title}</dd>
            </div>
            <div>
              <dt>Source release</dt>
              <dd>{summary.source_release_date}</dd>
            </div>
            <div>
              <dt>Summary series</dt>
              <dd>{summary.series.length}</dd>
            </div>
            <div>
              <dt>First data contract</dt>
              <dd>`latest-summary.json`</dd>
            </div>
          </dl>
        </article>

        <article className="panel panel--wide">
          <div className="panel__header">
            <h2>Disease snapshot</h2>
            <span className="pill">Incidence counts</span>
          </div>
          <div className="disease-grid">
            {snapshots.map((snapshot) => (
              <section key={snapshot.disease} className="disease-card">
                <div className="disease-card__header">
                  <h3>{snapshot.disease}</h3>
                  <span>{snapshot.latestYear}</span>
                </div>
                <p className="disease-card__value">
                  {new Intl.NumberFormat("da-DK", {
                    maximumFractionDigits: 0,
                  }).format(snapshot.latestValue)}
                </p>
                <p className="muted">
                  Change vs. prior year: {formatDelta(snapshot.delta)} {snapshot.unit}
                </p>
              </section>
            ))}
          </div>
        </article>

        <article className="panel panel--wide">
          <div className="panel__header">
            <h2>Build track</h2>
          </div>
          <div className="checklist">
            <p>1. Wire live upstream summary and manifest endpoints.</p>
            <p>2. Add filters for disease, measure, and year.</p>
            <p>3. Choose municipal geometry and build the first joined map.</p>
          </div>
        </article>
      </section>
    </main>
  );
}

function MetricCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article className="metric-card">
      <span className="metric-card__label">{label}</span>
      <strong className="metric-card__value">{value}</strong>
      <p className="muted">{note}</p>
    </article>
  );
}

