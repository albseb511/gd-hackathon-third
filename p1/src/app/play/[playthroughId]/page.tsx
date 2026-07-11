// Thin server shell around the client game stage. Full-bleed, no chrome —
// the stage owns the whole viewport.

import GameStage from "@/components/game/GameStage";

export default async function PlayPage({
  params,
}: {
  params: Promise<{ playthroughId: string }>;
}) {
  const { playthroughId } = await params;

  return (
    <main className="fixed inset-0 h-dvh w-screen overflow-hidden bg-zinc-950">
      <GameStage playthroughId={playthroughId} />
    </main>
  );
}
