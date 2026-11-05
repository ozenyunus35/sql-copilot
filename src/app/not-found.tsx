import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div>
        <p className="text-xs font-medium text-muted">404</p>
        <h1 className="mt-1 text-lg font-semibold">This page doesn&apos;t exist</h1>
        <Link href="/" className="mt-4 inline-block text-accent hover:underline">
          Back to Quarry
        </Link>
      </div>
    </main>
  );
}
