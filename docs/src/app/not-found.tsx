import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60dvh] flex-1 flex-col items-start justify-center py-16">
      <p className="text-sm text-[#8a8a83]">404</p>
      <h1 className="mt-2 text-[2.4rem] font-medium tracking-[-0.045em]">This page doesn&apos;t exist.</h1>
      <Link href="/" className="mt-6 inline-flex h-11 items-center rounded-full bg-ink px-5 text-sm font-medium text-white">
        Back to the docs
      </Link>
    </div>
  );
}
