import type { ReactNode, RefObject } from "react";

export interface ScrollRevealProps {
  children?: ReactNode;
  scrollContainerRef?: RefObject<HTMLElement | null>;
  highlightColor?: string;
  mode?: "scrub" | "enter";
  splitBy?: "words" | "chars" | "lines";
  effect?: "fade" | "rise" | "flip" | "scale";
  stagger?: number;
  duration?: number;
  smoothing?: number;
  enableBlur?: boolean;
  blurStrength?: number;
  baseOpacity?: number;
  baseRotation?: number;
  baseOffset?: number;
  rotationEnd?: string;
  wordAnimationEnd?: string;
  containerClassName?: string;
  textClassName?: string;
}

declare function ScrollReveal(props: ScrollRevealProps): ReactNode;
export default ScrollReveal;
