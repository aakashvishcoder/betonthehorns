import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

export interface StepProps {
  children?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
}

export function Step(props: StepProps): ReactNode;

export interface StepperProps {
  children?: ReactNode;
  step?: number;
  initialStep?: number;
  onStepChange?: (step: number) => void;
  onFinalStepCompleted?: () => void;
  indicator?: "numbers" | "dots" | "bars";
  orientation?: "horizontal" | "vertical";
  transition?: "slide" | "fade" | "none";
  linear?: boolean;
  disableStepIndicators?: boolean;
  showFooter?: boolean;
  backButtonText?: string;
  nextButtonText?: string;
  completeButtonText?: string;
  backButtonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  nextButtonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  completedContent?: ReactNode;
  theme?: "dark" | "light";
  accentColor?: string;
  frame?: boolean;
  radius?: number;
  width?: number | string;
  className?: string;
  stepContainerClassName?: string;
  contentClassName?: string;
  footerClassName?: string;
  style?: CSSProperties;
}

declare function Stepper(props: StepperProps): ReactNode;
export default Stepper;
