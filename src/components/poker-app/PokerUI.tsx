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
    .map(n => n[0])
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
