# Deploying to a Vultr VM

One Node process serves the website and the API on port 4000. PM2 keeps it running, and Caddy
puts HTTPS in front (wallets need HTTPS anywhere except localhost).

## 1. The VM

- **Instance:** a Vultr Cloud Compute instance running **Ubuntu 24.04**, 1 vCPU / 2 GB is plenty.
- **DNS:** point a domain's **A record** at the VM's IP, for example `play.yourdomain.com`.
- **Firewall:** open ports **80** and **443**. Don't expose 4000 publicly; Caddy forwards to it.

## 2. Install Node 22, PM2 and Caddy (once)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo npm install -g pm2
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

## 3. Get the code and the keys

```bash
git clone https://github.com/aakashvishcoder/betonthehorns.git
cd betonthehorns
git checkout acash        # or main once PR #11 is merged
nano .env                 # paste the keys below
```

`.env` needs these (copy the values from the local `.env` or the Vercel project; never commit
this file):

| Key | What it is |
|---|---|
| `DATABASE_URL` | Timescale/Postgres |
| `ABLY_ROOT_KEY`, `ABLY_SUBSCRIBE_KEY` | Ably realtime |
| `SESSION_SECRET` | any long random string (`openssl rand -hex 32`); signing in again is needed if it changes |
| `SOLANA_RPC_URL`, `ELO_PROGRAM_ID`, `ACHIEVEMENT_PROGRAM_ID`, `SOLANA_AUTHORITY_SECRET` | Solana devnet |
| `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_PAT` | AI practice opponents and post-game analysis |
| `MODEL_API_KEY` | Muse coach |
| `SERPAPI_KEY` | news strip and coach search |
| `PORT=4000` | the port Caddy forwards to |

Leave `VITE_API_URL` **empty or out of the file**: the site calls the API on its own domain.

## 4. Build and start

```bash
npm ci                    # a full install: the build and `npm start` need the dev tools (tsx, vite)
npm run build             # type-checks and builds the site into dist/
npm run test:server       # optional: 14 server tests, no keys or database needed
pm2 start deploy/ecosystem.config.cjs
pm2 save && pm2 startup   # run the command it prints, so the app starts after a reboot
curl -s localhost:4000/api/health   # {"ok":true,...,"db":true}
```

Use **npm** on the VM, not pnpm. `package.json` pins `motion-dom` through npm `overrides`, and
the build fails without that pin.

## 5. HTTPS with Caddy

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile        # replace play.example.com with your domain
sudo systemctl reload caddy
```

Open `https://your-domain`. Caddy fetches the certificate on the first visit.

## Updating

```bash
cd betonthehorns && git pull && npm ci && npm run build && pm2 restart betonthehorns
```

## Notes

- **Run exactly one app process.** `ecosystem.config.cjs` sets `instances: 1`. The table timers
  (action clock, AI turns, run-outs) run inside the process. Several processes stay correct
  because games are locked in the database, but they only add load.
- **Vercel and Vultr can share the database** safely, but only run both while switching over.
  Pause the Vercel project once Vultr works. Any other old deployment pointed at this database
  (for example one still running old `main`) **must be off**, or it creates duplicate games.
- **Logs:** `pm2 logs betonthehorns`. A healthy start prints `Timescale schema ready` (or nothing
  about the schema when it's already current), `serving the built site from dist/` and
  `api on :4000`.
