import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const releaseApiUrl =
  process.env.RUKS_RELEASE_API_URL ??
  "https://api.github.com/repos/steenhulthin/ruks-data/releases/latest";
const outputDirectory = process.env.RUKS_PUBLIC_DATA_DIR ?? "public/data";
const parquetAssetName = "ruks_hovedresultater_long.parquet";
const latestReleasePath = path.join(outputDirectory, "latest-release.json");
const parquetOutputPath = path.join(outputDirectory, parquetAssetName);
const githubToken = process.env.GITHUB_TOKEN;

await mkdir(outputDirectory, { recursive: true });

const release = await fetchJson(releaseApiUrl);
const parquetAsset = release.assets?.find((asset) => asset.name === parquetAssetName);

if (!parquetAsset?.browser_download_url) {
  throw new Error(`Release ${release.tag_name ?? releaseApiUrl} is missing ${parquetAssetName}.`);
}

console.log(`Downloading ${parquetAssetName} from ${release.tag_name}.`);

const parquetResponse = await fetch(parquetAsset.browser_download_url, {
  redirect: "follow",
  headers: {
    Accept: "application/octet-stream",
    ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
  },
});

if (!parquetResponse.ok) {
  throw new Error(
    `Parquet download failed with ${parquetResponse.status} ${parquetResponse.statusText}.`,
  );
}

await writeFile(parquetOutputPath, new Uint8Array(await parquetResponse.arrayBuffer()));

const staticRelease = {
  ...release,
  assets: release.assets.map((asset) =>
    asset.name === parquetAssetName
      ? {
          ...asset,
          browser_download_url: `data/${parquetAssetName}`,
        }
      : asset,
  ),
};

await writeFile(latestReleasePath, `${JSON.stringify(staticRelease, null, 2)}\n`);

console.log(`Wrote ${latestReleasePath} and ${parquetOutputPath}.`);

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(
      `Release metadata request failed with ${response.status} ${response.statusText}.`,
    );
  }

  return response.json();
}
