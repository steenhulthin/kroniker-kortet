export type GithubReleaseAsset = {
  name: string;
  browser_download_url: string;
  size: number;
  content_type: string;
  download_count?: number;
  updated_at?: string;
};

export type GithubLatestRelease = {
  tag_name: string;
  name: string;
  html_url: string;
  created_at: string;
  published_at: string;
  assets: GithubReleaseAsset[];
};

export type RuksArtifactKind = "parquet" | "csv_gz" | "sqlite";

export type RuksArtifact = {
  kind: RuksArtifactKind;
  name: string;
  url: string;
  sizeBytes: number;
  sizeLabel: string;
  contentType: string;
  downloadCount: number | null;
  updatedAt: string | null;
  recommended: boolean;
};

export type RuksLatestRelease = {
  tag: string;
  title: string;
  htmlUrl: string;
  createdAt: string;
  publishedAt: string;
  apiUrl: string;
  assets: RuksArtifact[];
  recommendedAsset: RuksArtifact;
};

export const DEFAULT_LATEST_RELEASE_URL =
  import.meta.env.VITE_RUKS_LATEST_RELEASE_URL ??
  "https://api.github.com/repos/steenhulthin/ruks-data/releases/latest";

export const DEFAULT_RELEASE_FALLBACK_URL =
  import.meta.env.VITE_RUKS_RELEASE_FALLBACK_URL ??
  appAssetUrl("data/latest-release.json");

export async function loadLatestRuksRelease(
  apiUrl: string = DEFAULT_LATEST_RELEASE_URL,
  fallbackUrl: string = DEFAULT_RELEASE_FALLBACK_URL,
): Promise<RuksLatestRelease> {
  try {
    const response = await fetchReleaseMetadata(apiUrl);

    if (!response.ok) {
      throw new Error(`GitHub release request failed with ${response.status}`);
    }

    return normalizeRelease((await response.json()) as GithubLatestRelease, apiUrl);
  } catch (error) {
    const fallbackResponse = await fetchReleaseFallback(fallbackUrl);

    if (!fallbackResponse.ok) {
      const message =
        error instanceof Error ? error.message : "Unknown release loading error";
      throw new Error(
        `Unable to load live release metadata and fallback also failed. ${message}`,
      );
    }

    return normalizeRelease(
      (await fallbackResponse.json()) as GithubLatestRelease,
      apiUrl,
    );
  }
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("da-DK", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDateLabel(value: string): string {
  return new Intl.DateTimeFormat("da-DK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Copenhagen",
  }).format(new Date(value));
}

export function formatBytes(value: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let currentValue = value;
  let unitIndex = 0;

  while (currentValue >= 1024 && unitIndex < units.length - 1) {
    currentValue /= 1024;
    unitIndex += 1;
  }

  return `${new Intl.NumberFormat("da-DK", {
    maximumFractionDigits: currentValue < 10 && unitIndex > 0 ? 1 : 0,
  }).format(currentValue)} ${units[unitIndex]}`;
}

export function describeArtifact(kind: RuksArtifactKind): string {
  if (kind === "parquet") {
    return "Best static-browser fit for DuckDB-Wasm and analytical queries.";
  }

  if (kind === "csv_gz") {
    return "Useful fallback if we need simpler parsing or export-friendly inspection.";
  }

  return "Archive-grade source for deeper inspection, but too large for the primary browser path.";
}

export function resolveRuksParquetUrl(release: RuksLatestRelease): string {
  const parquetAsset = release.assets.find((asset) => asset.kind === "parquet");

  if (!parquetAsset) {
    throw new Error(
      `Release ${release.tag} does not include the required ruks_hovedresultater_long Parquet asset.`,
    );
  }

  return resolveRuksAssetUrl(parquetAsset.url);
}

function normalizeRelease(
  data: GithubLatestRelease,
  apiUrl: string,
): RuksLatestRelease {
  if (!data.tag_name || !Array.isArray(data.assets)) {
    throw new Error("Release payload is missing required fields.");
  }

  const assets: RuksArtifact[] = [];

  for (const asset of data.assets) {
    const kind = classifyAsset(asset.name);
    if (!kind) {
      continue;
    }

    assets.push({
      kind,
      name: asset.name,
      url: asset.browser_download_url,
      sizeBytes: asset.size,
      sizeLabel: formatBytes(asset.size),
      contentType: asset.content_type,
      downloadCount: asset.download_count ?? null,
      updatedAt: asset.updated_at ?? null,
      recommended: false,
    });
  }

  if (assets.length === 0) {
    throw new Error("Release payload does not include a supported RUKS data artifact.");
  }

  const recommendedAsset =
    assets.find((asset) => asset.kind === "parquet") ??
    assets.find((asset) => asset.kind === "csv_gz") ??
    assets[0];

  const decoratedAssets = assets.map((asset) => ({
    ...asset,
    recommended: asset.name === recommendedAsset.name,
  }));

  return {
    tag: data.tag_name,
    title: data.name || data.tag_name,
    htmlUrl: data.html_url,
    createdAt: data.created_at,
    publishedAt: data.published_at,
    apiUrl,
    assets: decoratedAssets,
    recommendedAsset: {
      ...recommendedAsset,
      recommended: true,
    },
  };
}

function classifyAsset(name: string): RuksArtifactKind | null {
  if (name.endsWith(".parquet")) {
    return "parquet";
  }

  if (name.endsWith(".csv.gz")) {
    return "csv_gz";
  }

  if (name.endsWith(".sqlite")) {
    return "sqlite";
  }

  return null;
}

function appAssetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;
}

function resolveRuksAssetUrl(url: string): string {
  const bundledAssetUrl = import.meta.env.DEV
    ? null
    : resolveBundledRuksAssetUrl(url);

  if (bundledAssetUrl) {
    return bundledAssetUrl;
  }

  if (/^https?:\/\//i.test(url) || url.startsWith("/")) {
    return url;
  }

  return appAssetUrl(url);
}

function resolveBundledRuksAssetUrl(url: string): string | null {
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
    return appAssetUrl(`data/${fileName}`);
  }

  return null;
}

async function fetchReleaseMetadata(url: string): Promise<Response> {
  try {
    return await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
      },
    });
  } catch (error) {
    throw new Error(
      `Udgivelsesmetadata kunne ikke hentes. URL: ${url}. Absolut URL: ${resolveAbsoluteUrl(url)}. Årsag: ${formatErrorCause(error)}`,
      { cause: error },
    );
  }
}

async function fetchReleaseFallback(url: string): Promise<Response> {
  try {
    return await fetch(url, { cache: "no-store" });
  } catch (error) {
    throw new Error(
      `Fallbackmetadata kunne ikke hentes. URL: ${url}. Absolut URL: ${resolveAbsoluteUrl(url)}. Årsag: ${formatErrorCause(error)}`,
      { cause: error },
    );
  }
}

function resolveAbsoluteUrl(url: string): string {
  if (typeof window === "undefined") {
    return url;
  }

  return new URL(url, window.location.href).href;
}

function formatErrorCause(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}
