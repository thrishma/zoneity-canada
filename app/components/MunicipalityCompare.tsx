"use client";

import { useState, useEffect } from "react";
import type { Municipality, ComparisonMetric } from "@/types";

const DEFAULT_MUNICIPALITIES = ["thunder-bay-on", "waterloo-on"];

function ValueCell({ value, metricKey }: { value: string | null | undefined; metricKey: string }) {
  if (value == null) {
    return <span className="text-xs text-gray-300 italic">No data</span>;
  }

  const lower = value.toLowerCase();
  const isBoolean = lower === "yes" || lower === "no";

  if (isBoolean) {
    return lower === "yes" ? (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-50 border border-green-100 px-2.5 py-1 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        Yes
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 bg-red-50 border border-red-100 px-2.5 py-1 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        No
      </span>
    );
  }

  // Parking: lower = better (more permissive)
  const isLowerBetter = metricKey === "min_parking_per_unit" || metricKey === "min_lot_size_sqm";
  void isLowerBetter; // used for future color coding

  return <span className="text-sm font-semibold text-gray-900">{value}</span>;
}

export default function MunicipalityCompare() {
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [selected, setSelected] = useState<string[]>(DEFAULT_MUNICIPALITIES);
  const [metrics, setMetrics] = useState<ComparisonMetric[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/bylaws/municipalities")
      .then((r) => r.json())
      .then((d: { municipalities?: Municipality[] }) => setMunicipalities(d.municipalities ?? []))
      .catch(() => setError("Failed to load municipalities"));
  }, []);

  useEffect(() => {
    if (selected.length < 2) { setMetrics(null); return; }
    setLoading(true);
    setError(null);
    const params = selected.map((id) => `id=${encodeURIComponent(id)}`).join("&");
    fetch(`/api/bylaws/compare?${params}`)
      .then((r) => r.json())
      .then((d: { metrics?: ComparisonMetric[]; error?: string }) => {
        if (d.error) throw new Error(d.error);
        setMetrics(d.metrics ?? []);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Comparison failed"))
      .finally(() => setLoading(false));
  }, [selected]);

  const selectedMunicipalities = municipalities.filter((m) => selected.includes(m.id));

  function toggleMunicipality(id: string) {
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < 4
        ? [...prev, id]
        : prev
    );
  }

  return (
    <div>
      {/* Municipality selector */}
      <div className="mb-6">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          Select up to 4 municipalities
        </p>
        <div className="flex flex-wrap gap-2">
          {municipalities.map((m) => (
            <button
              key={m.id}
              onClick={() => toggleMunicipality(m.id)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-all ${
                selected.includes(m.id)
                  ? "bg-gray-900 text-white border-gray-900 shadow-sm"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-400 hover:text-gray-800"
              }`}
            >
              {m.name}
              <span className={`ml-1.5 text-xs font-normal ${selected.includes(m.id) ? "text-gray-400" : "text-gray-400"}`}>
                {m.province}
              </span>
            </button>
          ))}
          {municipalities.length === 0 && (
            <p className="text-sm text-gray-400">Loading municipalities...</p>
          )}
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {loading && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <div className="inline-flex gap-1 mb-2">
            <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
          <p className="text-sm text-gray-400">Loading comparison...</p>
        </div>
      )}

      {metrics && !loading && selected.length >= 2 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-5 py-3.5 font-semibold text-gray-600 w-60">Metric</th>
                  {selectedMunicipalities.map((m) => (
                    <th key={m.id} className="text-left px-5 py-3.5 font-semibold text-gray-900">
                      {m.name}
                      <span className="block text-xs font-normal text-gray-400 mt-0.5">{m.province}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {metrics.map((metric) => (
                  <tr key={metric.metric_key} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4">
                      <p className="font-medium text-gray-800 text-sm">{metric.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5 leading-snug">{metric.description}</p>
                    </td>
                    {selectedMunicipalities.map((m) => (
                      <td key={m.id} className="px-5 py-4">
                        <ValueCell value={metric.values[m.id]} metricKey={metric.metric_key} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected.length < 2 && !loading && (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
          <p className="text-sm text-gray-400">Select at least 2 municipalities to see a comparison.</p>
        </div>
      )}
    </div>
  );
}
