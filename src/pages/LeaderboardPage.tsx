import { useEffect, useState } from "react";
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
  RankMedal,
} from "@/components/poker-app/PokerUI";
import { api, type LeaderboardRow } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import OptionWheel from "@/components/react-bits/OptionWheel";
import { gameModes, type GameModeId } from "@/lib/game-modes";
import { rankFromElo } from "@/lib/poker-design";
import { shortAddress } from "@/lib/utils";
import "@/styles/leaderboard.css";

const ladderLabels = gameModes.map((item) => item.label);

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
  const [standings, setStandings] = useState<LeaderboardRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    void api
      .leaderboard(mode)
      .then((payload) => {
        if (!cancelled) setStandings(payload.rows);
      })
      .catch(() => {
        if (!cancelled) setStandings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const topThree = standings.slice(0, 3);
  const visible = standings.filter((player) =>
    `${player.name ?? ""} ${player.address}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  return (
    <PokerAppShell section="leaderboard">
      <div className="leaderboard-page">
        <PageHeading
          eyebrow="PUBLIC BOARD"
          title="ELO by mode."
          description="Hands Up, SNG 4, and SNG 6 each keep their own ladder. Ratings update when a table finishes."
          action={
            <Link href="/play" className="club-button club-button--secondary">
              Queue up <ArrowUpRight size={15} />
            </Link>
          }
        />

        <section className="leaderboard-wheel" aria-label="Game mode">
          <OptionWheel
            items={ladderLabels}
            defaultSelected={0}
            textColor="#8d7b96"
            activeColor="#fbf5fe"
            fontSize={1.85}
            spacing={1.25}
            curve={0.8}
            tilt={7}
            blur={1.2}
            fade={0.28}
            inset={36}
            side="left"
            onChange={(index) => {
              const next = gameModes[index];
              if (next) setMode(next.id);
            }}
          />
        </section>

        <section className="leaderboard-overview" aria-label="Top rated wallets">
          <Panel className="leaderboard-podium-panel">
            <div className="leaderboard-panel-heading">
              <div>
                <span className="club-section-heading">Top horns</span>
                <p>Highest ELO in {gameModes.find((item) => item.id === mode)?.label}.</p>
              </div>
              <Pill tone="violet">{topThree.length} seated</Pill>
            </div>
            <div className="leaderboard-podium">
              {topThree.map((player, index) => (
                <article
                  key={player.address}
                  className={`leaderboard-podium-card leaderboard-podium-card--${index + 1}`}
                >
                  <span className="leaderboard-podium-rank">#{player.place}</span>
                  <Avatar
                    name={player.name || shortAddress(player.address)}
                    size={index === 0 ? 48 : 40}
                    tone={index === 1 ? "maroon" : "violet"}
                  />
                  <div className="leaderboard-podium-copy">
                    <strong>{player.name || shortAddress(player.address)}</strong>
                    <span>{shortAddress(player.address)}</span>
                  </div>
                  <b>{player.elo}</b>
                  <small className="rank-chip-label">
                    <RankMedal rank={rankFromElo(player.elo)} size={18} />
                    {rankFromElo(player.elo)} dNFT
                  </small>
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
                      <b className="leaderboard-rank">#{player.place}</b>
                    </td>
                    <td>
                      <Link
                        href={`/profile/${player.address}`}
                        className="leaderboard-player"
                      >
                        <Avatar
                          name={player.name || shortAddress(player.address)}
                          size={34}
                          tone={
                            player.address === address ? "maroon" : "neutral"
                          }
                        />
                        <div>
                          <strong>
                            {player.name || shortAddress(player.address)}{" "}
                            {player.address === address && <em>You</em>}
                          </strong>
                          <span>{shortAddress(player.address)}</span>
                          <small className="leaderboard-mobile-meta rank-chip-label">
                            <RankMedal rank={rankFromElo(player.elo)} size={16} />
                            {rankFromElo(player.elo)} · {player.games}{" "}
                            {player.games === 1 ? "game" : "games"}
                          </small>
                        </div>
                      </Link>
                    </td>
                    <td>
                      <strong>{player.elo}</strong>
                    </td>
                    <td className="leaderboard-optional">
                      <span className="rank-chip-label">
                        <RankMedal rank={rankFromElo(player.elo)} size={22} />
                        {rankFromElo(player.elo)}
                      </span>
                    </td>
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
            <div className="club-empty">
              {query.trim()
                ? `No wallet matches “${query.trim()}”.`
                : "No finished tables in this mode yet."}
            </div>
          )}
        </Panel>
      </div>
    </PokerAppShell>
  );
}
