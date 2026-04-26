import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { geojson } from "flatgeobuf";
import proj4 from "proj4";
import { open } from "shapefile";

const sourceCrs =
  "+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs +type=crs";
const targetCrs = "WGS84";

const datasets = [
  {
    sourcePath:
      "public/data/dagi_2000m_nohist_l1.kommuneinddeling/dagi_2000m_nohist_l1.kommuneinddeling.shp",
    outputPath: "public/data/dagi-municipalities.fgb",
    kind: "municipality",
  },
  {
    sourcePath:
      "public/data/dagi_2000m_nohist_l1.regionsinddeling/dagi_2000m_nohist_l1.regionsinddeling.shp",
    outputPath: "public/data/dagi-regions.fgb",
    kind: "region",
  },
];

for (const dataset of datasets) {
  const collection = await readDagiShapefile(dataset);
  const output = geojson.serialize(collection, 4326);

  await mkdir(path.dirname(dataset.outputPath), { recursive: true });
  await writeFile(dataset.outputPath, output);

  console.log(
    `${dataset.outputPath}: ${collection.features.length} ${dataset.kind} features`,
  );
}

async function readDagiShapefile(dataset) {
  const source = await open(dataset.sourcePath);
  const features = [];

  while (true) {
    const result = await source.read();

    if (result.done) {
      break;
    }

    features.push(normalizeFeature(result.value, dataset.kind));
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

function normalizeFeature(feature, kind) {
  return {
    type: "Feature",
    properties: normalizeProperties(feature.properties, kind),
    geometry: normalizeGeometry(feature.geometry),
  };
}

function normalizeProperties(properties, kind) {
  const base = {
    name: readRequiredText(properties, "navn"),
    localId: readRequiredText(properties, "id_lokalid"),
    sourceScale: readRequiredText(properties, "skala"),
    extractedAt: readOptionalText(properties, "udtraeksda"),
  };

  if (kind === "municipality") {
    return {
      ...base,
      municipalityCode: readRequiredText(properties, "kommunekod"),
      regionCode: readRequiredText(properties, "regionskod"),
    };
  }

  return {
    ...base,
    regionCode: readRequiredText(properties, "regionskod"),
    nuts2Code: readRequiredText(properties, "nuts2vaerd"),
  };
}

function readRequiredText(properties, key) {
  const value = properties[key];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`DAGI shapefile feature is missing required field ${key}.`);
  }

  return value;
}

function readOptionalText(properties, key) {
  const value = properties[key];

  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function normalizeGeometry(geometry) {
  if (!geometry) {
    throw new Error("DAGI shapefile feature is missing geometry.");
  }

  if (geometry.type === "Polygon") {
    return {
      type: "MultiPolygon",
      coordinates: [transformPolygonCoordinates(geometry.coordinates)],
    };
  }

  if (geometry.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: geometry.coordinates.map(transformPolygonCoordinates),
    };
  }

  throw new Error(`Unsupported DAGI geometry type: ${geometry.type}`);
}

function transformPolygonCoordinates(polygon) {
  return polygon.map((ring) =>
    ring.map(([x, y]) => {
      const [lng, lat] = proj4(sourceCrs, targetCrs, [x, y]);
      return [roundCoordinate(lng), roundCoordinate(lat)];
    }),
  );
}

function roundCoordinate(value) {
  return Math.round(value * 1e7) / 1e7;
}
