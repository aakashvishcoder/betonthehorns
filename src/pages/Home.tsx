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
import { toast } from "sonner";
import { Brand, Chip, TablePreview } from "@/components/poker/PokerVisuals";
import TableSetup from "@/components/poker/TableSetup";
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
    title: "Make it your table.",
    text: "Pick your table name, choose your chips, and set the mood. Your house, your rules.",
    detail:
      "A private table for your favorite people. No crowded lobbies, no strangers, no pressure.",
  },
  {
    number: "02",
    title: "Bring your people.",
    text: "Send an invite to the group chat. From across the couch or across the world, everyone has a seat.",
    detail:
      "Built around a simple idea: the best part of poker night is who’s sitting around the table.",
  },
  {
    number: "03",
    title: "Let the good hands roll.",
    text: "A little strategy. A little luck. A lot of “I knew you were bluffing.” That’s our kind of poker.",
    detail:
      "Classic Texas Hold’em, play-money chips, and all the friendly competition you can handle.",
  },
];
const faqs = [
  [
    "Do I need to download anything?",
    "Nope. ALL IN is a browser-first concept, designed for poker night without the installations. This hackathon landing page includes a local table-setup demo and an interactive hand preview.",
  ],
  [
    "Are we playing with real money?",
    "No. This is all about play-money chips and real bragging rights. There are no deposits, buy-ins, or cash prizes.",
  ],
  [
    "Can I play a live game on this demo?",
    "Not yet. You can explore the table preview and save a table setup in your browser. Live multiplayer gameplay is the next step, not a feature of this landing-page demo.",
  ],
  [
    "Do I have to be good at poker?",
    "Absolutely not. The idea is a welcoming table for first-timers and seasoned bluffers alike. Bring your curiosity—and a friend who explains the rules.",
  ],
];

type EthereumProvider = {
  request: (args: { method: string }) => Promise<string[]>;
};

export default function Home() {
  const [, navigate] = useLocation();
  const [setupOpen, setSetupOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [activeFaq, setActiveFaq] = useState<number | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const motionPaused = Boolean(reducedMotion) || setupOpen;
  const enter = {
    initial: { opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 16 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: { duration: reducedMotion ? 0 : 0.7 },
  };
  const start = () => setSetupOpen(true);

  // ponytail: injected EIP-1193 wallet only (MetaMask etc.); add WalletConnect for mobile wallets if needed.
  async function connectWallet() {
    const ethereum = (window as { ethereum?: EthereumProvider }).ethereum;
    if (!ethereum) {
      toast.error("No wallet found. Install a browser wallet like MetaMask.");
      return;
    }
    try {
      const [account] = await ethereum.request({
        method: "eth_requestAccounts",
      });
      if (account) setWallet(account);
    } catch {
      toast.error("Wallet connection was cancelled.");
    }
  }

  return (
    <div
      id="top"
      className="site-shell cohesive-site"
      data-motion-paused={motionPaused}
    >
      <SmoothScroll paused={setupOpen} />
      <header className="site-header page-width">
        <Brand />
        <nav className="desktop-nav" aria-label="Main navigation">
          <a href="#the-table">The table</a>
          <a href="#how-it-works">How it works</a>
          <a href="#faqs">FAQs</a>
        </nav>
        <div className="header-actions">
          <button className="nav-cta" onClick={connectWallet}>
            {wallet ? (
              `${wallet.slice(0, 6)}…${wallet.slice(-4)}`
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
              ["The table", "#the-table"],
              ["How it works", "#how-it-works"],
              ["FAQs", "#faqs"],
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
                <span className="tiny-spade">♠</span> GOOD CARDS. BETTER
                COMPANY.
              </div>
              <h1 id="hero-title">
                Poker, with
                <br />
                your{" "}
                <span className="people-word">
                  people.
                  <svg viewBox="0 0 310 18" aria-hidden="true">
                    <path d="M4 12C73 0 202 1 304 10M31 15c85-6 155-5 236-2" />
                  </svg>
                </span>
              </h1>
              <p className="hero-description">
                The best nights start with a full table.
                <br className="desktop-br" /> Bring your friends, call a bluff,
                and make
                <br className="desktop-br" /> a little time for a good hand.
              </p>
              <div className="hero-cta-row">
                <button
                  className="primary-button"
                  onClick={() => navigate("/play")}
                >
                  Deal me in{" "}
                  <span>
                    <ArrowUpRight size={20} />
                  </span>
                </button>
                <a href="#the-table" className="text-link">
                  Meet your table <ArrowDown size={16} />
                </a>
              </div>
              <div className="hero-note">
                <Check size={14} /> No downloads. No buy-ins. Just bragging
                rights.
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
                  <b>♠</b> ALL FRIENDS <b>♥</b> NO STRANGERS <b>♣</b> GOOD
                  HANDS <b>♦</b> GREAT NIGHTS{" "}
                </span>
              ))}
            </div>
          </div>
          <section
            id="the-table"
            className="experience-section page-width"
            aria-labelledby="experience-title"
          >
            <motion.div className="section-heading" {...enter}>
              <div>
                <span className="eyebrow">THE TABLE IS WHERE IT HAPPENS</span>
                <h2 id="experience-title">
                  A little competition.
                  <br />
                  <span className="muted-heading">A lot of connection.</span>
                </h2>
              </div>
              <p>
                Not another crowded casino.
                <br />
                Just your people, your table,
                <br />
                and one more hand.
              </p>
            </motion.div>
            <div className="experience-layout">
              <motion.div {...enter}>
                <TablePreview />
              </motion.div>
              <motion.div className="experience-copy" {...enter}>
                <div className="feature-story">
                  <span className="feature-number">YOUR INNER CIRCLE</span>
                  <h3>
                    Keep the table close.
                    <br />
                    Even from far away.
                  </h3>
                  <p>
                    Recreate the feeling of Friday night, wherever your friends
                    happen to be. A private space for familiar faces and very
                    questionable poker faces.
                  </p>
                  <div className="story-tags">
                    <span>
                      <Check size={12} /> Private tables
                    </span>
                    <span>
                      <Check size={12} /> Play-money chips
                    </span>
                  </div>
                </div>
                <div className="small-feature">
                  <span className="small-feature-icon">♣</span>
                  <div>
                    <h4>Less setup. More showdown.</h4>
                    <p>Designed for the browser. Made for the group chat.</p>
                  </div>
                  <ArrowUpRight size={21} />
                </div>
                <button className="text-link experience-link" onClick={start}>
                  Find your seat <ArrowRight size={17} />
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
              <span className="eyebrow">FROM GROUP CHAT TO GAME NIGHT</span>
              <h2 id="how-title">
                Your table.
                <br />
                Your people.
                <br />
                <span className="muted-heading">Your kind of night.</span>
              </h2>
              <p>
                Skip the logistics. Save your energy
                <br />
                for that completely unconvincing bluff.
              </p>
              <div className="how-deck-moment">
                <PokerDeckMoment paused={motionPaused} />
                <span className="how-deck-caption">
                  A fresh deck.
                  <br />A familiar crowd.
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
              <button className="text-link night-planner-cta" onClick={start}>
                Plan a poker night <ArrowUpRight size={16} />
              </button>
            </div>
          </section>
        </div>
        <section className="manifesto-section">
          <div className="manifesto-inner page-width">
            <span className="eyebrow">OUR HOUSE RULE</span>
            <motion.p {...enter}>
              Play the hand.
              <br />
              <span>Enjoy the company.</span>
            </motion.p>
            <div className="manifesto-bottom">
              <span className="manifesto-suits">
                ♠ <i>♥</i> ♣ <i>♦</i>
              </span>
              <p>
                Because the best thing you can win
                <br />
                is a reason to do it all again.
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
            <span className="eyebrow">THERE’S ALWAYS ROOM FOR ONE MORE</span>
            <h2>
              Your seat
              <br />
              is waiting<span>.</span>
            </h2>
            <button className="primary-button cream-button" onClick={start}>
              Let’s make it a poker night{" "}
              <span>
                <ArrowUpRight size={21} />
              </span>
            </button>
            <p>All you need is a browser and your favorite people.</p>
            <span className="closing-star" aria-hidden="true">
              ✳
            </span>
          </div>
        </section>
      </main>
      <footer className="site-footer page-width">
        <Brand />
        <span>GOOD CARDS. BETTER COMPANY.</span>
        <div>
          <span>Made for the love of the game.</span>
          <small>Hackathon prototype · Play money only</small>
        </div>
        <a href="#top" aria-label="Back to top">
          <ArrowUpRight size={21} />
        </a>
      </footer>
      <TableSetup open={setupOpen} onOpenChange={setSetupOpen} />
    </div>
  );
}
