import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Flame, X } from "lucide-react";
import PokerAppShell from "@/components/poker-app/PokerAppShell";
import { PageHeading, Panel, Pill } from "@/components/poker-app/PokerUI";
import {
  api,
  type Puzzle,
  type PuzzleChoice,
  type PuzzleResult,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cardArt, cardName } from "@/lib/poker-design";
import { shortAddress } from "@/lib/utils";
import { walletToast } from "@/lib/wallet-toast";
import "@/styles/puzzles.css";
import AnalysisPanel from "@/components/analysis/AnalysisPanel";
import LatticeLoader from "@/components/react-bits/LatticeLoader";

type Results = Record<number, PuzzleResult>;
type Board = Awaited<ReturnType<typeof api.puzzleLeaderboard>>["rows"];

// Signed-out visitors keep the day's results in this browser only.
const storageKey = (day: string) => `horns-puzzles:${day}`;
function loadLocal(day: string): Results {
  try {
    return JSON.parse(localStorage.getItem(storageKey(day)) ?? "{}") as Results;
  } catch {
    return {};
  }
}
function saveLocal(day: string, results: Results) {
  try {
    localStorage.setItem(storageKey(day), JSON.stringify(results));
  } catch {
    // Private mode: results just won't survive a reload.
  }
}

function PuzzleCard({ code }: { code: string }) {
  return <img className="puzzles-card" src={cardArt(code)} alt={cardName(code)} />;
}

function shareText(day: string, puzzles: Puzzle[], results: Results) {
  const score = puzzles.filter((p) => results[p.index]?.correct).length;
  const grid = puzzles.map((p) => (results[p.index]?.correct ? "🟪" : "🟥")).join("");
  return `Bet on the Horns puzzles ${day}: ${score}/${puzzles.length}\n${grid}`;
}

export default function PuzzlesPage() {
  const { address, isAuthenticated } = useAuth();
  const [day, setDay] = useState("");
  const [puzzles, setPuzzles] = useState<Puzzle[]>([]);
  const [results, setResults] = useState<Results>({});
  const [streak, setStreak] = useState(0);
  const [current, setCurrent] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [board, setBoard] = useState<Board>([]);

  const load = useCallback(async () => {
    try {
      const data = await api.puzzlesToday();
      const saved: Results = isAuthenticated
        ? Object.fromEntries(data.attempts.map((a) => [a.index, a]))
        : loadLocal(data.day);
      setDay(data.day);
      setPuzzles(data.puzzles);
      setResults(saved);
      setStreak(data.streak);
      setCurrent(data.puzzles.find((p) => !saved[p.index])?.index ?? 1);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [isAuthenticated, address]);

  useEffect(() => {
    void load();
  }, [load]);

  const done = puzzles.length > 0 && puzzles.every((p) => results[p.index]);
  useEffect(() => {
    if (done) api.puzzleLeaderboard().then((d) => setBoard(d.rows)).catch(() => {});
  }, [done]);

  const puzzle = puzzles.find((p) => p.index === current);
  const result = puzzle ? results[puzzle.index] : undefined;
  const score = Object.values(results).filter((r) => r.correct).length;

  async function answer(choice: PuzzleChoice) {
    if (!puzzle || result || busy) return;
    setBusy(true);
    try {
      const r = await api.answerPuzzle(day, puzzle.index, choice);
      const next = { ...results, [r.index]: r };
      setResults(next);
      if (isAuthenticated) setStreak(r.streak);
      else saveLocal(day, next);
    } catch (e) {
      walletToast.error((e as Error).message);
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(shareText(day, puzzles, results));
      walletToast.success("Copied your results");
    } catch {
      walletToast.error("Couldn't copy to the clipboard");
    }
  }

  const nextOpen = puzzles.find((p) => p.index > current && !results[p.index]) ?? puzzles.find((p) => !results[p.index]);

  return (
    <PokerAppShell section="puzzles">
      <div className="puzzles-page">
        <PageHeading
          eyebrow={day ? `DAILY PUZZLES · ${day}` : "DAILY PUZZLES"}
          title="Five spots a day."
          description="Same five hands for everyone, easy to hard. Pick the best play: one try each, then see the math."
          action={
            <div className="puzzles-stats">
              <span>
                <strong>{score}</strong>/{puzzles.length || 5}
              </span>
              {isAuthenticated ? (
                <span title="Days in a row with all five answered">
                  <Flame size={14} /> <strong>{streak}</strong> day streak
                </span>
              ) : (
                <span className="club-muted">Sign in to save results and keep a streak</span>
              )}
            </div>
          }
        />

        {error && <Panel className="puzzles-panel">{error}</Panel>}

        {!day && !error && (
          <LatticeLoader
            label="Dealing the spots"
            color="#e1b0f7"
            glow
            glowColor="#932db9"
            pattern="ripple"
            showTimer={false}
            cellSize={8}
            gap={3}
          />
        )}

        {puzzles.length > 0 && (
          <nav className="puzzles-dots" aria-label="Puzzles">
            {puzzles.map((p) => {
              const r = results[p.index];
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`puzzles-dot ${p.index === current ? "is-current" : ""} ${r ? (r.correct ? "is-right" : "is-wrong") : ""}`}
                  onClick={() => setCurrent(p.index)}
                  aria-label={`Puzzle ${p.index}${r ? (r.correct ? ", correct" : ", missed") : ""}`}
                >
                  {r ? r.correct ? <Check size={13} /> : <X size={13} /> : p.index}
                </button>
              );
            })}
          </nav>
        )}

        {puzzle && (
          <Panel className="puzzles-panel">
            <div className="puzzles-meta">
              <Pill tone={puzzle.difficulty === "hard" ? "maroon" : "violet"}>{puzzle.difficulty}</Pill>
              <Pill>{puzzle.street}</Pill>
              <Pill>{puzzle.position}</Pill>
              <h2>{puzzle.title}</h2>
            </div>

            <div className="puzzles-felt">
              {puzzle.board.length > 0 && (
                <div className="puzzles-row">
                  {puzzle.board.map((c) => (
                    <PuzzleCard key={c} code={c} />
                  ))}
                </div>
              )}
              <div className="puzzles-pot">
                Pot <strong>{puzzle.pot}</strong>
                {puzzle.toCall > 0 && (
                  <>
                    {" "}· to call <strong>{puzzle.toCall}</strong>
                  </>
                )}
              </div>
              <div className="puzzles-row puzzles-row--hero">
                {puzzle.hero.map((c) => (
                  <PuzzleCard key={c} code={c} />
                ))}
              </div>
              <span className="puzzles-stack">Your stack {puzzle.heroStack}</span>
            </div>

            <p className="puzzles-situation">{puzzle.situation}</p>
            <p className="puzzles-assumption">{puzzle.assumption}</p>

            <div className="puzzles-options">
              {puzzle.options.map((o) => {
                const picked = result?.choice === o.id;
                const right = result?.solution.answer === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    className={`club-button ${result ? "club-button--secondary" : ""} ${right ? "is-right" : picked ? "is-wrong" : ""}`}
                    disabled={Boolean(result) || busy}
                    onClick={() => void answer(o.id)}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>

            {result && (
              <div className={`puzzles-reveal ${result.correct ? "is-right" : "is-wrong"}`}>
                <h3>{result.correct ? "Correct." : "Not quite."}</h3>
                <p>{result.solution.explanation}</p>
                <dl>
                  {result.solution.numbers.map((n) => (
                    <div key={n.label}>
                      <dt>{n.label}</dt>
                      <dd>{n.value}</dd>
                    </div>
                  ))}
                </dl>
                {nextOpen && (
                  <button type="button" className="club-button" onClick={() => setCurrent(nextOpen.index)}>
                    Next puzzle
                  </button>
                )}
              </div>
            )}
          </Panel>
        )}

        {done && isAuthenticated && (
          <AnalysisPanel kind="puzzles" target={day} label="Analyze my answers" />
        )}
        {done && (
          <div className="puzzles-summary">
            <Panel className="puzzles-panel">
              <span className="club-eyebrow">TODAY</span>
              <h2>
                {score}/{puzzles.length} correct
              </h2>
              <pre className="puzzles-share">{shareText(day, puzzles, results)}</pre>
              <button type="button" className="club-button club-button--secondary" onClick={() => void copyShare()}>
                <Copy size={14} /> Copy results
              </button>
              <p className="club-muted">New puzzles at midnight UTC.</p>
            </Panel>
            <Panel className="puzzles-panel">
              <span className="club-eyebrow">TODAY'S BEST</span>
              {board.length === 0 ? (
                <p className="club-muted">No signed-in players have finished yet.</p>
              ) : (
                <ol className="puzzles-board">
                  {board.map((row) => (
                    <li key={row.walletId} className={row.walletId === address ? "is-me" : ""}>
                      <span>{row.name || shortAddress(row.walletId)}</span>
                      <strong>
                        {row.correct}/{row.answered}
                      </strong>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          </div>
        )}
      </div>
    </PokerAppShell>
  );
}
