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
  Trophy,
  UserRound,
  ShieldCheck,
} from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { Brand } from "@/components/poker/PokerVisuals";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
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
  const { paused } = usePokerMotion();
  const { isAuthenticated, address, displayAddress, connect, status } =
    useAuth();
  const [tableName, setTableName] = useState<string | null>(null);
  const [handsUpElo, setHandsUpElo] = useState<number | null>(null);
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
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    document.title = `${label} — betonthehorns`;
  }, [location, label]);

  useEffect(() => {
    if (!address) {
      setTableName(null);
      setHandsUpElo(null);
      return;
    }
    const load = () => {
      void api
        .profile(address)
        .then((record) => {
          setTableName(record.displayName);
          setHandsUpElo(record.modes.find((mode) => mode.mode === "hands-up")?.elo ?? 1200);
        })
        .catch(() => undefined);
    };
    load();
    const onName = (event: Event) => {
      setTableName((event as CustomEvent<string | null>).detail);
    };
    window.addEventListener("horns-name", onName);
    return () => window.removeEventListener("horns-name", onName);
  }, [address]);

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
            <ArrowLeft size={14} /> Front Page
          </Link>
          <div className="club-fair-play">
            <ShieldCheck size={15} />
            <div>
              <strong>ELO escrow per game.</strong>
              <span>Rank dNFTs update per mode after each table.</span>
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
            {address ? (
              <span className="club-chip-balance">
                <strong>{handsUpElo ?? "—"}</strong>
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
            <Link
              className="club-account"
              href={profileHref}
              aria-label={tableName ? `${tableName}, open profile` : "Open profile"}
            >
              {tableName
                ? tableName.slice(0, 2).toUpperCase()
                : displayAddress
                  ? displayAddress.slice(0, 2)
                  : "?"}
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
            ELO escrow · rank dNFTs <ArrowUpRight size={12} />
          </span>
        </footer>
      </div>
    </div>
  );
}
