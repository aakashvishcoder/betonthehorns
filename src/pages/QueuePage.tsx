import { useEffect, useRef, useState } from "react";
import { UsersRound } from "lucide-react";
import { Link, useLocation, useRoute } from "wouter";
import PokerAppShell from "@/components/poker-app/PokerAppShell";
import { PageHeading, Panel, Pill } from "@/components/poker-app/PokerUI";
import { api, type QueueSnapshot } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getGameMode, isGameModeId } from "@/lib/game-modes";
import { enterQueuePresence, sendInbox, subscribeChannel, watchConnection, watchGlobalQueue } from "@/lib/realtime";
import "@/styles/play.css";

export default function QueuePage() {
  const [, params] = useRoute<{ mode: string }>("/queue/:mode");
  const [, navigate] = useLocation();
  const { address } = useAuth();
  const modeId = params?.mode && isGameModeId(params.mode) ? params.mode : null;
  const mode = modeId ? getGameMode(modeId) : null;
  const [elo, setElo] = useState(1200);
  const [rank, setRank] = useState("Bronze");
  const [seconds, setSeconds] = useState(0);
  const [queue, setQueue] = useState<QueueSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const matchedRef = useRef(false);
  const seatRef = useRef(0);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!modeId || !address) return;
    let cancelled = false;
    const mine = ++seatRef.current;
    matchedRef.current = false;

    const goTable = (matchId: string) => {
      if (matchedRef.current) return;
      matchedRef.current = true;
      navigateRef.current(`/table/${matchId}`);
    };

    void api
      .profile(address)
      .then((record) => {
        const stats = record.modes.find((item) => item.mode === modeId);
        if (!stats || cancelled) return;
        setElo(stats.elo);
        setRank(stats.rank);
      })
      .catch(() => undefined);

    void sendInbox(address, "join", { mode: modeId }).catch(() => undefined);
    const leavePresence = enterQueuePresence(address, modeId);

    void api
      .joinQueue(address, modeId)
      .then((result) => {
        if (cancelled) return;
        setQueue(result.queue);
        if (result.status === "playing" && result.matchId) goTable(result.matchId);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    const stopQueue = watchGlobalQueue(address, modeId, mode?.seats ?? 2, (data) => {
      if (!cancelled) setQueue(data);
    });
    const stopWallet = subscribeChannel(address, `wallet:${address}`, "matched", (data) => {
      const payload = data as { matchId?: string; match?: { status?: string; id?: string } };
      if (payload.match?.status === "finished") return;
      const id = payload.matchId ?? payload.match?.id;
      if (id) goTable(id);
    });
    const stopConnection = watchConnection(address, (state, reason) => {
      if (cancelled) return;
      if (state === "failed" || state === "suspended") {
        setError(reason || "Live updates did not connect. Still checking for a table.");
      }
    });

    return () => {
      cancelled = true;
      stopQueue();
      stopWallet();
      stopConnection();
      leavePresence();
      window.setTimeout(() => {
        if (seatRef.current !== mine || matchedRef.current) return;
        void sendInbox(address, "leave", {}).catch(() => undefined);
        void api.leaveQueue(address).catch(() => undefined);
      }, 400);
    };
  }, [address, modeId]);

  if (!mode || !modeId) {
    navigate("/play");
    return null;
  }

  const waiting = queue?.count ?? 1;

  return (
    <PokerAppShell section="queue">
      <div className="play-page">
        <PageHeading
          eyebrow={`${mode.label.toUpperCase()} · LIVE QUEUE`}
          title={`Line up for ${mode.label}.`}
          description={`${mode.seats} seats. This mode’s ELO locks when the table opens. The swing depends on the ratings at the table.`}
          action={
            <Link href="/play" className="club-button club-button--secondary">
              Back to dashboard
            </Link>
          }
        />

        <Panel className="queue-panel">
          <div className="queue-status">
            <Pill tone="maroon">SEARCHING</Pill>
            <h2>Waiting for {mode.seats} wallets worldwide.</h2>
            <p>
              {waiting} / {mode.seats} in the global {mode.label} queue · {seconds}s
            </p>
            <p>This mode has one queue on Ably. The table starts when {mode.seats} wallets are in it.</p>
            {error && <p>{error}</p>}
          </div>
          <dl className="mode-stats">
            <div>
              <dt>Your ELO</dt>
              <dd>{elo}</dd>
            </div>
            <div>
              <dt>Rank dNFT</dt>
              <dd>{rank}</dd>
            </div>
            <div>
              <dt>Escrow</dt>
              <dd>At risk</dd>
            </div>
          </dl>
          <div className="queue-actions">
            <Link href="/play" className="club-button club-button--ghost">
              Leave queue
            </Link>
          </div>
          <p className="queue-hint">
            <UsersRound size={14} /> Anyone on this {mode.label} queue, anywhere, can fill a seat.
            {queue && queue.wallets.length === 1 && queue.wallets[0] === address
              ? " This wallet is one seat, so the other device needs a different wallet."
              : ""}
          </p>
        </Panel>
      </div>
    </PokerAppShell>
  );
}
