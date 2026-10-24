import { useMemo, useState } from "react";
import { ArrowUpRight, Trophy } from "lucide-react";
import { Link, Redirect, useRoute } from "wouter";
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
import { useAuth } from "@/lib/auth";
import { gameModes, type GameModeId } from "@/lib/game-modes";
import {
  demoPlayerFromAddress,
  playerMilestones,
  sampleGames,
  type SampleGame,
} from "@/lib/poker-design";
import { shortAddress } from "@/lib/utils";
import "@/styles/profile.css";

export default function ProfilePage() {
  const [, params] = useRoute<{ address: string }>("/profile/:address");
  const { isAuthenticated, address: myAddress } = useAuth();
  const [selectedGame, setSelectedGame] = useState<SampleGame | null>(null);
  const lookedUp = params?.address ?? myAddress ?? "demo";
  const player = demoPlayerFromAddress(lookedUp);
  const mine = myAddress === player.address;
  const milestones = useMemo(() => playerMilestones(player), [player]);
  const totals = useMemo(() => {
    return gameModes.reduce(
      (sum, mode) => {
        const stats = player.modes[mode.id];
        return {
          games: sum.games + stats.games,
          wins: sum.wins + stats.wins,
          handsWon: sum.handsWon + stats.handsWon,
          handsFolded: sum.handsFolded + stats.handsFolded,
        };
      },
      { games: 0, wins: 0, handsWon: 0, handsFolded: 0 },
    );
  }, [player]);

  if (!params?.address) {
    if (isAuthenticated && myAddress) {
      return <Redirect to={`/profile/${myAddress}`} />;
    }
    return <Redirect to="/leaderboard" />;
  }

  return (
    <PokerAppShell section="profile">
      <div className="profile-page">
        <PageHeading
          eyebrow={mine ? "YOUR WALLET · DEMO" : "PUBLIC PROFILE · DEMO"}
          title={player.name}
          description={`${shortAddress(player.address)} · Separate ELO, rank dNFTs, and milestones for Hands Up, SNG 4, and SNG 6.`}
          action={
            <Link href="/play" className="club-button">
              Queue a mode <ArrowUpRight size={15} />
            </Link>
          }
        />

        <section className="profile-overview" aria-label="Wallet identity">
          <Panel className="profile-identity-panel">
            <div className="profile-identity-topline">
              <span>SOLANA WALLET</span>
              <Pill tone={mine ? "maroon" : "violet"}>
                {mine ? "You" : "Public"}
              </Pill>
            </div>
            <div className="profile-identity">
              <Avatar name={player.name} size={62} className="profile-avatar" />
              <div>
                <div className="profile-name-line">
                  <h2>{player.name}</h2>
                  <Pill tone="maroon">@{player.handle}</Pill>
                </div>
                <p className="profile-handle">{player.address}</p>
                <p className="profile-bio">
                  Ranked Hold’em on Solana. ELO is escrowed per game. Rank
                  dNFTs mint when this wallet crosses a new tier.
                </p>
              </div>
            </div>
          </Panel>

          <Panel className="profile-featured-panel">
            <div className="profile-panel-kicker">
              <Trophy size={14} /> FEATURED HAND
            </div>
            <div className="profile-featured-content">
              <div>
                <h2>Straight on the river.</h2>
                <p>Demo highlight from a Hands Up match.</p>
                <Pill tone="maroon">DEMO</Pill>
              </div>
              <div className="profile-featured-cards">
                <DeckCard card="AS" width={110} foil label="Ace of spades" />
                <DeckCard card="KH" width={110} foil label="King of hearts" />
              </div>
            </div>
          </Panel>
        </section>

        <section className="profile-stats" aria-label="Career totals">
          <StatTile label="Games" value={totals.games} note="All modes" />
          <StatTile
            label="Wins"
            value={totals.wins}
            note="Across ranked tables"
            tone="violet"
          />
          <StatTile
            label="Hands won"
            value={totals.handsWon}
            note="Milestone track"
          />
          <StatTile
            label="Hands folded"
            value={totals.handsFolded}
            note="Milestone track"
            tone="maroon"
          />
        </section>

        <section className="profile-modes" aria-label="ELO by mode">
          {gameModes.map((mode) => {
            const stats = player.modes[mode.id as GameModeId];
            return (
              <Panel key={mode.id} className="profile-mode-card">
                <span>{mode.label}</span>
                <strong>{stats.elo}</strong>
                <small>
                  {stats.rank} dNFT · {stats.games} games
                </small>
              </Panel>
            );
          })}
        </section>

        <section className="profile-highlights" aria-label="dNFT milestones">
          {milestones.map((item) => (
            <Panel key={item.id} className="profile-highlight">
              <Trophy size={17} />
              <div>
                <span>{item.earned ? "MINTED" : "LOCKED"}</span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </div>
            </Panel>
          ))}
        </section>

        <section className="profile-history" aria-labelledby="past-games-heading">
          <div className="profile-history-heading">
            <div>
              <span className="club-section-heading">RECENT MATCHES</span>
              <h2 id="past-games-heading">Demo results.</h2>
            </div>
          </div>
          <Panel className="profile-history-panel">
            <div className="club-table-scroll">
              <table className="club-table club-table--stack profile-history-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Mode</th>
                    <th>Result</th>
                    <th>ELO</th>
                  </tr>
                </thead>
                <tbody>
                  {sampleGames.map((game) => (
                    <tr key={game.id}>
                      <td>
                        <time>{game.date}</time>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="profile-game-link"
                          onClick={() => setSelectedGame(game)}
                        >
                          {gameModes.find((mode) => mode.id === game.mode)?.label}
                        </button>
                      </td>
                      <td>
                        <Pill tone={game.result === "Win" ? "violet" : "muted"}>
                          {game.result}
                        </Pill>
                      </td>
                      <td
                        className={
                          game.eloChange > 0
                            ? "profile-net profile-net--positive"
                            : "profile-net profile-net--negative"
                        }
                      >
                        {game.eloChange > 0 ? "+" : ""}
                        {game.eloChange}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
              <DialogTitle>
                {gameModes.find((mode) => mode.id === selectedGame.mode)?.label}
              </DialogTitle>
              <DialogDescription>
                Demo match on {selectedGame.date}. ELO escrow is not live.
              </DialogDescription>
            </DialogHeader>
            <div className="profile-dialog-detail">
              <div>
                <span>Best hand</span>
                <strong>{selectedGame.bestHand}</strong>
              </div>
              <div>
                <span>Seats</span>
                <strong>{selectedGame.players}</strong>
              </div>
              <div>
                <span>ELO</span>
                <strong>
                  {selectedGame.eloChange > 0 ? "+" : ""}
                  {selectedGame.eloChange}
                </strong>
              </div>
            </div>
            <div className="profile-dialog-cards">
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
