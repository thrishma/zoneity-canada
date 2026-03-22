"use client";

import { useState } from "react";
import AdminSubmissionsQueue from "./AdminSubmissionsQueue";

export default function AdminLoginGate() {
  const [input, setInput] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    setError(null);

    // Verify secret by hitting the admin list endpoint
    const res = await fetch("/api/admin/submissions?limit=1", {
      headers: { "x-admin-secret": input },
    });

    if (res.ok) {
      setSecret(input);
    } else if (res.status === 401) {
      setError("Invalid admin secret.");
    } else {
      setError("Could not connect to server.");
    }
    setChecking(false);
  }

  if (secret) {
    return <AdminSubmissionsQueue adminSecret={secret} />;
  }

  return (
    <form onSubmit={handleLogin} className="max-w-sm">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Admin secret
      </label>
      <input
        type="password"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        required
        placeholder="Enter ADMIN_SECRET"
        className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 mb-3"
      />
      {error && (
        <p className="text-sm text-red-600 mb-3">{error}</p>
      )}
      <button
        type="submit"
        disabled={checking}
        className="w-full bg-gray-900 text-white text-sm font-medium py-2.5 rounded hover:bg-gray-700 disabled:opacity-40"
      >
        {checking ? "Checking…" : "Enter"}
      </button>
    </form>
  );
}
