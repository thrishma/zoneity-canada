import type { BylawSearchResult, BylawSection } from "@/types";

export function formatBylawCitation(
  r: Pick<BylawSearchResult, "municipality_name" | "bylaw_type" | "section" | "page">
): string {
  const parts: string[] = [r.municipality_name];
  if (r.bylaw_type === "zoning_bylaw") parts.push("Zoning By-law");
  else if (r.bylaw_type === "official_plan") parts.push("Official Plan");
  else if (r.bylaw_type === "parking_bylaw") parts.push("Parking By-law");
  if (r.section) parts.push(`s.${r.section}`);
  if (r.page != null) parts.push(`p.${r.page}`);
  return parts.join(", ");
}

export function bylawTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    zoning_bylaw: "Zoning By-law",
    official_plan: "Official Plan",
    parking_bylaw: "Parking By-law",
    site_plan_bylaw: "Site Plan By-law",
    other: "By-law",
  };
  return labels[type] ?? "By-law";
}

export function sectionIdForResult(r: BylawSearchResult | BylawSection): string {
  const chapter = "chapter" in r ? r.chapter : null;
  const key = `${r.municipality_id}::${chapter ?? -1}`;
  return `bylaw-ch-${encodeURIComponent(key)}`;
}
