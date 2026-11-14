export default function Loading() {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]" aria-busy="true" aria-label="Loading vault">
      <div className="animate-pulse">
        <div className="h-24 rounded-xl bg-card md:h-28" />
        <div className="mt-6 flex items-center gap-4">
          <div className="size-16 rounded-full bg-card" />
          <div className="h-8 w-2/3 max-w-80 rounded-lg bg-card" />
        </div>
        <div className="mt-8 flex gap-6 md:gap-16">
          {[0, 1, 2].map((i) => <div key={i} className="h-16 w-24 rounded-lg md:w-36 bg-card" />)}
        </div>
        <div className="mt-10 h-72 rounded-xl bg-card" />
      </div>
      <div className="h-80 animate-pulse rounded-xl bg-card" />
    </div>
  );
}
