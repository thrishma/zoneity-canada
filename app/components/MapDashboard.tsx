"use client";

import { useEffect, useState } from "react";

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

// Ontario bounding box for coordinate-to-SVG projection
const ONTARIO_BOUNDS = {
  minLat: 41.6, maxLat: 56.9,
  minLng: -95.2, maxLng: -74.3,
};

function project(lat: number, lng: number, width: number, height: number): [number, number] {
  const x = ((lng - ONTARIO_BOUNDS.minLng) / (ONTARIO_BOUNDS.maxLng - ONTARIO_BOUNDS.minLng)) * width;
  const y = height - ((lat - ONTARIO_BOUNDS.minLat) / (ONTARIO_BOUNDS.maxLat - ONTARIO_BOUNDS.minLat)) * height;
  return [x, y];
}

function getColor(value: string | null | undefined, metricKey: string, allValues: (string | null)[]): string {
  if (!value || value === "MISSING") return "#e5e7eb"; // gray - no data

  const metric = METRICS.find((m) => m.key === metricKey);
  if (!metric) return "#e5e7eb";

  if (metric.type === "boolean") {
    return value.toLowerCase() === "yes" ? "#22c55e" : "#ef4444";
  }

  // Numeric — normalize to 0-1 across all values, color by restrictiveness
  const nums = allValues
    .filter((v): v is string => v !== null && v !== undefined && !isNaN(Number(v)))
    .map(Number);
  if (nums.length === 0) return "#94a3b8";

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (max === min) return "#3b82f6";

  const num = Number(value);
  const normalized = (num - min) / (max - min);

  // For lot size, density: higher = more permissive (green)
  // For parking: lower = more permissive (green)
  const permissive = metricKey === "min_parking_per_unit" ? 1 - normalized : normalized;

  if (permissive > 0.66) return "#22c55e";
  if (permissive > 0.33) return "#f59e0b";
  return "#ef4444";
}

export default function MapDashboard() {
  const [municipalities, setMunicipalities] = useState<MunicipalityMetrics[]>([]);
  const [selectedMetric, setSelectedMetric] = useState(METRICS[0].key);
  const [hovered, setHovered] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/bylaws/municipalities")
      .then((r) => r.json())
      .then(async (mData) => {
        const allIds: string[] = (mData.municipalities ?? []).map(
          (m: { id: string }) => m.id
        );

        // Fetch compare data for all municipalities (at least 2 needed)
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

  const W = 800;
  const H = 500;
  const allValues = municipalities.map((m) => m.metrics[selectedMetric] ?? null);
  const metric = METRICS.find((m) => m.key === selectedMetric)!;
  const hoveredMunicipality = hovered ? municipalities.find((m) => m.id === hovered) : null;

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
            {loading ? (
              <div className="h-80 flex items-center justify-center text-gray-400 text-sm">
                Loading map data...
              </div>
            ) : (
              <div className="relative">
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  className="w-full"
                  style={{ aspectRatio: `${W}/${H}` }}
                >
                  {/* Ontario outline (simplified rectangle background) */}
                  <rect width={W} height={H} fill="#f8fafc" />
                  {/* Great Lakes hint */}
                  <ellipse cx={620} cy={430} rx={80} ry={30} fill="#dbeafe" opacity={0.6} />
                  <text x={580} y={435} fontSize={9} fill="#93c5fd">Lake Superior</text>
                  <ellipse cx={700} cy={460} rx={50} ry={20} fill="#dbeafe" opacity={0.6} />
                  <text x={670} y={475} fontSize={9} fill="#93c5fd">L. Huron</text>

                  {/* Municipality dots */}
                  {municipalities.map((m) => {
                    if (!m.lat || !m.lng) return null;
                    const [x, y] = project(m.lat, m.lng, W, H);
                    const value = m.metrics[selectedMetric];
                    const color = getColor(value, selectedMetric, allValues);
                    const isHovered = hovered === m.id;
                    const r = isHovered ? 14 : 10;

                    return (
                      <g
                        key={m.id}
                        onMouseEnter={() => setHovered(m.id)}
                        onMouseLeave={() => setHovered(null)}
                        style={{ cursor: "pointer" }}
                      >
                        <circle cx={x} cy={y} r={r + 3} fill="white" opacity={0.7} />
                        <circle cx={x} cy={y} r={r} fill={color} stroke="white" strokeWidth={2} />
                        {isHovered && (
                          <text
                            x={x}
                            y={y - r - 5}
                            fontSize={11}
                            textAnchor="middle"
                            fill="#111827"
                            fontWeight={600}
                          >
                            {m.name}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>

                {/* Legend */}
                <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg p-3">
                  <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Legend</p>
                  {metric.type === "boolean" ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <span className="w-3 h-3 rounded-full bg-green-500 shrink-0" /> Yes / Permitted
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <span className="w-3 h-3 rounded-full bg-red-500 shrink-0" /> No / Restricted
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <span className="w-3 h-3 rounded-full bg-gray-200 shrink-0" /> No data
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
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
                        <span className="w-3 h-3 rounded-full bg-gray-200 shrink-0" /> No data
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Municipality details panel */}
        <div className="space-y-4">
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
                        <span
                          className={`font-medium shrink-0 ${
                            val ? "text-gray-900" : "text-gray-300"
                          }`}
                        >
                          {val ? `${val}${m.unit ? ` ${m.unit}` : ""}` : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 mt-4 text-center">
                Hover over a dot to see details
              </p>
            )}
          </div>

          {/* All municipalities table */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-700">All Municipalities</p>
            </div>
            <div className="divide-y divide-gray-100">
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
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="flex-1 text-gray-700">{m.name}</span>
                      <span className="text-gray-400 text-xs">
                        {value
                          ? `${value}${metric.unit ? ` ${metric.unit}` : ""}`
                          : "No data"}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Data completeness banner */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <strong>Data note:</strong> This map shows {municipalities.length} municipalities with indexed bylaws.
        Metrics marked "No data" indicate the relevant regulation was not found in the ingested sections —
        the bylaw may use different terminology or structure. View the{" "}
        <a href="/api/bylaws/quality" className="underline">
          quality API
        </a>{" "}
        for full coverage details.
      </div>
    </div>
  );
}
