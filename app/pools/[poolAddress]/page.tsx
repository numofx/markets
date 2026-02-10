import { SmartLink } from "@/ui/SmartLink";

export default function PoolLegacyPage() {
  // Legacy route kept to avoid 404s from old links/prefetches and wallet/extension probes.
  // The app now uses an inline modal on the Pools tab for adding liquidity.
  return (
    <main className="mx-auto w-full max-w-xl px-6 py-16">
      <h1 className="font-semibold text-2xl text-numo-ink">Pool</h1>
      <p className="mt-2 text-numo-muted text-sm">
        This page is deprecated. Add liquidity from the Pools tab.
      </p>
      <SmartLink
        className="mt-6 inline-flex rounded-full border border-numo-border bg-white px-4 py-2 text-numo-ink text-sm hover:bg-numo-pill"
        href="/"
      >
        Go back
      </SmartLink>
    </main>
  );
}
