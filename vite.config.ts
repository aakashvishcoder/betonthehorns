import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    proxy: {
      // AI coach + news ticker: our game server (server/src), which holds the Muse and SerpApi keys.
      // Defaults to the offline prototype (cd server && npm run prototype); GAME_SERVER=http://localhost:8787 for npm start.
      "/api/coach": process.env.GAME_SERVER ?? "http://localhost:8080",
      "/api/news": process.env.GAME_SERVER ?? "http://localhost:8080",
      // Everything else: the main API (server/index.ts).
      "/api": "http://127.0.0.1:4000",
    },
  },
});
