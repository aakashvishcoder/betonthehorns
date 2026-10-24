import type { ComponentType, CSSProperties, MouseEvent } from "react";

export type FlowingMenuDirection = "left" | "right" | "alternate";
export type FlowingMenuAlignment = "left" | "center";
export type FlowingMenuImageShape = "pill" | "rounded" | "circle";

export interface FlowingMenuItem {
  text: string;
  link?: string;
  image?: string;
  marquee?: string;
  meta?: string;
}

export interface FlowingMenuProps {
  items?: FlowingMenuItem[];
  speed?: number;
  direction?: FlowingMenuDirection;
  followCursor?: number;
  duration?: number;
  stretch?: number;
  magnet?: number;
  bandInset?: number;
  carryContent?: boolean;
  bandRadius?: number;
  textColor?: string;
  bgColor?: string;
  marqueeBgColor?: string;
  marqueeTextColor?: string;
  borderColor?: string;
  dividers?: boolean;
  dimInactive?: boolean;
  align?: FlowingMenuAlignment;
  showIndex?: boolean;
  showArrow?: boolean;
  imageShape?: FlowingMenuImageShape;
  intro?: boolean;
  /** Stops autonomous marquee motion; focus and pointer highlighting remain available. */
  paused?: boolean;
  activeIndex?: number;
  onItemClick?: (
    item: FlowingMenuItem,
    index: number,
    event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>
  ) => void;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}

declare const FlowingMenu: ComponentType<FlowingMenuProps>;

export default FlowingMenu;
