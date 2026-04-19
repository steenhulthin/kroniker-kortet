import { startTransition, useEffect, useState } from "react";
import {
  DEFAULT_LATEST_RELEASE_URL,
  describeArtifact,
  formatDateLabel,
  loadLatestRuksRelease,
  type RuksArtifact,
  type RuksLatestRelease,
} from "../lib/ruks";

type ReleaseState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; release: RuksLatestRelease };

const initialState: ReleaseState = { status: "loading" };

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
      <header className="hero">
        <div className="hero__copy">
          <p className="eyebrow">Kroniker-kortet</p>
          <h1>Latest-release RUKS dashboard scaffold</h1>
          <p className="hero__lede">
            A static GitHub Pages frontend that resolves the newest RUKS release,
            selects the Parquet artifact, and prepares the app for browser-side
            analytics and future mapping.
          </p>
        </div>

        <div className="hero__meta">
          <div className="meta-card">
            <span className="meta-card__label">Latest release source</span>
            <code>{DEFAULT_LATEST_RELEASE_URL}</code>
          </div>
          <div className="meta-card">
            <span className="meta-card__label">Current focus</span>
            <span>GitHub Releases API resolution and Parquet-first browser reads</span>
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
        <h2>Loading latest release metadata</h2>
      </div>
      <p className="muted">
        Resolving the newest upstream RUKS release and checking which artifact is
        best suited for a static browser app.
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
        The scaffold is ready, but the configured latest-release endpoint did not
        load.
      </p>
      <pre className="error-box">{message}</pre>
    </section>
  );
}

function Dashboard({ release }: { release: RuksLatestRelease }) {
  const parquetAsset = findAsset(release.assets, "parquet");
  const csvAsset = findAsset(release.assets, "csv_gz");
  const sqliteAsset = findAsset(release.assets, "sqlite");

  return (
    <main className="dashboard">
      <section className="stats-grid">
        <MetricCard
          label="Latest release tag"
          value={release.tag}
          note={`Published ${formatDateLabel(release.publishedAt)}`}
        />
        <MetricCard
          label="Recommended artifact"
          value={release.recommendedAsset.kind}
          note={`${release.recommendedAsset.sizeLabel} ${release.recommendedAsset.name}`}
        />
        <MetricCard
          label="Parquet size"
          value={parquetAsset?.sizeLabel ?? "n/a"}
          note="Small enough to be realistic for static browser delivery."
        />
        <MetricCard
          label="SQLite size"
          value={sqliteAsset?.sizeLabel ?? "n/a"}
          note="Useful as an archive, but too heavy for the default browser path."
        />
      </section>

      <section className="content-grid">
        <article className="panel panel--map">
          <div className="panel__header">
            <h2>Runtime data path</h2>
            <span className="pill">Chosen direction</span>
          </div>
          <div className="map-placeholder">
            <div className="map-placeholder__glow" />
            <div className="map-placeholder__card">
              <p>Static app resolves the latest release, then points the browser at the Parquet asset.</p>
              <p className="muted">
                The next layer is DuckDB-Wasm: query the remote Parquet in-browser,
                derive filter options, and connect those results to charts and map
                geometry.
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
              <dt>Release title</dt>
              <dd>{release.title}</dd>
            </div>
            <div>
              <dt>Published</dt>
              <dd>{formatDateLabel(release.publishedAt)}</dd>
            </div>
            <div>
              <dt>Tracked assets</dt>
              <dd>{release.assets.length}</dd>
            </div>
            <div>
              <dt>API endpoint</dt>
              <dd>{release.apiUrl}</dd>
            </div>
          </dl>
        </article>

        <article className="panel panel--wide">
          <div className="panel__header">
            <h2>Artifact choices</h2>
            <span className="pill">Parquet preferred</span>
          </div>
          <div className="asset-grid">
            {release.assets.map((asset) => (
              <section key={asset.name} className="asset-card">
                <div className="asset-card__header">
                  <h3>{asset.name}</h3>
                  {asset.recommended ? <span className="pill">Use this</span> : null}
                </div>
                <p className="asset-card__value">{asset.sizeLabel}</p>
                <p className="muted">{describeArtifact(asset.kind)}</p>
                <div className="asset-card__meta">
                  <span>{asset.kind}</span>
                  <span>{asset.contentType}</span>
                </div>
                <a className="asset-card__link" href={asset.url} target="_blank" rel="noreferrer">
                  Open asset
                </a>
              </section>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel__header">
            <h2>Why Parquet</h2>
          </div>
          <div className="checklist">
            <p>1. Current Parquet release asset is {parquetAsset?.sizeLabel ?? "small"}.</p>
            <p>2. Current CSV asset is {csvAsset?.sizeLabel ?? "larger"}, so parsing costs are higher.</p>
            <p>3. Current SQLite asset is {sqliteAsset?.sizeLabel ?? "very large"}, which is not realistic as the default browser download.</p>
          </div>
        </article>

        <article className="panel panel--wide">
          <div className="panel__header">
            <h2>Build track</h2>
          </div>
          <div className="checklist">
            <p>1. Instantiate DuckDB-Wasm and run the first `read_parquet` query against the latest asset URL.</p>
            <p>2. Build typed filter models from query results instead of sample JSON.</p>
            <p>3. Add municipality geometry and join logic once the analytical slice is stable.</p>
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

function findAsset(
  assets: RuksArtifact[],
  kind: RuksArtifact["kind"],
): RuksArtifact | undefined {
  return assets.find((asset) => asset.kind === kind);
}
