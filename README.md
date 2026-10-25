# Bet on the Horns — ALL IN poker prototype

A standalone **React 19 + Vite 7 + TypeScript** website, exported from the current ALL IN designs. This is a conventional Vite React app, not a dependency on the legacy `react-scripts` / Create React App toolchain.

## Run locally

Use Node **20.19+ or 22.12+** (Node 22 is recommended) and pnpm **10.18.0**. If pnpm is not installed, use `npx --yes pnpm@10.18.0` in place of `pnpm` below.

```bash
git clone https://github.com/aakashvishcoder/betonthehorns.git
cd betonthehorns
pnpm install
pnpm dev
```

Vite prints the local development address, normally `http://localhost:5173`.

```bash
pnpm check     # Strict app and Vite-config TypeScript checks
pnpm build     # Typecheck and build into dist/
pnpm preview   # Serve the production build locally
pnpm format    # Format the frontend source and entry files
```

No environment variables, API keys, authentication provider, database, or Manus account are required to run the app.

## Pages

| Route | Design |
| --- | --- |
| `/` | Front page with shining cards, smooth scrolling, and poker-night planner |
| `/profile` | Example player profile, filtered past games, and local game-detail dialog |
| `/play` | Table-style selection, sample room search, and local table setup |
| `/table` | Six-seat sample table, foil community/hole cards, preview actions and local chat |
| `/leaderboard` | Sample standings, period tabs, player search, and personal rank |

The landing page's **Take a seat** button opens the lobby. The shared app navigation connects the other pages. A lobby table link passes its fictional room ID through `/table?room=...`.

## Project structure

```text
src/
  main.tsx                     Plain React entry
  App.tsx                      Providers and lazy page routes
  pages/                       Front page, profile, lobby, table, leaderboard
  components/poker/            Front-page visuals, effects, setup, smooth scrolling
  components/poker-app/        Shared app shell and typed UI/card primitives
  components/react-bits/       The five supplied effects and their type declarations
  components/ui/               Only the UI primitives actually used
  lib/poker-design.ts          Shared deck map and fictional design fixtures
  styles/                      Shared palette and route-specific styling
public/
  cards/                       Six self-hosted WebP deck textures
  favicon.svg
```

Start sequential UI changes in the relevant page and its matching stylesheet. Change shared navigation and motion behavior in `PokerAppShell.tsx`, shared card rendering in `PokerUI.tsx`, and colors in `styles/palette.css`. Card textures and fixture data are centralized in `lib/poker-design.ts`; the landing card scene also references the same local deck artwork in `PokerEffects.tsx`.

## Effects and accessibility

The supplied **AeroShards, PlasmaWave, HoloCard, FlowingMenu, and InfiniteSpiral** implementations are preserved. Their original JSX files remain alongside `.d.ts` declarations so the surrounding React app is strictly typed without rewriting the verified graphics/shader pipeline.

Effects are lazy-loaded, background layers are restrained, and device reduced-motion preferences and the manual pause control are retained. WebGPU is optional: unsupported devices use static fallbacks. Holo card flips remain available where interactive. Compact history/standings thumbnails reuse the same artwork without creating extra shader canvases.

All six deck images are local. The existing DM Sans and Space Grotesk Google Fonts stylesheet is the only optional external visual resource; fallback fonts work without it. There are no managed-storage URLs, platform API scripts, OAuth handlers, tRPC providers, server code, or managed debug plugins in this app.

The pnpm lifecycle policy permits Tailwind's native CSS compiler and esbuild. Node-only WebGPU/Dawn adapters are intentionally excluded because the app renders in the browser.

## Design prototype, not a live poker service

Players, balances, games, rooms, and rankings are fictional examples. Filters, card interactions, preview actions, and chat update only local UI state. Table setup is stored in this browser under `allin-table`. No live matchmaking, shared chat, game engine, real-money play, authentication, or backend has been added.

## Static hosting

Deploy `dist/` to a static host that rewrites non-asset page routes to `index.html`, so direct visits to `/profile`, `/play`, `/table`, and `/leaderboard` work. The app currently assumes hosting at the origin root. GitHub Pages subdirectory hosting requires a separate base-path/routing configuration; pushing source to GitHub does not publish a website.

This standalone repository is separate from the managed Manus Preview. Later code changes should be made and committed here deliberately; there is no automatic two-way sync with the earlier managed project.

## Reproducible dependencies

Commit and retain `pnpm-lock.yaml` and `pnpm-workspace.yaml`. Motion's transitive packages are pinned to the versions used by the working prototype; resolving an unrelated newer `motion-dom` release can otherwise break the older Framer Motion API. Use `pnpm install --frozen-lockfile` for subsequent reproducible installs.
