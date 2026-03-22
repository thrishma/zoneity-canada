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
  { key: "min_lot_size_sqm", label: "Min Lot Size", unit: "sqm", type: "numeric" as const },
  { key: "max_height_residential_m", label: "Max Height", unit: "m", type: "numeric" as const },
  { key: "min_parking_per_unit", label: "Parking / Unit", unit: "spaces", type: "numeric" as const },
  { key: "permits_secondary_suite", label: "Secondary Suites", unit: "", type: "boolean" as const },
  { key: "permits_multiplex", label: "Multiplexes", unit: "", type: "boolean" as const },
  { key: "max_density_units_per_ha", label: "Max Density", unit: "u/ha", type: "numeric" as const },
];

function getColor(value: string | null | undefined, metricKey: string, allValues: (string | null)[]): string {
  if (!value || value === "MISSING") return "#d1d5db";

  const metric = METRICS.find((m) => m.key === metricKey);
  if (!metric) return "#d1d5db";

  if (metric.type === "boolean") {
    return value.toLowerCase() === "yes" ? "#16a34a" : "#dc2626";
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

  if (permissive > 0.66) return "#16a34a";
  if (permissive > 0.33) return "#f59e0b";
  return "#dc2626";
}

const LeafletMap = dynamic(() => import("./LeafletMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center text-gray-400 text-sm bg-gray-50">
      Loading map...
    </div>
  ),
});

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
    <div className="space-y-5">
      {/* Metric selector */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          Visualise metric
        </p>
        <div className="flex flex-wrap gap-2">
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setSelectedMetric(m.key)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-all ${
                selectedMetric === m.key
                  ? "bg-gray-900 text-white border-gray-900 shadow-sm"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-400 hover:text-gray-800"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Map */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-800">Ontario</p>
              <p className="text-xs text-gray-400 mt-0.5">{metric.label}</p>
            </div>
            <span className="text-xs text-gray-400">{municipalities.length} municipalities</span>
          </div>
          <div className="h-[520px]">
            {loading ? (
              <div className="h-full flex items-center justify-center text-sm text-gray-400 bg-gray-50">
                Loading map data...
              </div>
            ) : (
              <LeafletMap markers={markersData} hoveredId={hovered} onHover={setHovered} />
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Legend */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Legend</p>
            {metric.type === "boolean" ? (
              <div className="space-y-2">
                {[
                  { color: "bg-green-600", label: "Permitted" },
                  { color: "bg-red-600", label: "Not permitted" },
                  { color: "bg-gray-300", label: "No data" },
                ].map(({ color, label }) => (
                  <div key={label} className="flex items-center gap-2.5 text-sm text-gray-600">
                    <span className={`w-3 h-3 rounded-full shrink-0 ${color}`} />
                    {label}
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {[
                  { color: "bg-green-600", label: "More permissive" },
                  { color: "bg-amber-400", label: "Moderate" },
                  { color: "bg-red-600", label: "More restrictive" },
                  { color: "bg-gray-300", label: "No data" },
                ].map(({ color, label }) => (
                  <div key={label} className="flex items-center gap-2.5 text-sm text-gray-600">
                    <span className={`w-3 h-3 rounded-full shrink-0 ${color}`} />
                    {label}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Detail card */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm min-h-[160px]">
            {hoveredMunicipality ? (
              <div>
                <div className="flex items-baseline gap-2 mb-1">
                  <h3 className="font-bold text-gray-900">{hoveredMunicipality.name}</h3>
                  <span className="text-xs text-gray-400 font-medium">{hoveredMunicipality.province}</span>
                </div>
                {hoveredMunicipality.population && (
                  <p className="text-xs text-gray-400 mb-3">
                    Pop. {hoveredMunicipality.population.toLocaleString()}
                  </p>
                )}
                <div className="space-y-2">
                  {METRICS.map((m) => {
                    const val = hoveredMunicipality.metrics[m.key];
                    return (
                      <div key={m.key} className="flex justify-between items-center text-xs">
                        <span className="text-gray-500">{m.label}</span>
                        <span className={`font-semibold ${val ? "text-gray-900" : "text-gray-300"}`}>
                          {val ? `${val}${m.unit ? ` ${m.unit}` : ""}` : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center">
                <p className="text-sm text-gray-400 text-center">
                  Hover a marker to see details
                </p>
              </div>
            )}
          </div>

          {/* Municipality list */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">All Municipalities</p>
            </div>
            <div className="divide-y divide-gray-50 max-h-56 overflow-y-auto">
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
                        hovered === m.id ? "bg-gray-50" : "hover:bg-gray-50"
                      }`}
                    >
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <span className="flex-1 text-gray-700 font-medium">{m.name}</span>
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
    </div>
  );
}
