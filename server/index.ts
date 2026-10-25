import "dotenv/config";
import { createApp, ensureReady } from "./app.js";

const port = Number(process.env.PORT || 4000);

// Daily puzzles: same five for everyone each UTC day. Answers never leave the server until you
// commit to a choice; signed-in players get one try per puzzle, a streak and the leaderboard.
app.get("/api/puzzles/today", async (req, res) => {
  try {
    const day = today();
    const puzzles = dailyPuzzles(day);
    const walletId = sessionWallet(req);
    const attempts = walletId ? await attemptsFor(walletId, day) : [];
    res.json({
      day,
      puzzles: puzzles.map(publicPuzzle),
      attempts: attempts.map((a) => ({ ...a, solution: puzzles[a.index - 1]!.solution })),
      streak: walletId ? await streakFor(walletId, day) : 0,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post("/api/puzzles/answer", async (req, res) => {
  try {
    const { day, index, choice } = req.body as { day?: string; index?: number; choice?: string };
    if (day !== today()) {
      res.status(410).json({ error: "That puzzle set has ended. Reload for today's puzzles." });
      return;
    }
    const puzzle = dailyPuzzles(day)[Number(index) - 1];
    if (!puzzle || !puzzle.options.some((o) => o.id === choice)) {
      res.status(400).json({ error: "Unknown puzzle or choice" });
      return;
    }
    const correct = choice === puzzle.solution.answer;
    const walletId = sessionWallet(req);
    if (walletId) {
      const saved = await saveAttempt(walletId, day, { index: puzzle.index, choice: choice as Choice, correct });
      if (!saved) {
        const previous = (await attemptsFor(walletId, day)).find((a) => a.index === puzzle.index)!;
        res.status(409).json({ error: "You've already answered this one.", ...previous, solution: puzzle.solution });
        return;
      }
    }
    res.json({
      index: puzzle.index,
      choice,
      correct,
      solution: puzzle.solution,
      saved: Boolean(walletId),
      streak: walletId ? await streakFor(walletId, day) : 0,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get("/api/puzzles/leaderboard", async (_req, res) => {
  try {
    const day = today();
    const rows = await leaderboard(day);
    res.json({ day, rows: rows.map((r) => ({ ...r, name: seatLabel(r.walletId) })) });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

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
