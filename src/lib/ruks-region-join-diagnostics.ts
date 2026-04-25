import type { RuksLatestRelease } from "./ruks";
import {
  queryRuksMetricRows,
  type RuksFilterSelection,
  type RuksQueryContract,
} from "./ruks-duckdb";

type RegionJoinCandidateRow = {
  region_name?: unknown;
};

export type RuksRegionJoinDiagnosticsFilters = Pick<
  RuksFilterSelection,
  "disease" | "year" | "ageGroup" | "sex"
>;

export type RuksRegionJoinDiagnostics = {
  joinStrategy: "exact_name";
  totalRuksRegions: number;
  totalBoundaryRegions: number;
  matchedRegionNames: string[];
  unmatchedRuksRegionNames: string[];
  unmatchedBoundaryRegionNames: string[];
};

const regionJoinContract: RuksQueryContract = {
  filterColumns: {
    disease: "disease_slug",
    geoLevel: "geo_level",
    year: "year",
    ageGroup: "age_group_code",
    sex: "sex_code",
  },
  distinctColumns: {
    disease: {
      value: "disease_slug",
      label: "disease_label",
    },
    geoLevel: {
      value: "geo_level",
    },
    year: {
      value: "year",
    },
    ageGroup: {
      value: "age_group_code",
      label: "age_group_label",
    },
    sex: {
      value: "sex_code",
      label: "sex_label",
    },
  },
  selectColumns: ["region_name"],
};

export async function queryRuksRegionJoinDiagnostics(
  release: RuksLatestRelease,
  filters: RuksRegionJoinDiagnosticsFilters,
  boundaryRegionNames: readonly string[],
): Promise<RuksRegionJoinDiagnostics> {
  const candidates = await queryRuksMetricRows<RegionJoinCandidateRow>(
    release,
    regionJoinContract,
    {
      ...filters,
      geoLevel: "region",
    },
    {
      orderByColumns: ["region_name"],
    },
  );

  const ruksRegionNames = sortNames(
    Array.from(
      new Set(
        candidates.flatMap((candidate) => {
          const regionName = readText(candidate.region_name);
          return regionName === null ? [] : [regionName];
        }),
      ),
    ),
  );
  const distinctBoundaryRegionNames = sortNames(
    Array.from(
      new Set(
        boundaryRegionNames.flatMap((name) => {
          const regionName = readText(name);
          return regionName === null ? [] : [regionName];
        }),
      ),
    ),
  );
  const boundaryRegionNameSet = new Set(distinctBoundaryRegionNames);
  const ruksRegionNameSet = new Set(ruksRegionNames);

  return {
    joinStrategy: "exact_name",
    totalRuksRegions: ruksRegionNames.length,
    totalBoundaryRegions: distinctBoundaryRegionNames.length,
    matchedRegionNames: ruksRegionNames.filter((name) => boundaryRegionNameSet.has(name)),
    unmatchedRuksRegionNames: ruksRegionNames.filter(
      (name) => !boundaryRegionNameSet.has(name),
    ),
    unmatchedBoundaryRegionNames: distinctBoundaryRegionNames.filter(
      (name) => !ruksRegionNameSet.has(name),
    ),
  };
}

function readText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function sortNames(values: string[]): string[] {
  return values.sort((left, right) => left.localeCompare(right, "da-DK"));
}
