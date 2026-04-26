import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";

const distDirectory = process.env.PAGES_DIST_DIR ?? "dist";
const basePath = process.env.VITE_APP_BASE_PATH ?? "/kroniker-kortet/";
const latestReleasePath = path.join(distDirectory, "data/latest-release.json");
const parquetAssetName = "ruks_hovedresultater_long.parquet";
const parquetPath = path.join(distDirectory, "data", parquetAssetName);
const indexPath = path.join(distDirectory, "index.html");

await assertFile(indexPath);
await assertFile(latestReleasePath);
await assertFile(parquetPath);

const indexHtml = await readFile(indexPath, "utf8");

if (!indexHtml.includes(`${basePath}assets/`)) {
  throw new Error(
    `dist/index.html does not reference assets under ${basePath}. Check Vite base config.`,
  );
}

const release = JSON.parse(await readFile(latestReleasePath, "utf8"));
const parquetAsset = release.assets?.find((asset) => asset.name === parquetAssetName);

if (!parquetAsset) {
  throw new Error(`dist release metadata does not include ${parquetAssetName}.`);
}

if (/^https?:\/\//i.test(parquetAsset.browser_download_url)) {
  throw new Error(
    `dist release metadata still points at a remote Parquet URL: ${parquetAsset.browser_download_url}`,
  );
}

const parquetStat = await stat(parquetPath);

if (parquetStat.size === 0) {
  throw new Error(`${parquetPath} exists but is empty.`);
}

console.log(
  `Pages artifact OK: ${parquetPath} (${parquetStat.size} bytes), base ${basePath}.`,
);

async function assertFile(filePath) {
  try {
    await access(filePath);
  } catch {
    throw new Error(`Missing required Pages artifact file: ${filePath}`);
  }
}
