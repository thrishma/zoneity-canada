"use client";

import { useState, useEffect } from "react";

const BYLAW_TYPES = [
  { value: "zoning_bylaw", label: "Zoning By-law" },
  { value: "official_plan", label: "Official Plan" },
  { value: "parking_bylaw", label: "Parking By-law" },
  { value: "site_plan_bylaw", label: "Site Plan By-law" },
  { value: "other", label: "Other (describe in notes)" },
];

const PROVINCES = [
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
];

interface Municipality {
  id: string;
  name: string;
  province: string;
}

export default function SubmitForm() {
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [municipalityMode, setMunicipalityMode] = useState<"existing" | "new">("existing");

  // Form state
  const [municipalityId, setMunicipalityId] = useState("");
  const [newMunicipalityName, setNewMunicipalityName] = useState("");
  const [newProvince, setNewProvince] = useState("ON");
  const [bylawType, setBylawType] = useState("zoning_bylaw");
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [submitterName, setSubmitterName] = useState("");
  const [submitterEmail, setSubmitterEmail] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/bylaws/municipalities")
      .then((r) => r.json())
      .then((d: { municipalities?: Municipality[] }) =>
        setMunicipalities(d.municipalities ?? [])
      );
  }, []);

  const selectedMunicipality = municipalities.find((m) => m.id === municipalityId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const municipality_name =
      municipalityMode === "existing"
        ? selectedMunicipality?.name ?? ""
        : newMunicipalityName.trim();

    const province =
      municipalityMode === "existing"
        ? selectedMunicipality?.province ?? ""
        : newProvince;

    try {
      const res = await fetch("/api/bylaws/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          municipality_id: municipalityMode === "existing" ? municipalityId : null,
          municipality_name,
          province,
          bylaw_type: bylawType,
          title: title.trim(),
          source_url: sourceUrl.trim(),
          notes: notes.trim() || null,
          submitter_name: submitterName.trim() || null,
          submitter_email: submitterEmail.trim() || null,
        }),
      });

      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        setError(data.error ?? "Submission failed. Please try again.");
      } else {
        setSuccess(true);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center">
        <div className="text-2xl mb-3">Submitted</div>
        <p className="text-green-800 font-medium mb-1">Thank you for your contribution.</p>
        <p className="text-green-700 text-sm mb-4">
          Our team will review and ingest your submission. Once processed, the data will be
          available in search, compare, and the map.
        </p>
        <button
          onClick={() => {
            setSuccess(false);
            setTitle("");
            setSourceUrl("");
            setNotes("");
          }}
          className="text-sm text-green-700 underline"
        >
          Submit another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Municipality */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Municipality</label>
        <div className="flex gap-3 mb-3">
          <button
            type="button"
            onClick={() => setMunicipalityMode("existing")}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              municipalityMode === "existing"
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
            }`}
          >
            Already indexed
          </button>
          <button
            type="button"
            onClick={() => setMunicipalityMode("new")}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              municipalityMode === "new"
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
            }`}
          >
            New municipality
          </button>
        </div>

        {municipalityMode === "existing" ? (
          <select
            value={municipalityId}
            onChange={(e) => setMunicipalityId(e.target.value)}
            required
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
          >
            <option value="">Select a municipality…</option>
            {municipalities.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}, {m.province}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex gap-3">
            <input
              type="text"
              value={newMunicipalityName}
              onChange={(e) => setNewMunicipalityName(e.target.value)}
              placeholder="Municipality name (e.g. Peterborough)"
              required
              className="flex-1 border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
            <select
              value={newProvince}
              onChange={(e) => setNewProvince(e.target.value)}
              className="border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            >
              {PROVINCES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Document type */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Document type</label>
        <div className="flex flex-wrap gap-2">
          {BYLAW_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setBylawType(t.value)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                bylawType === t.value
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Title */}
      <div>
        <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
          Document title
        </label>
        <input
          id="title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. City of Peterborough Zoning By-law 1801"
          required
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
        />
      </div>

      {/* Source URL */}
      <div>
        <label htmlFor="source_url" className="block text-sm font-medium text-gray-700 mb-1">
          URL
          <span className="text-gray-400 font-normal ml-1">
            — direct PDF link or webpage where the bylaw is listed
          </span>
        </label>
        <input
          id="source_url"
          type="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://www.peterborough.ca/…/zoning-bylaw.pdf"
          required
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
        />
        <p className="mt-1 text-xs text-gray-400">
          Direct PDF links are preferred. If submitting a webpage, include the specific page where
          the bylaw PDF can be found.
        </p>
      </div>

      {/* Notes */}
      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
          Notes
          <span className="text-gray-400 font-normal ml-1">— optional</span>
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="e.g. This is the 2024 consolidated version. Section 7 covers R1 zone regulations. The PDF requires scrolling past the schedule maps to reach the text."
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 resize-none"
        />
      </div>

      {/* Attribution */}
      <div className="border-t border-gray-100 pt-5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Attribution (optional)
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="submitter_name" className="block text-xs text-gray-600 mb-1">
              Your name
            </label>
            <input
              id="submitter_name"
              type="text"
              value={submitterName}
              onChange={(e) => setSubmitterName(e.target.value)}
              placeholder="Jane Doe"
              className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
          </div>
          <div>
            <label htmlFor="submitter_email" className="block text-xs text-gray-600 mb-1">
              Email — to notify when ingested
            </label>
            <input
              id="submitter_email"
              type="email"
              value={submitterEmail}
              onChange={(e) => setSubmitterEmail(e.target.value)}
              placeholder="jane@example.com"
              className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-gray-900 text-white text-sm font-medium py-2.5 rounded hover:bg-gray-700 disabled:opacity-40 transition-colors"
      >
        {submitting ? "Submitting…" : "Submit for review"}
      </button>

      <p className="text-xs text-center text-gray-400">
        Submitted data will be reviewed before ingestion and published under{" "}
        <a href="https://creativecommons.org/licenses/by/4.0/" className="underline">
          CC BY 4.0
        </a>
        .
      </p>
    </form>
  );
}
