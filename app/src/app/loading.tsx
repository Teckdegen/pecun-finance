/** Explore skeleton while the catalog loads (the first load can take a few seconds). */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading yields" className="animate-pulse">
      <div className="h-8 w-56 rounded-lg bg-card" />
      <div className="mt-3 h-4 w-80 max-w-full rounded bg-card" />
      <div className="mt-6 h-36 rounded-2xl bg-card md:h-40" />
      <div className="mt-6 flex gap-3">
        <div className="h-11 flex-1 rounded-xl bg-card" />
        <div className="h-11 w-24 rounded-xl bg-card" />
      </div>
      <div className="mt-6 grid gap-2">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex h-[68px] items-center gap-3 rounded-xl bg-card px-4">
            <div className="size-10 rounded-full bg-white/5" />
            <div className="h-4 w-1/3 rounded bg-white/5" />
            <div className="ml-auto h-4 w-16 rounded bg-white/5" />
          </div>
        ))}
      </div>
    </div>
  );
}
