import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "wouter";
import LatticeLoader from "@/components/react-bits/LatticeLoader";
import { useAuth } from "@/lib/auth";
import { walletToast } from "@/lib/wallet-toast";

/** Sends signed-out visitors home. Leaderboard and profiles should not use this. */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, status } = useAuth();
  const [, navigate] = useLocation();
  const told = useRef(false);

  useEffect(() => {
    if (status !== "disconnected" || told.current) return;
    told.current = true;
    walletToast.error("Connect a Solana wallet to queue or sit at a table.");
    navigate("/");
  }, [navigate, status]);

  if (!isAuthenticated) {
    return (
      <div className="club-loading">
        <LatticeLoader
          label="Checking your wallet"
          color="#e1b0f7"
          glow
          glowColor="#932db9"
          pattern="orbit"
          showTimer={false}
        />
      </div>
    );
  }

  return children;
}
