export type RegionGeoJsonBoundaryFeature = {
  type: "Feature";
  properties: {
    name: string;
    regionCode: string;
    localId: string;
  };
  geometry: {
    type: "MultiPolygon";
    coordinates: number[][][][];
  };
};

export type RegionGeoJsonBoundaryCollection = {
  type: "FeatureCollection";
  source: "dagi-static-json";
  crs: "EPSG:4326";
  features: RegionGeoJsonBoundaryFeature[];
};

const DEFAULT_REGION_BOUNDARIES_URL = "/data/dagi-regions.geojson";

export async function fetchStaticDagiRegionGeoJsonBoundaries(
  url: string = import.meta.env.VITE_DAGI_REGION_BOUNDARIES_URL ??
    DEFAULT_REGION_BOUNDARIES_URL,
): Promise<RegionGeoJsonBoundaryCollection> {
  const response = await fetch(url, { cache: "force-cache" });

  if (!response.ok) {
    throw new Error(
      `Static DAGI region boundary request failed with ${response.status} ${response.statusText}`,
    );
  }

  return parseStaticDagiRegionGeoJson(await response.json());
}

function parseStaticDagiRegionGeoJson(value: unknown): RegionGeoJsonBoundaryCollection {
  if (!isRegionGeoJsonBoundaryCollection(value)) {
    throw new Error("Static DAGI region boundary file has an unexpected shape.");
  }

  return value;
}

function isRegionGeoJsonBoundaryCollection(
  value: unknown,
): value is RegionGeoJsonBoundaryCollection {
  if (!value || typeof value !== "object") {
    return false;
  }

  const collection = value as Partial<RegionGeoJsonBoundaryCollection>;

  return (
    collection.type === "FeatureCollection" &&
    collection.source === "dagi-static-json" &&
    collection.crs === "EPSG:4326" &&
    Array.isArray(collection.features)
  );
}
