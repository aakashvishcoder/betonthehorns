# Game server design: matchmaking and poker logic

Agreed 2026-10-24. Nothing here is wired into the website yet; the server is built and tested on its own first.

## Shape

| Piece | Where | Role |
| --- | --- | --- |
| Website | `src/` | Unchanged for now. |
| Game server | `server/` (new) | Node + TypeScript + WebSockets. The single source of truth: queues, seats, deals, enforces turns, decides winners. |
| Solana program | `anchor/` | Stores Elo per mode, match records, seed commitments. The server holds the game-server key (`result_authority`) and is the only one that settles matches. |

## Modes

Three ranked Sit & Go modes, each with its own queue and its own Elo rating:

| Mode | Players |
| --- | --- |
| `heads_up` | 2 |
| `four` | 4 |
| `six` | 6 |

No private tables, no cash games: you only get a table through the ranked queue.

## Identity and sign-in

- A wallet is required. To sign in, the server sends a one-time nonce and the client signs `Bet on the Horns login: <nonce>` with the wallet; the server checks the ed25519 signature (Node's built-in `crypto`, no extra dependency) and issues a session.
- The server reads the player's on-chain rating account for the chosen mode. **No account, no queue**: the player must call `register_player` from their own wallet first (they pay the small rent).

## Matchmaking

- One queue per mode. Each waiting player accepts opponents within **±100 Elo**, widening by **50 every 15 seconds** of waiting.
- A table forms as soon as enough players (2, 4 or 6) are all within each other's range. The longest-waiting player anchors the search.
- When a table forms, the server picks a random 32-byte seed and calls `create_match` with `sha256(seed)` **before any card is dealt**.

## Game rules

- No-limit Texas Hold'em, Sit & Go. Everyone starts with **1,500 chips**.
- Blinds start at **10/20 and double every 5 minutes** (10/20 → 20/40 → 40/80 → …). Heads-up uses standard heads-up rules: the button posts the small blind and acts first preflop.
- **Turn timer:** 20 s per decision plus a **60 s time bank** per game. On timeout: check if possible, otherwise fold.
- **Disconnect/leave:** the seat stays; the player auto-checks/folds and keeps posting blinds until they bust or reconnect (blinded out).
- **Showdown:** called hands are shown; a winner whose bet wasn't called may choose to **show or muck**. Side pots handled for all-ins.
- **Finishing places** come from bust-out order. Players busting in the same hand are ranked by their stack at the start of that hand (bigger stack places higher); identical stacks tie.
- **Extras:** table chat, and **spectators** who see the public table (never hole cards) via the table link.

## Fair shuffle

- Each hand's deck comes from the match seed: `HMAC-SHA256(seed, hand number)` drives a Fisher–Yates shuffle.
- At the end, the server reveals the seed in `settle_match`; the program checks it against the commitment. Anyone can then recompute every deck and confirm nothing was rigged.
- Trade-off: once the seed is revealed, the cards in every hand of that game can be recomputed, including hands that were folded. They stay hidden while the game is running.

## Settlement

When one player holds all the chips, the server calls `settle_match` with the finishing places, the revealed seed, and `sha256` of the final standings. The program updates each player's rating for that mode (pairwise Elo, K=32).

## Program changes needed (redeploy to the same devnet address)

- `register_player` takes a `mode`; rating accounts are keyed by `[player, wallet, mode]`.
- `Match` stores its `mode`; `create_match` requires exactly 2, 4 or 6 players to match the mode.
- `settle_match` checks each rating account belongs to the match's mode.
- Existing devnet test accounts use the old layout and become stale (devnet only, nothing to migrate).

## Build order

1. Program: add modes, update tests, redeploy to devnet.
2. Server core, pure logic with unit tests: deck/shuffle, hand evaluator, betting rounds, side pots, blinds, bust order.
3. Matchmaking queue with widening Elo ranges.
4. WebSocket protocol, wallet sign-in, timers, disconnect handling, chat, spectators.
5. On-chain hooks: rating lookup, `create_match`, `settle_match`.
6. End-to-end test: scripted bot players queue, play a full Sit & Go on devnet, and get settled.
7. Later, on your go-ahead: connect the website's table page.
