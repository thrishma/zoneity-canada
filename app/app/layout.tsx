import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zoneity Canada — National Zoning Intelligence Engine",
  description:
    "AI-powered search across Canadian municipal zoning bylaws, official plans, and land use regulations.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <header className="bg-gray-950 text-white px-6 py-3">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div>
                <h1 className="text-lg font-bold tracking-tight text-white">Zoneity Canada</h1>
                <p className="text-xs text-gray-400 mt-0">Zoning Intelligence Engine</p>
              </div>
            </div>
            <nav className="flex items-center gap-6 text-sm font-medium text-gray-300">
              <a href="/" className="hover:text-white transition-colors">Search</a>
              <a href="/compare" className="hover:text-white transition-colors">Compare</a>
              <a href="/map" className="hover:text-white transition-colors">Map</a>
              <a href="/submit" className="hover:text-white transition-colors">Submit</a>
              <a href="/docs" className="hover:text-white transition-colors">API</a>
              <a
                href="/api/bylaws/export?format=csv"
                className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-xs font-semibold transition-colors"
              >
                Export CSV
              </a>
            </nav>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
        <footer className="border-t border-gray-200 mt-16 py-8 text-center text-xs text-gray-400">
          Open data under{" "}
          <a href="https://creativecommons.org/licenses/by/4.0/" className="underline">
            CC BY 4.0
          </a>
          . Municipal bylaw data sourced from official government websites.
        </footer>
      </body>
    </html>
  );
}
