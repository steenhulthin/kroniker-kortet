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

export type RuksFilterDomainKey = "disease" | "geoLevel" | "year" | "ageGroup" | "sex";

export type RuksDistinctDomainKey = Exclude<RuksFilterDomainKey, "geoLevel">;

export type RuksFilterColumnContract = Record<RuksFilterDomainKey, string>;

export type RuksFilterSelection = Partial<Record<RuksFilterDomainKey, string>>;

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
  options: { limit?: number; orderByColumns?: readonly string[] } = {},
): Promise<Row[]> {
  return withRuksConnection(release, "query filtered metric rows", async (sourceName, connection) => {
    const projection =
      contract.selectColumns && contract.selectColumns.length > 0
        ? contract.selectColumns.map(quoteIdentifier).join(", ")
        : "*";

    const whereClauses = buildFilterClauses(contract.filterColumns, filters);
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const orderBySql =
      options.orderByColumns && options.orderByColumns.length > 0
        ? `ORDER BY ${options.orderByColumns.map(quoteIdentifier).join(", ")}`
        : "";
    const limitSql = typeof options.limit === "number" ? `LIMIT ${Math.max(0, Math.floor(options.limit))}` : "";

    const table = await connection.query(
      `SELECT ${projection}
       FROM ${parquetRelationSql(sourceName)}
       ${whereSql}
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

  debugDuckDb("parquet:fetch:start", { parquetUrl, fetchUrl });

  const response = await fetch(fetchUrl, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(
      `Parquet fetch failed with ${response.status} ${response.statusText}`,
    );
  }

  const buffer = new Uint8Array(await response.arrayBuffer());

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

    clauses.push(`${quoteIdentifier(filterColumns[domain])} = ${quoteString(value)}`);
  }

  return clauses;
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

function createRuksDuckDbError(message: string, cause: unknown): Error {
  if (cause instanceof Error) {
    return new Error(`${message} ${cause.message}`, { cause });
  }

  if (cause !== undefined) {
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
  if (!import.meta.env.DEV) {
    return parquetUrl;
  }

  return `/api/ruks-release-asset?url=${encodeURIComponent(parquetUrl)}`;
}
