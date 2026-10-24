import { type FormEvent, useState } from "react";
import { ArrowLeft, Eye, EyeOff, Leaf, MessageCircle } from "lucide-react";
import { Link } from "wouter";
import PokerAppShell from "@/components/poker-app/PokerAppShell";
import {
  Avatar,
  DeckCard,
  PageHeading,
  Panel,
  Pill,
} from "@/components/poker-app/PokerUI";
import { sampleTables, type DeckCode } from "@/lib/poker-design";
import "@/styles/table.css";

type Action = "fold" | "check" | "raise" | null;

type Seat = {
  name: string;
  chips: string;
  position: string;
  tone: "violet" | "maroon" | "neutral";
  current?: boolean;
};

const seats: readonly Seat[] = [
  { name: "Alex", chips: "1,780", position: "top", tone: "neutral" },
  { name: "Sam", chips: "2,240", position: "upper-left", tone: "maroon" },
  { name: "River", chips: "980", position: "upper-right", tone: "violet" },
  { name: "Casey", chips: "1,410", position: "lower-left", tone: "neutral" },
  { name: "Jo", chips: "1,650", position: "lower-right", tone: "maroon" },
  {
    name: "Jamie",
    chips: "2,450",
    position: "you",
    tone: "violet",
    current: true,
  },
] as const;

const flop: DeckCode[] = ["QC", "JC", "TC"];

export default function TablePage() {
  const roomId =
    new URLSearchParams(window.location.search).get("room") ?? "friday";
  const room =
    sampleTables.find(table => table.id === roomId) ?? sampleTables[0]!;
  const [action, setAction] = useState<Action>(null);
  const [raiseAmount, setRaiseAmount] = useState(80);
  const [hideCards, setHideCards] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  const [messages, setMessages] = useState([
    { name: "Sam", text: "one more hand?" },
    { name: "River", text: "That flop has opinions." },
  ]);

  const previewText = action
    ? `Preview action: ${action === "raise" ? `Raise ${raiseAmount} play chips` : action[0].toUpperCase() + action.slice(1)} — no live game.`
    : "Preview action: choose Fold, Check, or Raise — no live game.";

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draftMessage.trim();
    if (!text) return;
    setMessages(current => [...current, { name: "Jamie", text }]);
    setDraftMessage("");
  }

  return (
    <PokerAppShell section="table">
      <section className="table-page" aria-labelledby="table-room-title">
        <PageHeading
          eyebrow="TABLE ROOM · SAMPLE HAND"
          title={<span id="table-room-title">{room.name}</span>}
          description={
            <>
              {room.description} A static six-seat hand for the design preview.
            </>
          }
          action={
            <Link
              href="/play"
              className="club-button club-button--ghost table-back-link"
            >
              <ArrowLeft size={15} /> Back to tables
            </Link>
          }
        />

        <div className="table-layout">
          <div className="table-primary">
            <Panel className="tabletop-panel">
              <div className="tabletop-header">
                <div>
                  <span className="club-muted">SIX SEAT SAMPLE TABLE</span>
                  <h2 className="club-section-heading">
                    Friendly stakes, polished view.
                  </h2>
                </div>
                <div className="tabletop-controls">
                  <span className="table-design-leaf">
                    <Leaf size={13} /> DESIGN ONLY
                  </span>
                  <button
                    type="button"
                    className="club-button club-button--secondary table-card-toggle"
                    onClick={() => setHideCards(hidden => !hidden)}
                    aria-pressed={hideCards}
                  >
                    {hideCards ? <Eye size={15} /> : <EyeOff size={15} />}
                    {hideCards ? "Show own cards" : "Hide own cards"}
                  </button>
                </div>
              </div>

              <div
                className="tabletop-scene"
                aria-label="Static example poker table with six sample players"
              >
                <div className="table-oval" aria-hidden="true" />
                {seats.map(seat => (
                  <div
                    className={`table-seat table-seat--${seat.position} ${seat.current ? "is-current" : ""}`}
                    key={seat.name}
                  >
                    <Avatar name={seat.name} size={38} tone={seat.tone} />
                    <div className="table-seat-card">
                      <strong>
                        {seat.name}
                        {seat.current && <em>you</em>}
                      </strong>
                      <span>
                        {seat.chips} <small>play chips</small>
                      </span>
                      {seat.current && <b>Your action</b>}
                    </div>
                  </div>
                ))}

                <div
                  className="table-board"
                  aria-label="Flop: queen, jack, and ten of clubs. Turn and river not revealed."
                >
                  {flop.map(card => (
                    <DeckCard
                      key={card}
                      card={card}
                      width={72}
                      foil={true}
                      faceDown={false}
                      interactive={false}
                      className="table-board-card"
                      label={`Community card: ${card === "QC" ? "queen" : card === "JC" ? "jack" : "ten"} of clubs`}
                    />
                  ))}
                  <DeckCard
                    card="BACK"
                    width={72}
                    foil={false}
                    faceDown={true}
                    interactive={false}
                    className="table-board-card"
                    label="Turn not revealed"
                  />
                  <DeckCard
                    card="BACK"
                    width={72}
                    foil={false}
                    faceDown={true}
                    interactive={false}
                    className="table-board-card"
                    label="River not revealed"
                  />
                </div>

                <div className="table-pot">
                  <span>Pot</span>
                  <strong>320</strong>
                  <small>play chips</small>
                </div>
                <div className="table-hand-label">
                  {hideCards
                    ? "Your hand · Cards hidden"
                    : "Your hand · Broadway straight"}
                </div>
                <div className="table-player-cards">
                  <DeckCard
                    card="AS"
                    width={70}
                    foil={true}
                    faceDown={hideCards}
                    interactive={true}
                    className="table-hole-card"
                    label="Your Ace of spades — click or press Enter to flip"
                  />
                  <DeckCard
                    card="KH"
                    width={70}
                    foil={true}
                    faceDown={hideCards}
                    interactive={true}
                    className="table-hole-card"
                    label="Your King of hearts — click or press Enter to flip"
                  />
                </div>
              </div>

              <div className="tabletop-footer">
                <span>
                  Round <strong>Flop</strong>
                </span>
                <span>
                  Blinds <strong>10 / 20</strong>
                </span>
                <span className="club-muted">
                  Cards are interactive design components.
                </span>
              </div>
            </Panel>

            <Panel className="table-actions-panel">
              <div className="table-actions-copy">
                <span className="club-muted">YOUR TURN · PREVIEW CONTROLS</span>
                <p aria-live="polite">{previewText}</p>
              </div>
              <div className="table-actions" aria-label="Sample poker actions">
                <button
                  type="button"
                  className={`club-button club-button--ghost ${action === "fold" ? "is-selected" : ""}`}
                  onClick={() => setAction("fold")}
                  aria-pressed={action === "fold"}
                >
                  Fold
                </button>
                <button
                  type="button"
                  className={`club-button club-button--secondary ${action === "check" ? "is-selected" : ""}`}
                  onClick={() => setAction("check")}
                  aria-pressed={action === "check"}
                >
                  Check
                </button>
                <button
                  type="button"
                  className={`club-button ${action === "raise" ? "is-selected" : ""}`}
                  onClick={() => setAction("raise")}
                  aria-pressed={action === "raise"}
                >
                  Raise
                </button>
              </div>
              <div className="table-raise-control">
                <label htmlFor="sample-raise">Sample raise amount</label>
                <input
                  id="sample-raise"
                  type="range"
                  min="40"
                  max="240"
                  step="20"
                  value={raiseAmount}
                  onChange={event => setRaiseAmount(Number(event.target.value))}
                />
                <output htmlFor="sample-raise">{raiseAmount} play chips</output>
              </div>
            </Panel>
          </div>

          <aside
            className="table-sidebar"
            aria-label="Table notes and sample chat"
          >
            <Panel className="table-notes-panel">
              <span className="club-muted">TABLE NOTES</span>
              <h2 className="club-section-heading">A small, good crowd.</h2>
              <dl>
                <div>
                  <dt>Room</dt>
                  <dd>
                    {room.category} · {room.pace}
                  </dd>
                </div>
                <div>
                  <dt>Seats</dt>
                  <dd>6 named sample players</dd>
                </div>
                <div>
                  <dt>Cards</dt>
                  <dd>Foil cards are visual only</dd>
                </div>
              </dl>
              <Pill tone="maroon">Play chips, never real money</Pill>
            </Panel>

            <Panel className="table-chat-panel">
              <div className="table-chat-heading">
                <div>
                  <span className="club-muted">TABLE CHAT</span>
                  <h2 className="club-section-heading">Around the felt</h2>
                </div>
                <MessageCircle size={18} aria-hidden="true" />
              </div>
              <ul className="table-chat-list">
                {messages.map((message, index) => (
                  <li key={`${message.name}-${index}`}>
                    <strong>{message.name}</strong>
                    <span>{message.text}</span>
                  </li>
                ))}
              </ul>
              <form onSubmit={submitMessage} className="table-chat-form">
                <label htmlFor="table-chat-input">
                  Add a local sample message
                </label>
                <div>
                  <input
                    id="table-chat-input"
                    value={draftMessage}
                    onChange={event => setDraftMessage(event.target.value)}
                    placeholder="Say something friendly"
                  />
                  <button
                    type="submit"
                    className="club-button club-button--secondary"
                  >
                    Add
                  </button>
                </div>
                <p>This adds a local sample message only. Nothing is sent.</p>
              </form>
            </Panel>
          </aside>
        </div>
      </section>
    </PokerAppShell>
  );
}
