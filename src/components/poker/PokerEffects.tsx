import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Chip } from "./PokerVisuals";
import "@/styles/poker-effects.css";

const AeroShards = lazy(() => import("@/components/react-bits/AeroShards"));
const PlasmaWave = lazy(() => import("@/components/react-bits/PlasmaWave"));
const HoloCard = lazy(() => import("@/components/react-bits/HoloCard"));
const FlowingMenu = lazy(() => import("@/components/react-bits/FlowingMenu"));
const InfiniteSpiral = lazy(
  () => import("@/components/react-bits/InfiniteSpiral")
);

export const pokerCardArt = {
  ace: "/cards/ace-spades.webp",
  king: "/cards/king-hearts.webp",
  back: "/cards/horns-card-back.webp",
};

const cardTextures = [
  { src: pokerCardArt.ace, alt: "Ace of spades" },
  { src: pokerCardArt.back, alt: "betonthehorns violet and maroon card back" },
  { src: pokerCardArt.king, alt: "King of hearts" },
];

const spiralItems = Array.from({ length: 10 }, (_, index) => ({
  ...cardTextures[index % cardTextures.length],
  id: `deck-card-${index}`,
}));

function SuitFallback({ className = "" }: { className?: string }) {
  return (
    <div
      className={`poker-suit-fallback ${className}`.trim()}
      aria-hidden="true"
    >
      <span>♠</span>
      <span>♦</span>
      <span>♣</span>
      <span>♥</span>
    </div>
  );
}

class GraphicsBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function DeferredEffect({
  children,
  fallback,
  className = "",
}: {
  children: ReactNode;
  fallback: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    if (!("IntersectionObserver" in window)) {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setNearViewport(true);
        observer.disconnect();
      },
      { rootMargin: "180px" }
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`deferred-poker-effect ${className}`.trim()}>
      {nearViewport ? (
        <GraphicsBoundary fallback={fallback}>
          <Suspense fallback={fallback}>{children}</Suspense>
        </GraphicsBoundary>
      ) : (
        fallback
      )}
    </div>
  );
}

function CardFallback({ rank, suit }: { rank: string; suit: string }) {
  return (
    <div className="holo-card-fallback" aria-hidden="true">
      <span>
        {rank}
        <small>{suit}</small>
      </span>
      <b>{suit}</b>
      <span>
        {rank}
        <small>{suit}</small>
      </span>
    </div>
  );
}

/** A single, quiet visual field shared by all sections of the page. */
export function PokerAtmosphere({ paused }: { paused: boolean }) {
  const [gpuAvailable, setGpuAvailable] = useState(false);
  const [graphicsFailed, setGraphicsFailed] = useState(false);

  useEffect(() => {
    setGpuAvailable("gpu" in navigator);
  }, []);

  const useGraphics = gpuAvailable && !graphicsFailed;

  return (
    <div
      className="poker-world-atmosphere"
      aria-hidden="true"
      style={{ pointerEvents: "none" }}
    >
      <div className="world-light-ribbon">
        <DeferredEffect fallback={<div className="plasma-static-light" />}>
          <PlasmaWave
            colors={["#932db9", "#c73757"]}
            speed={0.22}
            bend1={0.9}
            bend2={0.5}
            thickness={0.23}
            brightness={0.45}
            glow={0.35}
            core={0.15}
            quality={0.45}
            dpr={1}
            fade={0.5}
            grain={0.015}
            opacity={0.75}
            intro={!paused}
            mouseInteraction={false}
            paused={paused}
          />
        </DeferredEffect>
      </div>
      <div className="world-card-shards">
        {useGraphics ? (
          <DeferredEffect
            fallback={<SuitFallback className="world-suit-fallback" />}
          >
            <AeroShards
              shardColor="#932db9"
              accentColor="#dc576f"
              backgroundColor="transparent"
              placement="right"
              material="chrome"
              markers="none"
              count={160}
              shardSize={1.1}
              spread={0.85}
              speed={0.25}
              depthOfField={0.45}
              glow={0.2}
              vignette={0.6}
              intro={!paused}
              mouseInteraction={false}
              pulseOnClick={false}
              holdToGather={false}
              paused={paused}
              dpr={1}
              onError={() => setGraphicsFailed(true)}
            />
          </DeferredEffect>
        ) : (
          <SuitFallback className="world-suit-fallback" />
        )}
      </div>
    </div>
  );
}

/** A clear foreground hand, without a competing deck behind it. */
export function PokerHeroScene({ paused }: { paused: boolean }) {
  return (
    <section
      id="the-deck"
      className="poker-hero-scene"
      aria-label="Your poker hand"
    >
      <div className="scene-felt" aria-hidden="true" />
      <div className="scene-hand">
        <DeferredEffect
          className="scene-card-effect scene-ace-effect"
          fallback={<CardFallback rank="A" suit="♠" />}
        >
          <HoloCard
            className="scene-holo-card scene-ace"
            image={pokerCardArt.ace}
            backImage={pokerCardArt.back}
            alt="Ace of spades. Click, tap, or press Enter to turn the card."
            preset="shards"
            foilColor="#e1b0f7"
            intensity={0.2}
            edgeSparkle={0.28}
            glare={0.18}
            tiltMax={8}
            hoverScale={1.025}
            width={220}
            radius={12}
            frame={3}
            idle={false}
            paused={paused}
          />
        </DeferredEffect>
        <DeferredEffect
          className="scene-card-effect scene-king-effect"
          fallback={<CardFallback rank="K" suit="♥" />}
        >
          <HoloCard
            className="scene-holo-card scene-king"
            image={pokerCardArt.king}
            backImage={pokerCardArt.back}
            alt="King of hearts. Click, tap, or press Enter to turn the card."
            preset="stars"
            foilColor="#e98392"
            intensity={0.18}
            edgeSparkle={0.25}
            glare={0.16}
            tiltMax={8}
            hoverScale={1.025}
            width={220}
            radius={12}
            frame={3}
            idle={false}
            paused={paused}
          />
        </DeferredEffect>
      </div>
      <div className="scene-chip-stack" aria-hidden="true">
        <Chip color="green" />
        <Chip color="red" />
        <Chip color="ivory" />
      </div>
      <div className="scene-caption">
        <p>Your next good hand.</p>
        <p>Turn a card. See where the night goes.</p>
      </div>
    </section>
  );
}

/** A small open deck treatment, separated from the interactive foreground hand. */
export function PokerDeckMoment({ paused }: { paused: boolean }) {
  return (
    <div
      className="planning-deck-trail"
      aria-hidden="true"
      style={{ pointerEvents: "none" }}
    >
      <DeferredEffect fallback={<SuitFallback className="spiral-fallback" />}>
        <InfiniteSpiral
          items={spiralItems}
          animationMode="all"
          speed={0.1}
          radius={58}
          cardWidth={41}
          cardHeight={61}
          verticalSpacing={18}
          perspective={650}
          cardsPerTurn={6}
          centerScale={1}
          cardRadius={4}
          edgeBlur={0.15}
          edgeFade={0.12}
          imageFit="contain"
          paused={paused}
        />
      </DeferredEffect>
    </div>
  );
}

const nightMenuItems = [
  {
    text: "Connect a Solana wallet.",
    marquee: "♠ CONNECT A SOLANA WALLET. ♠",
  },
  {
    text: "Escrow that mode’s ELO.",
    marquee: "♣ ESCROW THAT MODE’S ELO. ♣",
  },
  {
    text: "Mint the rank you earn.",
    marquee: "♥ MINT THE RANK YOU EARN. ♥",
  },
];

export function PokerNightMenu({
  paused,
  activeStep,
  onStepChange,
}: {
  paused: boolean;
  activeStep: number;
  onStepChange: (index: number) => void;
}) {
  const fallback = (
    <div
      className="night-step-fallback"
      role="group"
      aria-label="Poker night steps"
    >
      {nightMenuItems.map((item, index) => (
        <button
          type="button"
          key={item.text}
          className={activeStep === index ? "is-active" : ""}
          aria-pressed={activeStep === index}
          onClick={() => onStepChange(index)}
        >
          {item.text}
        </button>
      ))}
    </div>
  );

  return (
    <div className="poker-night-menu">
      <DeferredEffect fallback={fallback}>
        <FlowingMenu
          items={nightMenuItems}
          speed={24}
          followCursor={0.08}
          magnet={0.05}
          stretch={0.2}
          duration={0.6}
          textColor="#e1b0f7"
          bgColor="transparent"
          marqueeBgColor="#3b0949"
          marqueeTextColor="#ffffff"
          align="left"
          showIndex
          showArrow={false}
          intro={false}
          paused={paused}
          activeIndex={activeStep}
          ariaLabel="Poker night steps"
          onItemClick={(_item, index) => onStepChange(index)}
        />
      </DeferredEffect>
    </div>
  );
}
