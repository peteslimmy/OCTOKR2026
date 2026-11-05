// Shown at once while the next page loads, so moving between pages never looks frozen.
export default function Loading() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading page">
      <div className="shimmer h-8 w-64 rounded-lg" aria-hidden />
      <div className="grid gap-4 sm:grid-cols-3" aria-hidden><div className="shimmer h-28 rounded-xl" /><div className="shimmer h-28 rounded-xl" /><div className="shimmer h-28 rounded-xl" /></div>
      <div className="shimmer h-64 rounded-xl" aria-hidden />
    </div>
  );
}
