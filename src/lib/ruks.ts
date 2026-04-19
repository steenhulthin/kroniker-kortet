export type RuksValue = {
  year: number;
  value: number;
};

export type RuksSeries = {
  disease: string;
  measure_code: string;
  measure_label: string;
  value_kind: "count" | "rate" | string;
  unit: string;
  standardization: string;
  values: RuksValue[];
};

export type RuksSummary = {
  workbook_title: string;
  source_release_date: string;
  release_tag: string;
  source_row_count?: number;
  observation_count?: number;
  diseases: string[];
  series: RuksSeries[];
};

export type DiseaseSnapshot = {
  disease: string;
  latestYear: number;
  latestValue: number;
  previousValue: number | null;
  delta: number | null;
  valueKind: string;
  unit: string;
};

export const DEFAULT_SUMMARY_URL =
  import.meta.env.VITE_RUKS_SUMMARY_URL ?? "/data/latest-summary.json";

export async function loadRuksSummary(
  input: RequestInfo | URL = DEFAULT_SUMMARY_URL,
): Promise<RuksSummary> {
  const response = await fetch(input);
  if (!response.ok) {
    throw new Error(`Unable to load RUKS summary: ${response.status}`);
  }

  const data = (await response.json()) as RuksSummary;

  if (!Array.isArray(data.diseases) || !Array.isArray(data.series)) {
    throw new Error("RUKS summary payload is missing required arrays.");
  }

  return data;
}

export function getLatestYear(summary: RuksSummary): number | null {
  const years = summary.series.flatMap((series) =>
    series.values.map((value) => value.year),
  );

  return years.length === 0 ? null : Math.max(...years);
}

export function getDiseaseSnapshots(summary: RuksSummary): DiseaseSnapshot[] {
  return summary.diseases
    .map((disease) => {
      const preferredSeries = summary.series.find(
        (series) =>
          series.disease === disease &&
          series.measure_code === "incidence" &&
          series.value_kind === "count",
      );

      if (!preferredSeries || preferredSeries.values.length === 0) {
        return null;
      }

      const values = [...preferredSeries.values].sort((left, right) => left.year - right.year);
      const latest = values.at(-1)!;
      const previous = values.at(-2) ?? null;

      return {
        disease,
        latestYear: latest.year,
        latestValue: latest.value,
        previousValue: previous?.value ?? null,
        delta: previous ? latest.value - previous.value : null,
        valueKind: preferredSeries.value_kind,
        unit: preferredSeries.unit,
      };
    })
    .filter((value): value is DiseaseSnapshot => value !== null);
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("da-DK", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDelta(value: number | null): string {
  if (value === null) {
    return "No comparison yet";
  }

  const prefix = value > 0 ? "+" : "";
  return `${prefix}${new Intl.NumberFormat("da-DK", {
    maximumFractionDigits: 0,
  }).format(value)}`;
}

