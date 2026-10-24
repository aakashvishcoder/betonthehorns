import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Minus,
  Search,
} from "lucide-react";
import { Link } from "wouter";
import PokerAppShell from "@/components/poker-app/PokerAppShell";
import {
  Avatar,
  DeckCard,
  PageHeading,
  Panel,
  Pill,
  StatTile,
} from "@/components/poker-app/PokerUI";
import { formatChips, sampleStandings } from "@/lib/poker-design";
import "@/styles/leaderboard.css";

type Period = "week" | "month" | "all";
type Standing = (typeof sampleStandings)[number] & {
  rank: number;
  score: number;
  periodGames: number;
  periodWins: number;
};

const periods: {
  id: Period;
  tab: string;
  heading: string;
  chipFactor: number;
  gameFactor: number;
  winFactor: number;
  winWeight: number;
  orderWeight: number;
}[] = [
  {
    id: "week",
    tab: "This week",
    heading: "Weekly",
    chipFactor: 0.21,
    gameFactor: 0.25,
    winFactor: 0.25,
    winWeight: 73,
    orderWeight: 41,
  },
  {
    id: "month",
    tab: "This month",
    heading: "Monthly",
    chipFactor: 0.56,
    gameFactor: 0.58,
    winFactor: 0.58,
    winWeight: 39,
    orderWeight: 17,
  },
  {
    id: "all",
    tab: "All time",
    heading: "All-time",
    chipFactor: 1,
    gameFactor: 1,
    winFactor: 1,
    winWeight: 0,
    orderWeight: 0,
  },
];

function buildStandings(period: Period): Standing[] {
  const config = periods.find(item => item.id === period) ?? periods[0];
  return sampleStandings
    .map((player, index) => ({
      ...player,
      score: Math.round(
        player.chips * config.chipFactor +
          player.wins * config.winWeight +
          (sampleStandings.length - index) * config.orderWeight
      ),
      periodGames: Math.max(1, Math.round(player.games * config.gameFactor)),
      periodWins: Math.max(0, Math.round(player.wins * config.winFactor)),
    }))
    .sort((a, b) => b.score - a.score)
    .map((player, index) => ({ ...player, rank: index + 1 }));
}

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
  const [period, setPeriod] = useState<Period>("week");
  const [query, setQuery] = useState("");
  const standings = useMemo(() => buildStandings(period), [period]);
  const periodLabel = periods.find(item => item.id === period) ?? periods[0];
  const topThree = standings.slice(0, 3);
  const jamie = standings.find(player => player.name === "Jamie");
  const visibleStandings = standings.filter(player =>
    `${player.name} ${player.handle}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  );

  return (
    <PokerAppShell section="leaderboard">
      <div className="leaderboard-page">
        <PageHeading
          eyebrow="THE CLUB · SAMPLE STANDINGS"
          title="Good hands. Great company."
          description="A fictional table tally for design preview—nothing here is a live player record."
          action={
            <Link
              href="/profile"
              className="club-button club-button--secondary"
            >
              My profile <ArrowUpRight size={15} />
            </Link>
          }
        />

        <section
          className="leaderboard-controls"
          aria-label="Leaderboard controls"
        >
          <div
            className="club-segmented"
            role="group"
            aria-label="Choose sample standings period"
          >
            {periods.map(item => (
              <button
                key={item.id}
                type="button"
                aria-pressed={period === item.id}
                onClick={() => setPeriod(item.id)}
              >
                {item.tab}
              </button>
            ))}
          </div>
          <p className="club-muted">
            Local preview only · scores and ranks change with the sample period.
          </p>
        </section>

        <section
          className="leaderboard-overview"
          aria-label="Sample leaderboard highlights"
        >
          <Panel className="leaderboard-podium-panel">
            <div className="leaderboard-panel-heading">
              <div>
                <span className="club-section-heading">
                  A friendly little lead
                </span>
                <p>Top three in this sample view.</p>
              </div>
              <Pill tone="violet">Example data</Pill>
            </div>
            <div className="leaderboard-podium">
              {topThree.map((player, index) => (
                <article
                  key={player.handle}
                  className={`leaderboard-podium-card leaderboard-podium-card--${index + 1}`}
                >
                  <span className="leaderboard-podium-rank">
                    #{player.rank}
                  </span>
                  <Avatar
                    name={player.name}
                    size={index === 0 ? 48 : 40}
                    tone={index === 1 ? "maroon" : "violet"}
                  />
                  <div className="leaderboard-podium-copy">
                    <strong>{player.name}</strong>
                    <span>@{player.handle}</span>
                  </div>
                  <b>{formatChips(player.score)}</b>
                  <small>sample points</small>
                </article>
              ))}
            </div>
          </Panel>

          <Panel className="leaderboard-place-panel">
            <div className="leaderboard-panel-heading">
              <div>
                <span className="club-section-heading">
                  Your place at the table
                </span>
                <p>Jamie’s fictional profile fixture.</p>
              </div>
              <Pill tone="maroon">You (sample)</Pill>
            </div>
            <div className="leaderboard-place-main">
              <Avatar name="Jamie" size={50} tone="maroon" />
              <div>
                <strong>
                  Jamie <span>You (sample)</span>
                </strong>
                <p>@jamieplays · #{jamie?.rank ?? "—"} this period</p>
              </div>
              <Link
                href="/profile"
                className="club-button club-button--ghost"
                aria-label="Open Jamie's sample profile"
              >
                Profile <ArrowRight size={14} />
              </Link>
            </div>
            <div className="leaderboard-place-stats">
              <StatTile
                label="Sample rank"
                value={`#${jamie?.rank ?? "—"}`}
                note="before search"
                tone="maroon"
              />
              <StatTile
                label="Sample points"
                value={jamie ? formatChips(jamie.score) : "—"}
                note={periodLabel.heading.toLowerCase()}
                tone="violet"
              />
              <div className="leaderboard-best-hand">
                <span>Featured sample hand</span>
                <b>Straight</b>
                <div>
                  <DeckCard card="AS" width={32} foil={false} />
                  <DeckCard card="KH" width={32} foil={false} />
                </div>
              </div>
            </div>
          </Panel>
        </section>

        <Panel className="leaderboard-standings-panel">
          <div className="leaderboard-standings-toolbar">
            <div>
              <span className="club-section-heading">
                Example {periodLabel.heading} standings
              </span>
              <p className="club-muted">
                Eight fictional club regulars. Rank stays tied to the full
                sample before filtering.
              </p>
            </div>
            <label className="leaderboard-search">
              <Search size={15} />
              <span className="sr-only">Search sample players</span>
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Find a player"
              />
            </label>
          </div>
          <div className="club-table-scroll">
            <table className="club-table leaderboard-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Player</th>
                  <th>Points</th>
                  <th className="leaderboard-optional">Games</th>
                  <th className="leaderboard-optional">Wins</th>
                  <th className="leaderboard-optional">Move</th>
                </tr>
              </thead>
              <tbody>
                {visibleStandings.map(player => (
                  <tr
                    key={player.handle}
                    className={
                      player.name === "Jamie"
                        ? "leaderboard-you-row"
                        : undefined
                    }
                  >
                    <td>
                      <b className="leaderboard-rank">#{player.rank}</b>
                    </td>
                    <td>
                      <div className="leaderboard-player">
                        <Avatar
                          name={player.name}
                          size={34}
                          tone={player.name === "Jamie" ? "maroon" : "neutral"}
                        />
                        <div>
                          <strong>
                            {player.name}{" "}
                            {player.name === "Jamie" && <em>You (sample)</em>}
                          </strong>
                          <span>@{player.handle}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <strong>{formatChips(player.score)}</strong>
                      <small>sample points</small>
                    </td>
                    <td className="leaderboard-optional">
                      {player.periodGames}
                    </td>
                    <td className="leaderboard-optional">
                      {player.periodWins}
                    </td>
                    <td className="leaderboard-optional">
                      <Movement value={player.change} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visibleStandings.length === 0 && (
            <div className="club-empty">
              No fictional player matches “{query}”.
            </div>
          )}
        </Panel>
      </div>
    </PokerAppShell>
  );
}
