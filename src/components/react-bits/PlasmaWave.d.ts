import type { ComponentType, HTMLAttributes } from "react";

export interface PlasmaWaveProps extends HTMLAttributes<HTMLDivElement> {
  /** The two plasma ribbon colors. */
  colors?: readonly [string, string];
  speed?: number;
  speed1?: number;
  speed2?: number;
  dir2?: number;
  bend1?: number;
  bend2?: number;
  thickness?: number;
  focalLength?: number;
  rotationDeg?: number;
  xOffset?: number;
  yOffset?: number;
  brightness?: number;
  glow?: number;
  core?: number;
  grain?: number;
  quality?: number;
  mouseInteraction?: boolean;
  intro?: boolean;
  fade?: number;
  opacity?: number;
  lightMode?: boolean;
  /** Freezes autonomous animation time and cursor easing. */
  paused?: boolean;
  /** Maximum device-pixel ratio; defaults to the browser ratio capped at 2. */
  dpr?: number;
}

declare const PlasmaWave: ComponentType<PlasmaWaveProps>;

export default PlasmaWave;
