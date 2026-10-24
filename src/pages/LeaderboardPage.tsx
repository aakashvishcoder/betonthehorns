import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Minus,
  Search,
} from "lucide-react";
import { Link } from "wouter";
import PokerAppShell from "@/components/poker-app/PokerAppShell";
import {
  Avatar,
  PageHeading,
  Panel,
  Pill,
} from "@/components/poker-app/PokerUI";
import { useAuth } from "@/lib/auth";
import { gameModes, type GameModeId } from "@/lib/game-modes";
import { standingsForMode } from "@/lib/poker-design";
import { shortAddress } from "@/lib/utils";
import "@/styles/leaderboard.css";

function Movement({ value }: { value: number }) {
  if (value > 0)
    return (
      <span className="leaderboard-movement leaderboard-movement--up">
        <ArrowUp size={13} /> {value}
      </span>
    );
  if (value < 0)
    return (
      <span className="leaderboard-movement leaderboard-movement--down">
        <ArrowDown size={13} /> {Math.abs(value)}
      </span>
    );
  return (
    <span className="leaderboard-movement leaderboard-movement--even">
      <Minus size={13} /> —
    </span>
  );
}

export default function LeaderboardPage() {
  const { address } = useAuth();
  const [mode, setMode] = useState<GameModeId>("hands-up");
  const [query, setQuery] = useState("");
  const standings = useMemo(() => standingsForMode(mode), [mode]);
  const topThree = standings.slice(0, 3);
  const visible = standings.filter((player) =>
    `${player.name} ${player.handle} ${player.address}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  return (
    <PokerAppShell section="leaderboard">
      <div className="leaderboard-page">
        <PageHeading
          eyebrow="PUBLIC BOARD · DEMO"
          title="ELO by mode."
          description="Hands Up, SNG 4, and SNG 6 each keep their own ladder. These wallets and ratings are demo data."
          action={
            <Link href="/play" className="club-button club-button--secondary">
              Queue up <ArrowUpRight size={15} />
            </Link>
          }
        />

        <section className="leaderboard-controls" aria-label="Mode filter">
          <div className="club-segmented" role="group" aria-label="Game mode">
            {gameModes.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={mode === item.id}
                onClick={() => setMode(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <section className="leaderboard-overview" aria-label="Top rated wallets">
          <Panel className="leaderboard-podium-panel">
            <div className="leaderboard-panel-heading">
              <div>
                <span className="club-section-heading">Top horns</span>
                <p>Highest ELO in {gameModes.find((item) => item.id === mode)?.label}.</p>
              </div>
              <Pill tone="violet">Demo</Pill>
            </div>
            <div className="leaderboard-podium">
              {topThree.map((player, index) => (
                <article
                  key={player.address}
                  className={`leaderboard-podium-card leaderboard-podium-card--${index + 1}`}
                >
                  <span className="leaderboard-podium-rank">#{player.rank}</span>
                  <Avatar
                    name={player.name}
                    size={index === 0 ? 48 : 40}
                    tone={index === 1 ? "maroon" : "violet"}
                  />
                  <div className="leaderboard-podium-copy">
                    <strong>{player.name}</strong>
                    <span>{shortAddress(player.address)}</span>
                  </div>
                  <b>{player.elo}</b>
                  <small>{player.rankBadge} dNFT</small>
                </article>
              ))}
            </div>
          </Panel>
        </section>

        <Panel className="leaderboard-standings-panel">
          <div className="leaderboard-standings-toolbar">
            <div>
              <span className="club-section-heading">Standings</span>
              <p className="club-muted">Public wallets. Click through for rank dNFTs and milestones.</p>
            </div>
            <label className="leaderboard-search">
              <Search size={15} />
              <span className="sr-only">Search players</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a wallet"
              />
            </label>
          </div>
          <div className="club-table-scroll">
            <table className="club-table club-table--stack leaderboard-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Wallet</th>
                  <th>ELO</th>
                  <th className="leaderboard-optional">dNFT</th>
                  <th className="leaderboard-optional">Games</th>
                  <th className="leaderboard-optional">Move</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((player) => (
                  <tr
                    key={player.address}
                    className={
                      player.address === address
                        ? "leaderboard-you-row"
                        : undefined
                    }
                  >
                    <td>
                      <b className="leaderboard-rank">#{player.rank}</b>
                    </td>
                    <td>
                      <Link
                        href={`/profile/${player.address}`}
                        className="leaderboard-player"
                      >
                        <Avatar
                          name={player.name}
                          size={34}
                          tone={
                            player.address === address ? "maroon" : "neutral"
                          }
                        />
                        <div>
                          <strong>
                            {player.name}{" "}
                            {player.address === address && <em>You</em>}
                          </strong>
                          <span>{shortAddress(player.address)}</span>
                        </div>
                      </Link>
                    </td>
                    <td>
                      <strong>{player.elo}</strong>
                    </td>
                    <td className="leaderboard-optional">{player.rankBadge}</td>
                    <td className="leaderboard-optional">{player.games}</td>
                    <td className="leaderboard-optional">
                      <Movement value={player.move} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visible.length === 0 && (
            <div className="club-empty">No wallet matches “{query}”.</div>
          )}
        </Panel>
      </div>
    </PokerAppShell>
  );
}
