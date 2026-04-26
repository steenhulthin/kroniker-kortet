import * as duckdb from "@duckdb/duckdb-wasm";
import duckdbEhWasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import ehWorkerUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import duckdbMvpWasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import mvpWorkerUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";

import {
  resolveRuksParquetUrl,
  type RuksLatestRelease,
} from "./ruks";

export type RuksDuckDbBootstrap = {
  db: duckdb.AsyncDuckDB;
  bundle: duckdb.DuckDBBundle;
};

export type RuksFilterDomainKey =
  | "disease"
  | "geoLevel"
  | "measure"
  | "metric"
  | "year"
  | "ageGroup"
  | "sex";

export type RuksDistinctDomainKey = RuksFilterDomainKey;

export type RuksFilterColumnContract = Record<RuksFilterDomainKey, string>;

export type RuksFilterRange = {
  min: string;
  max: string;
};

export type RuksFilterSelectionValue = string | readonly string[] | RuksFilterRange;

export type RuksFilterSelection = Partial<Record<RuksFilterDomainKey, RuksFilterSelectionValue>>;

export type RuksDistinctColumnContract = Record<
  RuksDistinctDomainKey,
  {
    value: string;
    label?: string;
  }
>;

export type RuksQueryContract = {
  filterColumns: RuksFilterColumnContract;
  distinctColumns: RuksDistinctColumnContract;
  selectColumns?: readonly string[];
};

export type RuksSchemaColumn = {
  name: string;
  type: string;
  nullable: boolean;
};

export type RuksDistinctValue = {
  value: string;
  label: string;
};

const RUKS_PARQUET_SOURCE_NAME = "ruks_hovedresultater_long.parquet";
const DUCKDB_DEBUG = import.meta.env.VITE_DEBUG_DUCKDB === "true";

let bootstrapPromise: Promise<RuksDuckDbBootstrap> | null = null;
let registeredParquetUrl: string | null = null;

export async function getRuksDuckDbBootstrap(): Promise<RuksDuckDbBootstrap> {
  if (!bootstrapPromise) {
    bootstrapPromise = createDuckDbBootstrap().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }

  return bootstrapPromise;
}

export async function inspectRuksParquetSchema(
  release: RuksLatestRelease,
): Promise<RuksSchemaColumn[]> {
  return withRuksConnection(
    release,
    "inspect the parquet schema",
    async (sourceName, connection) => {
      const table = await connection.query(
        `SELECT * FROM ${parquetRelationSql(sourceName)} LIMIT 0`,
      );

      return table.schema.fields.map((field) => ({
        name: field.name,
        type: field.type.toString(),
        nullable: field.nullable,
      }));
    },
  );
}

export async function queryRuksDistinctFilterValues(
  release: RuksLatestRelease,
  contract: RuksQueryContract,
  domain: RuksDistinctDomainKey,
): Promise<RuksDistinctValue[]> {
  return withRuksConnection(release, `query distinct ${domain} values`, async (sourceName, connection) => {
    const { value: valueColumn, label: labelColumn } = contract.distinctColumns[domain];
    const valueSql = quoteIdentifier(valueColumn);
    const labelSql = labelColumn ? `COALESCE(${quoteIdentifier(labelColumn)}, ${valueSql})` : valueSql;
    const table = await connection.query(
      `SELECT DISTINCT ${valueSql} AS value, ${labelSql} AS label
       FROM ${parquetRelationSql(sourceName)}
       WHERE ${valueSql} IS NOT NULL
       ORDER BY label, value`,
    );

    return table.toArray().flatMap((row) => {
      const value = normalizeDistinctValue((row as { value?: unknown }).value);
      const label = normalizeDistinctValue((row as { label?: unknown }).label) ?? value;

      return value && label ? [{ value, label }] : [];
    });
  });
}

export async function queryRuksMetricRows<Row extends Record<string, unknown> = Record<string, unknown>>(
  release: RuksLatestRelease,
  contract: RuksQueryContract,
  filters: RuksFilterSelection,
  options: {
    limit?: number;
    orderByColumns?: readonly string[];
    dedupe?: {
      keyColumns: readonly string[];
      valueColumn: string;
    };
  } = {},
): Promise<Row[]> {
  return withRuksConnection(release, "query filtered metric rows", async (sourceName, connection) => {
    const projection =
      contract.selectColumns && contract.selectColumns.length > 0
        ? contract.selectColumns.map(quoteIdentifier).join(", ")
        : "*";

    const whereClauses = buildFilterClauses(contract.filterColumns, filters);
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const baseQuery = `SELECT ${projection}
       FROM ${parquetRelationSql(sourceName)}
       ${whereSql}`;
    const dedupedQuery = options.dedupe
      ? buildDedupedMetricQuery(baseQuery, options.dedupe)
      : baseQuery;
    const orderBySql =
      options.orderByColumns && options.orderByColumns.length > 0
        ? `ORDER BY ${options.orderByColumns.map(quoteIdentifier).join(", ")}`
        : "";
    const limitSql = typeof options.limit === "number" ? `LIMIT ${Math.max(0, Math.floor(options.limit))}` : "";

    const table = await connection.query(
      `${dedupedQuery}
       ${orderBySql}
       ${limitSql}`,
    );

    return table.toArray() as Row[];
  });
}

async function createDuckDbBootstrap(): Promise<RuksDuckDbBootstrap> {
  if (typeof Worker === "undefined") {
    throw new Error("DuckDB-Wasm requires a browser Worker runtime.");
  }

  const bundle = await duckdb.selectBundle({
    mvp: {
      mainModule: duckdbMvpWasm,
      mainWorker: mvpWorkerUrl,
    },
    eh: {
      mainModule: duckdbEhWasm,
      mainWorker: ehWorkerUrl,
    },
  });

  if (!bundle.mainWorker) {
    throw new Error("DuckDB-Wasm bundle selection did not return a browser worker.");
  }

  debugDuckDb("bundle:selected", {
    mainModule: bundle.mainModule,
    mainWorker: bundle.mainWorker,
    pthreadWorker: bundle.pthreadWorker,
    runtime: getRuntimeDiagnostics(),
  });

  const worker = new Worker(bundle.mainWorker);
  const db = new duckdb.AsyncDuckDB(
    DUCKDB_DEBUG ? new duckdb.ConsoleLogger() : new duckdb.VoidLogger(),
    worker,
  );

  try {
    debugDuckDb("instantiate:start", { bundle: bundle.mainModule });
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    await db.open({
      path: ":memory:",
      accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
      filesystem: {
        allowFullHTTPReads: true,
      },
    });
    debugDuckDb("instantiate:ready");
    return { db, bundle };
  } catch (error) {
    worker.terminate();
    throw createRuksDuckDbError("Failed to instantiate DuckDB-Wasm", error);
  }
}

async function withRuksConnection<T>(
  release: RuksLatestRelease,
  action: string,
  run: (sourceName: string, connection: duckdb.AsyncDuckDBConnection) => Promise<T>,
): Promise<T> {
  const { db } = await getRuksDuckDbBootstrap();

  try {
    const sourceName = await ensureRuksParquetSource(db, release);
    const connection = await db.connect();

    try {
      return await run(sourceName, connection);
    } finally {
      await connection.close().catch(() => undefined);
    }
  } catch (error) {
    throw createRuksDuckDbError(
      `Failed to ${action} for release ${release.tag}.`,
      error,
    );
  }
}

async function ensureRuksParquetSource(
  db: duckdb.AsyncDuckDB,
  release: RuksLatestRelease,
): Promise<string> {
  const parquetUrl = resolveRuksParquetUrl(release);
  const fetchUrl = resolveParquetFetchUrl(parquetUrl);

  if (registeredParquetUrl === fetchUrl) {
    return RUKS_PARQUET_SOURCE_NAME;
  }

  debugDuckDb("parquet:fetch:start", {
    parquetUrl,
    fetchUrl,
    absoluteFetchUrl: resolveAbsoluteUrl(fetchUrl),
    runtime: getRuntimeDiagnostics(),
  });

  const buffer = await fetchParquetBuffer(fetchUrl);

  debugDuckDb("parquet:fetch:done", {
    parquetUrl,
    fetchUrl,
    sizeBytes: buffer.byteLength,
  });

  if (registeredParquetUrl !== null) {
    await db.dropFile(RUKS_PARQUET_SOURCE_NAME).catch(() => undefined);
  }

  await db.registerFileBuffer(RUKS_PARQUET_SOURCE_NAME, buffer);
  registeredParquetUrl = fetchUrl;

  debugDuckDb("parquet:register:done", {
    parquetUrl,
    fetchUrl,
    sourceName: RUKS_PARQUET_SOURCE_NAME,
  });

  return RUKS_PARQUET_SOURCE_NAME;
}

function buildFilterClauses(
  filterColumns: RuksFilterColumnContract,
  filters: RuksFilterSelection,
): string[] {
  const clauses: string[] = [];

  for (const domain of Object.keys(filterColumns) as RuksFilterDomainKey[]) {
    const value = filters[domain];

    if (value == null || value === "") {
      continue;
    }

    const columnSql = quoteIdentifier(filterColumns[domain]);

    if (isFilterValueList(value)) {
      const literals = value.filter((item) => item !== "").map(quoteLiteral);

      if (literals.length > 0) {
        clauses.push(`${columnSql} IN (${literals.join(", ")})`);
      }

      continue;
    }

    if (isFilterRange(value)) {
      if (value.min !== "") {
        clauses.push(`${columnSql} >= ${quoteLiteral(value.min)}`);
      }

      if (value.max !== "") {
        clauses.push(`${columnSql} <= ${quoteLiteral(value.max)}`);
      }

      continue;
    }

    clauses.push(`${columnSql} = ${quoteLiteral(value)}`);
  }

  return clauses;
}

function buildDedupedMetricQuery(
  baseQuery: string,
  dedupe: {
    keyColumns: readonly string[];
    valueColumn: string;
  },
): string {
  const keyColumnsSql = dedupe.keyColumns.map(quoteIdentifier);
  const groupedProjection = keyColumnsSql.join(", ");
  const separator = groupedProjection.length > 0 ? ", " : "";

  return `SELECT ${groupedProjection}${separator}MAX(${quoteIdentifier(dedupe.valueColumn)}) AS ${quoteIdentifier(dedupe.valueColumn)}
    FROM (${baseQuery}) AS metric_rows
    GROUP BY ${groupedProjection}`;
}

function normalizeDistinctValue(value: unknown): string | null {
  if (value == null || value === "") {
    return null;
  }

  return String(value);
}

function parquetRelationSql(sourceName: string): string {
  return `read_parquet(${quoteString(sourceName)})`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function quoteLiteral(value: string): string {
  return /^-?\d+(\.\d+)?$/.test(value) ? value : quoteString(value);
}

function isFilterValueList(
  value: RuksFilterSelectionValue,
): value is readonly string[] {
  return Array.isArray(value);
}

function isFilterRange(value: RuksFilterSelectionValue): value is RuksFilterRange {
  return typeof value === "object" && !Array.isArray(value);
}

function createRuksDuckDbError(message: string, cause: unknown): Error {
  if (cause instanceof Error) {
    console.error("[ruks-duckdb]", message, cause);
    return new Error(`${message} ${cause.message}`, { cause });
  }

  if (cause !== undefined) {
    console.error("[ruks-duckdb]", message, cause);
    return new Error(`${message} ${String(cause)}`, { cause });
  }

  return new Error(message);
}

function debugDuckDb(event: string, details?: Record<string, unknown>) {
  if (!DUCKDB_DEBUG) {
    return;
  }

  if (details) {
    console.debug(`[ruks-duckdb] ${event}`, details);
    return;
  }

  console.debug(`[ruks-duckdb] ${event}`);
}

function resolveParquetFetchUrl(parquetUrl: string): string {
  const staticParquetUrl = resolveStaticRuksParquetUrl(parquetUrl);

  if (!import.meta.env.DEV) {
    return staticParquetUrl ?? parquetUrl;
  }

  return `/api/ruks-release-asset?url=${encodeURIComponent(parquetUrl)}`;
}

function resolveStaticRuksParquetUrl(url: string): string | null {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url, "https://example.invalid");
  } catch {
    return null;
  }

  const fileName = parsedUrl.pathname.split("/").at(-1);

  if (
    !fileName ||
    !/^ruks_hovedresultater_long(?:-.+)?\.parquet$/.test(fileName)
  ) {
    return null;
  }

  if (
    parsedUrl.hostname === "github.com" &&
    /^\/steenhulthin\/ruks-data\/releases\/download\//.test(parsedUrl.pathname)
  ) {
    return `${import.meta.env.BASE_URL}data/${fileName}`;
  }

  return null;
}

async function fetchParquetBuffer(fetchUrl: string): Promise<Uint8Array> {
  let response: Response;

  try {
    response = await fetch(fetchUrl, { cache: "no-store" });
  } catch (error) {
    throw new Error(
      [
        "Parquet-filen kunne ikke hentes.",
        `URL: ${fetchUrl}`,
        `Absolut URL: ${resolveAbsoluteUrl(fetchUrl)}`,
        `BASE_URL: ${import.meta.env.BASE_URL}`,
        `Side: ${getRuntimeDiagnostics().pageUrl}`,
        `Årsag: ${formatErrorCause(error)}`,
      ].join(" "),
      { cause: error },
    );
  }

  if (!response.ok) {
    throw new Error(
      [
        `Parquet-hentning fejlede med ${response.status} ${response.statusText}.`,
        `URL: ${fetchUrl}`,
        `Absolut URL: ${resolveAbsoluteUrl(fetchUrl)}`,
        `Content-Type: ${response.headers.get("content-type") ?? "ukendt"}`,
      ].join(" "),
    );
  }

  const contentType = response.headers.get("content-type") ?? "ukendt";
  const buffer = new Uint8Array(await response.arrayBuffer());

  if (buffer.byteLength === 0) {
    throw new Error(
      `Parquet-hentning returnerede en tom fil. URL: ${fetchUrl}. Content-Type: ${contentType}.`,
    );
  }

  return buffer;
}

function resolveAbsoluteUrl(url: string): string {
  if (typeof window === "undefined") {
    return url;
  }

  return new URL(url, window.location.href).href;
}

function getRuntimeDiagnostics(): Record<string, string | boolean> {
  return {
    baseUrl: import.meta.env.BASE_URL,
    dev: import.meta.env.DEV,
    mode: import.meta.env.MODE,
    pageUrl: typeof window === "undefined" ? "unavailable" : window.location.href,
    origin: typeof window === "undefined" ? "unavailable" : window.location.origin,
  };
}

function formatErrorCause(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}
