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

const AI_EXAMPLES = [
  "Compare minimum lot sizes in Waterloo and Kitchener",
  "Which municipality allows the most housing density?",
  "What are the parking requirements for a 50-unit apartment?",
  "Can I build a fourplex in a residential zone in Waterloo?",
];

function SearchResultCard({ result }: { result: BylawSearchResult }) {
  const [showChat, setShowChat] = useState(false);
  const [chatAnswer, setChatAnswer] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);

  async function askFollowUp() {
    if (chatLoading) return;
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

  const similarity = Math.round(result.similarity * 100);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-full uppercase tracking-wide">
            {result.municipality_name}
          </span>
          <span className="text-xs text-gray-500 bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-full">
            {bylawTypeLabel(result.bylaw_type)}
          </span>
          {result.title && (
            <span className="text-xs font-medium text-gray-600">{result.title}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1">
            <div
              className="h-1.5 rounded-full"
              style={{
                width: 40,
                background: `linear-gradient(to right, #2563eb ${similarity}%, #e5e7eb ${similarity}%)`,
              }}
            />
            <span className="text-xs text-gray-400 font-mono">{similarity}%</span>
          </div>
          <span className="text-xs text-gray-300 font-mono">{formatBylawCitation(result)}</span>
        </div>
      </div>

      {/* Body */}
      <p className="text-sm text-gray-700 leading-relaxed">{result.text}</p>

      {/* Footer */}
      <div className="mt-4 flex items-center justify-end">
        <button
          onClick={askFollowUp}
          disabled={chatLoading}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-100 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M6 0C2.686 0 0 2.686 0 6s2.686 6 6 6 6-2.686 6-6S9.314 0 6 0zm0 9a.75.75 0 110-1.5A.75.75 0 016 9zm.75-3.375c0 .414-.336.75-.75.75s-.75-.336-.75-.75V3.75a.75.75 0 111.5 0v1.875z" />
          </svg>
          {chatLoading ? "Explaining..." : "Explain with AI"}
        </button>
      </div>

      {/* AI Explanation */}
      {showChat && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          {chatLoading ? (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span className="w-3 h-3 rounded-full bg-blue-400 animate-pulse" />
              Analysing regulation...
            </div>
          ) : (
            <div className="prose prose-sm prose-gray max-w-none">
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
    if (!chatQuestion.trim() || chatLoading) return;
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
      {/* Tab switcher */}
      <div className="flex gap-2 mb-5 p-1 bg-gray-100 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab("search")}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
            activeTab === "search"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Keyword Search
        </button>
        <button
          onClick={() => setActiveTab("ask")}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "ask"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-blue-500" />
          Ask AI
        </button>
      </div>

      {/* Search tab */}
      {activeTab === "search" && (
        <div>
          <div className="flex gap-2 mb-5">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none text-gray-400">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && search(query)}
                placeholder="Search zoning bylaws — e.g. minimum lot size, secondary suite..."
                className="w-full border border-gray-200 rounded-xl pl-10 pr-4 py-3 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <button
              onClick={() => search(query)}
              disabled={loading || !query.trim()}
              className="px-5 py-3 bg-gray-900 hover:bg-gray-700 text-white text-sm font-semibold rounded-xl disabled:opacity-40 shadow-sm"
            >
              {loading ? "Searching..." : "Search"}
            </button>
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-4">
              {error}
            </div>
          )}

          {results !== null && results.length === 0 && (
            <p className="text-sm text-gray-400 py-6 text-center">No results. Try different keywords.</p>
          )}

          {results && results.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs text-gray-400 font-medium">
                {results.length} result{results.length !== 1 ? "s" : ""} found
              </p>
              {results.map((r) => (
                <SearchResultCard key={r.id} result={r} />
              ))}
            </div>
          )}

          {results === null && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
                Try searching for
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => { setQuery(s); search(s); }}
                    className="text-sm text-gray-600 hover:text-blue-600 bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-200 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Ask AI tab */}
      {activeTab === "ask" && (
        <div>
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm mb-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                AI-Powered · LangChain + GPT-4o
              </span>
            </div>
            <div className="flex gap-2">
              <textarea
                value={chatQuestion}
                onChange={(e) => setChatQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), askQuestion())}
                placeholder="Ask anything about Canadian zoning — e.g. Can I build a fourplex in Waterloo?"
                rows={2}
                className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              />
              <button
                onClick={askQuestion}
                disabled={chatLoading || !chatQuestion.trim()}
                className="px-5 py-3 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl disabled:opacity-40 shadow-sm self-end"
              >
                {chatLoading ? "..." : "Ask"}
              </button>
            </div>
          </div>

          {chatLoading && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center gap-3 text-sm text-gray-400">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
                Searching bylaws and generating answer...
              </div>
            </div>
          )}

          {chatAnswer && !chatLoading && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-100">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                  AI Answer
                </span>
              </div>
              <div className="prose prose-sm prose-gray max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{chatAnswer}</ReactMarkdown>
              </div>
            </div>
          )}

          {!chatAnswer && !chatLoading && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
                Example questions
              </p>
              <div className="space-y-2">
                {AI_EXAMPLES.map((q) => (
                  <button
                    key={q}
                    onClick={() => setChatQuestion(q)}
                    className="block w-full text-left text-sm text-gray-600 hover:text-blue-600 bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-200 px-4 py-2.5 rounded-lg transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
