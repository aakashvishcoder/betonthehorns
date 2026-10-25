import { useEffect, useState } from "react";
import { ArrowUpRight, Bot } from "lucide-react";
import { Link, useLocation } from "wouter";
import TableQuestion from "@/components/coach/TableQuestion";
import PokerAppShell from "@/components/poker-app/PokerAppShell";
import { PageHeading, Panel, Pill, RankMedal } from "@/components/poker-app/PokerUI";
import Stepper, { Step } from "@/components/react-bits/Stepper";
import { api, type ProfileMode, type PublicMatch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { gameModes } from "@/lib/game-modes";
import { walletToast } from "@/lib/wallet-toast";
import "@/styles/play.css";

export default function PlayPage() {
  const { address } = useAuth();
  const [modes, setModes] = useState<ProfileMode[]>([]);
  const [live, setLive] = useState<PublicMatch | null>(null);
  const [, navigate] = useLocation();
  const [starting, setStarting] = useState<string | null>(null);

  async function practice(mode: (typeof gameModes)[number]["id"]) {
    setStarting(mode);
    try {
      const { matchId } = await api.practice(mode);
      navigate(`/table/${matchId}`);
    } catch (error) {
      walletToast.error((error as Error).message || "Couldn't start a practice table.");
    } finally {
      setStarting(null);
    }
  }

  useEffect(() => {
    if (!address) return;
    void api
      .activeMatch(address)
      .then((payload) => setLive(payload.match))
      .catch(() => undefined);
    void api
      .profile(address)
      .then((record) => setModes(record.modes))
      .catch(() => undefined);
  }, [address]);

  return (
    <PokerAppShell section="play">
      <div className="play-page">
        <PageHeading
          eyebrow="DASHBOARD · LIVE QUEUE"
          title="Pick a ranked mode."
          description="Each format keeps its own ELO. The table locks what each rating can lose. Beating a higher rating is worth more."
        />
        {live && live.status === "playing" && (
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
            const stats = modes.find((item) => item.mode === mode.id);
            return (
              <Panel key={mode.id} className="mode-card">
                <div className="mode-card-top">
                  <Pill tone="violet">{mode.seats} seats</Pill>
                  <span className="rank-chip-label">
                    <RankMedal rank={stats?.rank ?? "Bronze"} size={22} />
                    {stats?.rank ?? "Bronze"}
                  </span>
                </div>
                <h2>{mode.label}</h2>
                <p>{mode.tagline}</p>
                <dl className="mode-stats">
                  <div>
                    <dt>Your ELO</dt>
                    <dd>{stats?.elo ?? 1200}</dd>
                  </div>
                  <div>
                    <dt>Escrow</dt>
                    <dd>At risk</dd>
                  </div>
                  <div>
                    <dt>Games</dt>
                    <dd>{stats?.games ?? 0}</dd>
                  </div>
                </dl>
                <div className="mode-card-actions">
                  <Link href={`/queue/${mode.id}`} className="club-button">
                    Queue {mode.label}{" "}
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </Link>
                  <button
                    type="button"
                    className="club-button club-button--secondary"
                    onClick={() => void practice(mode.id)}
                    disabled={starting !== null}
                  >
                    {starting === mode.id ? "Seating the AIs…" : "Practice vs AI"}{" "}
                    <Bot size={15} aria-hidden="true" />
                  </button>
                </div>
              </Panel>
            );
          })}
        </section>

        <TableQuestion />

        <section className="play-how" aria-label="How a ranked match works">
          <Stepper
            accentColor="#d081f1"
            theme="dark"
            width="100%"
            nextButtonText="Next"
            completeButtonText="Got it"
            backButtonText="Back"
            completedContent={
              <p>Queue a mode above. The escrow locks when the table opens.</p>
            }
          >
            <Step title="Mode">
              <h3>Pick a ranked mode.</h3>
              <p>Hands Up, SNG 4, or SNG 6. Each format keeps its own ELO.</p>
            </Step>
            <Step title="Queue">
              <h3>Wait for the seats.</h3>
              <p>
                The table opens when the queue fills. Practice versus AI if you
                want a table right now.
              </p>
            </Step>
            <Step title="Escrow">
              <h3>ELO escrow.</h3>
              <p>
                Ratings start at 1,200, and any rating can queue. When the table
                opens, each player locks the ELO the formula says they could lose
                to that field. Beating a higher rating is worth more than beating
                a lower one. You never lose more than you locked.
              </p>
            </Step>
            <Step title="Rank">
              <h3>Rank dNFTs.</h3>
              <p>
                Bronze through Platinum follow each mode’s ELO. Hands played and
                games won unlock the milestone dNFTs.
              </p>
            </Step>
          </Stepper>
        </section>
      </div>
    </PokerAppShell>
  );
}
