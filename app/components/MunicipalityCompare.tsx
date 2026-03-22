"use client";

import { useState, useEffect } from "react";
import type { Municipality, ComparisonMetric } from "@/types";

const DEFAULT_MUNICIPALITIES = ["waterloo-on", "kitchener-on"];

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
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          Select municipalities to compare (max 4):
        </h3>
        <div className="flex flex-wrap gap-2">
          {municipalities.map((m) => (
            <button
              key={m.id}
              onClick={() => toggleMunicipality(m.id)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                selected.includes(m.id)
                  ? "bg-gray-900 text-white"
                  : "bg-white border border-gray-200 text-gray-600 hover:border-gray-400"
              }`}
            >
              {m.name}, {m.province}
            </button>
          ))}
          {municipalities.length === 0 && (
            <p className="text-sm text-gray-400">Loading municipalities...</p>
          )}
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 rounded px-3 py-2 mb-4">{error}</div>
      )}

      {loading && (
        <div className="text-sm text-gray-400 py-8 text-center">Loading comparison...</div>
      )}

      {metrics && !loading && selected.length >= 2 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 pr-6 font-semibold text-gray-700 w-64">Metric</th>
                {selectedMunicipalities.map((m) => (
                  <th key={m.id} className="text-left py-3 px-4 font-semibold text-gray-700">
                    {m.name}
                    <span className="block text-xs font-normal text-gray-400">{m.province}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric, i) => (
                <tr
                  key={metric.label}
                  className={`border-b border-gray-50 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}
                >
                  <td className="py-3 pr-6">
                    <p className="font-medium text-gray-800">{metric.label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{metric.description}</p>
                  </td>
                  {selectedMunicipalities.map((m) => {
                    const value = metric.values[m.id];
                    return (
                      <td key={m.id} className="py-3 px-4">
                        {value != null ? (
                          <span className="font-medium text-gray-900">{value}</span>
                        ) : (
                          <span className="text-gray-300 text-xs">Not indexed</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected.length < 2 && !loading && (
        <p className="text-sm text-gray-400 py-8 text-center">
          Select at least 2 municipalities to see a comparison.
        </p>
      )}
    </div>
  );
}
