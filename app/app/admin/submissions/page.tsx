import AdminLoginGate from "@/components/AdminLoginGate";

export const metadata = {
  title: "Admin — Bylaw Submissions",
};

export default function AdminSubmissionsPage() {
  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h2 className="text-3xl font-bold tracking-tight mb-1">Submission Queue</h2>
        <p className="text-gray-500 text-sm">
          Review, approve, and ingest community-submitted bylaw documents.
        </p>
      </div>
      <AdminLoginGate />
    </div>
  );
}
