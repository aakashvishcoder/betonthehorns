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
    // The AI coach lives on the game server, which keeps the Muse API key.
    // Defaults to the offline prototype (cd server && npm run prototype); use GAME_SERVER=http://localhost:8787 for npm start.
    proxy: { "/api": process.env.GAME_SERVER ?? "http://localhost:8080" },
  },
});
