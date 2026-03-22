import MunicipalityCompare from "@/components/MunicipalityCompare";

export default function ComparePage() {
  return (
    <div>
      <div className="mb-8">
        <h2 className="text-3xl font-bold tracking-tight mb-2">
          Compare Zoning Regulations
        </h2>
        <p className="text-gray-500 max-w-2xl">
          Side-by-side comparison of key zoning metrics across municipalities.
          Identify where regulations enable or restrict housing supply.
        </p>
      </div>
      <MunicipalityCompare />
    </div>
  );
}
