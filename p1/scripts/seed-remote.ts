// Copies prebuilt stories + sim_runs from the local Postgres to the deployed
// one so production analytics have the synthetic-population data.
// Usage: REMOTE_DATABASE_URL=... npx tsx scripts/seed-remote.ts
import { readFileSync } from "fs";
import postgres from "postgres";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.split("=", 2) as [string, string]),
);

async function main() {
  const localUrl = env.DATABASE_URL;
  const remoteUrl = process.env.REMOTE_DATABASE_URL;
  if (!localUrl || !remoteUrl) throw new Error("need local .env DATABASE_URL and REMOTE_DATABASE_URL");

  const local = postgres(localUrl, { prepare: false });
  const remote = postgres(remoteUrl, { prepare: false });

  const stories = await local`select * from stories where is_prebuilt = true`;
  console.log(`local prebuilt stories: ${stories.length}`);

  const idMap = new Map<string, string>();
  for (const s of stories) {
    const [existing] = await remote`
      select id from stories where is_prebuilt = true and title = ${s.title} limit 1`;
    if (existing) {
      idMap.set(s.id, existing.id);
    } else {
      const [inserted] = await remote`
        insert into stories (title, premise, outline, is_prebuilt, art_style)
        values (${s.title}, ${s.premise}, ${s.outline}, true, ${s.art_style})
        returning id`;
      idMap.set(s.id, inserted.id);
    }
  }

  const runs = await local`select * from sim_runs`;
  let copied = 0;
  for (const r of runs) {
    const remoteStoryId = idMap.get(r.story_id);
    if (!remoteStoryId) continue;
    const [dup] = await remote`
      select id from sim_runs where story_id = ${remoteStoryId} and persona = ${r.persona}
        and created_at = ${r.created_at} limit 1`;
    if (dup) continue;
    await remote`
      insert into sim_runs (story_id, persona, path, choices, ending_id, latencies, created_at)
      values (${remoteStoryId}, ${r.persona}, ${r.path}, ${r.choices}, ${r.ending_id}, ${r.latencies}, ${r.created_at})`;
    copied++;
  }
  console.log(`sim runs copied: ${copied} (of ${runs.length} local)`);

  await local.end();
  await remote.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
