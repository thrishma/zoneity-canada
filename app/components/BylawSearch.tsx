"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { BylawSearchResult } from "@/types";
import { formatBylawCitation, bylawTypeLabel } from "@/lib/bylaw-utils";
import { useDocSearch } from "@/hooks/useDocSearch";

const SUGGESTIONS = [
  "minimum lot size residential zone",
  "secondary suite permitted as-of-right",
  "parking requirements multi-unit residential",
  "building height limit residential",
  "setback requirements from property line",
  "permitted uses in commercial zones",
];

interface SearchResultCardProps {
  result: BylawSearchResult;
}

function SearchResultCard({ result }: SearchResultCardProps) {
  const [showChat, setShowChat] = useState(false);
  const [chatAnswer, setChatAnswer] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);

  async function askFollowUp() {
    setChatLoading(true);
    setShowChat(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: `Explain this regulation in plain English and note any exceptions or conditions: "${result.text}"`,
          municipalityId: result.municipality_id,
          municipalityName: result.municipality_name,
        }),
      });
      const data = await res.json() as { answer?: string };
      setChatAnswer(data.answer ?? "No answer returned.");
    } catch {
      setChatAnswer("Failed to load explanation.");
    } finally {
      setChatLoading(false);
    }
  }

  return (
    <div className="border border-gray-100 rounded-lg p-4 bg-white">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded uppercase tracking-wide">
            {result.municipality_name}
          </span>
          <span className="text-xs text-gray-500 bg-gray-50 px-2 py-0.5 rounded">
            {bylawTypeLabel(result.bylaw_type)}
          </span>
          {result.title && (
            <span className="text-xs font-medium text-gray-600">{result.title}</span>
          )}
        </div>
        <span className="text-xs text-gray-400 font-mono shrink-0">
          {formatBylawCitation(result)}
        </span>
      </div>

      <p className="text-sm text-gray-800 leading-relaxed">{result.text}</p>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-gray-400">
          Relevance: {Math.round(result.similarity * 100)}%
        </span>
        <button
          onClick={askFollowUp}
          className="text-xs font-medium text-gray-500 hover:text-gray-800 underline underline-offset-2"
        >
          Explain this
        </button>
      </div>

      {showChat && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          {chatLoading ? (
            <p className="text-xs text-gray-400 italic">Loading explanation...</p>
          ) : (
            <div className="prose prose-sm prose-gray max-w-none text-xs">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{chatAnswer ?? ""}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function BylawSearch() {
  const { query, setQuery, results, loading, error, search } =
    useDocSearch<BylawSearchResult>("/api/bylaws/search");

  const [chatQuestion, setChatQuestion] = useState("");
  const [chatAnswer, setChatAnswer] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"search" | "ask">("search");

  async function askQuestion() {
    if (!chatQuestion.trim()) return;
    setChatLoading(true);
    setChatAnswer(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: chatQuestion }),
      });
      const data = await res.json() as { answer?: string };
      setChatAnswer(data.answer ?? "No answer returned.");
    } catch {
      setChatAnswer("Failed. Please try again.");
    } finally {
      setChatLoading(false);
    }
  }

  return (
    <div>
      <div className="flex gap-1 mb-4 border-b border-gray-100">
        <button
          onClick={() => setActiveTab("search")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === "search"
              ? "border-gray-900 text-gray-900"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Keyword Search
        </button>
        <button
          onClick={() => setActiveTab("ask")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === "ask"
              ? "border-gray-900 text-gray-900"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Ask AI
        </button>
      </div>

      {activeTab === "search" && (
        <div>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search(query)}
              placeholder="e.g. minimum lot size, secondary suite, parking requirements..."
              className="flex-1 border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
            <button
              onClick={() => search(query)}
              disabled={loading || !query.trim()}
              className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              {loading ? "Searching..." : "Search"}
            </button>
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 rounded px-3 py-2 mb-4">{error}</div>
          )}

          {results !== null && results.length === 0 && (
            <p className="text-sm text-gray-400">No results. Try different keywords.</p>
          )}

          {results && results.length > 0 && (
            <div className="space-y-4">
              {results.map((r) => (
                <SearchResultCard key={r.id} result={r} />
              ))}
            </div>
          )}

          {results === null && (
            <div className="text-sm text-gray-400 space-y-2 mt-2">
              <p className="font-medium text-gray-600">Try searching for:</p>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => { setQuery(s); search(s); }}
                  className="block text-blue-600 hover:text-blue-800 hover:underline"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "ask" && (
        <div>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={chatQuestion}
              onChange={(e) => setChatQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && askQuestion()}
              placeholder="Ask a question about Canadian zoning regulations..."
              className="flex-1 border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
            <button
              onClick={askQuestion}
              disabled={chatLoading || !chatQuestion.trim()}
              className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              {chatLoading ? "Thinking..." : "Ask"}
            </button>
          </div>

          {chatAnswer && (
            <div className="prose prose-sm prose-gray max-w-none bg-white border border-gray-100 rounded-lg p-5">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{chatAnswer}</ReactMarkdown>
            </div>
          )}

          {!chatAnswer && !chatLoading && (
            <div className="text-sm text-gray-400 space-y-2">
              <p className="font-medium text-gray-600">Example questions:</p>
              {[
                "Compare minimum lot sizes in Waterloo and Kitchener",
                "Which municipality allows the most housing density?",
                "What are the parking requirements for a 50-unit apartment?",
                "Can I build a fourplex in a residential zone in Waterloo?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => { setChatQuestion(q); }}
                  className="block text-blue-600 hover:text-blue-800 hover:underline"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
