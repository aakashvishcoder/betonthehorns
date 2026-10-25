const suitPath = {
  S: "M50 3C50 3 12 40 12 61c0 16 14 27 28 26l-5 12h30l-5-12c14 1 28-10 28-26C88 40 50 3 50 3z",
  H: "M50 90C18 66 6 50 6 34 6 18 18 8 32 14c10 4 15 14 18 22 3-8 8-18 18-22 14-6 26 4 26 20 0 16-12 32-44 56z",
  D: "M50 4 94 50 50 96 6 50z",
} as const;

type Rank = "A" | "K" | "Q" | "J" | "T" | "9" | "8" | "7" | "6" | "5" | "4" | "3" | "2";
type Suit = "S" | "H" | "D" | "C";
type Spot = [number, number, boolean];

const L = 76;
const R = 124;
const C = 100;
const pips: Record<Exclude<Rank, "A" | "K" | "Q" | "J">, Spot[]> = {
  T: [
    [L, 90, false],
    [R, 90, false],
    [C, 108, false],
    [L, 126, false],
    [R, 126, false],
    [L, 164, true],
    [R, 164, true],
    [C, 182, true],
    [L, 200, true],
    [R, 200, true],
  ],
  "9": [
    [L, 90, false],
    [R, 90, false],
    [L, 118, false],
    [R, 118, false],
    [C, 145, false],
    [L, 172, true],
    [R, 172, true],
    [L, 200, true],
    [R, 200, true],
  ],
  "8": [
    [L, 90, false],
    [R, 90, false],
    [L, 116, false],
    [R, 116, false],
    [L, 174, true],
    [R, 174, true],
    [L, 200, true],
    [R, 200, true],
  ],
  "7": [
    [L, 90, false],
    [R, 90, false],
    [C, 112, false],
    [L, 145, false],
    [R, 145, false],
    [L, 200, true],
    [R, 200, true],
  ],
  "6": [
    [L, 92, false],
    [R, 92, false],
    [L, 145, false],
    [R, 145, false],
    [L, 198, true],
    [R, 198, true],
  ],
  "5": [
    [L, 94, false],
    [R, 94, false],
    [C, 145, false],
    [L, 196, true],
    [R, 196, true],
  ],
  "4": [
    [L, 98, false],
    [R, 98, false],
    [L, 192, true],
    [R, 192, true],
  ],
  "3": [
    [C, 96, false],
    [C, 145, false],
    [C, 194, true],
  ],
  "2": [
    [C, 100, false],
    [C, 190, true],
  ],
};

function ink(suit: Suit) {
  return suit === "H" || suit === "D" ? "#b92d50" : "#1a1020";
}

function SuitMark({
  suit,
  x,
  y,
  size,
  ornate = false,
}: {
  suit: Suit;
  x: number;
  y: number;
  size: number;
  ornate?: boolean;
}) {
  const color = ink(suit);
  const accent = suit === "H" || suit === "D" ? "#f0b7c4" : "#b06ad8";
  return (
    <g transform={`translate(${x} ${y}) scale(${size / 100}) translate(-50 -50)`}>
      {suit === "C" ? (
        <>
          <circle cx="50" cy="34" r="18" fill={color} />
          <circle cx="30" cy="56" r="18" fill={color} />
          <circle cx="70" cy="56" r="18" fill={color} />
          <path d="M43 62h14l6 34H37z" fill={color} />
          {ornate && (
            <>
              <circle cx="50" cy="34" r="8" fill="none" stroke={accent} strokeWidth="3" />
              <circle cx="30" cy="56" r="8" fill="none" stroke={accent} strokeWidth="3" />
              <circle cx="70" cy="56" r="8" fill="none" stroke={accent} strokeWidth="3" />
            </>
          )}
        </>
      ) : (
        <>
          <path d={suitPath[suit]} fill={color} />
          {ornate && (
            <path
              d={suitPath[suit]}
              fill="none"
              stroke={accent}
              strokeWidth="3.5"
              transform="translate(50 50) scale(0.62) translate(-50 -50)"
            />
          )}
        </>
      )}
    </g>
  );
}

function Corners({ rank, suit }: { rank: string; suit: Suit }) {
  const label = rank === "T" ? "10" : rank;
  const color = ink(suit);
  const index = (
    <>
      <rect x="8" y="10" width="42" height="58" rx="7" fill="#f4eef8" />
      <text
        x="14"
        y={label === "10" ? 32 : 36}
        fill={color}
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize={label === "10" ? 22 : 28}
        fontWeight="700"
      >
        {label}
      </text>
      <SuitMark suit={suit} x={26} y={54} size={16} />
    </>
  );
  return (
    <g>
      {index}
      <g transform="rotate(180 100 145)">{index}</g>
    </g>
  );
}

function Portrait({ rank, suit }: { rank: "K" | "Q" | "J"; suit: Suit }) {
  const cloth = ink(suit);
  const hair = rank === "Q" ? "#4a2c22" : "#24180f";
  const gold = "#e6c36a";
  return (
    <g>
      <path d="M18 118c8-28 22-36 32-36s24 8 32 36v12H18z" fill={cloth} />
      <path d="M38 84h24l4 20H34z" fill="#f6d7c3" />
      <path d="M34 96h32l-4 14H38z" fill="#fbf5fe" />
      <ellipse cx="50" cy="58" rx="22" ry="26" fill="#f3c7ad" />
      {rank === "K" && (
        <>
          <path d="M28 42 36 16l14 16 14-16 8 26-8 6H36z" fill={gold} stroke={cloth} strokeWidth="1.4" />
          <path d="M30 50c6-16 34-16 40 0-6 6-34 6-40 0z" fill={hair} />
          <path d="M34 70c2 16 30 16 32 0-8 8-24 8-32 0z" fill={hair} />
          <path d="M40 66h20c-1 5-6 8-10 8s-9-3-10-8z" fill={hair} />
        </>
      )}
      {rank === "Q" && (
        <>
          <path d="M32 34 40 16l10 12 10-12 8 18-6 6H38z" fill={gold} stroke={cloth} strokeWidth="1.2" />
          <path d="M24 58c-6 24-2 52 8 62 2-20 6-34 10-42-8-4-14-10-18-20z" fill={hair} />
          <path d="M76 58c6 24 2 52-8 62-2-20-6-34-10-42 8-4 14-10 18-20z" fill={hair} />
          <path d="M30 46c8-20 32-20 40 0-8 8-32 8-40 0z" fill={hair} />
        </>
      )}
      {rank === "J" && (
        <>
          <path d="M24 48c8-28 44-28 52 0l-8 8H32z" fill={cloth} />
          <path d="M30 44h40l-4 10H34z" fill={gold} />
          <path d="M28 52c6-8 12-4 14 2 4-10 16-10 20 0 2-6 8-10 14-2-8 10-40 10-48 0z" fill={hair} />
        </>
      )}
      <ellipse cx="42" cy="58" rx="3.2" ry="3.8" fill="#1a1020" />
      <ellipse cx="58" cy="58" rx="3.2" ry="3.8" fill="#1a1020" />
      <circle cx="43.1" cy="56.8" r="1" fill="#fff" />
      <circle cx="59.1" cy="56.8" r="1" fill="#fff" />
      <path d="M50 62v8" stroke="#c4896c" strokeWidth="1.4" strokeLinecap="round" />
      <path
        d={rank === "K" ? "M43 80h14" : "M42 78c3 4 13 4 16 0"}
        fill="none"
        stroke="#9a4e42"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {rank === "Q" && (
        <>
          <circle cx="30" cy="66" r="2.2" fill={gold} />
          <circle cx="70" cy="66" r="2.2" fill={gold} />
        </>
      )}
    </g>
  );
}

function CourtFace({ rank, suit }: { rank: "K" | "Q" | "J"; suit: Suit }) {
  return (
    <g>
      <Corners rank={rank} suit={suit} />
      <g transform="translate(58 72) scale(0.84)">
        <Portrait rank={rank} suit={suit} />
      </g>
      <g transform="translate(142 218) rotate(180) scale(0.84)">
        <Portrait rank={rank} suit={suit} />
      </g>
      <circle cx="100" cy="145" r="13" fill="#f4eef8" stroke="#c48be0" strokeWidth="1.5" />
      <SuitMark suit={suit} x={100} y={145} size={18} />
    </g>
  );
}

export function HornCard({
  code,
  faceDown = false,
}: {
  code?: string | null;
  faceDown?: boolean;
}) {
  const hidden = faceDown || !code || code === "BACK";
  if (hidden) {
    return <img className="horn-card-face" src="/cards/horns-card-back.webp" alt="" />;
  }

  const rank = (code[0] ?? "A") as Rank;
  const suit = (code[1] ?? "S") as Suit;
  const spots = rank in pips ? pips[rank as keyof typeof pips] : null;
  const spotSize = !spots ? 34 : spots.length >= 8 ? 16 : spots.length >= 6 ? 20 : spots.length >= 4 ? 26 : 34;

  return (
    <svg className="horn-card-face" viewBox="0 0 200 290" role="img" aria-label={code}>
      <rect x="2" y="2" width="196" height="286" rx="16" fill="#f4eef8" />
      <rect x="5" y="5" width="190" height="280" rx="14" fill="none" stroke="#c48be0" strokeWidth="3" />
      {rank === "K" || rank === "Q" || rank === "J" ? (
        <CourtFace rank={rank} suit={suit} />
      ) : rank === "A" ? (
        <>
          <Corners rank={rank} suit={suit} />
          <SuitMark suit={suit} x={100} y={158} size={96} ornate />
        </>
      ) : (
        <>
          <Corners rank={rank} suit={suit} />
          {spots?.map(([x, y, flip], index) => (
            <g key={`${x}-${y}-${index}`} transform={flip ? `rotate(180 ${x} ${y})` : undefined}>
              <SuitMark suit={suit} x={x} y={y} size={spotSize} ornate={spots.length <= 3} />
            </g>
          ))}
        </>
      )}
    </svg>
  );
}
