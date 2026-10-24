import { useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type WalletChoice = {
  name: string;
  icon: string;
};

export default function WalletPicker({
  wallets,
  onSelect,
  onCancel,
}: {
  wallets: WalletChoice[];
  onSelect: (name: string) => void;
  onCancel: () => void;
}) {
  const picked = useRef(false);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (next) return;
        if (picked.current) {
          picked.current = false;
          return;
        }
        onCancel();
      }}
    >
      <DialogContent className="wallet-picker">
        <DialogHeader>
          <DialogTitle>Choose a Solana wallet</DialogTitle>
          <DialogDescription>
            More than one wallet is installed in this browser. Pick the one you
            want to play with.
          </DialogDescription>
        </DialogHeader>
        <div className="wallet-picker-list">
          {wallets.map((wallet) => (
            <button
              key={wallet.name}
              type="button"
              className="wallet-choice"
              onClick={() => {
                picked.current = true;
                onSelect(wallet.name);
              }}
            >
              <img src={wallet.icon} alt="" width={28} height={28} />
              <span>{wallet.name}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
