import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const releaseApiUrl =
  process.env.RUKS_RELEASE_API_URL ??
  "https://api.github.com/repos/steenhulthin/ruks-data/releases/latest";
const outputDirectory = process.env.RUKS_PUBLIC_DATA_DIR ?? "public/data";
const latestReleasePath = path.join(outputDirectory, "latest-release.json");
const githubToken = process.env.GITHUB_TOKEN;

await mkdir(outputDirectory, { recursive: true });

const release = await fetchJson(releaseApiUrl);
const parquetAssets = selectRuksParquetAssets(release.assets ?? []);

if (parquetAssets.length === 0) {
  throw new Error(
    `Release ${release.tag_name ?? releaseApiUrl} is missing a ruks_hovedresultater_long Parquet asset.`,
  );
}

const parquetOutputPaths = [];

for (const parquetAsset of parquetAssets) {
  const parquetOutputPath = path.join(outputDirectory, parquetAsset.name);

  console.log(`Downloading ${parquetAsset.name} from ${release.tag_name}.`);

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
  parquetOutputPaths.push(parquetOutputPath);
}

const staticRelease = {
  ...release,
  assets: release.assets.map((asset) =>
    isRuksParquetAssetName(asset.name)
      ? {
          ...asset,
          browser_download_url: `data/${asset.name}`,
        }
      : asset,
  ),
};

await writeFile(latestReleasePath, `${JSON.stringify(staticRelease, null, 2)}\n`);

console.log(`Wrote ${latestReleasePath} and ${parquetOutputPaths.join(", ")}.`);

function selectRuksParquetAssets(assets) {
  return assets.filter((asset) => isRuksParquetAssetName(asset.name));
}

function isRuksParquetAssetName(name) {
  return /^ruks_hovedresultater_long(?:-.+)?\.parquet$/.test(name);
}

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
