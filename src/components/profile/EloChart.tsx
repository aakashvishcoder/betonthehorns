import { useEffect, useMemo, useState, type PointerEvent } from "react";
import { Panel } from "@/components/poker-app/PokerUI";
import { api } from "@/lib/api";
import { gameModes, type GameModeId } from "@/lib/game-modes";
import "@/styles/elo-chart.css";

const START = 1200;
const W = 640;
const H = 220;
const PAD = { top: 18, right: 18, bottom: 28, left: 46 };

type Point = { game: number; elo: number; change: number; time: string | null };

/** Rating after every rated game in one mode, game by game, starting from 1200. */
function toPoints(history: { time: string; elo: number }[]): Point[] {
  const points: Point[] = [{ game: 0, elo: START, change: 0, time: null }];
  history.forEach((row, i) => {
    points.push({ game: i + 1, elo: row.elo, change: row.elo - points[i]!.elo, time: row.time });
  });
  return points;
}

/** Elo over time on a profile: one line per mode (tabs), hover a point for the game's details. */
export default function EloChart({ walletId }: { walletId: string }) {
  const [mode, setMode] = useState<GameModeId>("hands-up");
  const [history, setHistory] = useState<Record<GameModeId, { time: string; elo: number }[]> | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setHistory(null);
    api
      .wallet(walletId)
      .then((record) => live && setHistory(record.eloHistory))
      .catch(() => live && setHistory({ "hands-up": [], "sng-4": [], "sng-6": [] }));
    return () => {
      live = false;
    };
  }, [walletId]);

  const points = useMemo(() => toPoints(history?.[mode] ?? []), [history, mode]);
  const games = points.length - 1;

  const elos = points.map((p) => p.elo);
  const low = Math.floor((Math.min(...elos) - 15) / 10) * 10;
  const high = Math.ceil((Math.max(...elos) + 15) / 10) * 10;
  const x = (game: number) => PAD.left + (games === 0 ? 0 : (game / games) * (W - PAD.left - PAD.right));
  const y = (elo: number) => PAD.top + ((high - elo) / (high - low)) * (H - PAD.top - PAD.bottom);
  const line = points.map((p) => `${x(p.game)},${y(p.elo)}`).join(" ");
  const area = `${x(0)},${H - PAD.bottom} ${line} ${x(games)},${H - PAD.bottom}`;
  const ticks = [low, Math.round((low + high) / 2), high];
  const shown = hover === null ? points[points.length - 1]! : points[hover]!;

  function onMove(event: PointerEvent<SVGSVGElement>) {
    if (games === 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    const at = ((event.clientX - box.left) / box.width) * W;
    const game = Math.round(((at - PAD.left) / (W - PAD.left - PAD.right)) * games);
    setHover(Math.max(0, Math.min(games, game)));
  }

  return (
    <section className="elo-chart" aria-label="Elo over time">
      <div className="profile-history-heading">
        <div>
          <span className="club-section-heading">RATING HISTORY</span>
          <h2>Elo over time.</h2>
        </div>
        <div className="elo-tabs" role="tablist" aria-label="Game mode">
          {gameModes.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              className={mode === m.id ? "is-active" : ""}
              onClick={() => {
                setMode(m.id);
                setHover(null);
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <Panel className="elo-chart-panel">
        {history === null ? (
          <div className="club-empty">Loading rating history…</div>
        ) : games === 0 ? (
          <div className="club-empty">No rated games in this mode yet. Everyone starts at {START}.</div>
        ) : (
          <>
            <div className="elo-readout" aria-live="polite">
              <strong>{shown.elo}</strong>
              {shown.game === 0 ? (
                <span>Starting rating</span>
              ) : (
                <span>
                  Game {shown.game}
                  {shown.time ? ` · ${new Date(shown.time).toLocaleDateString()}` : ""} ·{" "}
                  <b className={shown.change > 0 ? "is-up" : shown.change < 0 ? "is-down" : ""}>
                    {shown.change > 0 ? "+" : ""}
                    {shown.change}
                  </b>
                </span>
              )}
            </div>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              aria-label={`Elo from ${START} to ${points[points.length - 1]!.elo} over ${games} games`}
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            >
              <defs>
                <linearGradient id="elo-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#ba50e5" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#ba50e5" stopOpacity="0" />
                </linearGradient>
              </defs>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="elo-grid" />
                  <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="elo-axis">
                    {t}
                  </text>
                </g>
              ))}
              {low < START && high > START && (
                <line x1={PAD.left} x2={W - PAD.right} y1={y(START)} y2={y(START)} className="elo-start" />
              )}
              <polygon points={area} fill="url(#elo-fill)" />
              <polyline points={line} className="elo-line" />
              {points.map((p) => (
                <circle
                  key={p.game}
                  cx={x(p.game)}
                  cy={y(p.elo)}
                  r={hover === p.game ? 5.5 : games > 40 ? 0 : 3}
                  className={hover === p.game ? "elo-dot is-hover" : "elo-dot"}
                />
              ))}
              {hover !== null && (
                <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} className="elo-cursor" />
              )}
              <text x={PAD.left} y={H - 8} className="elo-axis">
                Start
              </text>
              <text x={W - PAD.right} y={H - 8} textAnchor="end" className="elo-axis">
                Game {games}
              </text>
            </svg>
          </>
        )}
      </Panel>
    </section>
  );
}
