import "dotenv/config";
import { createApp, ensureReady } from "./app.js";
import { dailyPuzzles, today } from "./puzzles.js";

const port = Number(process.env.PORT || 4000);

async function start() {
  await ensureReady();
  // Build today's puzzles up front (and again after midnight) so no visitor waits for them.
  setTimeout(() => dailyPuzzles(today()), 0);
  setInterval(() => dailyPuzzles(today()), 10 * 60_000).unref();
  const app = createApp();
  app.listen(port, "0.0.0.0", () => {
    console.log(`betonthehorns api on :${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
