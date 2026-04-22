export type SpatialLayerConfig = {
  key: "municipalities" | "regions";
  title: string;
  typeName: string;
};

export type SpatialJoinStrategy = "name_match" | "mapping_table";

export type SpatialJoinContract = {
  geoLevel: "municipality" | "region";
  ruksNameColumn: string;
  dagiNameColumn: string;
  dagiCodeColumn: string;
  dagiLocalIdColumn?: string;
  joinStrategy: SpatialJoinStrategy;
  fallbackStrategy?: SpatialJoinStrategy;
  notes: string[];
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

export const RUKS_SPATIAL_JOIN_CONTRACTS: Record<
  "municipality" | "region",
  SpatialJoinContract
> = {
  municipality: {
    geoLevel: "municipality",
    ruksNameColumn: "municipality_name",
    dagiNameColumn: "Navn",
    dagiCodeColumn: "Kommunekode",
    dagiLocalIdColumn: "Id_lokalid",
    joinStrategy: "name_match",
    fallbackStrategy: "mapping_table",
    notes: [
      "DAGI Kommuneinddeling exposes both municipality name and municipality code.",
      "RUKS currently exposes municipality names, not municipality codes, in the analytical extract used by this app.",
      "Christiansoe is modeled in DAGI as outside municipality and region boundaries, so municipality join logic must not invent a normal municipality polygon for it.",
      "A maintained name-to-code lookup remains the preferred fallback if direct name matching proves unstable.",
    ],
  },
  region: {
    geoLevel: "region",
    ruksNameColumn: "region_name",
    dagiNameColumn: "Navn",
    dagiCodeColumn: "Regionskode",
    dagiLocalIdColumn: "Id_lokalid",
    joinStrategy: "name_match",
    fallbackStrategy: "mapping_table",
    notes: [
      "DAGI Regionsinddeling exposes both region name and region code.",
      "RUKS currently exposes region names, not region codes, in the analytical extract used by this app.",
      "For the current KOL extract, the five RUKS region names appear to match DAGI names exactly.",
      "If later diseases or releases introduce naming drift, switch to a maintained region lookup rather than adding ad hoc string fixes in components.",
    ],
  },
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
