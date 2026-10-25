import { useEffect, useState } from "react";
import { ArrowUpRight, ShieldCheck, Trophy } from "lucide-react";
import { Link } from "wouter";
import PokerAppShell from "@/components/poker-app/PokerAppShell";
import { PageHeading, Panel, Pill } from "@/components/poker-app/PokerUI";
import { api, type PublicMatch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { gameModes } from "@/lib/game-modes";
import { demoPlayerFromAddress } from "@/lib/poker-design";
import "@/styles/play.css";

export default function PlayPage() {
  const { address } = useAuth();
  const player = demoPlayerFromAddress(address ?? "demo");
  const [live, setLive] = useState<PublicMatch | null>(null);

  useEffect(() => {
    if (!address) return;
    void api
      .activeMatch(address)
      .then((payload) => setLive(payload.match))
      .catch(() => undefined);
  }, [address]);

  return (
    <PokerAppShell section="play">
      <div className="play-page">
        <PageHeading
          eyebrow="DASHBOARD · LIVE QUEUE"
          title="Pick a ranked mode."
          description="Each format keeps its own ELO. Matchmaking is live. ELO escrow still settles on Solana later."
        />
        {live && (
          <Panel className="queue-panel">
            <div className="queue-status">
              <Pill tone="maroon">AT THE TABLE</Pill>
              <h2>You have a {live.status} {live.mode} match.</h2>
              <p>Hand {live.handNumber} · {live.street}</p>
            </div>
            <Link href={`/table/${live.id}`} className="club-button">
              Return to table <ArrowUpRight size={15} />
            </Link>
          </Panel>
        )}

        <section className="mode-grid" aria-label="Ranked game modes">
          {gameModes.map((mode) => {
            const stats = player.modes[mode.id];
            return (
              <Panel key={mode.id} className="mode-card">
                <div className="mode-card-top">
                  <Pill tone="violet">{mode.seats} seats</Pill>
                  <span>{stats.rank} dNFT</span>
                </div>
                <h2>{mode.label}</h2>
                <p>{mode.tagline}</p>
                <dl className="mode-stats">
                  <div>
                    <dt>Your ELO</dt>
                    <dd>{stats.elo}</dd>
                  </div>
                  <div>
                    <dt>Escrow</dt>
                    <dd>{mode.escrow}</dd>
                  </div>
                  <div>
                    <dt>Games</dt>
                    <dd>{stats.games}</dd>
                  </div>
                </dl>
                <Link href={`/queue/${mode.id}`} className="club-button">
                  Queue {mode.label}{" "}
                  <ArrowUpRight size={15} aria-hidden="true" />
                </Link>
              </Panel>
            );
          })}
        </section>

        <section className="play-notes" aria-label="How ranked play works">
          <Panel className="play-note">
            <ShieldCheck size={18} />
            <div>
              <strong>ELO escrow</strong>
              <p>
                Both sides lock this mode’s ELO before cards come out. Demo
                numbers only — the chain settlement is not live yet.
              </p>
            </div>
          </Panel>
          <Panel className="play-note">
            <Trophy size={18} />
            <div>
              <strong>Rank dNFTs</strong>
              <p>
                Bronze through Diamond mint per mode as your ELO crosses each
                rank. Hands won and hands folded unlock extra milestones.
              </p>
            </div>
          </Panel>
        </section>
      </div>
    </PokerAppShell>
  );
}
