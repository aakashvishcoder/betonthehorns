import { useEffect, useState } from "react";
import { ArrowUpRight, UsersRound } from "lucide-react";
import { Link, useLocation, useRoute } from "wouter";
import PokerAppShell from "@/components/poker-app/PokerAppShell";
import { PageHeading, Panel, Pill } from "@/components/poker-app/PokerUI";
import { useAuth } from "@/lib/auth";
import { getGameMode, isGameModeId } from "@/lib/game-modes";
import { demoPlayerFromAddress } from "@/lib/poker-design";
import "@/styles/play.css";

export default function QueuePage() {
  const [, params] = useRoute<{ mode: string }>("/queue/:mode");
  const [, navigate] = useLocation();
  const { address } = useAuth();
  const modeId = params?.mode && isGameModeId(params.mode) ? params.mode : null;
  const mode = modeId ? getGameMode(modeId) : null;
  const player = demoPlayerFromAddress(address ?? "demo");
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!mode || !modeId) {
    navigate("/play");
    return null;
  }

  const stats = player.modes[modeId];
  const waiting = 1 + (seconds % mode.seats);

  return (
    <PokerAppShell section="queue">
      <div className="play-page">
        <PageHeading
          eyebrow={`${mode.label.toUpperCase()} · QUEUE`}
          title={`Line up for ${mode.label}.`}
          description={`${mode.seats} seats. ${mode.escrow} ELO from this mode is escrowed for the match. This queue is a demo — it does not match live players yet.`}
          action={
            <Link href="/play" className="club-button club-button--secondary">
              Back to dashboard
            </Link>
          }
        />

        <Panel className="queue-panel">
          <div className="queue-status">
            <Pill tone="maroon">SEARCHING</Pill>
            <h2>Waiting for {mode.seats} wallets.</h2>
            <p>
              {waiting} / {mode.seats} in queue · {seconds}s
            </p>
          </div>
          <dl className="mode-stats">
            <div>
              <dt>Your ELO</dt>
              <dd>{stats.elo}</dd>
            </div>
            <div>
              <dt>Rank dNFT</dt>
              <dd>{stats.rank}</dd>
            </div>
            <div>
              <dt>Escrow</dt>
              <dd>{mode.escrow}</dd>
            </div>
          </dl>
          <div className="queue-actions">
            <Link
              href={`/table?mode=${mode.id}`}
              className="club-button"
            >
              Take a demo seat <ArrowUpRight size={15} />
            </Link>
            <Link href="/play" className="club-button club-button--ghost">
              Leave queue
            </Link>
          </div>
          <p className="queue-hint">
            <UsersRound size={14} /> When matchmaking is live, this button
            disappears and the table opens on its own.
          </p>
        </Panel>
      </div>
    </PokerAppShell>
  );
}
