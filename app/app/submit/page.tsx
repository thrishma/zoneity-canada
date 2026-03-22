import SubmitForm from "@/components/SubmitForm";

export const metadata = {
  title: "Submit a Bylaw — Zoneity Canada",
  description:
    "Help expand Zoneity Canada's database by submitting a zoning bylaw, official plan, or other land use document.",
};

export default function SubmitPage() {
  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h2 className="text-3xl font-bold tracking-tight mb-2">Submit a Bylaw</h2>
        <p className="text-gray-500">
          Know a bylaw we haven&apos;t indexed yet? Submit the URL or PDF link and our team will
          review and ingest it. All data is published under{" "}
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            className="text-blue-600 underline"
          >
            CC BY 4.0
          </a>
          .
        </p>
      </div>
      <SubmitForm />
    </div>
  );
}
