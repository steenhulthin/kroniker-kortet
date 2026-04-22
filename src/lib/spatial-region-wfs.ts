import { DAGI_WFS } from "./spatial";

const TEMPORARY_DAGI_REGION_TYPE_NAME = "dagi:Regionsinddeling";
const TEMPORARY_DAGI_REGION_NAMESPACE =
  "xmlns(dagi=http://data.gov.dk/schemas/dagi/2/gml3sfp)";
const TEMPORARY_DAGI_REGION_CRS = "EPSG:25832";
const TEMPORARY_DAGI_REGION_WFS_VERSION = "1.1.0";
const TEMPORARY_DAGI_WFS_TOKEN =
  import.meta.env.VITE_DAGI_WFS_TOKEN ?? "be8f1253b8642085ffb7d11d95685a72";

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
  source: "dagi-wfs-temporary";
  crs: typeof TEMPORARY_DAGI_REGION_CRS;
  bounds: RegionBoundaryBounds;
  features: RegionBoundaryFeature[];
};

export type SvgRegionBoundaryFeature = RegionBoundaryFeature & {
  path: string;
};

export type SvgRegionBoundaryCollection = {
  source: "dagi-wfs-temporary";
  crs: typeof TEMPORARY_DAGI_REGION_CRS;
  bounds: RegionBoundaryBounds;
  width: number;
  height: number;
  viewBox: string;
  features: SvgRegionBoundaryFeature[];
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
    source: "dagi-wfs-temporary",
    crs: TEMPORARY_DAGI_REGION_CRS,
    bounds: getCollectionBounds(features),
    features,
  };
}

export async function fetchTemporaryDagiRegionSvgBoundaries(
  options: RegionBoundaryFetchOptions & RegionBoundarySvgOptions = {},
): Promise<SvgRegionBoundaryCollection> {
  const collection = await fetchTemporaryDagiRegionBoundaries(options);
  return toSvgRegionBoundaryCollection(collection, options);
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
