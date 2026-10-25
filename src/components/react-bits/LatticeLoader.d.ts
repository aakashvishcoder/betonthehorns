import type { CSSProperties, ReactNode } from "react";

export interface LatticeLoaderProps {
  label?: string;
  doneLabel?: string;
  errorLabel?: string;
  status?: "working" | "done" | "error";
  pattern?: string;
  grid?: 3 | 4;
  shape?: "square" | "round";
  color?: string;
  doneColor?: string;
  errorColor?: string;
  cellSize?: number;
  gap?: number;
  fontSize?: number;
  step?: number;
  idleOpacity?: number;
  glow?: boolean;
  glowColor?: string;
  showTimer?: boolean;
  elapsed?: number;
  className?: string;
  style?: CSSProperties;
}

declare function LatticeLoader(props: LatticeLoaderProps): ReactNode;
export default LatticeLoader;
