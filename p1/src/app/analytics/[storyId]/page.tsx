import BranchMap from "@/components/analytics/BranchMap";
import Link from "next/link";

async function getData(storyId: string) {
  // server-side self-fetch keeps one code path; base resolved at request time
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3111";
  const res = await fetch(`${base}/api/analytics/${storyId}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json();
}

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ storyId: string }>;
}) {
  const { storyId } = await params;
  const data = await getData(storyId);

  if (!data) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-300 p-10">
        story not found. <Link className="underline" href="/">home</Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6 md:p-10">
      <p className="text-amber-400 text-xs tracking-[0.3em] uppercase mb-1">
        Story cartography
      </p>
      <h1
        className="text-4xl mb-1"
        style={{ fontFamily: "var(--font-display, Georgia, serif)" }}
      >
        {data.title}
      </h1>
      <p className="text-zinc-500 mb-8">
        {data.simCount} simulated playthroughs · every branch, every ending, every
        millisecond
      </p>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 mb-10">
        <BranchMap aggregate={data.aggregate} height={520} />
      </section>

      <div className="grid md:grid-cols-2 gap-10">
        <section>
          <h2 className="text-sm uppercase tracking-widest text-zinc-400 mb-4">
            Ending distribution
          </h2>
          {data.aggregate.endings.map(
            (e: { endingId: string; count: number; pct: number }) => (
              <div key={e.endingId} className="mb-2 flex items-center gap-3">
                <div
                  className="h-2 rounded bg-amber-500/80"
                  style={{ width: `${Math.max(2, e.pct) * 2}px` }}
                />
                <span className="text-zinc-300 text-sm">
                  {e.endingId} <span className="text-zinc-500">({e.count} · {e.pct}%)</span>
                </span>
              </div>
            ),
          )}
          {data.aggregate.unreachedBeats.length > 0 && (
            <p className="text-zinc-600 text-xs mt-4">
              unreached beats: {data.aggregate.unreachedBeats.join(", ")}
            </p>
          )}
        </section>

        <section>
          <h2 className="text-sm uppercase tracking-widest text-zinc-400 mb-4">
            Pipeline latency (live players)
          </h2>
          <table className="text-sm w-full">
            <thead>
              <tr className="text-zinc-500 text-left">
                <th className="pb-2 font-normal">step</th>
                <th className="pb-2 font-normal text-right">p50</th>
                <th className="pb-2 font-normal text-right">p95</th>
                <th className="pb-2 font-normal text-right">n</th>
              </tr>
            </thead>
            <tbody>
              {(data.liveLatency as { step: string; p50: number; p95: number; n: number }[])
                .sort((a, b) => b.n - a.n)
                .map((l) => (
                  <tr key={l.step} className="border-t border-zinc-800/60">
                    <td className="py-1.5 text-zinc-300">{l.step}</td>
                    <td className="py-1.5 text-right text-amber-300">{l.p50}ms</td>
                    <td className="py-1.5 text-right text-zinc-400">{l.p95}ms</td>
                    <td className="py-1.5 text-right text-zinc-600">{l.n}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
