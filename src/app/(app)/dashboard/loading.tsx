/** Shown while the dashboard data loads: the shape of the page, shimmering, so nothing jumps when it arrives. */
export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-label="Loading the dashboard" className="space-y-6">
      <div className="shimmer h-40 rounded-[20px]" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="shimmer h-28 rounded-2xl" />)}</div>
      <div className="grid gap-4 lg:grid-cols-3"><div className="shimmer h-80 rounded-2xl lg:col-span-2" /><div className="shimmer h-80 rounded-2xl" /></div>
    </div>
  );
}
