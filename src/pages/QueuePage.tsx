import { useEffect, useRef, useState } from "react";
import { UsersRound } from "lucide-react";
import { Link, useLocation, useRoute } from "wouter";
import PokerAppShell from "@/components/poker-app/PokerAppShell";
import { PageHeading, Panel, Pill } from "@/components/poker-app/PokerUI";
import { api, type QueueSnapshot } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getGameMode, isGameModeId } from "@/lib/game-modes";
import { demoPlayerFromAddress } from "@/lib/poker-design";
import { subscribeChannel } from "@/lib/realtime";
import "@/styles/play.css";

export default function QueuePage() {
  const [, params] = useRoute<{ mode: string }>("/queue/:mode");
  const [, navigate] = useLocation();
  const { address } = useAuth();
  const modeId = params?.mode && isGameModeId(params.mode) ? params.mode : null;
  const mode = modeId ? getGameMode(modeId) : null;
  const player = demoPlayerFromAddress(address ?? "demo");
  const [seconds, setSeconds] = useState(0);
  const [queue, setQueue] = useState<QueueSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const matchedRef = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!modeId || !address) return;
    let cancelled = false;

    const goTable = (matchId: string) => {
      if (matchedRef.current) return;
      matchedRef.current = true;
      navigate(`/table/${matchId}`);
    };

    void api
      .joinQueue(address, modeId)
      .then((result) => {
        if (cancelled) return;
        setQueue(result.queue);
        if (result.matchId) goTable(result.matchId);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    const stopQueue = subscribeChannel(address, `queue:${modeId}`, "waiting", (data) => {
      setQueue(data as QueueSnapshot);
    });
    const stopWallet = subscribeChannel(address, `wallet:${address}`, "matched", (data) => {
      const payload = data as { matchId?: string };
      if (payload.matchId) goTable(payload.matchId);
    });
    const stopState = subscribeChannel(address, `wallet:${address}`, "state", (data) => {
      const payload = data as { matchId?: string };
      if (payload.matchId) goTable(payload.matchId);
    });

    return () => {
      cancelled = true;
      stopQueue();
      stopWallet();
      stopState();
      if (!matchedRef.current) {
        void api.leaveQueue(address).catch(() => undefined);
      }
    };
  }, [address, modeId, navigate]);

  if (!mode || !modeId) {
    navigate("/play");
    return null;
  }

  const stats = player.modes[modeId];
  const waiting = queue?.count ?? 1;

  return (
    <PokerAppShell section="queue">
      <div className="play-page">
        <PageHeading
          eyebrow={`${mode.label.toUpperCase()} · LIVE QUEUE`}
          title={`Line up for ${mode.label}.`}
          description={`${mode.seats} seats. ${mode.escrow} ELO from this mode will be escrowed on Solana later. Matchmaking is live now.`}
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
            <p>The table starts when {mode.seats} wallets are in this queue.</p>
            {error && <p>{error}</p>}
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
            <Link href="/play" className="club-button club-button--ghost">
              Leave queue
            </Link>
          </div>
          <p className="queue-hint">
            <UsersRound size={14} /> The table opens on its own when the seats fill.
          </p>
        </Panel>
      </div>
    </PokerAppShell>
  );
}
