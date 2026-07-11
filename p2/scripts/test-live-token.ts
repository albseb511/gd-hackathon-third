// M0 smoke test: mint a Live ephemeral token via the same config path as the
// API route. Run: npm run test:live-token
import { GoogleGenAI } from "@google/genai";
import { MODELS } from "@/lib/models";
import { buildLiveConnectConfig } from "@/lib/live/liveConfig";

async function main() {
  const client = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { apiVersion: "v1alpha" },
  });
  const token = await client.authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      newSessionExpireTime: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      liveConnectConstraints: {
        model: MODELS.live,
        config: buildLiveConnectConfig({}),
      },
      httpOptions: { apiVersion: "v1alpha" },
    },
  });
  if (!token.name) throw new Error("no token name returned");
  console.log(`OK live-token minted for ${MODELS.live}: ${token.name.slice(0, 28)}…`);
}

main().catch((e) => {
  console.error("FAIL test-live-token:", e);
  process.exit(1);
});
