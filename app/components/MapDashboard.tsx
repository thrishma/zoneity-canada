"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

interface MunicipalityMetrics {
  id: string;
  name: string;
  province: string;
  population: number | null;
  metrics: Record<string, string | null>;
  lat?: number;
  lng?: number;
}

const METRICS = [
  { key: "min_lot_size_sqm", label: "Min Lot Size (sqm)", unit: "sqm", type: "numeric" as const },
  { key: "max_height_residential_m", label: "Max Building Height (m)", unit: "m", type: "numeric" as const },
  { key: "min_parking_per_unit", label: "Min Parking / Unit", unit: "spaces", type: "numeric" as const },
  { key: "permits_secondary_suite", label: "Secondary Suites", unit: "", type: "boolean" as const },
  { key: "permits_multiplex", label: "Multiplexes Permitted", unit: "", type: "boolean" as const },
  { key: "max_density_units_per_ha", label: "Max Density (units/ha)", unit: "u/ha", type: "numeric" as const },
];

function getColor(value: string | null | undefined, metricKey: string, allValues: (string | null)[]): string {
  if (!value || value === "MISSING") return "#9ca3af"; // gray-400

  const metric = METRICS.find((m) => m.key === metricKey);
  if (!metric) return "#9ca3af";

  if (metric.type === "boolean") {
    return value.toLowerCase() === "yes" ? "#22c55e" : "#ef4444";
  }

  const nums = allValues
    .filter((v): v is string => v !== null && v !== undefined && v !== "MISSING" && !isNaN(Number(v)))
    .map(Number);
  if (nums.length === 0) return "#3b82f6";

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (max === min) return "#3b82f6";

  const num = Number(value);
  const normalized = (num - min) / (max - min);
  const permissive = metricKey === "min_parking_per_unit" ? 1 - normalized : normalized;

  if (permissive > 0.66) return "#22c55e";
  if (permissive > 0.33) return "#f59e0b";
  return "#ef4444";
}

// Dynamically import the Leaflet map to avoid SSR issues
const LeafletMap = dynamic(() => import("./LeafletMap"), { ssr: false, loading: () => (
  <div className="h-full flex items-center justify-center text-gray-400 text-sm bg-gray-50">
    Loading map...
  </div>
)});

export default function MapDashboard() {
  const [municipalities, setMunicipalities] = useState<MunicipalityMetrics[]>([]);
  const [selectedMetric, setSelectedMetric] = useState(METRICS[0].key);
  const [hovered, setHovered] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/bylaws/municipalities")
      .then((r) => r.json())
      .then(async (mData) => {
        const allIds: string[] = (mData.municipalities ?? []).map((m: { id: string }) => m.id);
        const metricsMap: Record<string, Record<string, string | null>> = {};
        for (const m of mData.municipalities ?? []) metricsMap[m.id] = {};

        if (allIds.length >= 2) {
          const qs = allIds.map((id) => `id=${encodeURIComponent(id)}`).join("&");
          const cData = await fetch(`/api/bylaws/compare?${qs}`).then((r) => r.json());
          for (const metric of cData.metrics ?? []) {
            for (const [mId, val] of Object.entries(metric.values ?? {})) {
              if (!metricsMap[mId]) metricsMap[mId] = {};
              metricsMap[mId][metric.metric_key] = val as string | null;
            }
          }
        }

        const result: MunicipalityMetrics[] = (mData.municipalities ?? []).map(
          (m: { id: string; name: string; province: string; population: number; lat?: number; lng?: number }) => ({
            ...m,
            metrics: metricsMap[m.id] ?? {},
          })
        );
        setMunicipalities(result);
        setLoading(false);
      });
  }, []);

  const allValues = municipalities.map((m) => m.metrics[selectedMetric] ?? null);
  const metric = METRICS.find((m) => m.key === selectedMetric)!;
  const hoveredMunicipality = hovered ? municipalities.find((m) => m.id === hovered) : null;

  const markersData = municipalities
    .filter((m) => m.lat && m.lng)
    .map((m) => ({
      id: m.id,
      name: m.name,
      lat: m.lat!,
      lng: m.lng!,
      color: getColor(m.metrics[selectedMetric], selectedMetric, allValues),
      value: m.metrics[selectedMetric] ?? null,
      metricUnit: metric.unit,
    }));

  return (
    <div className="space-y-6">
      {/* Metric selector */}
      <div className="flex flex-wrap gap-2">
        {METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => setSelectedMetric(m.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedMetric === m.key
                ? "bg-gray-900 text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:border-gray-400"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Map */}
        <div className="lg:col-span-2">
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-700">
                Ontario — <span className="text-gray-500">{metric.label}</span>
              </p>
            </div>
            <div className="h-[500px]">
              {loading ? (
                <div className="h-full flex items-center justify-center text-gray-400 text-sm bg-gray-50">
                  Loading map data...
                </div>
              ) : (
                <LeafletMap
                  markers={markersData}
                  hoveredId={hovered}
                  onHover={setHovered}
                />
              )}
            </div>
          </div>
        </div>

        {/* Details panel */}
        <div className="space-y-4">
          {/* Legend */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Legend</p>
            {metric.type === "boolean" ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <span className="w-3 h-3 rounded-full bg-green-500 shrink-0" /> Yes / Permitted
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <span className="w-3 h-3 rounded-full bg-red-500 shrink-0" /> No / Restricted
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <span className="w-3 h-3 rounded-full bg-gray-400 shrink-0" /> No data
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <span className="w-3 h-3 rounded-full bg-green-500 shrink-0" /> More permissive
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <span className="w-3 h-3 rounded-full bg-amber-400 shrink-0" /> Moderate
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <span className="w-3 h-3 rounded-full bg-red-500 shrink-0" /> More restrictive
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <span className="w-3 h-3 rounded-full bg-gray-400 shrink-0" /> No data
                </div>
              </div>
            )}
          </div>

          {/* Hover card */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 min-h-36">
            {hoveredMunicipality ? (
              <div>
                <div className="flex items-baseline gap-2 mb-3">
                  <h3 className="font-semibold text-gray-900">{hoveredMunicipality.name}</h3>
                  <span className="text-xs text-gray-400">{hoveredMunicipality.province}</span>
                </div>
                {hoveredMunicipality.population && (
                  <p className="text-xs text-gray-500 mb-3">
                    Pop. {hoveredMunicipality.population.toLocaleString()}
                  </p>
                )}
                <div className="space-y-2">
                  {METRICS.map((m) => {
                    const val = hoveredMunicipality.metrics[m.key];
                    return (
                      <div key={m.key} className="flex justify-between items-center text-xs">
                        <span className="text-gray-500 truncate pr-2">{m.label}</span>
                        <span className={`font-medium shrink-0 ${val ? "text-gray-900" : "text-gray-300"}`}>
                          {val ? `${val}${m.unit ? ` ${m.unit}` : ""}` : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 mt-4 text-center">
                Click or hover a marker to see details
              </p>
            )}
          </div>

          {/* Municipality list */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-700">All Municipalities</p>
            </div>
            <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
              {loading ? (
                <p className="px-4 py-3 text-sm text-gray-400">Loading...</p>
              ) : (
                municipalities.map((m) => {
                  const value = m.metrics[selectedMetric];
                  const color = getColor(value, selectedMetric, allValues);
                  return (
                    <div
                      key={m.id}
                      onMouseEnter={() => setHovered(m.id)}
                      onMouseLeave={() => setHovered(null)}
                      className={`flex items-center gap-3 px-4 py-2.5 text-sm cursor-pointer transition-colors ${
                        hovered === m.id ? "bg-gray-50" : ""
                      }`}
                    >
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <span className="flex-1 text-gray-700">{m.name}</span>
                      <span className="text-gray-400 text-xs">
                        {value ? `${value}${metric.unit ? ` ${metric.unit}` : ""}` : "No data"}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Data note */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <strong>Data note:</strong> This map shows {municipalities.length} municipalities with indexed bylaws.
        Metrics marked &ldquo;No data&rdquo; indicate the relevant regulation was not found in the ingested sections —
        the bylaw may use different terminology or structure. View the{" "}
        <a href="/api/bylaws/quality" className="underline">quality API</a> for full coverage details.
      </div>
    </div>
  );
}
