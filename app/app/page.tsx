import BylawSearch from "@/components/BylawSearch";

export default function HomePage() {
  return (
    <div>
      {/* Hero */}
      <div className="mb-10">
        <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-full px-3 py-1 text-xs font-semibold text-blue-700 mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
          Live — FCI x LangChain Hackathon 2025
        </div>
        <h2 className="text-4xl font-extrabold tracking-tight mb-3 text-gray-900">
          Canada&apos;s Zoning<br />Intelligence Engine
        </h2>
        <p className="text-gray-500 max-w-xl text-base leading-relaxed">
          Ask any question about Canadian zoning regulations in plain English.
          Powered by semantic search and AI across real municipal bylaws and official plans.
        </p>

        {/* Stats bar */}
        <div className="flex items-center gap-8 mt-6 pt-6 border-t border-gray-200">
          <div>
            <p className="text-2xl font-bold text-gray-900">2</p>
            <p className="text-xs text-gray-500 mt-0.5">Municipalities indexed</p>
          </div>
          <div className="w-px h-8 bg-gray-200" />
          <div>
            <p className="text-2xl font-bold text-gray-900">10,000+</p>
            <p className="text-xs text-gray-500 mt-0.5">Bylaw sections searchable</p>
          </div>
          <div className="w-px h-8 bg-gray-200" />
          <div>
            <p className="text-2xl font-bold text-gray-900">AI</p>
            <p className="text-xs text-gray-500 mt-0.5">Plain English answers</p>
          </div>
          <div className="w-px h-8 bg-gray-200" />
          <div>
            <p className="text-2xl font-bold text-gray-900">Open</p>
            <p className="text-xs text-gray-500 mt-0.5">REST API + CSV export</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <BylawSearch />
        </div>

        <aside className="space-y-5">
          <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
              Coverage
            </h3>
            <ul className="space-y-2.5">
              {[
                { name: "Waterloo, ON", status: "Live", color: "text-green-600 bg-green-50" },
                { name: "Kitchener, ON", status: "Live", color: "text-green-600 bg-green-50" },
                { name: "Thunder Bay, ON", status: "Ingesting", color: "text-amber-600 bg-amber-50" },
                { name: "More cities", status: "Submit data →", color: "text-blue-600 bg-blue-50" },
              ].map(({ name, status, color }) => (
                <li key={name} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 font-medium">{name}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${color}`}>
                    {status}
                  </span>
                </li>
              ))}
            </ul>
            <a
              href="/compare"
              className="mt-4 block text-center text-xs font-semibold text-blue-600 hover:text-blue-800 underline underline-offset-2"
            >
              Compare municipalities side-by-side →
            </a>
          </div>

          <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
              Try asking
            </h3>
            <ul className="space-y-2">
              {[
                "What is the minimum lot size in R-1 zones?",
                "Where is mid-rise residential permitted?",
                "What are parking requirements for apartments?",
                "Can I build a duplex on a corner lot?",
                "What setbacks apply to commercial zones?",
              ].map((q) => (
                <li key={q} className="text-sm text-gray-500 leading-snug pl-3 border-l-2 border-gray-100">
                  {q}
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-gray-950 text-white rounded-xl p-5">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
              REST API
            </h3>
            <p className="text-xs text-gray-300 mb-3">
              Query bylaws programmatically. Open, free, no auth required.
            </p>
            <a
              href="/docs"
              className="block text-center text-xs font-semibold bg-white text-gray-900 rounded px-3 py-2 hover:bg-gray-100 transition-colors"
            >
              View API docs →
            </a>
          </div>
        </aside>
      </div>
    </div>
  );
}
