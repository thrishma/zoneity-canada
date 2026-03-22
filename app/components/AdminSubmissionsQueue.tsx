"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface Submission {
  id: string;
  municipality_name: string;
  province: string;
  bylaw_type: string;
  title: string;
  source_url: string;
  notes: string | null;
  submitter_name: string | null;
  submitter_email: string | null;
  status: "pending" | "reviewed" | "ingesting" | "ingested" | "rejected";
  review_notes: string | null;
  reviewed_at: string | null;
  ingested_at: string | null;
  created_at: string;
}

const STATUS_BADGE: Record<Submission["status"], string> = {
  pending:   "bg-yellow-100 text-yellow-800",
  reviewed:  "bg-blue-100 text-blue-800",
  ingesting: "bg-purple-100 text-purple-800",
  ingested:  "bg-green-100 text-green-800",
  rejected:  "bg-red-100 text-red-800",
};

const BYLAW_TYPE_LABELS: Record<string, string> = {
  zoning_bylaw:   "Zoning",
  official_plan:  "Official Plan",
  parking_bylaw:  "Parking",
  site_plan_bylaw:"Site Plan",
  other:          "Other",
};

interface Props {
  adminSecret: string;
}

export default function AdminSubmissionsQueue({ adminSecret }: Props) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [actionState, setActionState] = useState<Record<string, string>>({}); // id → action label
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");

  // IDs currently being polled (ingesting)
  const pollingRef = useRef<Set<string>>(new Set());

  const headers = { "x-admin-secret": adminSecret };

  const fetchSubmissions = useCallback(async () => {
    const qs = statusFilter !== "all" ? `?status=${statusFilter}` : "";
    const res = await fetch(`/api/admin/submissions${qs}`, { headers });
    if (!res.ok) {
      setError("Failed to load submissions");
      return;
    }
    const data = await res.json() as { submissions: Submission[] };
    setSubmissions(data.submissions);
    setLoading(false);
  }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoading(true);
    fetchSubmissions();
  }, [fetchSubmissions]);

  // Poll ingesting submissions every 5s
  const pollStatus = useCallback(async (id: string) => {
    const res = await fetch(`/api/admin/submissions/${id}`, { headers });
    if (!res.ok) return;
    const data = await res.json() as { submission: Submission };
    const { status } = data.submission;
    if (status !== "ingesting") {
      pollingRef.current.delete(id);
      setSubmissions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status } : s))
      );
    }
  }, []); // eslint-disable-line react-hooks/exhaustive_deps

  useEffect(() => {
    const ingestingIds = submissions
      .filter((s) => s.status === "ingesting")
      .map((s) => s.id);

    ingestingIds.forEach((id) => {
      if (!pollingRef.current.has(id)) {
        pollingRef.current.add(id);
        const interval = setInterval(() => {
          if (!pollingRef.current.has(id)) {
            clearInterval(interval);
            return;
          }
          pollStatus(id);
        }, 5000);
      }
    });
  }, [submissions, pollStatus]);

  async function handleApprove(id: string) {
    setActionState((s) => ({ ...s, [id]: "Approving…" }));
    const res = await fetch(`/api/admin/submissions/${id}/approve`, {
      method: "POST",
      headers,
    });
    if (res.ok) {
      setSubmissions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: "reviewed" } : s))
      );
    } else {
      const d = await res.json() as { error?: string };
      alert(d.error ?? "Approve failed");
    }
    setActionState((s) => { const n = { ...s }; delete n[id]; return n; });
  }

  async function handleReject(id: string) {
    setActionState((s) => ({ ...s, [id]: "Rejecting…" }));
    const res = await fetch(`/api/admin/submissions/${id}/reject`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ review_notes: rejectNotes }),
    });
    if (res.ok) {
      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, status: "rejected", review_notes: rejectNotes } : s
        )
      );
      setRejectingId(null);
      setRejectNotes("");
    } else {
      const d = await res.json() as { error?: string };
      alert(d.error ?? "Reject failed");
    }
    setActionState((s) => { const n = { ...s }; delete n[id]; return n; });
  }

  async function handleIngest(id: string) {
    setActionState((s) => ({ ...s, [id]: "Starting…" }));
    const res = await fetch(`/api/admin/submissions/${id}/ingest`, {
      method: "POST",
      headers,
    });
    const d = await res.json() as { message?: string; error?: string };
    if (res.ok || res.status === 202) {
      setSubmissions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: "ingesting" } : s))
      );
    } else {
      alert(d.error ?? "Ingest failed");
    }
    setActionState((s) => { const n = { ...s }; delete n[id]; return n; });
  }

  const FILTERS = ["pending", "reviewed", "ingesting", "ingested", "rejected", "all"];

  if (loading) {
    return <p className="text-gray-500 text-sm">Loading submissions…</p>;
  }

  if (error) {
    return <p className="text-red-600 text-sm">{error}</p>;
  }

  return (
    <div>
      {/* Filter tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors capitalize ${
              statusFilter === f
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
            }`}
          >
            {f}
          </button>
        ))}
        <button
          onClick={fetchSubmissions}
          className="ml-auto px-3 py-1.5 rounded-full text-sm border border-gray-200 text-gray-500 hover:border-gray-400"
        >
          Refresh
        </button>
      </div>

      {submissions.length === 0 && (
        <p className="text-gray-500 text-sm">No submissions in this category.</p>
      )}

      <div className="space-y-4">
        {submissions.map((sub) => (
          <div
            key={sub.id}
            className="border border-gray-200 rounded-lg p-5 bg-white"
          >
            {/* Header row */}
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-semibold ${STATUS_BADGE[sub.status]}`}
                  >
                    {sub.status}
                  </span>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                    {BYLAW_TYPE_LABELS[sub.bylaw_type] ?? sub.bylaw_type}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(sub.created_at).toLocaleDateString("en-CA")}
                  </span>
                </div>
                <h3 className="font-semibold text-gray-900 truncate">{sub.title}</h3>
                <p className="text-sm text-gray-500">
                  {sub.municipality_name}, {sub.province}
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 shrink-0">
                {sub.status === "pending" && (
                  <>
                    <button
                      onClick={() => handleApprove(sub.id)}
                      disabled={!!actionState[sub.id]}
                      className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
                    >
                      {actionState[sub.id] === "Approving…" ? "Approving…" : "Approve"}
                    </button>
                    <button
                      onClick={() => { setRejectingId(sub.id); setRejectNotes(""); }}
                      className="px-3 py-1.5 text-sm rounded border border-red-200 text-red-600 hover:bg-red-50"
                    >
                      Reject
                    </button>
                  </>
                )}
                {sub.status === "reviewed" && (
                  <>
                    <button
                      onClick={() => handleIngest(sub.id)}
                      disabled={!!actionState[sub.id]}
                      className="px-3 py-1.5 text-sm rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-40"
                    >
                      {actionState[sub.id] ?? "Approve & Ingest"}
                    </button>
                    <button
                      onClick={() => { setRejectingId(sub.id); setRejectNotes(""); }}
                      className="px-3 py-1.5 text-sm rounded border border-red-200 text-red-600 hover:bg-red-50"
                    >
                      Reject
                    </button>
                  </>
                )}
                {sub.status === "ingesting" && (
                  <span className="text-sm text-purple-600 font-medium animate-pulse">
                    Ingesting…
                  </span>
                )}
                {sub.status === "ingested" && (
                  <span className="text-sm text-green-600 font-medium">Ingested</span>
                )}
              </div>
            </div>

            {/* URL */}
            <a
              href={sub.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline truncate block mb-2"
            >
              {sub.source_url}
            </a>

            {/* Notes */}
            {sub.notes && (
              <p className="text-xs text-gray-500 mb-2 italic">{sub.notes}</p>
            )}

            {/* Submitter */}
            {(sub.submitter_name || sub.submitter_email) && (
              <p className="text-xs text-gray-400">
                Submitted by {sub.submitter_name ?? ""}
                {sub.submitter_email ? ` &lt;${sub.submitter_email}&gt;` : ""}
              </p>
            )}

            {/* Reject reason */}
            {sub.review_notes && (
              <p className="text-xs text-red-600 mt-1">Reason: {sub.review_notes}</p>
            )}

            {/* Inline reject form */}
            {rejectingId === sub.id && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <textarea
                  value={rejectNotes}
                  onChange={(e) => setRejectNotes(e.target.value)}
                  placeholder="Rejection reason (optional)"
                  rows={2}
                  className="w-full text-sm border border-gray-200 rounded px-3 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-gray-300 resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleReject(sub.id)}
                    disabled={!!actionState[sub.id]}
                    className="px-3 py-1.5 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-40"
                  >
                    {actionState[sub.id] === "Rejecting…" ? "Rejecting…" : "Confirm Reject"}
                  </button>
                  <button
                    onClick={() => setRejectingId(null)}
                    className="px-3 py-1.5 text-sm rounded border border-gray-200 text-gray-500 hover:border-gray-400"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
