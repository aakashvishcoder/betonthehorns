import type { CSSProperties } from "react";
import { toast } from "sonner";

const style: CSSProperties = {
  background: "#6f2088",
  color: "#ffffff",
  borderColor: "#d081f1",
};

const options = {
  className: "wallet-toast",
  position: "top-center" as const,
  style,
};

export const walletToast = {
  success(message: string) {
    toast.success(message, options);
  },
  error(message: string) {
    toast.error(message, options);
  },
};
