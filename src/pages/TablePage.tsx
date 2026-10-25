import { lazy, Suspense, type CSSProperties, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Eye, EyeOff, MessageCircle } from "lucide-react";
import { Link, useRoute } from "wouter";
import PokerAppShell, { usePokerMotion } from "@/components/poker-app/PokerAppShell";
import { Avatar, CopyHash, explorerTx, RankMedal } from "@/components/poker-app/PokerUI";
import {
  api,
  type ChatMessage,
  type LegalActions,
  type PrivateView,
  type PublicMatch,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBlockCoach } from "@/components/coach/coachGate";
import { getGameMode, isGameModeId } from "@/lib/game-modes";
import { cardArt, cardName, deckArt, formatChips } from "@/lib/poker-design";
import { sendInbox, subscribeChannel } from "@/lib/realtime";
import { shortAddress } from "@/lib/utils";
import "@/styles/table.css";
import AnalysisPanel from "@/components/analysis/AnalysisPanel";

const HoloCard = lazy(() => import("@/components/react-bits/HoloCard"));

const tones = ["violet", "maroon", "neutral"] as const;

const chipDenominations = [
  { value: 25, variant: "chip-ivory" },
  { value: 100, variant: "chip-red" },
  { value: 500, variant: "" },
] as const;

function LiveCard({
  code,
  faceDown = false,
  delay = 0,
  win = false,
  feature = false,
}: {
  code?: string | null;
  faceDown?: boolean;
  delay?: number;
  win?: boolean;
  feature?: boolean;
}) {
  const { paused } = usePokerMotion();
  const hidden = faceDown || !code || code === "BACK";
  const red = !hidden && (code?.[1] === "H" || code?.[1] === "D");
  const face = hidden ? deckArt.BACK : cardArt(code ?? "BACK");
  return (
    <div
      className={`horn-card ${win ? "is-win" : ""}`}
      style={{ "--deal-delay": `${delay}ms` } as CSSProperties}
    >
      {hidden ? (
        <img className="horn-card-face" src={deckArt.BACK} alt="" />
      ) : (
        <Suspense fallback={<img className="horn-card-face" src={face} alt="" />}>
          <HoloCard
            image={face}
            alt={cardName(code ?? "")}
            preset={red ? "stars" : "shards"}
            foilColor={red ? "#e98392" : "#e1b0f7"}
            intensity={0.2}
            edgeSparkle={0.26}
            glare={0.16}
            tiltMax={feature ? 7 : 0}
            hoverScale={feature ? 1.02 : 1}
            width={feature ? 180 : 84}
            radius={10}
            frame={3}
            idle={false}
            paused={paused}
            shadow={false}
            style={{ "--hc-w": "100%" } as CSSProperties}
          />
        </Suspense>
      )}
    </div>
  );
}

function seatPosition(index: number, count: number) {
  const angle = ((90 + index * (360 / count)) * Math.PI) / 180;
  return {
    "--cos": Math.cos(angle),
    "--sin": Math.sin(angle),
  } as CSSProperties;
}

function Chip({
  label,
  variant = "",
  className = "",
}: {
  label?: string;
  variant?: string;
  className?: string;
}) {
  return (
    <span className={`poker-chip ${variant} ${className}`} aria-hidden="true">
      <span className="chip-rim">{label && <span>{label}</span>}</span>
    </span>
  );
}

const idleLegal: LegalActions = {
  canAct: false,
  toCall: 0,
  canCheck: false,
  canFold: false,
  canCall: false,
  minRaiseTo: 0,
  maxRaiseTo: 0,
};

export default function TablePage() {
  const [, params] = useRoute<{ matchId: string }>("/table/:matchId");
  const matchId = params?.matchId ?? "";
  const { address, displayAddress } = useAuth();
  const [match, setMatch] = useState<PublicMatch | null>(null);
  const [you, setYou] = useState<PrivateView | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [raising, setRaising] = useState(false);
  const [raiseTo, setRaiseTo] = useState(0);
  const [hideCards, setHideCards] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const [draftMessage, setDraftMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(-1);
  const matchRef = useRef<PublicMatch | null>(null);

  function remember(next: PublicMatch, hole?: PrivateView | null) {
    if (matchRef.current?.status === "finished" && next.status !== "finished") return;
    const rev = next.revision ?? 0;
    // Each update arrives twice with the same revision: the public table copy (no hole cards)
    // and your private copy. Never drop the private one just because the public one won the
    // race, or your cards vanish until the next change.
    if (rev < revision.current && next.status !== "finished") return;
    if (rev === revision.current && !hole && next.status !== "finished") return;
    revision.current = Math.max(revision.current, rev);
    matchRef.current = next;
    setMatch(next);
    if (next.status === "finished") setYou(null);
    else if (hole) setYou(hole);
  }

  useEffect(() => {
    if (!matchId || !address) return;
    let cancelled = false;
    revision.current = -1;
    matchRef.current = null;

    const applyState = (data: unknown) => {
      const payload = data as {
        match?: PublicMatch;
        you?: PrivateView;
        id?: string;
        revision?: number;
      };
      if (payload.match) {
        if (payload.match.id && payload.match.id !== matchId) return;
        remember(payload.match, payload.you);
        return;
      }
      if (payload.id && payload.id !== matchId) return;
      if (payload.id) remember(payload as PublicMatch);
    };

    const pull = () => {
      void api
        .match(matchId, address)
        .then((payload) => {
          if (cancelled) return;
          const first = revision.current < 0;
          remember(payload.match, payload.you);
          if (first) setError(null);
          setMessages((current) => {
            const seen = new Set(current.map((item) => `${item.at}:${item.text}`));
            const extra = payload.chat.filter((item) => !seen.has(`${item.at}:${item.text}`));
            return extra.length ? [...current, ...extra].slice(-40) : current;
          });
        })
        .catch((err: Error) => {
          if (!cancelled && revision.current < 0) setError(err.message);
        });
    };

    pull();

    const stopTable = subscribeChannel(address, `table:${matchId}`, "state", applyState);
    const stopMatched = subscribeChannel(address, `table:${matchId}`, "matched", applyState);
    const stopWallet = subscribeChannel(address, `wallet:${address}`, "state", applyState);
    const stopChat = subscribeChannel(address, `table:${matchId}`, "chat", (data) => {
      const message = data as ChatMessage;
      setMessages((current) => {
        if (current.some((item) => item.at === message.at && item.text === message.text)) {
          return current;
        }
        return [...current, message].slice(-40);
      });
    });
    const poll = window.setInterval(pull, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      stopTable();
      stopMatched();
      stopWallet();
      stopChat();
    };
  }, [address, matchId]);

  // The AI coach is off (face-down) at ranked tables, and allowed in practice vs AI.
  useBlockCoach(match?.ranked !== false);

  const mode = getGameMode(
    match && isGameModeId(match.mode) ? match.mode : "hands-up",
  );
  const seats = match?.players ?? [];
  const me = seats.find((player) => player.walletId === address);
  const legal = you?.legal ?? idleLegal;
  const myHole = you?.hole ?? me?.hole ?? [];
  const minRaise = legal.minRaiseTo || match?.blinds.bb || 20;
  const maxRaise = legal.maxRaiseTo || me?.stack || 0;

  useEffect(() => {
    setRaiseTo(minRaise);
    setRaising(false);
  }, [match?.handNumber, match?.street, match?.actionIndex, minRaise]);

  const boardSlots = useMemo(() => {
    const cards = match?.board ?? [];
    return [...cards, ...Array.from({ length: Math.max(0, 5 - cards.length) }, () => null)];
  }, [match?.board]);
  const winners = useMemo(() => {
    if (!match) return new Set<string>();
    if (match.street !== "showdown" && match.street !== "complete" && match.status !== "finished") {
      return new Set<string>();
    }
    return new Set(match.winners.filter((winner) => winner.amount > 0).map((winner) => winner.walletId));
  }, [match]);

  const over = match?.status === "finished" || match?.street === "complete";
  const clampRaise = (value: number) =>
    Math.min(maxRaise, Math.max(minRaise, Math.round(value)));
  const totalPot = match?.pot ?? 0;
  const presets = [
    { label: "Min", value: minRaise },
    { label: "½ Pot", value: minRaise + totalPot / 2 },
    { label: "¾ Pot", value: minRaise + (totalPot * 3) / 4 },
    { label: "Pot", value: minRaise + totalPot },
    { label: "All in", value: maxRaise },
  ];

  async function act(type: "fold" | "check" | "call" | "raise", amount?: number) {
    if (!address || !matchId || busy || over) return;
    setBusy(true);
    setError(null);
    try {
      try {
        const result = await api.action(matchId, address, type, amount);
        remember(result.match, result.you);
      } catch {
        await sendInbox(address, "action", { matchId, type, raiseTo: amount });
      }
      setRaising(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function addChip(value: number) {
    setRaiseTo((current) => clampRaise((raising ? current : minRaise) + value));
    setRaising(true);
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draftMessage.trim();
    if (!text || !address) return;
    setDraftMessage("");
    try {
      try {
        const result = await api.chat(matchId, address, text);
        setMessages(result.messages);
      } catch {
        await sendInbox(address, "chat", { matchId, text });
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const myTurn = Boolean(legal.canAct && !over);
  const streetLabel = match?.street ?? "dealing";

  return (
    <PokerAppShell section="table">
      <section className="felt-room" aria-labelledby="felt-room-title">
        <header className="felt-topbar">
          <Link href={`/queue/${mode.id}`} className="club-button club-button--ghost">
            <ArrowLeft size={15} /> Queue
          </Link>
          <div className="felt-room-name">
            <h1 id="felt-room-title">{mode.label}</h1>
            <span>
              NLH · {mode.seats} seats · blinds {match?.blinds.sb ?? 10}/
              {match?.blinds.bb ?? 20} · hand {match?.handNumber ?? 0} · {streetLabel}
            </span>
          </div>
          <div className="felt-topbar-actions">
            <button
              type="button"
              className="club-button club-button--secondary"
              onClick={() => setHideCards((hidden) => !hidden)}
              aria-pressed={hideCards}
            >
              {hideCards ? <Eye size={15} /> : <EyeOff size={15} />}
              {hideCards ? "Show cards" : "Hide cards"}
            </button>
            <button
              type="button"
              className="club-button club-button--secondary"
              onClick={() => setShowChat((shown) => !shown)}
              aria-pressed={showChat}
            >
              <MessageCircle size={15} /> Chat
            </button>
          </div>
        </header>

        {match?.commitHash && (
          <section className="felt-fairness" aria-label="Match randomness and Solana transactions">
            <CopyHash label="Commit" value={match.commitHash} />
            <CopyHash
              label="Seed"
              value={match.revealSeed}
              hidden="Locked until the match ends"
            />
            <div className="felt-chain">
              <span>Transactions</span>
              {(match.chain ?? []).length === 0 ? (
                <p>The escrow transaction has not landed yet.</p>
              ) : (
                <ul>
                  {match.chain.map((tx) => (
                    <li key={tx.signature}>
                      <a href={explorerTx(tx.signature)} target="_blank" rel="noreferrer">
                        {tx.label}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        <div className="felt-stage-row">
          <div className="felt-stage" aria-label={`${mode.label} table, ${streetLabel}`}>
            <div className="felt-oval" aria-hidden="true" />

            <div className="felt-center">
              <div className="felt-pot-row">
                {totalPot > 0 && (
                  <span className="felt-chip-stack" aria-hidden="true">
                    <Chip variant="chip-ivory" className="felt-chip-mini" />
                    {totalPot >= 40 && (
                      <Chip variant="chip-red" className="felt-chip-mini" />
                    )}
                    {totalPot >= 120 && <Chip className="felt-chip-mini" />}
                  </span>
                )}
                <div className="felt-pot">
                  <span>
                    Pot <strong>{formatChips(totalPot)}</strong>
                  </span>
                  <small>
                    {match?.status === "finished"
                      ? "Table complete"
                      : `${streetLabel} · ${match?.blinds.sb}/${match?.blinds.bb}`}
                  </small>
                </div>
              </div>
              <div className="felt-board" aria-label="Community cards">
                {boardSlots.map((card, index) =>
                  card ? (
                    <LiveCard
                      key={`${match?.handNumber ?? 0}-board-${index}-${card}`}
                      code={card}
                      delay={index * 90}
                      feature
                    />
                  ) : (
                    <span key={`slot-${index}`} className="felt-board-slot" aria-hidden="true" />
                  ),
                )}
              </div>
            </div>

            {seats.map((seat, index) => {
              const style = seatPosition(index, seats.length);
              const mine = seat.walletId === address;
              const name = seat.name || (mine ? displayAddress ?? shortAddress(seat.walletId) : shortAddress(seat.walletId));
              const acting = match?.actionIndex === index;
              // Your seat always shows your private cards, so the public copy of the table
              // (face-down placeholders) can't swap them out mid-hand.
              const holeCards = mine && myHole.length ? myHole : seat.hole;
              return (
                <div key={seat.walletId}>
                  <div
                    className={`felt-seat ${mine ? "is-me" : ""} ${acting ? "is-acting" : ""} ${seat.folded || seat.busted ? "is-folded" : ""}`}
                    style={style}
                  >
                    {!seat.folded && holeCards && (
                      <div className="felt-seat-cards">
                        {holeCards.map((card, cardIndex) => (
                          <LiveCard
                            key={`${match?.handNumber ?? 0}-${seat.walletId}-${cardIndex}-${card}`}
                            code={card}
                            delay={cardIndex * 120}
                            faceDown={mine && hideCards}
                            win={winners.has(seat.walletId)}
                          />
                        ))}
                      </div>
                    )}
                    <div className="felt-seat-box">
                      <Avatar
                        name={name}
                        size={30}
                        tone={tones[index % tones.length]}
                      />
                      <RankMedal rank={seat.rank || "Bronze"} size={16} />
                      <div className="felt-seat-meta">
                        <strong>{name}</strong>
                        <span>
                          <em>{seat.rank || "Bronze"}</em>
                          {formatChips(seat.stack)}
                        </span>
                      </div>
                      {seat.lastAction && <em className="felt-seat-tag">{seat.lastAction}</em>}
                    </div>
                    {acting && <i className="felt-timer" aria-hidden="true" />}
                  </div>
                  {seat.bet > 0 && (
                    <div className="felt-bet" style={style}>
                      <span className="felt-chip-stack">
                        <Chip
                          className="felt-chip-mini"
                          variant={
                            seat.bet >= 100
                              ? "chip-red"
                              : seat.bet >= 40
                                ? ""
                                : "chip-ivory"
                          }
                        />
                        {seat.bet >= 80 && <Chip className="felt-chip-mini" />}
                      </span>
                      {formatChips(seat.bet)}
                    </div>
                  )}
                  {index === match?.dealerIndex && (
                    <span className="felt-dealer" style={style} aria-label={`${name} is the dealer`}>
                      D
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <aside className="felt-chip-rail" aria-label="Chip tray">
            <span className="felt-rail-label">Your stack</span>
            <strong className="felt-rail-stack">{formatChips(me?.stack ?? 0)}</strong>
            {chipDenominations.map(({ value, variant }) => (
              <button
                type="button"
                key={value}
                className="felt-rail-chip"
                onClick={() => addChip(value)}
                disabled={!myTurn}
                aria-label={`Add ${value} to your raise`}
              >
                <Chip label={String(value)} variant={variant} />
              </button>
            ))}
            <button
              type="button"
              className="felt-rail-clear"
              onClick={() => setRaiseTo(minRaise)}
            >
              Clear
            </button>
          </aside>
        </div>

        <div className={`felt-bottom ${showChat ? "" : "felt-bottom--no-chat"}`}>
          <div className="felt-my-hand">
            <div className="felt-my-cards">
              {(myHole.length ? myHole : ["BACK", "BACK"]).map((card, index) => (
                <LiveCard
                  key={`${match?.handNumber ?? 0}-me-${index}-${card}`}
                  code={card}
                  delay={index * 140}
                  faceDown={hideCards}
                  win={Boolean(address && winners.has(address))}
                  feature
                />
              ))}
            </div>
            <p className="felt-hand-read">
              <span>Best hand</span>
              <strong>
                {you?.handName ||
                  (match?.status === "finished" ? "Table over" : "Waiting for cards")}
              </strong>
            </p>
          </div>

          {showChat && (
            <div className="felt-chat">
              <ul>
                {messages.map((message, index) => (
                  <li key={`${message.name}-${message.at}-${index}`}>
                    <strong>{message.name}</strong> {message.text}
                  </li>
                ))}
              </ul>
              <form onSubmit={submitMessage}>
                <label htmlFor="felt-chat-input" className="sr-only">
                  Chat message
                </label>
                <input
                  id="felt-chat-input"
                  value={draftMessage}
                  onChange={(event) => setDraftMessage(event.target.value)}
                  placeholder="Say something friendly"
                />
              </form>
            </div>
          )}

          <div className="felt-actions" aria-label="Your action">
            {over ? (
              <div className="felt-action-buttons">
                <p className="felt-result" aria-live="polite">
                  {match.ranked ? "Ranked game: Elo updates on your profile" : "Practice game: unranked"}
                </p>
                {match.players.some((p) => p.walletId === address) && (
                  <AnalysisPanel kind="match" target={match.id} />
                )}
                <Link href="/play" className="club-button">
                  Back to dashboard
                </Link>
              </div>
            ) : raising ? (
              <>
                <div className="felt-presets">
                  {presets.map((preset) => (
                    <button
                      type="button"
                      key={preset.label}
                      className="club-button club-button--secondary"
                      onClick={() => setRaiseTo(clampRaise(preset.value))}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="felt-raise-row">
                  <input
                    type="range"
                    min={minRaise}
                    max={Math.max(minRaise, maxRaise)}
                    step={10}
                    value={raiseTo}
                    onChange={(event) => setRaiseTo(Number(event.target.value))}
                    aria-label="Raise to"
                  />
                  <input
                    type="number"
                    min={minRaise}
                    max={maxRaise}
                    value={raiseTo}
                    onChange={(event) => setRaiseTo(Number(event.target.value))}
                    onBlur={() => setRaiseTo(clampRaise(raiseTo))}
                    aria-label="Raise amount"
                  />
                </div>
                <div className="felt-action-buttons">
                  <button
                    type="button"
                    className="club-button club-button--ghost"
                    onClick={() => setRaising(false)}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="club-button"
                    disabled={!myTurn || busy}
                    onClick={() => void act("raise", clampRaise(raiseTo))}
                  >
                    Raise to {formatChips(raiseTo)}
                  </button>
                </div>
              </>
            ) : (
              <div className="felt-action-buttons">
                <button
                  type="button"
                  className="club-button club-button--ghost"
                  disabled={!myTurn || busy}
                  onClick={() => void act("fold")}
                >
                  Fold
                </button>
                <button
                  type="button"
                  className="club-button club-button--secondary"
                  disabled={!myTurn || busy}
                  onClick={() => void act(legal.canCheck ? "check" : "call")}
                >
                  {legal.canCheck ? "Check" : `Call ${legal.toCall}`}
                </button>
                <button
                  type="button"
                  className="club-button"
                  disabled={!myTurn || busy || maxRaise < minRaise}
                  onClick={() => setRaising(true)}
                >
                  Raise
                </button>
              </div>
            )}
            <p aria-live="polite">
              {error
                ? error
                : match?.status === "finished"
                  ? `Winner ${
                      match.players.find((player) => player.walletId === match.winners[0]?.walletId)
                        ?.name ?? shortAddress(match.winners[0]?.walletId ?? "—")
                    } · escrowed ELO follows the rating result`
                  : myTurn
                    ? `Your turn · ${legal.toCall ? `${legal.toCall} to call` : "you can check"}`
                    : `Waiting · ${streetLabel}`}
            </p>
          </div>
        </div>
      </section>
    </PokerAppShell>
  );
}
