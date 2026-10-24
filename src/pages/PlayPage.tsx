import { ArrowUpRight, ShieldCheck, Trophy } from "lucide-react";
import { Link } from "wouter";
import PokerAppShell from "@/components/poker-app/PokerAppShell";
import { PageHeading, Panel, Pill } from "@/components/poker-app/PokerUI";
import { useAuth } from "@/lib/auth";
import { gameModes } from "@/lib/game-modes";
import { demoPlayerFromAddress } from "@/lib/poker-design";
import "@/styles/play.css";

export default function PlayPage() {
  const { address } = useAuth();
  const player = demoPlayerFromAddress(address ?? "demo");

  return (
    <PokerAppShell section="play">
      <div className="play-page">
        <PageHeading
          eyebrow="DASHBOARD · DEMO"
          title="Pick a ranked mode."
          description="Each format keeps its own ELO. A match escrows that mode’s ELO on Solana, then settles it when the table ends."
        />

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
