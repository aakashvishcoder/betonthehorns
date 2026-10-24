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
  LayoutGrid,
  Pause,
  Play,
  Trophy,
  UserRound,
  ShieldCheck,
} from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { Brand } from "@/components/poker/PokerVisuals";
import { useAuth } from "@/lib/auth";
import { demoPlayerFromAddress } from "@/lib/poker-design";
import "@/styles/poker-app.css";

const PlasmaWave = lazy(() => import("@/components/react-bits/PlasmaWave"));
type Section = "profile" | "play" | "table" | "leaderboard" | "queue";
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
        toggleEffects: () => setEffectsPaused((p) => !p),
      }}
    >
      {children}
    </motionContext.Provider>
  );
}
export function usePokerMotion() {
  return useContext(motionContext);
}

export default function PokerAppShell({
  section,
  children,
}: {
  section: Section;
  children: ReactNode;
}) {
  const [location, navigate] = useLocation();
  const { paused, effectsPaused, reducedMotion, toggleEffects } =
    usePokerMotion();
  const { isAuthenticated, address, displayAddress, connect, status } =
    useAuth();
  const profileHref = address ? `/profile/${address}` : "/leaderboard";
  const navigation = [
    { id: "play", label: "Play", href: "/play", icon: LayoutGrid },
    { id: "leaderboard", label: "Leaderboard", href: "/leaderboard", icon: Trophy },
    { id: "profile", label: "Profile", href: profileHref, icon: UserRound },
  ] as const;
  const label =
    section === "queue"
      ? "Queue"
      : section === "table"
        ? "Table"
        : (navigation.find((item) => item.id === section)?.label ??
          "betonthehorns");
  const player = address ? demoPlayerFromAddress(address) : null;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    document.title = `${label} — betonthehorns`;
  }, [location, label]);

  return (
    <div
      className={`poker-app-shell poker-app-shell--${section}`}
      data-motion-paused={paused}
    >
      <aside className="club-sidebar">
        <div className="club-sidebar-brand">
          <Brand href={isAuthenticated ? "/play" : "/"} />
          <span>RANKED HOLD’EM ON SOLANA</span>
        </div>
        <div className="club-nav-label">MODES</div>
        <nav aria-label="betonthehorns navigation" className="club-nav">
          {navigation.map(({ id, label: navLabel, href, icon: Icon }) => (
            <Link
              href={href}
              key={id}
              className={
                section === id || (id === "play" && section === "queue")
                  ? "club-nav-link is-current"
                  : "club-nav-link"
              }
              aria-current={section === id ? "page" : undefined}
            >
              <Icon size={18} />
              <span>{navLabel}</span>
              {(section === id || (id === "play" && section === "queue")) && (
                <i aria-hidden="true" />
              )}
            </Link>
          ))}
        </nav>
        <div className="club-sidebar-bottom">
          <Link href="/" className="club-back-home">
            <ArrowLeft size={14} /> Landing
          </Link>
          <div className="club-fair-play">
            <ShieldCheck size={15} />
            <div>
              <strong>ELO escrow per game.</strong>
              <span>Rank dNFTs mint per mode. Demo data for now.</span>
            </div>
          </div>
        </div>
      </aside>
      <div className="club-main-area">
        <header className="club-topbar">
          <div className="club-breadcrumb">
            <span>BETONTHEHORNS</span>
            <i>/</i>
            <b>{label}</b>
          </div>
          <div className="club-topbar-actions">
            <span className="club-design-badge">DEMO</span>
            {player ? (
              <span className="club-chip-balance">
                <strong>{player.modes["hands-up"].elo}</strong>
                <small>HANDS UP ELO</small>
              </span>
            ) : (
              <button
                type="button"
                className="club-button club-button--secondary"
                disabled={status === "connecting"}
                onClick={() =>
                  void connect().then((next) => {
                    if (next) navigate("/play");
                  })
                }
              >
                {status === "connecting" ? "Connecting…" : "Connect wallet"}
              </button>
            )}
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
              href={profileHref}
              aria-label="Open profile"
            >
              {displayAddress ? displayAddress.slice(0, 2) : "?"}
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
          <span>betonthehorns · ranked Hold’em on Solana</span>
          <span>
            Demo ELO, escrow, and dNFTs <ArrowUpRight size={12} />
          </span>
        </footer>
      </div>
    </div>
  );
}
