import type { Metadata } from "next";
import "./globals.css";
import NavLink from "@/components/NavLink";

export const metadata: Metadata = {
  title: "Zoneity Canada — National Zoning Intelligence Engine",
  description:
    "AI-powered search across Canadian municipal zoning bylaws, official plans, and land use regulations.",
};

const NAV_LINKS = [
  { href: "/", label: "Search", exact: true },
  { href: "/compare", label: "Compare" },
  { href: "/map", label: "Map" },
  { href: "/submit", label: "Submit" },
  { href: "/docs", label: "API" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased min-h-screen flex flex-col">
        <header className="bg-gray-950 text-white sticky top-0 z-50 border-b border-gray-800">
          <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
            <NavLink
              href="/"
              exact
              className="flex items-center gap-2.5 group"
              activeClassName=""
            >
              <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 1L13 4V10L7 13L1 10V4L7 1Z" stroke="white" strokeWidth="1.5" fill="none" />
                  <circle cx="7" cy="7" r="1.5" fill="white" />
                </svg>
              </div>
              <div>
                <span className="text-sm font-bold text-white tracking-tight">Zoneity Canada</span>
                <span className="hidden sm:block text-xs text-gray-500 leading-none mt-0.5">
                  Zoning Intelligence Engine
                </span>
              </div>
            </NavLink>

            <nav className="flex items-center gap-1">
              {NAV_LINKS.map(({ href, label, exact }) => (
                <NavLink
                  key={href}
                  href={href}
                  exact={exact}
                  className="px-3 py-1.5 rounded-md text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800"
                  activeClassName="!text-white !bg-gray-800"
                >
                  {label}
                </NavLink>
              ))}
              <a
                href="/api/bylaws/export?format=csv"
                className="ml-2 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-md text-sm font-semibold"
              >
                Export CSV
              </a>
            </nav>
          </div>
        </header>

        <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-10">
          {children}
        </main>

        <footer className="border-t border-gray-200 py-6 mt-auto">
          <div className="max-w-6xl mx-auto px-6 flex items-center justify-between text-xs text-gray-400">
            <span>
              © 2026 Zoneity Canada &mdash; Open data under{" "}
              <a href="https://creativecommons.org/licenses/by/4.0/" className="underline hover:text-gray-600">
                CC BY 4.0
              </a>
            </span>
            <span>Built for FCI × LangChain Hackathon</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
