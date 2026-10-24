import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  Clock3,
  Coins,
  Crown,
  Trophy,
  UsersRound,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatChips,
  sampleGames,
  samplePlayer,
  type SampleGame,
} from "@/lib/poker-design";
import "@/styles/profile.css";

type HistoryFilter = "all" | "win" | "loss";

const filters: { id: HistoryFilter; label: string }[] = [
  { id: "all", label: "All hands" },
  { id: "win", label: "Wins" },
  { id: "loss", label: "Losses" },
];

function signedChips(value: number) {
  return `${value > 0 ? "+" : "−"}${formatChips(Math.abs(value))}`;
}

export default function ProfilePage() {
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [selectedGame, setSelectedGame] = useState<SampleGame | null>(null);

  const metrics = useMemo(() => {
    const recentNet = sampleGames.reduce(
      (total, game) => total + game.chipChange,
      0,
    );
    const winRate = Math.round((samplePlayer.wins / samplePlayer.games) * 100);
    return { recentNet, winRate };
  }, []);

  const filteredGames = useMemo(
    () =>
      sampleGames.filter(
        (game) =>
          historyFilter === "all" ||
          game.result.toLowerCase() === historyFilter,
      ),
    [historyFilter],
  );

  return (
    <PokerAppShell section="profile">
      <div className="profile-page">
        <PageHeading
          eyebrow="MY PROFILE"
          title="Your poker story."
          description="A quiet look back at the hands, tables, and company in this fictional club preview."
          action={
            <Link href="/play" className="club-button">
              Find a table <ArrowUpRight size={15} />
            </Link>
          }
        />

        <p className="profile-sample-notice" role="note">
          <span aria-hidden="true">◆</span> Example profile and history only. No
          live account, balances, or game records are shown here.
        </p>

        <section
          className="profile-overview"
          aria-label="Example player profile"
        >
          <Panel className="profile-identity-panel">
            <div className="profile-identity-topline">
              <span>PLAYER CARD</span>
              <Pill tone="violet">EXAMPLE</Pill>
            </div>
            <div className="profile-identity">
              <Avatar
                name={samplePlayer.name}
                size={62}
                className="profile-avatar"
              />
              <div>
                <div className="profile-name-line">
                  <h2>{samplePlayer.name}</h2>
                  <Pill tone="maroon">{samplePlayer.title}</Pill>
                </div>
                <p className="profile-handle">@{samplePlayer.handle}</p>
                <p className="profile-bio">{samplePlayer.bio}</p>
              </div>
            </div>
            <div className="profile-member-note">
              <span>CLUB MEMBER SINCE</span>
              <strong>{samplePlayer.joined}</strong>
            </div>
          </Panel>

          <Panel className="profile-featured-panel">
            <div className="profile-panel-kicker">
              <Crown size={14} /> FEATURED HAND
            </div>
            <div className="profile-featured-content">
              <div>
                <h2>High notes, low stakes.</h2>
                <p>
                  A shining example hand from the design fixture: straight on
                  the river.
                </p>
                <Pill tone="maroon">FICTIONAL HIGHLIGHT</Pill>
              </div>
              <div
                className="profile-featured-cards"
                aria-label="Ace of spades and king of hearts"
              >
                <DeckCard
                  card="AS"
                  width={110}
                  foil
                  label="Featured example ace of spades"
                />
                <DeckCard
                  card="KH"
                  width={110}
                  foil
                  label="Featured example king of hearts"
                />
              </div>
            </div>
          </Panel>
        </section>

        <section
          className="profile-stats"
          aria-label="Example poker statistics"
        >
          <StatTile
            label="Games played"
            value={samplePlayer.games}
            note="Example total"
            tone="neutral"
          />
          <StatTile
            label="Win rate"
            value={`${metrics.winRate}%`}
            note={`${samplePlayer.wins} example wins`}
            tone="violet"
          />
          <StatTile
            label="Play chips"
            value={formatChips(samplePlayer.chips)}
            note="For the good times"
            tone="neutral"
          />
          <StatTile
            label="Recent net"
            value={signedChips(metrics.recentNet)}
            note="Last 6 example games"
            tone="maroon"
          />
        </section>

        <section
          className="profile-history"
          aria-labelledby="past-games-heading"
        >
          <div className="profile-history-heading">
            <div>
              <span className="club-section-heading">PAST GAMES</span>
              <h2 id="past-games-heading">The hands we remember.</h2>
              <p className="club-muted">
                Six fictional sessions from Jamie’s design-preview history.
              </p>
            </div>
            <div
              className="club-segmented profile-history-filters"
              aria-label="Filter example past games"
            >
              {filters.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  aria-pressed={historyFilter === filter.id}
                  onClick={() => setHistoryFilter(filter.id)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <Panel className="profile-history-panel">
            <div className="club-table-scroll">
              <table className="club-table club-table--stack profile-history-table">
                <caption className="sr-only">Example past poker games</caption>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Table &amp; hand</th>
                    <th>Players</th>
                    <th>Result</th>
                    <th>Chip net</th>
                    <th>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredGames.map((game) => (
                    <tr key={game.id}>
                      <td>
                        <time>{game.date}</time>
                      </td>
                      <td className="club-cell-main">
                        <button
                          type="button"
                          className="profile-game-link"
                          onClick={() => setSelectedGame(game)}
                          aria-label={`View example details for ${game.table} on ${game.date}`}
                        >
                          <span>{game.table}</span>
                          <span
                            className="profile-mini-hand"
                            aria-label={`Example hand: ${game.bestHand}`}
                          >
                            {game.cards.map((card) => (
                              <DeckCard
                                key={card}
                                card={card}
                                width={28}
                                foil={false}
                                className="profile-card-thumb"
                              />
                            ))}
                          </span>
                        </button>
                      </td>
                      <td>
                        <span className="profile-players">
                          <UsersRound size={14} />
                          {game.players}
                        </span>
                      </td>
                      <td>
                        <Pill tone={game.result === "Win" ? "violet" : "muted"}>
                          {game.result}
                        </Pill>
                      </td>
                      <td
                        className={
                          game.chipChange > 0
                            ? "profile-net profile-net--positive"
                            : "profile-net profile-net--negative"
                        }
                      >
                        {signedChips(game.chipChange)}
                      </td>
                      <td>
                        <span className="profile-duration">
                          <Clock3 size={13} />
                          {game.duration}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredGames.length === 0 && (
              <div className="club-empty">
                No fictional games match this filter.
              </div>
            )}
          </Panel>
        </section>

        <section
          className="profile-highlights"
          aria-label="Example club highlights"
        >
          <Panel className="profile-highlight">
            <Trophy size={17} />
            <div>
              <span>EXAMPLE NOTE</span>
              <strong>Three wins in this six-game sample.</strong>
            </div>
          </Panel>
          <Panel className="profile-highlight">
            <Coins size={17} />
            <div>
              <span>EXAMPLE TABLE</span>
              <strong>Friday Night Crew appears twice.</strong>
            </div>
          </Panel>
        </section>
      </div>

      <Dialog
        open={Boolean(selectedGame)}
        onOpenChange={(open) => !open && setSelectedGame(null)}
      >
        {selectedGame && (
          <DialogContent className="profile-game-dialog">
            <DialogHeader>
              <span className="club-section-heading">EXAMPLE GAME DETAIL</span>
              <DialogTitle>{selectedGame.table}</DialogTitle>
              <DialogDescription>
                Fictional preview data for {selectedGame.date}. This does not
                represent a recorded game or real result.
              </DialogDescription>
            </DialogHeader>
            <div className="profile-dialog-detail">
              <div>
                <span>Best hand</span>
                <strong>{selectedGame.bestHand}</strong>
              </div>
              <div>
                <span>Table</span>
                <strong>
                  {selectedGame.players} players · {selectedGame.duration}
                </strong>
              </div>
              <div>
                <span>Chip net</span>
                <strong
                  className={
                    selectedGame.chipChange > 0
                      ? "profile-net--positive"
                      : "profile-net--negative"
                  }
                >
                  {signedChips(selectedGame.chipChange)} play chips
                </strong>
              </div>
            </div>
            <div
              className="profile-dialog-cards"
              aria-label={`Example ${selectedGame.bestHand} cards`}
            >
              {selectedGame.cards.map((card) => (
                <DeckCard key={card} card={card} width={58} foil={false} />
              ))}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </PokerAppShell>
  );
}
