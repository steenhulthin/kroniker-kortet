import { geojson } from "flatgeobuf";

export type DagiGeoLevel = "municipality" | "region";

export type DagiBoundaryProperties = {
  name: string;
  localId: string;
  sourceScale: string;
  extractedAt?: string | null;
  municipalityCode?: string;
  regionCode: string;
  nuts2Code?: string;
};

export type DagiBoundaryFeature = {
  type: "Feature";
  properties: DagiBoundaryProperties;
  geometry: {
    type: "MultiPolygon";
    coordinates: number[][][][];
  };
};

export type DagiBoundaryCollection = {
  type: "FeatureCollection";
  source: "dagi-static-flatgeobuf";
  geoLevel: DagiGeoLevel;
  crs: "EPSG:4326";
  features: DagiBoundaryFeature[];
};

export type DagiBoundaryCollections = Record<DagiGeoLevel, DagiBoundaryCollection>;

const DEFAULT_MUNICIPALITY_BOUNDARIES_URL = appAssetUrl(
  "data/dagi-municipalities.fgb",
);
const DEFAULT_REGION_BOUNDARIES_URL = appAssetUrl("data/dagi-regions.fgb");

export async function fetchStaticDagiFlatGeobufBoundaries(): Promise<DagiBoundaryCollections> {
  const [municipality, region] = await Promise.all([
    fetchStaticDagiFlatGeobufBoundaryCollection(
      "municipality",
      import.meta.env.VITE_DAGI_MUNICIPALITY_BOUNDARIES_URL ??
        DEFAULT_MUNICIPALITY_BOUNDARIES_URL,
    ),
    fetchStaticDagiFlatGeobufBoundaryCollection(
      "region",
      import.meta.env.VITE_DAGI_REGION_BOUNDARIES_URL ??
        DEFAULT_REGION_BOUNDARIES_URL,
    ),
  ]);

  return { municipality, region };
}

async function fetchStaticDagiFlatGeobufBoundaryCollection(
  geoLevel: DagiGeoLevel,
  url: string,
): Promise<DagiBoundaryCollection> {
  const response = await fetch(url, { cache: "force-cache" });

  if (!response.ok) {
    throw new Error(
      `Static DAGI ${geoLevel} boundary request failed with ${response.status} ${response.statusText}`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const features: DagiBoundaryFeature[] = [];

  for await (const feature of geojson.deserialize(bytes)) {
    features.push(parseDagiBoundaryFeature(feature));
  }

  return {
    type: "FeatureCollection",
    source: "dagi-static-flatgeobuf",
    geoLevel,
    crs: "EPSG:4326",
    features,
  };
}

function parseDagiBoundaryFeature(value: unknown): DagiBoundaryFeature {
  if (!isDagiBoundaryFeature(value)) {
    throw new Error("Static DAGI FlatGeobuf boundary file has an unexpected shape.");
  }

  return value;
}

function isDagiBoundaryFeature(value: unknown): value is DagiBoundaryFeature {
  if (!value || typeof value !== "object") {
    return false;
  }

  const feature = value as Partial<DagiBoundaryFeature>;

  return (
    feature.type === "Feature" &&
    isDagiBoundaryProperties(feature.properties) &&
    feature.geometry?.type === "MultiPolygon" &&
    Array.isArray(feature.geometry.coordinates)
  );
}

function isDagiBoundaryProperties(
  value: unknown,
): value is DagiBoundaryProperties {
  if (!value || typeof value !== "object") {
    return false;
  }

  const properties = value as Partial<DagiBoundaryProperties>;

  return (
    typeof properties.name === "string" &&
    typeof properties.localId === "string" &&
    typeof properties.sourceScale === "string" &&
    typeof properties.regionCode === "string" &&
    (properties.municipalityCode === undefined ||
      typeof properties.municipalityCode === "string") &&
    (properties.nuts2Code === undefined || typeof properties.nuts2Code === "string")
  );
}

function appAssetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;
}
