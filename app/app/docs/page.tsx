export const metadata = {
  title: "API Reference — Zoneity Canada",
  description: "Open REST API for Canadian municipal zoning data",
};

interface Endpoint {
  method: "GET" | "POST";
  path: string;
  description: string;
  params?: { name: string; required: boolean; description: string }[];
  example: string;
  response: string;
}

const BASE = "https://zoneitycanada.ca";

const endpoints: Endpoint[] = [
  {
    method: "GET",
    path: "/api/bylaws/search",
    description:
      "Semantic search across all ingested bylaw sections using natural language. Powered by OpenAI embeddings (text-embedding-3-small).",
    params: [
      { name: "q", required: true, description: "Natural language query" },
      { name: "municipality", required: false, description: "Filter by municipality ID (e.g. waterloo-on)" },
      { name: "type", required: false, description: "Filter by bylaw type: zoning_bylaw | official_plan | parking_bylaw" },
      { name: "limit", required: false, description: "Max results (default: 8, max: 20)" },
    ],
    example: `curl "${BASE}/api/bylaws/search?q=minimum+lot+size+residential&municipality=waterloo-on"`,
    response: `{
  "results": [
    {
      "id": "uuid",
      "municipality_id": "waterloo-on",
      "municipality_name": "Waterloo",
      "province": "ON",
      "bylaw_type": "zoning_bylaw",
      "section": "7.1.1",
      "title": "Residential One (R1) Zone",
      "text": "...",
      "page": 45,
      "similarity": 0.87
    }
  ]
}`,
  },
  {
    method: "GET",
    path: "/api/bylaws/municipalities",
    description: "List all indexed municipalities with document counts.",
    example: `curl "${BASE}/api/bylaws/municipalities"`,
    response: `{
  "municipalities": [
    {
      "id": "waterloo-on",
      "name": "Waterloo",
      "province": "ON",
      "population": 121436,
      "website": "https://www.waterloo.ca",
      "document_count": 2
    }
  ]
}`,
  },
  {
    method: "GET",
    path: "/api/bylaws/compare",
    description: "Side-by-side comparison of structured zoning metrics for up to 4 municipalities.",
    params: [
      { name: "id", required: true, description: "Municipality ID (repeat for multiple, max 4)" },
    ],
    example: `curl "${BASE}/api/bylaws/compare?id=waterloo-on&id=kitchener-on&id=thunder-bay-on"`,
    response: `{
  "metrics": [
    {
      "label": "Minimum Lot Size (Residential)",
      "metric_key": "min_lot_size_sqm",
      "description": "Smallest permitted residential lot in the base low-density zone (sqm)",
      "values": {
        "waterloo-on": "405",
        "kitchener-on": null,
        "thunder-bay-on": "300"
      }
    }
  ]
}`,
  },
  {
    method: "GET",
    path: "/api/bylaws/export",
    description:
      "Bulk export of all structured metrics and document index. Intended for researchers and data analysts. Licensed CC BY 4.0.",
    params: [
      { name: "format", required: false, description: "json (default) or csv" },
      { name: "province", required: false, description: "Filter by province code (e.g. ON)" },
      { name: "municipality", required: false, description: "Filter by municipality ID" },
    ],
    example: `curl "${BASE}/api/bylaws/export?format=csv&province=ON" -o zoning-data.csv`,
    response: `{
  "meta": {
    "generated_at": "2026-03-22T...",
    "license": "CC-BY-4.0",
    "source": "Zoneity Canada"
  },
  "municipalities": [ ... ],
  "metrics": [ ... ]
}`,
  },
  {
    method: "GET",
    path: "/api/bylaws/quality",
    description:
      "Data quality report: metric coverage per municipality, ingest status, and flags for human review.",
    example: `curl "${BASE}/api/bylaws/quality"`,
    response: `{
  "coverage": [
    {
      "municipality_id": "waterloo-on",
      "coverage_pct": "66.7",
      "missing_metrics": 2,
      "metric_values": {
        "min_lot_size_sqm": "405",
        "permits_secondary_suite": "Yes",
        "max_density_units_per_ha": "MISSING"
      }
    }
  ],
  "summary": {
    "total_municipalities": 3,
    "fully_covered": 0,
    "needs_review": 2
  }
}`,
  },
  {
    method: "POST",
    path: "/api/chat",
    description:
      "AI-powered Q&A over bylaw data using GPT-4o with tool calling. The model searches bylaws autonomously to answer your question with citations.",
    params: [
      { name: "question", required: true, description: "Your question in plain English" },
      { name: "municipalityId", required: false, description: "Constrain search to one municipality" },
    ],
    example: `curl -X POST "${BASE}/api/chat" \\
  -H "Content-Type: application/json" \\
  -d '{"question":"What is the minimum lot size for a single detached house in Waterloo?"}'`,
    response: `{
  "answer": "In Waterloo, the minimum lot area for a single detached house in the Residential One (R1) zone is 405 square metres for an interior lot... *(City of Waterloo, Zoning By-law 2018-050, s.7.1.2)*",
  "sources": [
    {
      "section": "7.1.2",
      "municipality": "Waterloo",
      "snippet": "Table 7A: Regulations – RESIDENTIAL ONE ZONE (R1)..."
    }
  ]
}`,
  },
];

const METRIC_KEYS = [
  { key: "min_lot_size_sqm", label: "Minimum lot area for low-density residential (sqm)" },
  { key: "max_height_residential_m", label: "Maximum building height in residential zones (m)" },
  { key: "min_parking_per_unit", label: "Minimum parking spaces per dwelling unit" },
  { key: "permits_secondary_suite", label: "Secondary suites permitted as-of-right (Yes/No)" },
  { key: "permits_multiplex", label: "Multiplexes (4+ units) permitted as-of-right (Yes/No)" },
  { key: "max_density_units_per_ha", label: "Maximum density in medium-density zones (units/ha)" },
];

export default function DocsPage() {
  return (
    <div className="max-w-4xl">
      <div className="mb-10">
        <h2 className="text-3xl font-bold tracking-tight mb-2">API Reference</h2>
        <p className="text-gray-500 max-w-2xl">
          Open REST API for Canadian municipal zoning data. All endpoints are publicly accessible with no
          authentication required. Data is licensed under{" "}
          <a href="https://creativecommons.org/licenses/by/4.0/" className="text-blue-600 underline">
            CC BY 4.0
          </a>
          .
        </p>
        <div className="mt-4 flex gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 ring-1 ring-green-600/20">
            No auth required
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-600/20">
            CORS enabled
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 ring-1 ring-purple-600/20">
            CC BY 4.0
          </span>
        </div>
      </div>

      {/* Base URL */}
      <div className="mb-10 rounded-lg bg-gray-900 px-5 py-4">
        <p className="text-xs text-gray-400 mb-1 uppercase tracking-wider">Base URL</p>
        <code className="text-sm text-green-400 font-mono">{BASE}</code>
      </div>

      {/* Structured metrics reference */}
      <div className="mb-12">
        <h3 className="text-lg font-semibold mb-3">Structured Metric Keys</h3>
        <p className="text-sm text-gray-500 mb-4">
          These keys appear in <code className="bg-gray-100 px-1 rounded">/compare</code> and{" "}
          <code className="bg-gray-100 px-1 rounded">/export</code> responses.
        </p>
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 font-medium text-gray-700">metric_key</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-700">Description</th>
              </tr>
            </thead>
            <tbody>
              {METRIC_KEYS.map((m, i) => (
                <tr key={m.key} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                  <td className="px-4 py-2.5">
                    <code className="text-xs font-mono text-blue-700">{m.key}</code>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{m.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Endpoints */}
      <div className="space-y-12">
        {endpoints.map((ep) => (
          <section key={ep.path} className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-3.5 bg-gray-50 border-b border-gray-200">
              <span
                className={`inline-block rounded px-2 py-0.5 text-xs font-bold font-mono ${
                  ep.method === "GET"
                    ? "bg-green-100 text-green-700"
                    : "bg-orange-100 text-orange-700"
                }`}
              >
                {ep.method}
              </span>
              <code className="text-sm font-mono font-medium text-gray-900">{ep.path}</code>
            </div>

            <div className="px-5 py-4 space-y-4">
              <p className="text-sm text-gray-600">{ep.description}</p>

              {ep.params && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Parameters
                  </p>
                  <div className="space-y-1.5">
                    {ep.params.map((p) => (
                      <div key={p.name} className="flex gap-3 text-sm">
                        <code className="shrink-0 text-xs font-mono text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                          {p.name}
                        </code>
                        <span className="text-gray-400 text-xs">{p.required ? "required" : "optional"}</span>
                        <span className="text-gray-600 text-xs">{p.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Example</p>
                <pre className="bg-gray-900 rounded-lg px-4 py-3 overflow-x-auto">
                  <code className="text-xs text-green-400 font-mono">{ep.example}</code>
                </pre>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Response
                </p>
                <pre className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 overflow-x-auto">
                  <code className="text-xs text-gray-700 font-mono">{ep.response}</code>
                </pre>
              </div>
            </div>
          </section>
        ))}
      </div>

      {/* Attribution */}
      <div className="mt-12 rounded-lg border border-gray-200 p-5 text-sm text-gray-500">
        <p className="font-medium text-gray-700 mb-1">Attribution</p>
        <p>
          When using this data, please cite: <em>Zoneity Canada, National Zoning &amp; Land Use Data Platform</em>.
          Data sourced from official municipal government websites and licensed CC BY 4.0.
        </p>
      </div>
    </div>
  );
}
