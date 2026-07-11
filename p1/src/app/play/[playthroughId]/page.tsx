// Thin server shell around the game stage. Full-bleed, no chrome. Prebuilt
// stories play SCRIPTED (pre-rendered audio, instant, ~free); custom (premise)
// stories play LIVE (improvising narrator). Decided here by matching the
// playthrough's story to a prebuilt id.

import GameStage from "@/components/game/GameStage";
import ScriptedStage from "@/components/game/ScriptedStage";
import { loadPlaythroughContext } from "@/lib/storyEngine/loadContext";
import { prebuiltById, prebuiltStories, PrebuiltStoryId } from "@/lib/prebuilt";
import { isScriptedReady } from "@/lib/scriptedStory";

// Resolve the scripted id for a playthrough, or null if it's a custom story
// (or a prebuilt whose scripted audio isn't rendered yet — those stay live).
async function scriptedIdFor(playthroughId: string): Promise<string | null> {
  if (playthroughId.startsWith("local-")) {
    const id = playthroughId.slice("local-".length);
    return isScriptedReady(id) ? id : null;
  }
  const ctx = await loadPlaythroughContext(playthroughId).catch(() => null);
  if (!ctx) return null;
  // match by title against the prebuilt catalogue (custom stories won't match)
  const hit = prebuiltStories.find((s) => s.title === ctx.outline.title);
  if (hit && prebuiltById[hit.id as PrebuiltStoryId] && isScriptedReady(hit.id))
    return hit.id;
  return null;
}

export default async function PlayPage({
  params,
}: {
  params: Promise<{ playthroughId: string }>;
}) {
  const { playthroughId } = await params;
  const scriptedId = await scriptedIdFor(playthroughId);

  return (
    <main className="fixed inset-0 h-dvh w-screen overflow-hidden bg-zinc-950">
      {scriptedId ? (
        <ScriptedStage playthroughId={playthroughId} scriptedId={scriptedId} />
      ) : (
        <GameStage playthroughId={playthroughId} />
      )}
    </main>
  );
}
