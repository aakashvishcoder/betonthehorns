import "dotenv/config";
import { createApp, ensureReady } from "./app.js";

const port = Number(process.env.PORT || 4000);

async function start() {
  await ensureReady();
  const app = createApp();
  app.listen(port, "0.0.0.0", () => {
    console.log(`betonthehorns api on :${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
