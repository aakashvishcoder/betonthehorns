import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowLeft,
  ArrowUpRight,
  CircleDollarSign,
  LayoutGrid,
  Pause,
  Play,
  Spade,
  Trophy,
  UserRound,
  ShieldCheck,
} from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { Brand } from "@/components/poker/PokerVisuals";
import { formatChips, samplePlayer } from "@/lib/poker-design";
import "@/styles/poker-app.css";

const PlasmaWave = lazy(() => import("@/components/react-bits/PlasmaWave"));
type Section = "profile" | "play" | "table" | "leaderboard";
const motionContext = createContext({
  paused: false,
  effectsPaused: false,
  reducedMotion: false,
  toggleEffects: () => {},
});
export function PokerMotionProvider({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const [effectsPaused, setEffectsPaused] = useState(false);
  return (
    <motionContext.Provider
      value={{
        paused: effectsPaused || Boolean(reduced),
        effectsPaused,
        reducedMotion: Boolean(reduced),
        toggleEffects: () => setEffectsPaused(p => !p),
      }}
    >
      {children}
    </motionContext.Provider>
  );
}
export function usePokerMotion() {
  return useContext(motionContext);
}
const navigation = [
  { id: "play", label: "Play", href: "/play", icon: LayoutGrid },
  { id: "table", label: "The table", href: "/table", icon: Spade },
  {
    id: "leaderboard",
    label: "Leaderboard",
    href: "/leaderboard",
    icon: Trophy,
  },
  { id: "profile", label: "My profile", href: "/profile", icon: UserRound },
] as const;

export default function PokerAppShell({
  section,
  children,
}: {
  section: Section;
  children: ReactNode;
}) {
  const [location] = useLocation();
  const { paused, effectsPaused, reducedMotion, toggleEffects } =
    usePokerMotion();
  const label = navigation.find(n => n.id === section)?.label ?? "The club";
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    document.title = `${label} — ALL IN design preview`;
  }, [location, label]);
  return (
    <div
      className={`poker-app-shell poker-app-shell--${section}`}
      data-motion-paused={paused}
    >
      <aside className="club-sidebar">
        <div className="club-sidebar-brand">
          <Brand href="/" />
          <span>GOOD CARDS. BETTER COMPANY.</span>
        </div>
        <div className="club-nav-label">THE CLUB</div>
        <nav aria-label="Poker club navigation" className="club-nav">
          {navigation.map(({ id, label: navLabel, href, icon: Icon }) => (
            <Link
              href={href}
              key={id}
              className={
                section === id ? "club-nav-link is-current" : "club-nav-link"
              }
              aria-current={section === id ? "page" : undefined}
            >
              <Icon size={18} />
              <span>{navLabel}</span>
              {section === id && <i aria-hidden="true" />}
            </Link>
          ))}
        </nav>
        <div className="club-sidebar-bottom">
          <Link href="/" className="club-back-home">
            <ArrowLeft size={14} /> Back to the good times
          </Link>
          <div className="club-fair-play">
            <ShieldCheck size={15} />
            <div>
              <strong>Just for the good times.</strong>
              <span>Play chips. No real-money play.</span>
            </div>
          </div>
        </div>
      </aside>
      <div className="club-main-area">
        <header className="club-topbar">
          <div className="club-breadcrumb">
            <span>THE CLUB</span>
            <i>/</i>
            <b>{label}</b>
          </div>
          <div className="club-topbar-actions">
            <span className="club-design-badge">DESIGN PREVIEW</span>
            <span className="club-chip-balance">
              <CircleDollarSign size={16} />
              <strong>{formatChips(samplePlayer.chips)}</strong>
              <small>PLAY CHIPS</small>
            </span>
            <button
              className="club-icon-button"
              onClick={toggleEffects}
              aria-label={
                reducedMotion
                  ? "Motion follows your reduced-motion preference"
                  : effectsPaused
                    ? "Resume visual effects"
                    : "Pause visual effects"
              }
              aria-pressed={paused}
              disabled={reducedMotion}
            >
              {paused ? <Play size={15} /> : <Pause size={15} />}
            </button>
            <Link
              className="club-account"
              href="/profile"
              aria-label="Open Jamie's example profile"
            >
              J
            </Link>
          </div>
        </header>
        <div className="club-ambient" aria-hidden="true">
          <Suspense fallback={null}>
            <PlasmaWave
              colors={["#932db9", "#c73757"]}
              quality={0.4}
              dpr={1}
              speed={0.12}
              brightness={0.3}
              glow={0.25}
              core={0.1}
              intro={false}
              mouseInteraction={false}
              paused={paused}
            />
          </Suspense>
        </div>
        <main className="club-content">{children}</main>
        <footer className="club-page-footer">
          <span>ALL IN · GOOD CARDS. BETTER COMPANY.</span>
          <span>
            Example players and games · Design prototype only{" "}
            <ArrowUpRight size={12} />
          </span>
        </footer>
      </div>
    </div>
  );
}
