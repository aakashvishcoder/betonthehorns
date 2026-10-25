import {
  Suspense,
  lazy,
  useEffect,
  useState,
  type ReactNode,
  type CSSProperties,
  type HTMLAttributes,
} from "react";
import { deckArt, deckNames, type DeckCode } from "@/lib/poker-design";
import { usePokerMotion } from "./PokerAppShell";
const HoloCard = lazy(() => import("@/components/react-bits/HoloCard"));

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="club-page-heading">
      <div>
        {eyebrow && <span className="club-eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="club-heading-action">{action}</div>}
    </header>
  );
}
export function Panel({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`club-panel ${className}`} {...props}>
      {children}
    </div>
  );
}
export function StatTile({
  label,
  value,
  note,
  tone = "violet",
}: {
  label: string;
  value: ReactNode;
  note?: string;
  tone?: "violet" | "maroon" | "neutral";
}) {
  return (
    <div className={`club-stat club-stat--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
export function Pill({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "violet" | "maroon" | "muted";
}) {
  return <span className={`club-pill club-pill--${tone}`}>{children}</span>;
}
const RANK_TIERS = ["bronze", "silver", "gold", "diamond", "platinum"] as const;

/** Two-tone disc for a mode's rank. The left half is the darker shade of the same color. */
export function RankMedal({
  rank,
  size = 22,
}: {
  rank: string;
  size?: number;
}) {
  const tier = RANK_TIERS.includes(rank.toLowerCase() as (typeof RANK_TIERS)[number])
    ? rank.toLowerCase()
    : "bronze";
  return (
    <span
      className={`rank-medal rank-medal--${tier}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${rank} rank`}
    >
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path className="rank-medal-shade" d="M16 2a14 14 0 0 0 0 28z" />
        <path className="rank-medal-face" d="M16 2a14 14 0 0 1 0 28z" />
      </svg>
    </span>
  );
}

export function SolanaMark({ size = 15 }: { size?: number }) {
  return (
    <svg
      className="solana-mark"
      width={size}
      height={size}
      viewBox="0 0 397 311"
      aria-hidden="true"
    >
      <path
        fill="#14F195"
        d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z"
      />
      <path
        fill="#9945FF"
        d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z"
      />
      <path
        fill="#19C6E6"
        d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z"
      />
    </svg>
  );
}

export function explorerTx(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function CopyHash({
  label,
  value,
  hidden,
}: {
  label: string;
  value: string | null;
  hidden?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="copy-hash">
      <span>{label}</span>
      <code>{value ?? hidden ?? "Not published yet"}</code>
      <button type="button" className="club-button club-button--secondary" onClick={() => void copy()} disabled={!value}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function Avatar({
  name,
  size = 40,
  tone = "violet",
  className = "",
}: {
  name: string;
  size?: number;
  tone?: "violet" | "maroon" | "neutral";
  className?: string;
}) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      className={`club-avatar club-avatar--${tone} ${className}`}
      style={{ "--avatar-size": `${size}px` } as CSSProperties}
      aria-label={name}
    >
      {initials}
    </span>
  );
}

export interface DeckCardProps {
  card: DeckCode;
  width?: number;
  foil?: boolean;
  faceDown?: boolean;
  interactive?: boolean;
  className?: string;
  label?: string;
}
export function DeckCard({
  card,
  width = 100,
  foil = false,
  faceDown = false,
  interactive = false,
  className = "",
  label,
}: DeckCardProps) {
  const { paused } = usePokerMotion();
  const [imageError, setImageError] = useState(false);
  const displayedCard = faceDown ? "BACK" : card;
  const name =
    faceDown && card !== "BACK"
      ? "Face-down poker card"
      : (label ?? deckNames[displayedCard]);
  useEffect(() => {
    setImageError(false);
  }, [displayedCard]);
  const simpleCard = (
    <div className="club-deck-image">
      {imageError ? (
        <div className="club-card-fallback" role="img" aria-label={name}>
          {displayedCard === "BACK"
            ? "♠"
            : displayedCard === "TC"
              ? "10♣"
              : `${displayedCard[0]}${displayedCard === "AS" ? "♠" : displayedCard === "KH" ? "♥" : "♣"}`}
        </div>
      ) : (
        <img
          src={deckArt[displayedCard]}
          alt={name}
          onError={() => setImageError(true)}
          loading="lazy"
        />
      )}
    </div>
  );
  return (
    <div
      className={`club-deck-card ${foil ? "club-deck-card--foil" : ""} ${className}`}
      style={{ "--card-width": `${width}px` } as CSSProperties}
    >
      {foil && !faceDown && card !== "BACK" ? (
        <Suspense fallback={simpleCard}>
          <HoloCard
            image={deckArt[card]}
            backImage={interactive ? deckArt.BACK : undefined}
            alt={name}
            preset="shards"
            foilColor={card === "KH" ? "#e98392" : "#e1b0f7"}
            intensity={0.16}
            edgeSparkle={0.2}
            glare={0.12}
            tiltMax={interactive ? 5 : 0}
            hoverScale={interactive ? 1.015 : 1}
            width={width}
            radius={9}
            frame={2}
            idle={false}
            paused={paused}
            shadow={false}
          />
        </Suspense>
      ) : (
        simpleCard
      )}
    </div>
  );
}
