/** Shown while the homepage waits on live yield figures. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading PECUN" className="animate-pulse">
      <div className="dots px-4 pb-20 pt-16 text-center md:pb-28 md:pt-24">
        <div className="mx-auto h-24 max-w-md rounded-2xl bg-black/[0.06] sm:h-28 md:h-40 md:max-w-3xl" />
        <div className="mx-auto mt-6 h-6 w-56 max-w-full rounded-full bg-white sm:w-64" />
        <div className="mx-auto mt-12 hidden h-6 max-w-3xl rounded-full bg-black/[0.04] sm:block" />
      </div>
      <div className="mx-auto max-w-3xl px-4 py-16">
        <div className="mx-auto h-8 w-48 rounded-lg bg-black/[0.06] sm:w-72" />
        <div className="mt-8 grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-16 rounded-xl bg-black/[0.05] sm:h-20" />
          ))}
        </div>
      </div>
    </div>
  );
}
