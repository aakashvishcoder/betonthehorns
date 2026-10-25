import type { CSSProperties, ReactNode, RefObject } from "react";

export interface ScrollVelocityProps {
  scrollContainerRef?: RefObject<HTMLElement | null>;
  texts?: ReactNode[];
  velocity?: number;
  color?: string;
  fontSize?: number | string;
  fontWeight?: number | string;
  skewWithVelocity?: number;
  scaleWithVelocity?: number;
  draggable?: boolean;
  outlineAlternate?: boolean;
  gap?: number;
  className?: string;
  damping?: number;
  stiffness?: number;
  numCopies?: number;
  separator?: ReactNode;
  fadeEdges?: boolean;
  pauseOnHover?: boolean;
  velocityMapping?: { input: number[]; output: number[] };
  parallaxClassName?: string;
  scrollerClassName?: string;
  parallaxStyle?: CSSProperties;
  scrollerStyle?: CSSProperties;
}

declare function ScrollVelocity(props: ScrollVelocityProps): ReactNode;
export default ScrollVelocity;
