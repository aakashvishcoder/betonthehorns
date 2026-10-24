import type { ComponentType } from "react";

export type InfiniteSpiralAnimationMode = "auto" | "drag" | "scroll" | "all";
export type InfiniteSpiralDirection = "up" | "down";
export type InfiniteSpiralImageFit = "cover" | "contain";

export interface InfiniteSpiralItem {
  src: string;
  alt?: string;
  id?: string | number;
  label?: string;
}

export interface InfiniteSpiralProps {
  items?: Array<string | InfiniteSpiralItem>;
  speed?: number;
  direction?: InfiniteSpiralDirection;
  animationMode?: InfiniteSpiralAnimationMode;
  radius?: number;
  cardWidth?: number;
  cardHeight?: number;
  verticalSpacing?: number;
  perspective?: number;
  cardsPerTurn?: number;
  rotation?: number;
  cardTilt?: number;
  cardRadius?: number;
  centerScale?: number;
  edgeFade?: number;
  edgeBlur?: number;
  pauseOnHover?: boolean;
  paused?: boolean;
  imageFit?: InfiniteSpiralImageFit;
  grayscale?: number;
  className?: string;
}

declare const InfiniteSpiral: ComponentType<InfiniteSpiralProps>;

export default InfiniteSpiral;
