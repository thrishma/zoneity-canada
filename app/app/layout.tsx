import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zoneity Canada — National Zoning Data Platform",
  description:
    "Searchable, comparable zoning bylaws and land use regulations across Canadian municipalities.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <header className="border-b border-gray-200 bg-white px-6 py-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold tracking-tight">Zoneity Canada</h1>
              <p className="text-xs text-gray-500 mt-0.5">
                National Zoning &amp; Land Use Data Platform
              </p>
            </div>
            <nav className="flex items-center gap-6 text-sm font-medium text-gray-600">
              <a href="/" className="hover:text-gray-900">Search</a>
              <a href="/compare" className="hover:text-gray-900">Compare</a>
              <a href="/map" className="hover:text-gray-900">Map</a>
              <a href="/submit" className="hover:text-gray-900">Submit</a>
              <a href="/docs" className="hover:text-gray-900">API Docs</a>
              <a href="/api/bylaws/export?format=csv" className="hover:text-gray-900 text-blue-600">Export CSV</a>
              <a href="/admin/submissions" className="hover:text-gray-900 text-gray-400 text-xs">Admin</a>
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
