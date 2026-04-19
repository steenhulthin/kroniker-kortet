export type SpatialLayerConfig = {
  key: "municipalities" | "regions";
  title: string;
  typeName: string;
};

export type SpatialServiceConfig = {
  title: string;
  serviceUrl: string;
  defaultCrs: string;
  capabilitiesUrl: string;
  layers: SpatialLayerConfig[];
};

const DAGI_SERVICE_URL = "https://api.dataforsyningen.dk/DAGI_10MULTIGEOM_GMLSFP_DAF";
const DEFAULT_DAGI_TOKEN = "be8f1253b8642085ffb7d11d95685a72";

export const DAGI_WFS: SpatialServiceConfig = {
  title: "DAGI – Danmarks Administrative Geografiske Inddeling, multi geometrier",
  serviceUrl: DAGI_SERVICE_URL,
  defaultCrs: "EPSG:25832",
  capabilitiesUrl: buildDagiCapabilitiesUrl(),
  layers: [
    {
      key: "municipalities",
      title: "Kommuneinddeling",
      typeName: "dagi:Kommuneinddeling",
    },
    {
      key: "regions",
      title: "Regionsinddeling",
      typeName: "dagi:Regionsinddeling",
    },
  ],
};

export function buildWfsCapabilitiesUrl(serviceUrl: string, token: string): string {
  const url = new URL(serviceUrl);
  url.searchParams.set("service", "WFS");
  url.searchParams.set("request", "GetCapabilities");
  url.searchParams.set("token", token);
  return url.toString();
}

export function buildDagiCapabilitiesUrl(
  token: string = import.meta.env.VITE_DAGI_WFS_TOKEN ?? DEFAULT_DAGI_TOKEN,
): string {
  return buildWfsCapabilitiesUrl(DAGI_SERVICE_URL, token);
}
