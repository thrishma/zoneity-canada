"use client";

import { useState, useCallback } from "react";

export interface DocSearchState<T> {
  query: string;
  setQuery: (q: string) => void;
  results: T[] | null;
  loading: boolean;
  error: string | null;
  search: (q: string) => Promise<void>;
}

export function useDocSearch<T>(apiPath: string): DocSearchState<T> {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<T[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults(null); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiPath}?q=${encodeURIComponent(q.trim())}`);
      const data = await res.json() as { results?: T[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setResults(data.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, [apiPath]);

  return { query, setQuery, results, loading, error, search };
}
