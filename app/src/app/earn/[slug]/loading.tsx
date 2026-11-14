export default function Loading() {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]" aria-busy="true" aria-label="Loading vault">
      <div className="animate-pulse">
        <div className="h-4 w-48 rounded bg-card" />
        <div className="mt-6 flex items-center gap-4">
          <div className="size-16 rounded-full bg-card" />
          <div className="h-8 w-80 rounded-lg bg-card" />
        </div>
        <div className="mt-8 flex gap-16">
          {[0, 1, 2].map((i) => <div key={i} className="h-16 w-36 rounded-lg bg-card" />)}
        </div>
        <div className="mt-10 h-72 rounded-[22px] bg-card" />
      </div>
      <div className="h-80 animate-pulse rounded-[22px] bg-card" />
    </div>
  );
}
