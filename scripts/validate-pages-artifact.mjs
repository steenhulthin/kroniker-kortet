import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";

const distDirectory = process.env.PAGES_DIST_DIR ?? "dist";
const basePath = process.env.VITE_APP_BASE_PATH ?? "/kroniker-kortet/";
const latestReleasePath = path.join(distDirectory, "data/latest-release.json");
const indexPath = path.join(distDirectory, "index.html");

await assertFile(indexPath);
await assertFile(latestReleasePath);

const indexHtml = await readFile(indexPath, "utf8");

if (!indexHtml.includes(`${basePath}assets/`)) {
  throw new Error(
    `dist/index.html does not reference assets under ${basePath}. Check Vite base config.`,
  );
}

const release = JSON.parse(await readFile(latestReleasePath, "utf8"));
const parquetAssets = selectRuksParquetAssets(release.assets ?? []);

if (parquetAssets.length === 0) {
  throw new Error(
    "dist release metadata does not include a ruks_hovedresultater_long Parquet asset.",
  );
}

for (const parquetAsset of parquetAssets) {
  if (/^https?:\/\//i.test(parquetAsset.browser_download_url)) {
    throw new Error(
      `dist release metadata still points at a remote Parquet URL: ${parquetAsset.browser_download_url}`,
    );
  }

  const parquetPath = resolveDistAssetPath(parquetAsset.browser_download_url);
  await assertFile(parquetPath);

  const parquetStat = await stat(parquetPath);

  if (parquetStat.size === 0) {
    throw new Error(`${parquetPath} exists but is empty.`);
  }

  console.log(
    `Pages artifact OK: ${parquetPath} (${parquetStat.size} bytes), base ${basePath}.`,
  );
}

function selectRuksParquetAssets(assets) {
  return assets.filter((asset) =>
    /^ruks_hovedresultater_long(?:-.+)?\.parquet$/.test(asset.name),
  );
}

function resolveDistAssetPath(assetUrl) {
  const normalizedBasePath = basePath.endsWith("/") ? basePath : `${basePath}/`;
  let normalizedUrl = assetUrl.replace(/^\/+/, "");

  if (assetUrl.startsWith(normalizedBasePath)) {
    normalizedUrl = assetUrl.slice(normalizedBasePath.length);
  }

  if (!normalizedUrl.startsWith("data/")) {
    throw new Error(
      `Parquet URL must point inside the Pages data directory, got: ${assetUrl}`,
    );
  }

  return path.join(distDirectory, normalizedUrl);
}

async function assertFile(filePath) {
  try {
    await access(filePath);
  } catch {
    throw new Error(`Missing required Pages artifact file: ${filePath}`);
  }
}
