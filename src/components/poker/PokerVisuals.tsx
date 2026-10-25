import { useState } from "react";
import { ArrowRight, RotateCcw } from "lucide-react";

export function Brand({
  light = false,
  href = "#top",
}: {
  light?: boolean;
  href?: string;
}) {
  return (
    <a
      href={href}
      className={`brand ${light ? "brand-light" : ""}`}
      aria-label="betonthehorns home"
    >
      <span className="brand-mark" aria-hidden="true">
        ♠<i>◆</i>
      </span>
      <span>
        betonthehorns<span className="brand-dot">.</span>
      </span>
    </a>
  );
}

export function Chip({
  color = "green",
  className = "",
  value = "♠",
}: {
  color?: "green" | "red" | "ivory";
  className?: string;
  value?: string;
}) {
  return (
    <div className={`poker-chip chip-${color} ${className}`} aria-hidden="true">
      <div className="chip-rim">
        <span>{value}</span>
      </div>
    </div>
  );
}

export function PlayingCard({
  rank,
  suit,
  faceDown = false,
  className = "",
}: {
  rank: string;
  suit: string;
  faceDown?: boolean;
  className?: string;
}) {
  const suitName =
    (
      {
        "♠": "spades",
        "♥": "hearts",
        "♦": "diamonds",
        "♣": "clubs",
      } as Record<string, string>
    )[suit] ?? suit;
  const rankName =
    ({ A: "Ace", K: "King", Q: "Queen", J: "Jack" } as Record<string, string>)[
      rank
    ] ?? rank;
  return (
    <div
      className={`playing-card ${suit === "♥" || suit === "♦" ? "red-suit" : ""} ${faceDown ? "face-down" : ""} ${className}`}
      role="img"
      aria-label={faceDown ? "Face-down card" : `${rankName} of ${suitName}`}
    >
      {faceDown ? (
        <img
          className="card-back-art"
          src="/cards/horns-card-back.webp"
          alt=""
        />
      ) : (
        <>
          <span className="card-corner">
            {rank}
            <small>{suit}</small>
          </span>
          <span className="card-suit">{suit}</span>
          <span className="card-corner card-bottom">
            {rank}
            <small>{suit}</small>
          </span>
        </>
      )}
    </div>
  );
}

export function TablePreview() {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="table-preview">
      <div className="preview-topline">
        <span>
          <i className="status-dot" />
          HANDS UP · DEMO
        </span>
        <span>ELO ESCROW LIVE</span>
      </div>
      <div className="mini-table">
        <div className="player-seat seat-top">
          <span className="player-avatar peach">J</span>
          <span>
            You<small>1,482 ELO</small>
          </span>
        </div>
        <div className="player-seat seat-left">
          <span className="player-avatar lavender">S</span>
          <span>
            Sam<small>1,426 ELO</small>
          </span>
        </div>
        <div className="player-seat seat-right">
          <span className="player-avatar sand">A</span>
          <span>
            Alex<small>1,864 ELO</small>
          </span>
        </div>
        <div className="table-oval">
          <div className="table-wordmark">HORNS</div>
          <div className="community-cards">
            <PlayingCard rank="K" suit="♠" />
            <PlayingCard rank="Q" suit="♠" />
            <PlayingCard rank="J" suit="♠" />
            <PlayingCard rank="10" suit="♠" />
            <PlayingCard rank="2" suit="♥" />
          </div>
          <div className="pot-label">
            THE POT <strong>1,200</strong>
          </div>
          <Chip color="red" className="table-chip" />
        </div>
        <div className="your-hand">
          <div className={`hand-card ${revealed ? "is-revealed" : ""}`}>
            <div className="hand-front" aria-hidden={!revealed}>
              <PlayingCard rank="A" suit="♠" />
            </div>
            <div className="hand-back" aria-hidden={revealed}>
              <PlayingCard rank="A" suit="♠" faceDown />
            </div>
          </div>
          <div className={`hand-card ${revealed ? "is-revealed" : ""}`}>
            <div className="hand-front" aria-hidden={!revealed}>
              <PlayingCard rank="9" suit="♦" />
            </div>
            <div className="hand-back" aria-hidden={revealed}>
              <PlayingCard rank="9" suit="♦" faceDown />
            </div>
          </div>
          <span className="you-label" role="status" aria-live="polite">
            YOU ·{" "}
            {revealed
              ? "A ROYAL FLUSH. NICELY PLAYED."
              : "YOUR NEXT GOOD HAND?"}
          </span>
        </div>
      </div>
      <div className="preview-bottom">
        <span>
          {revealed
            ? "Some hands are worth showing off."
            : "A little taste of your next poker night."}
        </span>
        <button
          onClick={() => setRevealed(!revealed)}
          className="reveal-button"
        >
          {revealed ? "Deal again" : "Reveal your hand"}
          {revealed ? <RotateCcw size={15} /> : <ArrowRight size={15} />}
        </button>
      </div>
    </div>
  );
}
