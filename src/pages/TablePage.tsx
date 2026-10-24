import { type CSSProperties, type FormEvent, useMemo, useState } from "react";
import { ArrowLeft, Eye, EyeOff, MessageCircle } from "lucide-react";
import { Link } from "wouter";
import PokerAppShell from "@/components/poker-app/PokerAppShell";
import { Avatar, DeckCard } from "@/components/poker-app/PokerUI";
import { useAuth } from "@/lib/auth";
import { getGameMode, isGameModeId } from "@/lib/game-modes";
import {
  demoPlayers,
  demoPlayerFromAddress,
  formatChips,
  type DeckCode,
} from "@/lib/poker-design";
import { shortAddress } from "@/lib/utils";
import "@/styles/table.css";

type Seat = {
  name: string;
  stack: number;
  tone: "violet" | "maroon" | "neutral";
  bet?: number;
  last?: string;
  folded?: boolean;
  me?: boolean;
} | null;

const tones = ["violet", "maroon", "neutral"] as const;

function seatsForMode(seatCount: number, youName: string): Seat[] {
  const opponents = demoPlayers.slice(0, seatCount - 1);
  return [
    { name: youName, stack: 2450, tone: "violet", me: true },
    ...opponents.map((player, index) => ({
      name: player.name,
      stack: 980 + index * 220,
      tone: tones[(index + 1) % tones.length],
      last: index === 0 ? "Fold" : index === 1 ? "Call" : "Check",
      folded: index === 0,
      bet: index === 1 ? 40 : undefined,
    })),
  ];
}
const flop: DeckCode[] = ["QC", "JC", "TC"];
const potBeforeStreet = 240;
const toCall = 40;

// Same three chip styles as the landing page (.poker-chip in index.css).
const chipDenominations = [
  { value: 25, variant: "chip-ivory" },
  { value: 100, variant: "chip-red" },
  { value: 500, variant: "" },
] as const;

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

export default function TablePage() {
  const { address, displayAddress } = useAuth();
  const requested =
    new URLSearchParams(window.location.search).get("mode") ?? "hands-up";
  const mode = getGameMode(isGameModeId(requested) ? requested : "hands-up");
  const you = address
    ? demoPlayerFromAddress(address)
    : { name: displayAddress ?? "You" };
  const seats = useMemo(
    () => seatsForMode(mode.seats, you.name || shortAddress(address ?? "You")),
    [mode.seats, you.name, address],
  );
  const me = seats[0]!;
  const dealerSeat = 1;
  const totalPot =
    potBeforeStreet + seats.reduce((sum, seat) => sum + (seat?.bet ?? 0), 0);
  const minRaise = toCall * 2;

  const [raising, setRaising] = useState(false);
  const [raiseTo, setRaiseTo] = useState(minRaise);
  const [myAction, setMyAction] = useState<string | null>(null);
  const [hideCards, setHideCards] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const [draftMessage, setDraftMessage] = useState("");
  const [messages, setMessages] = useState([
    { name: "Sam", text: "one more hand?" },
    { name: "River", text: "That flop has opinions." },
  ]);

  const clampRaise = (value: number) =>
    Math.min(me.stack, Math.max(minRaise, Math.round(value)));
  const presets = [
    { label: "Min", value: minRaise },
    { label: "½ Pot", value: totalPot / 2 },
    { label: "¾ Pot", value: (totalPot * 3) / 4 },
    { label: "Pot", value: totalPot },
    { label: "All in", value: me.stack },
  ];

  function act(label: string) {
    setMyAction(label);
    setRaising(false);
  }

  function addChip(value: number) {
    setRaiseTo((current) => clampRaise((raising ? current : 0) + value));
    setRaising(true);
  }

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draftMessage.trim();
    if (!text) return;
    setMessages((current) => [...current, { name: me.name, text }]);
    setDraftMessage("");
  }

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
              NLH · {mode.seats} seats · {mode.escrow} ELO escrowed · demo
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

        <div className="felt-stage-row">
          <div
            className="felt-stage"
            aria-label={`${mode.label} table, flop dealt`}
          >
            <div className="felt-oval" aria-hidden="true" />

            <div className="felt-center">
              <div className="felt-pot">
                <span>
                  Pot <strong>{formatChips(potBeforeStreet)}</strong>
                </span>
                <small>Total {formatChips(totalPot)}</small>
              </div>
              <div
                className="felt-board"
                aria-label="Flop: queen, jack and ten of clubs. Turn and river not dealt."
              >
                {flop.map((card) => (
                  <DeckCard
                    key={card}
                    card={card}
                    width={64}
                    foil={true}
                    interactive={false}
                  />
                ))}
                <span className="felt-board-slot" aria-hidden="true" />
                <span className="felt-board-slot" aria-hidden="true" />
              </div>
            </div>

            {seats.map((seat, index) => {
              const style = seatPosition(index, seats.length);
              if (!seat)
                return (
                  <button
                    type="button"
                    key={index}
                    className="felt-seat felt-seat--open"
                    style={style}
                  >
                    Sit here
                  </button>
                );
              const label = seat.me ? myAction : seat.last;
              const folded = seat.folded || (seat.me && myAction === "Fold");
              return (
                <div key={seat.name}>
                  <div
                    className={`felt-seat ${seat.me ? "is-me is-acting" : ""} ${folded ? "is-folded" : ""}`}
                    style={style}
                  >
                    {!folded && (
                      <div className="felt-seat-cards">
                        {seat.me && !hideCards ? (
                          <>
                            <DeckCard card="AS" width={40} />
                            <DeckCard card="KH" width={40} />
                          </>
                        ) : (
                          <>
                            <DeckCard card="BACK" width={40} />
                            <DeckCard card="BACK" width={40} />
                          </>
                        )}
                      </div>
                    )}
                    <div className="felt-seat-box">
                      <Avatar name={seat.name} size={30} tone={seat.tone} />
                      <div>
                        <strong>{seat.name}</strong>
                        <span>{formatChips(seat.stack)}</span>
                      </div>
                      {label && <em className="felt-seat-tag">{label}</em>}
                    </div>
                    {seat.me && !myAction && (
                      <i className="felt-timer" aria-hidden="true" />
                    )}
                  </div>
                  {seat.bet && (
                    <div className="felt-bet" style={style}>
                      <Chip className="felt-chip-mini" />
                      {formatChips(seat.bet)}
                    </div>
                  )}
                  {index === dealerSeat && (
                    <span
                      className="felt-dealer"
                      style={style}
                      aria-label={`${seat.name} is the dealer`}
                    >
                      D
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <aside className="felt-chip-rail" aria-label="Chip tray">
            <span className="felt-rail-label">Your stack</span>
            <strong className="felt-rail-stack">{formatChips(me.stack)}</strong>
            {chipDenominations.map(({ value, variant }) => (
              <button
                type="button"
                key={value}
                className="felt-rail-chip"
                onClick={() => addChip(value)}
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

        <div
          className={`felt-bottom ${showChat ? "" : "felt-bottom--no-chat"}`}
        >
          <div className="felt-my-hand">
            <div className="felt-my-cards">
              <DeckCard
                card="AS"
                width={76}
                foil={true}
                faceDown={hideCards}
                interactive={true}
                label="Your ace of spades"
              />
              <DeckCard
                card="KH"
                width={76}
                foil={true}
                faceDown={hideCards}
                interactive={true}
                label="Your king of hearts"
              />
            </div>
            <span>{hideCards ? "Cards hidden" : "Straight, ace high"}</span>
          </div>

          {showChat && (
            <div className="felt-chat">
              <ul>
                {messages.map((message, index) => (
                  <li key={`${message.name}-${index}`}>
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
            {raising ? (
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
                    max={me.stack}
                    step={10}
                    value={raiseTo}
                    onChange={(event) => setRaiseTo(Number(event.target.value))}
                    aria-label="Raise to"
                  />
                  <input
                    type="number"
                    min={minRaise}
                    max={me.stack}
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
                    onClick={() => act(`Raise ${formatChips(raiseTo)}`)}
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
                  onClick={() => act("Fold")}
                >
                  Fold
                </button>
                <button
                  type="button"
                  className="club-button club-button--secondary"
                  onClick={() => act(`Call ${toCall}`)}
                >
                  Call {toCall}
                </button>
                <button
                  type="button"
                  className="club-button"
                  onClick={() => setRaising(true)}
                >
                  Raise
                </button>
              </div>
            )}
            <p aria-live="polite">
              {myAction
                ? `You: ${myAction} · demo table, ELO escrow not live`
                : `Your turn · ${toCall} to call`}
            </p>
          </div>
        </div>
      </section>
    </PokerAppShell>
  );
}
