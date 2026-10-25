import type { ReactNode } from "react";

export interface PromptBarSource {
  key: string;
  name: string;
  description?: string;
  icon?: ReactNode;
  attach?: boolean;
}

export interface PromptBarCommand {
  key: string;
  name: string;
  description?: string;
}

export interface PromptBarModel {
  key: string;
  name: string;
  tag?: string;
}

export interface PromptBarProps {
  placeholder?: string;
  sources?: PromptBarSource[];
  commands?: PromptBarCommand[];
  models?: PromptBarModel[];
  efforts?: string[];
  defaultEffort?: string;
  onEffortChange?: (effort: string) => void;
  defaultModel?: string;
  busy?: boolean;
  onSend?: (
    text: string,
    meta: { attachments: string[]; model?: PromptBarModel; effort: string },
  ) => void;
  onStop?: () => void;
  onAttach?: () => string | string[] | Promise<string | string[] | undefined> | undefined;
  onDictate?: () => string | Promise<string>;
  background?: string;
  color?: string;
  menuBackground?: string;
  sparkColor?: string;
  sparkBoost?: number;
  width?: number;
  radius?: number;
  maxRows?: number;
  morphDuration?: number;
  squash?: number;
  tilt?: number;
  pressScale?: number;
  className?: string;
}

declare function PromptBar(props: PromptBarProps): ReactNode;
export default PromptBar;
