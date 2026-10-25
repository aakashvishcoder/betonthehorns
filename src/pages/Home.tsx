import { useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Menu,
  Wallet,
  X,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Brand, Chip, TablePreview } from "@/components/poker/PokerVisuals";
import NewsTicker from "@/components/poker/NewsTicker";
import { useAuth } from "@/lib/auth";
import SmoothScroll from "@/components/poker/SmoothScroll";
import {
  PokerAtmosphere,
  PokerHeroScene,
  PokerNightMenu,
  PokerDeckMoment,
} from "@/components/poker/PokerEffects";

const steps = [
  {
    number: "01",
    title: "Connect a Solana wallet.",
    text: "Phantom, Solflare, Backpack, or any wallet this browser exposes. That public key is your seat and your profile.",
    detail:
      "No private rooms. You queue into ranked Hands Up, SNG 4, or SNG 6.",
  },
  {
    number: "02",
    title: "Escrow that mode’s ELO.",
    text: "Each format keeps its own rating. When a table fills, both sides lock ELO for the match.",
    detail:
      "The winner is paid from that escrow. Demo numbers for now — settlement is the next chain step.",
  },
  {
    number: "03",
    title: "Mint the rank you earn.",
    text: "Bronze through Diamond dNFTs drop per mode as your ELO climbs. Hands won and hands folded unlock extra milestones.",
    detail:
      "Public profiles and the leaderboard stay open. Anyone can look up a wallet.",
  },
];
const faqs = [
  [
    "What is betonthehorns?",
    "A ranked Texas Hold’em app on Solana. You queue into Hands Up, SNG 4, or SNG 6. Each mode has its own ELO.",
  ],
  [
    "Do I play with cash?",
    "Tables stake ELO, not cash chips. That ELO is escrowed for the game, then settled when the table ends.",
  ],
  [
    "What are the dNFTs?",
    "Rank achievements for each mode (Bronze through Diamond), plus milestones such as hands won and hands folded.",
  ],
  [
    "Is this live on-chain yet?",
    "The wallet session and routes are real. ELO, escrow, and dNFTs on these pages are demo data until the program is wired.",
  ],
];

export default function Home() {
  const [, navigate] = useLocation();
  const { isAuthenticated, status, displayAddress, connect, disconnect } =
    useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [activeFaq, setActiveFaq] = useState<number | null>(null);
  const reducedMotion = useReducedMotion();
  const motionPaused = Boolean(reducedMotion);
  const enter = {
    initial: { opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 16 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: { duration: reducedMotion ? 0 : 0.7 },
  };
  async function goToDashboard() {
    if (!isAuthenticated) {
      const next = await connect();
      if (!next) return;
    }
    navigate("/play");
  }

  async function onWalletClick() {
    if (isAuthenticated) {
      await disconnect();
      return;
    }
    const next = await connect();
    if (next) navigate("/play");
  }

  return (
    <div
      id="top"
      className="site-shell cohesive-site"
      data-motion-paused={motionPaused}
    >
      <SmoothScroll paused={false} />
      <header className="site-header page-width">
        <Brand />
        <nav className="desktop-nav" aria-label="Main navigation">
          <a href="#the-table">Modes</a>
          <a href="#how-it-works">How it works</a>
          <a href="/leaderboard">Leaderboard</a>
        </nav>
        <div className="header-actions">
          <button
            className="nav-cta"
            onClick={() => void onWalletClick()}
            disabled={status === "connecting"}
            aria-label={
              isAuthenticated ? "Disconnect wallet" : "Connect wallet"
            }
          >
            {status === "connecting" ? (
              "Connecting…"
            ) : displayAddress ? (
              displayAddress
            ) : (
              <>
                Connect wallet <Wallet size={16} />
              </>
            )}
          </button>
          <button
            className="mobile-menu-toggle"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
        {menuOpen && (
          <nav className="mobile-nav" aria-label="Mobile navigation">
            {[
              ["Modes", "#the-table"],
              ["How it works", "#how-it-works"],
              ["Leaderboard", "/leaderboard"],
            ].map(([text, link]) => (
              <a key={link} href={link} onClick={() => setMenuOpen(false)}>
                {text}
                <ArrowUpRight size={18} />
              </a>
            ))}
          </nav>
        )}
      </header>
      <main>
        <div className="poker-night-world">
          <PokerAtmosphere paused={motionPaused} />
          <section className="hero page-width" aria-labelledby="hero-title">
            <motion.div className="hero-copy" {...enter}>
              <div className="eyebrow">
                <span className="tiny-spade">♠</span> RANKED HOLD’EM ON SOLANA
              </div>
              <h1 id="hero-title">
                Bet on the
                <br />
                <span className="people-word">
                  horns.
                  <svg viewBox="0 0 310 18" aria-hidden="true">
                    <path d="M4 12C73 0 202 1 304 10M31 15c85-6 155-5 236-2" />
                  </svg>
                </span>
              </h1>
              <p className="hero-description">
                Queue Hands Up, SNG 4, or SNG 6.
                <br className="desktop-br" /> Each mode keeps its own ELO,
                escrowed
                <br className="desktop-br" /> on-chain for the match.
              </p>
              <div className="hero-cta-row">
                <button className="primary-button" onClick={() => void goToDashboard()}>
                  {isAuthenticated ? "Open dashboard" : "Connect and play"}{" "}
                  <span>
                    <ArrowUpRight size={20} />
                  </span>
                </button>
                <a href="#the-table" className="text-link">
                  See the modes <ArrowDown size={16} />
                </a>
              </div>
              <div className="hero-note">
                <Check size={14} /> Wallet login. ELO escrow. Rank dNFTs.
              </div>
            </motion.div>
            <motion.div
              className="hero-art"
              {...enter}
              transition={{
                duration: reducedMotion ? 0 : 0.85,
                delay: reducedMotion ? 0 : 0.12,
              }}
            >
              <PokerHeroScene paused={motionPaused} />
            </motion.div>
            <a
              href="#the-table"
              className="hero-scroll"
              aria-label="Scroll to the table"
            >
              <ArrowDown size={15} />
            </a>
          </section>
          <div className="suit-marquee" aria-hidden="true">
            <div className="marquee-track">
              {Array.from({ length: 4 }, (_, index) => (
                <span key={index}>
                  <b>♠</b> HANDS UP <b>♥</b> SNG 4 <b>♣</b> SNG 6
                  <b>♦</b> ELO ESCROW{" "}
                </span>
              ))}
            </div>
          </div>
          <NewsTicker />
          <section
            id="the-table"
            className="experience-section page-width"
            aria-labelledby="experience-title"
          >
            <motion.div className="section-heading" {...enter}>
              <div>
                <span className="eyebrow">THREE MODES. THREE RATINGS.</span>
                <h2 id="experience-title">
                  Ranked tables.
                  <br />
                  <span className="muted-heading">No private rooms.</span>
                </h2>
              </div>
              <p>
                Queue a public sit-and-go
                <br />
                or a heads-up match.
                <br />
                Your wallet is the seat.
              </p>
            </motion.div>
            <div className="experience-layout">
              <motion.div {...enter}>
                <TablePreview />
              </motion.div>
              <motion.div className="experience-copy" {...enter}>
                <div className="feature-story">
                  <span className="feature-number">ON-CHAIN STAKES</span>
                  <h3>
                    Escrow the ELO.
                    <br />
                    Mint the rank.
                  </h3>
                  <p>
                    Each game locks that mode’s ELO until the table is over.
                    Climb a rank and the matching dNFT mints to the same wallet.
                  </p>
                  <div className="story-tags">
                    <span>
                      <Check size={12} /> Hands Up · SNG 4 · SNG 6
                    </span>
                    <span>
                      <Check size={12} /> Public profiles
                    </span>
                  </div>
                </div>
                <div className="small-feature">
                  <span className="small-feature-icon">♣</span>
                  <div>
                    <h4>Milestones on the same wallet.</h4>
                    <p>Hands won, hands folded, and rank dNFTs per mode.</p>
                  </div>
                  <ArrowUpRight size={21} />
                </div>
                <button
                  className="text-link experience-link"
                  onClick={() => void goToDashboard()}
                >
                  Open the dashboard <ArrowRight size={17} />
                </button>
              </motion.div>
            </div>
          </section>
          <section
            id="how-it-works"
            className="how-section night-planning-section page-width"
            aria-labelledby="how-title"
          >
            <motion.div className="how-heading" {...enter}>
              <span className="eyebrow">FROM WALLET TO TABLE</span>
              <h2 id="how-title">
                Connect.
                <br />
                Queue.
                <br />
                <span className="muted-heading">Settle the ELO.</span>
              </h2>
              <p>
                No private lobbies. Pick a mode,
                <br />
                lock the escrow, play the hand.
              </p>
              <div className="how-deck-moment">
                <PokerDeckMoment paused={motionPaused} />
                <span className="how-deck-caption">
                  A fresh deck.
                  <br />A ranked seat.
                </span>
              </div>
            </motion.div>
            <div className="night-planner">
              <PokerNightMenu
                paused={motionPaused}
                activeStep={activeStep}
                onStepChange={setActiveStep}
              />
              <div
                className="night-step-detail"
                aria-live="polite"
                aria-atomic="true"
              >
                <span className="eyebrow">
                  {steps[activeStep].number} / YOUR NEXT MOVE
                </span>
                <h3>{steps[activeStep].title}</h3>
                <p>{steps[activeStep].text}</p>
                <p className="night-step-extra">{steps[activeStep].detail}</p>
              </div>
              <button
                className="text-link night-planner-cta"
                onClick={() => void goToDashboard()}
              >
                Queue a mode <ArrowUpRight size={16} />
              </button>
            </div>
          </section>
        </div>
        <section className="manifesto-section">
          <div className="manifesto-inner page-width">
            <span className="eyebrow">HOUSE RULE</span>
            <motion.p {...enter}>
              Play the hand.
              <br />
              <span>Stake the horns.</span>
            </motion.p>
            <div className="manifesto-bottom">
              <span className="manifesto-suits">
                ♠ <i>♥</i> ♣ <i>♦</i>
              </span>
              <p>
                Because the rating you escrow
                <br />
                is the one you came to move.
              </p>
            </div>
          </div>
        </section>
        <section
          id="faqs"
          className="faq-section page-width"
          aria-labelledby="faq-title"
        >
          <div className="faq-heading">
            <span className="eyebrow">BEFORE YOU ANTE UP</span>
            <h2 id="faq-title">
              A few good
              <br />
              questions.
            </h2>
            <p>No poker face needed.</p>
          </div>
          <div className="faq-list">
            {faqs.map(([question, answer], index) => (
              <div key={question} className="faq-item">
                <button
                  onClick={() =>
                    setActiveFaq(activeFaq === index ? null : index)
                  }
                  aria-expanded={activeFaq === index}
                  aria-controls={`faq-answer-${index}`}
                >
                  {question}
                  <ChevronDown
                    size={19}
                    className={activeFaq === index ? "faq-chevron-open" : ""}
                  />
                </button>
                <p id={`faq-answer-${index}`} hidden={activeFaq !== index}>
                  {answer}
                </p>
              </div>
            ))}
          </div>
        </section>
        <section className="closing-section">
          <div className="closing-inner page-width">
            <div className="closing-chip-art" aria-hidden="true">
              <Chip color="ivory" value="♠" />
              <Chip color="red" value="♥" />
            </div>
            <span className="eyebrow">THE QUEUE IS OPEN</span>
            <h2>
              Connect
              <br />
              and sit down<span>.</span>
            </h2>
            <button
              className="primary-button cream-button"
              onClick={() => void goToDashboard()}
            >
              {isAuthenticated ? "Go to dashboard" : "Connect wallet"}{" "}
              <span>
                <ArrowUpRight size={21} />
              </span>
            </button>
            <p>A Solana wallet is the only ticket in.</p>
            <span className="closing-star" aria-hidden="true">
              ✳
            </span>
          </div>
        </section>
      </main>
      <footer className="site-footer page-width">
        <Brand />
        <span>RANKED HOLD’EM ON SOLANA</span>
        <div>
          <span>ELO escrow · rank dNFTs · demo tables</span>
          <small>betonthehorns</small>
        </div>
        <a href="#top" aria-label="Back to top">
          <ArrowUpRight size={21} />
        </a>
      </footer>
    </div>
  );
}
