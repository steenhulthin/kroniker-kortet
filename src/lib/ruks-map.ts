import type { RuksLatestRelease } from "./ruks";
import {
  queryRuksMetricRows,
  type RuksFilterSelection,
  type RuksQueryContract,
} from "./ruks-duckdb";

type RegionRateCandidateRow = {
  region_name?: unknown;
  value?: unknown;
  value_kind?: unknown;
  unit?: unknown;
  standardization?: unknown;
  measure_code?: unknown;
  measure_label?: unknown;
  source_unit_label?: unknown;
};

export type RuksRegionRateMapFilters = Pick<
  RuksFilterSelection,
  "disease" | "metric" | "year" | "ageGroup" | "sex"
>;

export type RuksRegionRateMapRow = {
  regionName: string;
  value: number;
  measureCode: string;
  measureLabel: string;
  sourceUnitLabel: string;
};

export type RuksRegionRateCandidateAudit = {
  candidates: RuksRegionRateMapRow[];
  candidateRegionNames: string[];
  duplicateRegionNames: string[];
  measures: Array<{
    measureCode: string;
    measureLabel: string;
    sourceUnitLabel: string;
    rowCount: number;
    distinctRegionCount: number;
  }>;
};

const regionRateMapContract: RuksQueryContract = {
  filterColumns: {
    disease: "disease_slug",
    geoLevel: "geo_level",
    measure: "measure_code",
    metric: "source_unit_label",
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
    measure: {
      value: "measure_code",
      label: "measure_label",
    },
    metric: {
      value: "source_unit_label",
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
  selectColumns: [
    "region_name",
    "value",
    "value_kind",
    "unit",
    "standardization",
    "measure_code",
    "measure_label",
    "source_unit_label",
  ],
};

export async function queryRuksRegionRateMapRows(
  release: RuksLatestRelease,
  filters: RuksRegionRateMapFilters,
): Promise<RuksRegionRateMapRow[]> {
  const audit = await auditRuksRegionRateCandidates(release, filters);
  const selectedCandidates = selectRegionRateMapCandidates(audit.candidates);
  const matchingMeasureCodes = new Set(selectedCandidates.map((candidate) => candidate.measureCode));

  if (matchingMeasureCodes.size > 1) {
    const measureSummary = audit.measures
      .map(
        (measure) =>
          `${measure.measureLabel || measure.measureCode} (${measure.measureCode})`,
      )
      .join(", ");

    throw new Error(
      `Region map metric is ambiguous: multiple non-standardized rate measures match the current filters: ${measureSummary}. Define the measure contract before rendering the choropleth.`,
    );
  }

  const rowsByRegion = new Map<string, RuksRegionRateMapRow>();

  for (const candidate of selectedCandidates) {
    if (rowsByRegion.has(candidate.regionName)) {
      throw new Error(
        `Region map query returned multiple rate rows for ${candidate.regionName}.`,
      );
    }

    rowsByRegion.set(candidate.regionName, candidate);
  }

  return Array.from(rowsByRegion.values()).sort((left, right) =>
    left.regionName.localeCompare(right.regionName, "da-DK"),
  );
}

function selectRegionRateMapCandidates(
  candidates: readonly RuksRegionRateMapRow[],
): RuksRegionRateMapRow[] {
  const measureCodes = new Set(candidates.map((candidate) => candidate.measureCode));

  if (measureCodes.size <= 1) {
    return [...candidates];
  }

  const preferredCandidates = candidates.filter((candidate) =>
    isPreferredRegionRateMeasure(candidate),
  );
  const preferredMeasureCodes = new Set(
    preferredCandidates.map((candidate) => candidate.measureCode),
  );

  return preferredMeasureCodes.size === 1 ? preferredCandidates : [...candidates];
}

function isPreferredRegionRateMeasure(candidate: RuksRegionRateMapRow): boolean {
  const normalized =
    `${candidate.measureCode} ${candidate.measureLabel} ${candidate.sourceUnitLabel}`.toLocaleLowerCase(
      "da-DK",
    );

  return (
    !normalized.includes("incidens") &&
    (normalized.includes("personer med sygdom") ||
      normalized.includes("prævalens") ||
      normalized.includes("praevalens") ||
      normalized.includes("prevalence"))
  );
}

export async function auditRuksRegionRateCandidates(
  release: RuksLatestRelease,
  filters: RuksRegionRateMapFilters,
): Promise<RuksRegionRateCandidateAudit> {
  const candidates = await queryRuksMetricRows<RegionRateCandidateRow>(
    release,
    regionRateMapContract,
    {
      ...filters,
      geoLevel: "region",
    },
    {
      orderByColumns: ["region_name", "measure_code", "standardization"],
    },
  );

  const matchingRateCandidates = candidates.flatMap((candidate) => {
    const regionName = readText(candidate.region_name);
    const value = readNumber(candidate.value);
    const valueKind = readText(candidate.value_kind);
    const unit = readText(candidate.unit);
    const standardization = readText(candidate.standardization);
    const measureCode = readText(candidate.measure_code);
    const measureLabel = readText(candidate.measure_label);
    const sourceUnitLabel = readText(candidate.source_unit_label);

    if (
      regionName === null ||
      value === null ||
      measureCode === null ||
      valueKind !== "rate" ||
      unit !== "per_100k_population" ||
      standardization !== "none"
    ) {
      return [];
    }

    return [
      {
        regionName,
        value,
        measureCode,
        measureLabel: measureLabel ?? "",
        sourceUnitLabel: sourceUnitLabel ?? "",
      },
    ];
  });

  const measureMap = new Map<
    string,
    {
      measureCode: string;
      measureLabel: string;
      sourceUnitLabel: string;
      rowCount: number;
      regionNames: Set<string>;
    }
  >();
  const regionCounts = new Map<string, number>();

  for (const candidate of matchingRateCandidates) {
    regionCounts.set(candidate.regionName, (regionCounts.get(candidate.regionName) ?? 0) + 1);

    const existingMeasure = measureMap.get(candidate.measureCode);

    if (existingMeasure) {
      existingMeasure.rowCount += 1;
      existingMeasure.regionNames.add(candidate.regionName);
      continue;
    }

    measureMap.set(candidate.measureCode, {
      measureCode: candidate.measureCode,
      measureLabel: candidate.measureLabel,
      sourceUnitLabel: candidate.sourceUnitLabel,
      rowCount: 1,
      regionNames: new Set([candidate.regionName]),
    });
  }

  return {
    candidates: matchingRateCandidates.sort((left, right) =>
      left.regionName.localeCompare(right.regionName, "da-DK"),
    ),
    candidateRegionNames: Array.from(new Set(matchingRateCandidates.map((candidate) => candidate.regionName))).sort(
      (left, right) => left.localeCompare(right, "da-DK"),
    ),
    duplicateRegionNames: Array.from(regionCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([regionName]) => regionName)
      .sort((left, right) => left.localeCompare(right, "da-DK")),
    measures: Array.from(measureMap.values())
      .map((measure) => ({
        measureCode: measure.measureCode,
        measureLabel: measure.measureLabel,
        sourceUnitLabel: measure.sourceUnitLabel,
        rowCount: measure.rowCount,
        distinctRegionCount: measure.regionNames.size,
      }))
      .sort((left, right) => left.measureCode.localeCompare(right.measureCode, "da-DK")),
  };
}

function readText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
