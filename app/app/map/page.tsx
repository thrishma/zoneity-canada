import MapDashboard from "@/components/MapDashboard";

export const metadata = {
  title: "Zoning Map — Zoneity Canada",
  description: "Visualize zoning restrictiveness across Canadian municipalities",
};

export default function MapPage() {
  return (
    <div>
      <div className="mb-8">
        <h2 className="text-3xl font-bold tracking-tight mb-2">Zoning Restrictiveness Map</h2>
        <p className="text-gray-500 max-w-2xl">
          Compare key zoning metrics across municipalities. Select a metric to see how regulations vary —
          highlighting where policies enable or restrict housing supply.
        </p>
      </div>
      <MapDashboard />
    </div>
  );
}
