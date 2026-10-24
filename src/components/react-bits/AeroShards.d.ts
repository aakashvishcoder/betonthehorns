import type { CSSProperties, ComponentType } from "react";

export type AeroShardsPlacement = "full" | "left" | "right" | "center";
export type AeroShardsMaterial = "glass" | "chrome";
export type AeroShardsMarkers = "plus" | "dots" | "none";

export interface AeroShardsProps {
  shardColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  lightMode?: boolean;
  placement?: AeroShardsPlacement;
  material?: AeroShardsMaterial;
  count?: number;
  shardSize?: number;
  spread?: number;
  twist?: number;
  billow?: number;
  speed?: number;
  scale?: number;
  depthOfField?: number;
  glow?: number;
  grain?: number;
  vignette?: number;
  intro?: boolean;
  mouseInteraction?: boolean;
  mouseStrength?: number;
  markers?: AeroShardsMarkers;
  pulseOnClick?: boolean;
  holdToGather?: boolean;
  parallax?: number;
  paused?: boolean;
  dpr?: number;
  className?: string;
  style?: CSSProperties;
  onError?: (error: Error) => void;
}

declare const AeroShards: ComponentType<AeroShardsProps>;

export default AeroShards;
