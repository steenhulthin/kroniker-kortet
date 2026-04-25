import { DAGI_WFS } from "./spatial";

const TEMPORARY_DAGI_REGION_TYPE_NAME = "dagi:Regionsinddeling";
const TEMPORARY_DAGI_REGION_NAMESPACE =
  "xmlns(dagi=http://data.gov.dk/schemas/dagi/2/gml3sfp)";
const TEMPORARY_DAGI_REGION_CRS = "EPSG:25832";
const TEMPORARY_DAGI_REGION_WFS_VERSION = "1.1.0";
const TEMPORARY_DAGI_WFS_TOKEN =
  import.meta.env.VITE_DAGI_WFS_TOKEN ?? "be8f1253b8642085ffb7d11d95685a72";
const REGION_BOUNDARY_SOURCE = "dagi-wfs-temporary";
const REGION_BOUNDARY_FALLBACK_SOURCE = "local-region-schematic-fallback";

type RegionBoundarySource =
  | typeof REGION_BOUNDARY_SOURCE
  | typeof REGION_BOUNDARY_FALLBACK_SOURCE;

export type RegionBoundaryPoint = {
  x: number;
  y: number;
};

export type RegionBoundaryPolygon = {
  outerRing: RegionBoundaryPoint[];
  innerRings: RegionBoundaryPoint[][];
};

export type RegionBoundaryFeature = {
  name: string;
  regionCode: string;
  localId: string;
  polygons: RegionBoundaryPolygon[];
};

export type RegionBoundaryBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type RegionBoundaryCollection = {
  source: RegionBoundarySource;
  crs: typeof TEMPORARY_DAGI_REGION_CRS;
  bounds: RegionBoundaryBounds;
  features: RegionBoundaryFeature[];
};

export type SvgRegionBoundaryFeature = RegionBoundaryFeature & {
  path: string;
};

export type SvgRegionBoundaryCollection = {
  source: RegionBoundarySource;
  crs: typeof TEMPORARY_DAGI_REGION_CRS;
  bounds: RegionBoundaryBounds;
  width: number;
  height: number;
  viewBox: string;
  features: SvgRegionBoundaryFeature[];
};

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
  source: RegionBoundarySource;
  crs: "EPSG:4326";
  features: RegionGeoJsonBoundaryFeature[];
};

export type RegionBoundaryFetchOptions = {
  token?: string;
  signal?: AbortSignal;
};

export type RegionBoundarySvgOptions = {
  width?: number;
  height?: number;
  padding?: number;
  decimals?: number;
};

export function buildTemporaryDagiRegionWfsUrl(
  token: string = TEMPORARY_DAGI_WFS_TOKEN,
): string {
  const url = new URL(DAGI_WFS.serviceUrl);

  url.searchParams.set("service", "WFS");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("version", TEMPORARY_DAGI_REGION_WFS_VERSION);
  url.searchParams.set("namespace", TEMPORARY_DAGI_REGION_NAMESPACE);
  url.searchParams.set("typename", TEMPORARY_DAGI_REGION_TYPE_NAME);
  url.searchParams.set("srsName", TEMPORARY_DAGI_REGION_CRS);
  url.searchParams.set("token", token);

  return url.toString();
}

export async function fetchTemporaryDagiRegionBoundaries(
  options: RegionBoundaryFetchOptions = {},
): Promise<RegionBoundaryCollection> {
  const response = await fetch(buildTemporaryDagiRegionWfsUrl(options.token), {
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(
      `DAGI region WFS request failed with ${response.status} ${response.statusText}`,
    );
  }

  const gml = await response.text();
  return parseTemporaryDagiRegionBoundariesGml(gml);
}

export function parseTemporaryDagiRegionBoundariesGml(
  gml: string,
): RegionBoundaryCollection {
  const xml = new DOMParser().parseFromString(gml, "application/xml");
  const parserError = xml.getElementsByTagName("parsererror")[0];

  if (parserError) {
    throw new Error("Unable to parse DAGI region GML response.");
  }

  const featureMembers = [
    ...findElementsByLocalName(xml.documentElement, "member"),
    ...findElementsByLocalName(xml.documentElement, "featureMember"),
  ];
  const features = featureMembers.map(parseFeatureMember);

  if (features.length === 0) {
    throw new Error("DAGI region GML response did not contain any region features.");
  }

  return {
    source: REGION_BOUNDARY_SOURCE,
    crs: TEMPORARY_DAGI_REGION_CRS,
    bounds: getCollectionBounds(features),
    features,
  };
}

export async function fetchTemporaryDagiRegionSvgBoundaries(
  options: RegionBoundaryFetchOptions & RegionBoundarySvgOptions = {},
): Promise<SvgRegionBoundaryCollection> {
  try {
    const collection = await fetchTemporaryDagiRegionBoundaries(options);
    return toSvgRegionBoundaryCollection(collection, options);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    return createFallbackRegionSvgBoundaries();
  }
}

export async function fetchTemporaryDagiRegionGeoJsonBoundaries(
  options: RegionBoundaryFetchOptions = {},
): Promise<RegionGeoJsonBoundaryCollection> {
  try {
    const collection = await fetchTemporaryDagiRegionBoundaries(options);
    return toRegionGeoJsonBoundaryCollection(collection);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    return createFallbackRegionGeoJsonBoundaries();
  }
}

function createFallbackRegionSvgBoundaries(): SvgRegionBoundaryCollection {
  const bounds: RegionBoundaryBounds = {
    minX: 0,
    minY: 0,
    maxX: 1000,
    maxY: 700,
  };
  const features: SvgRegionBoundaryFeature[] = [
    {
      name: "Region Nordjylland",
      regionCode: "1081",
      localId: "fallback-region-nordjylland",
      polygons: [],
      path: "M390 34 L650 34 L706 174 L606 248 L398 228 L318 118 Z",
    },
    {
      name: "Region Midtjylland",
      regionCode: "1082",
      localId: "fallback-region-midtjylland",
      polygons: [],
      path: "M278 170 L608 214 L662 372 L532 496 L292 454 L198 300 Z",
    },
    {
      name: "Region Syddanmark",
      regionCode: "1083",
      localId: "fallback-region-syddanmark",
      polygons: [],
      path: "M256 426 L532 474 L614 612 L470 682 L176 628 L110 500 Z",
    },
    {
      name: "Region Sjælland",
      regionCode: "1085",
      localId: "fallback-region-sjaelland",
      polygons: [],
      path: "M642 430 L838 424 L924 552 L838 664 L636 612 L578 504 Z",
    },
    {
      name: "Region Hovedstaden",
      regionCode: "1084",
      localId: "fallback-region-hovedstaden",
      polygons: [],
      path: "M760 294 L928 278 L972 390 L852 452 L720 402 Z",
    },
  ];

  return {
    source: REGION_BOUNDARY_FALLBACK_SOURCE,
    crs: TEMPORARY_DAGI_REGION_CRS,
    bounds,
    width: 1000,
    height: 700,
    viewBox: "0 0 1000 700",
    features,
  };
}

function createFallbackRegionGeoJsonBoundaries(): RegionGeoJsonBoundaryCollection {
  return {
    type: "FeatureCollection",
    source: REGION_BOUNDARY_FALLBACK_SOURCE,
    crs: "EPSG:4326",
    features: [
      createFallbackRegionFeature("Region Nordjylland", "1081", "fallback-region-nordjylland", [
        [
          [8.1, 56.55],
          [10.62, 56.58],
          [10.45, 57.72],
          [8.42, 57.55],
          [8.1, 56.55],
        ],
      ]),
      createFallbackRegionFeature("Region Midtjylland", "1082", "fallback-region-midtjylland", [
        [
          [7.62, 56.12],
          [7.95, 55.82],
          [10.52, 55.82],
          [10.62, 56.58],
          [8.1, 56.55],
          [7.62, 56.12],
        ],
      ]),
      createFallbackRegionFeature("Region Syddanmark", "1083", "fallback-region-syddanmark", [
        [
          [8.05, 54.72],
          [10.92, 54.82],
          [10.52, 55.82],
          [7.95, 55.82],
          [7.48, 55.18],
          [8.05, 54.72],
        ],
      ]),
      createFallbackRegionFeature("Region Sjælland", "1085", "fallback-region-sjaelland", [
        [
          [10.78, 54.86],
          [12.34, 54.92],
          [12.24, 55.76],
          [11.14, 55.86],
          [10.5, 55.3],
          [10.78, 54.86],
        ],
      ]),
      createFallbackRegionFeature("Region Hovedstaden", "1084", "fallback-region-hovedstaden", [
        [
          [11.72, 55.42],
          [12.78, 55.42],
          [12.82, 56.16],
          [11.78, 56.12],
          [11.72, 55.42],
        ],
        [
          [14.62, 54.96],
          [15.16, 55.0],
          [15.1, 55.32],
          [14.68, 55.28],
          [14.62, 54.96],
        ],
      ]),
    ],
  };
}

function createFallbackRegionFeature(
  name: string,
  regionCode: string,
  localId: string,
  polygons: number[][][],
): RegionGeoJsonBoundaryFeature {
  return {
    type: "Feature",
    properties: {
      name,
      regionCode,
      localId,
    },
    geometry: {
      type: "MultiPolygon",
      coordinates: polygons.map((polygon) => [polygon]),
    },
  };
}

export function toRegionGeoJsonBoundaryCollection(
  collection: RegionBoundaryCollection,
): RegionGeoJsonBoundaryCollection {
  return {
    type: "FeatureCollection",
    source: collection.source,
    crs: "EPSG:4326",
    features: collection.features.map((feature) => ({
      type: "Feature",
      properties: {
        name: feature.name,
        regionCode: feature.regionCode,
        localId: feature.localId,
      },
      geometry: {
        type: "MultiPolygon",
        coordinates: feature.polygons.map((polygon) => [
          closeGeoJsonRing(polygon.outerRing.map(projectEpsg25832ToWgs84)),
          ...polygon.innerRings.map((ring) =>
            closeGeoJsonRing(ring.map(projectEpsg25832ToWgs84)),
          ),
        ]),
      },
    })),
  };
}

export function toSvgRegionBoundaryCollection(
  collection: RegionBoundaryCollection,
  options: RegionBoundarySvgOptions = {},
): SvgRegionBoundaryCollection {
  const width = options.width ?? 1000;
  const height = options.height ?? 700;
  const padding = options.padding ?? 12;
  const decimals = options.decimals ?? 2;
  const projector = createSvgProjector(collection.bounds, width, height, padding, decimals);

  return {
    source: collection.source,
    crs: collection.crs,
    bounds: collection.bounds,
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    features: collection.features.map((feature) => ({
      ...feature,
      path: feature.polygons
        .map((polygon) => buildSvgPathForPolygon(polygon, projector))
        .join(" "),
    })),
  };
}

function closeGeoJsonRing(ring: number[][]): number[][] {
  const first = ring[0];
  const last = ring.at(-1);

  if (!first || !last) {
    return ring;
  }

  if (first[0] === last[0] && first[1] === last[1]) {
    return ring;
  }

  return [...ring, first];
}

function projectEpsg25832ToWgs84(point: RegionBoundaryPoint): [number, number] {
  const zoneNumber = 32;
  const centralMeridianDegrees = (zoneNumber - 1) * 6 - 180 + 3;
  const centralMeridian = degreesToRadians(centralMeridianDegrees);
  const semiMajorAxis = 6378137;
  const eccentricitySquared = 0.0066943799901413165;
  const scaleFactor = 0.9996;
  const x = point.x - 500000;
  const y = point.y;
  const e1 =
    (1 - Math.sqrt(1 - eccentricitySquared)) /
    (1 + Math.sqrt(1 - eccentricitySquared));
  const meridionalArc = y / scaleFactor;
  const mu =
    meridionalArc /
    (semiMajorAxis *
      (1 -
        eccentricitySquared / 4 -
        (3 * eccentricitySquared ** 2) / 64 -
        (5 * eccentricitySquared ** 3) / 256));
  const footprintLatitude =
    mu +
    (((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)) +
    (((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const eccentricityPrimeSquared =
    eccentricitySquared / (1 - eccentricitySquared);
  const sinFootprintLatitude = Math.sin(footprintLatitude);
  const cosFootprintLatitude = Math.cos(footprintLatitude);
  const tanFootprintLatitude = Math.tan(footprintLatitude);
  const c1 = eccentricityPrimeSquared * cosFootprintLatitude ** 2;
  const t1 = tanFootprintLatitude ** 2;
  const n1 =
    semiMajorAxis /
    Math.sqrt(1 - eccentricitySquared * sinFootprintLatitude ** 2);
  const r1 =
    (semiMajorAxis * (1 - eccentricitySquared)) /
    (1 - eccentricitySquared * sinFootprintLatitude ** 2) ** 1.5;
  const d = x / (n1 * scaleFactor);
  const latitude =
    footprintLatitude -
    ((n1 * tanFootprintLatitude) / r1) *
      (d ** 2 / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * eccentricityPrimeSquared) *
          d ** 4) /
          24 +
        ((61 +
          90 * t1 +
          298 * c1 +
          45 * t1 ** 2 -
          252 * eccentricityPrimeSquared -
          3 * c1 ** 2) *
          d ** 6) /
          720);
  const longitude =
    centralMeridian +
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 -
        2 * c1 +
        28 * t1 -
        3 * c1 ** 2 +
        8 * eccentricityPrimeSquared +
        24 * t1 ** 2) *
        d ** 5) /
        120) /
      cosFootprintLatitude;

  return [
    roundForSvg(radiansToDegrees(longitude), 6),
    roundForSvg(radiansToDegrees(latitude), 6),
  ];
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

function parseFeatureMember(featureMember: Element): RegionBoundaryFeature {
  const featureElement = Array.from(featureMember.children)[0];

  if (!featureElement) {
    throw new Error("Encountered empty DAGI region feature member.");
  }

  return {
    name: readRequiredText(featureElement, "navn"),
    regionCode: readRequiredText(featureElement, "regionskode"),
    localId: readRequiredTextFromAny(featureElement, ["id.lokalId", "lokalId"]),
    polygons: parseFeaturePolygons(featureElement),
  };
}

function parseFeaturePolygons(featureElement: Element): RegionBoundaryPolygon[] {
  const multiSurface = findFirstElementByLocalName(featureElement, "MultiSurface");

  if (!multiSurface) {
    throw new Error("DAGI region feature is missing gml:MultiSurface geometry.");
  }

  const polygons = findElementsByLocalName(multiSurface, "Polygon").map((polygonElement) => ({
    outerRing: parseRingFromContainer(polygonElement, "exterior"),
    innerRings: findElementsByLocalName(polygonElement, "interior").map((interiorElement) =>
      parseRing(interiorElement),
    ),
  }));

  if (polygons.length === 0) {
    throw new Error("DAGI region feature did not contain any gml:Polygon geometries.");
  }

  return polygons;
}

function parseRingFromContainer(container: Element, ringType: "exterior" | "interior") {
  const ringContainer = findFirstElementByLocalName(container, ringType);

  if (!ringContainer) {
    throw new Error(`DAGI region polygon is missing gml:${ringType}.`);
  }

  return parseRing(ringContainer);
}

function parseRing(ringContainer: Element): RegionBoundaryPoint[] {
  const linearRing = findFirstElementByLocalName(ringContainer, "LinearRing");

  if (!linearRing) {
    throw new Error("DAGI region polygon ring is missing gml:LinearRing.");
  }

  const coordinatesElement = findFirstElementByLocalName(linearRing, "coordinates");

  if (coordinatesElement) {
    const tupleSeparator = coordinatesElement.getAttribute("ts") ?? " ";
    const coordinateSeparator = coordinatesElement.getAttribute("cs") ?? ",";
    const coordinatesText = coordinatesElement.textContent?.trim() ?? "";

    return parseCoordinateTuples(coordinatesText, tupleSeparator, coordinateSeparator);
  }

  const posListElement = findFirstElementByLocalName(linearRing, "posList");

  if (posListElement) {
    const posListText = posListElement.textContent?.trim() ?? "";
    const dimension = Number.parseInt(posListElement.getAttribute("srsDimension") ?? "2", 10);

    return parsePosList(posListText, Number.isFinite(dimension) ? dimension : 2);
  }

  throw new Error("DAGI region polygon ring is missing coordinates.");
}

function parseCoordinateTuples(
  coordinatesText: string,
  tupleSeparator: string,
  coordinateSeparator: string,
): RegionBoundaryPoint[] {
  const tuples =
    tupleSeparator.trim() === ""
      ? coordinatesText.split(/\s+/)
      : coordinatesText.split(tupleSeparator);

  return tuples
    .map((tuple) => tuple.trim())
    .filter(Boolean)
    .map((tuple) => {
      const [xValue, yValue] = tuple.split(coordinateSeparator);

      if (xValue === undefined || yValue === undefined) {
        throw new Error("Encountered malformed gml:coordinates tuple.");
      }

      return {
        x: parseRequiredNumber(xValue),
        y: parseRequiredNumber(yValue),
      };
    });
}

function parsePosList(posListText: string, dimension: number): RegionBoundaryPoint[] {
  const values = posListText
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map(parseRequiredNumber);

  if (values.length < dimension * 3 || values.length % dimension !== 0) {
    throw new Error("Encountered malformed gml:posList coordinates.");
  }

  const points: RegionBoundaryPoint[] = [];

  for (let index = 0; index < values.length; index += dimension) {
    points.push({
      x: values[index] ?? 0,
      y: values[index + 1] ?? 0,
    });
  }

  return points;
}

function getCollectionBounds(features: RegionBoundaryFeature[]): RegionBoundaryBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const feature of features) {
    for (const polygon of feature.polygons) {
      for (const point of polygon.outerRing) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }

      for (const ring of polygon.innerRings) {
        for (const point of ring) {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
      }
    }
  }

  return { minX, minY, maxX, maxY };
}

function createSvgProjector(
  bounds: RegionBoundaryBounds,
  width: number,
  height: number,
  padding: number,
  decimals: number,
) {
  const sourceWidth = Math.max(bounds.maxX - bounds.minX, 1);
  const sourceHeight = Math.max(bounds.maxY - bounds.minY, 1);
  const innerWidth = Math.max(width - padding * 2, 1);
  const innerHeight = Math.max(height - padding * 2, 1);
  const scale = Math.min(innerWidth / sourceWidth, innerHeight / sourceHeight);
  const offsetX = padding + (innerWidth - sourceWidth * scale) / 2;
  const offsetY = padding + (innerHeight - sourceHeight * scale) / 2;

  return (point: RegionBoundaryPoint) => ({
    x: roundForSvg(offsetX + (point.x - bounds.minX) * scale, decimals),
    y: roundForSvg(offsetY + (bounds.maxY - point.y) * scale, decimals),
  });
}

function buildSvgPathForPolygon(
  polygon: RegionBoundaryPolygon,
  projector: (point: RegionBoundaryPoint) => RegionBoundaryPoint,
): string {
  const pathSegments = [toSvgPathSegment(polygon.outerRing, projector)];

  for (const ring of polygon.innerRings) {
    pathSegments.push(toSvgPathSegment(ring, projector));
  }

  return pathSegments.join(" ");
}

function toSvgPathSegment(
  ring: RegionBoundaryPoint[],
  projector: (point: RegionBoundaryPoint) => RegionBoundaryPoint,
): string {
  if (ring.length < 3) {
    throw new Error("A DAGI region polygon ring must contain at least three points.");
  }

  return ring
    .map((point, index) => {
      const projectedPoint = projector(point);
      const command = index === 0 ? "M" : "L";

      return `${command}${projectedPoint.x} ${projectedPoint.y}`;
    })
    .concat("Z")
    .join(" ");
}

function readRequiredText(root: Element, localName: string): string {
  return readRequiredTextFromAny(root, [localName]);
}

function readRequiredTextFromAny(root: Element, localNames: string[]): string {
  for (const localName of localNames) {
    const element = findFirstElementByLocalName(root, localName);
    const value = element?.textContent?.trim();

    if (value) {
      return value;
    }
  }

  throw new Error(`DAGI region feature is missing ${localNames.join(" or ")}.`);
}

function parseRequiredNumber(value: string): number {
  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Unable to parse numeric coordinate value "${value}".`);
  }

  return parsed;
}

function roundForSvg(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function findFirstElementByLocalName(root: Element, localName: string): Element | undefined {
  return findElementsByLocalName(root, localName)[0];
}

function findElementsByLocalName(root: Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagName("*")).filter(
    (element) => element.localName === localName,
  );
}
