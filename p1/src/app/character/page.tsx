// /character?pt=<playthroughId> — forge a character from a selfie (or just a
// name and a line of self-description), then continue into the playthrough.

import CharacterCreator from "@/components/character/CharacterCreator";

export default async function CharacterPage({
  searchParams,
}: {
  searchParams: Promise<{ pt?: string }>;
}) {
  const { pt } = await searchParams;
  return <CharacterCreator playthroughId={pt?.trim() || null} />;
}
