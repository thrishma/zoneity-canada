import BylawSearch from "@/components/BylawSearch";

export default function HomePage() {
  return (
    <div>
      <div className="mb-10">
        <h2 className="text-3xl font-bold tracking-tight mb-2">
          Search Canadian Zoning Regulations
        </h2>
        <p className="text-gray-500 max-w-2xl">
          Search across zoning bylaws and official plans from municipalities across Canada.
          Ask in plain English — powered by semantic search and AI.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <BylawSearch />
        </div>

        <aside className="space-y-6">
          <div className="bg-white border border-gray-100 rounded-lg p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">
              Municipalities Indexed
            </h3>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-center justify-between">
                <span>Waterloo, ON</span>
                <span className="text-xs text-green-600 font-medium">Live</span>
              </li>
              <li className="flex items-center justify-between">
                <span>Kitchener, ON</span>
                <span className="text-xs text-green-600 font-medium">Live</span>
              </li>
              <li className="flex items-center justify-between">
                <span>Thunder Bay, ON</span>
                <span className="text-xs text-amber-600 font-medium">Coming soon</span>
              </li>
            </ul>
            <a
              href="/compare"
              className="mt-4 block text-center text-xs font-medium text-blue-600 hover:text-blue-800 underline underline-offset-2"
            >
              Compare municipalities side-by-side
            </a>
          </div>

          <div className="bg-white border border-gray-100 rounded-lg p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Try asking</h3>
            <ul className="space-y-1.5 text-sm text-gray-500">
              {[
                "What is the minimum lot size in R-1 zones?",
                "Where is mid-rise residential permitted?",
                "What are parking requirements for apartments?",
                "Can I build a duplex on a corner lot?",
                "What setbacks apply to commercial zones?",
              ].map((q) => (
                <li key={q} className="leading-snug">{q}</li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
