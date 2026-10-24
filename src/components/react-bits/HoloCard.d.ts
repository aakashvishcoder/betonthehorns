import type * as React from "react";

export type HoloCardPreset =
  | "bursts"
  | "stars"
  | "shards"
  | "cosmos"
  | "rainbow"
  | "swirl"
  | "glitter"
  | "gold";

export interface HoloCardProps {
  image?: string;
  backImage?: string;
  alt?: string;
  preset?: HoloCardPreset;
  intensity?: number;
  scale?: number;
  edgeSparkle?: number;
  frame?: number;
  glare?: number;
  foilColor?: string;
  width?: number;
  radius?: number;
  tiltMax?: number;
  hoverScale?: number;
  idle?: boolean;
  /** Stops idle shimmer and pointer tilt; an explicitly triggered flip remains available. */
  paused?: boolean;
  shadow?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

declare const HoloCard: React.ComponentType<HoloCardProps>;

export default HoloCard;
