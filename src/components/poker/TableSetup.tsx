import * as React from "react";
import {
  CheckCircle2,
  Clipboard,
  Copy,
  Dices,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type StartingChips = 1000 | 2500 | 5000;
type SetupStep = "form" | "success";
type CopyState = "idle" | "pending" | "copied" | "error";

type SavedTableSetup = {
  playerName: string;
  tableName: string;
  startingChips: StartingChips;
  tableCode: string;
  createdAt: string;
};

type TableSetupProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const startingChipOptions: StartingChips[] = [1000, 2500, 5000];
const tableStorageKey = "allin-table";
const tableCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function formatChips(chips: StartingChips) {
  return new Intl.NumberFormat("en-US").format(chips);
}

function generateTableCode() {
  const randomValues = new Uint32Array(6);
  crypto.getRandomValues(randomValues);

  return Array.from(
    randomValues,
    value => tableCodeAlphabet[value % tableCodeAlphabet.length]
  ).join("");
}

function copyWithFallback(text: string) {
  return new Promise<void>((resolve, reject) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    textArea.style.pointerEvents = "none";
    document.body.appendChild(textArea);
    textArea.select();

    try {
      const didCopy = document.execCommand("copy");
      if (didCopy) {
        resolve();
      } else {
        reject(new Error("The browser did not complete the copy action."));
      }
    } catch (error) {
      reject(error);
    } finally {
      document.body.removeChild(textArea);
    }
  });
}

export default function TableSetup({ open, onOpenChange }: TableSetupProps) {
  const [step, setStep] = React.useState<SetupStep>("form");
  const [playerName, setPlayerName] = React.useState("");
  const [tableName, setTableName] = React.useState("Friday Night Crew");
  const [startingChips, setStartingChips] = React.useState<StartingChips>(2500);
  const [playerNameError, setPlayerNameError] = React.useState("");
  const [tableNameError, setTableNameError] = React.useState("");
  const [storageError, setStorageError] = React.useState("");
  const [savedSetup, setSavedSetup] = React.useState<SavedTableSetup | null>(
    null
  );
  const [copyState, setCopyState] = React.useState<CopyState>("idle");
  const playerNameInputRef = React.useRef<HTMLInputElement>(null);

  const resetForm = React.useCallback(() => {
    setStep("form");
    setPlayerName("");
    setTableName("Friday Night Crew");
    setStartingChips(2500);
    setPlayerNameError("");
    setTableNameError("");
    setStorageError("");
    setSavedSetup(null);
    setCopyState("idle");

    window.setTimeout(() => playerNameInputRef.current?.focus(), 0);
  }, []);

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setCopyState("idle");
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange]
  );

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedPlayerName = playerName.trim();
    const trimmedTableName = tableName.trim();
    const nextPlayerNameError = trimmedPlayerName
      ? ""
      : "Enter the name you would like shown at the table.";
    const nextTableNameError = trimmedTableName
      ? ""
      : "Enter a name for this table.";

    setPlayerNameError(nextPlayerNameError);
    setTableNameError(nextTableNameError);
    setStorageError("");

    if (nextPlayerNameError || nextTableNameError) {
      return;
    }

    const nextSetup: SavedTableSetup = {
      playerName: trimmedPlayerName,
      tableName: trimmedTableName,
      startingChips,
      tableCode: generateTableCode(),
      createdAt: new Date().toISOString(),
    };

    try {
      window.localStorage.setItem(tableStorageKey, JSON.stringify(nextSetup));
      setSavedSetup(nextSetup);
      setStep("success");
    } catch {
      setStorageError(
        "This browser could not save your table. Please allow local storage and try again."
      );
    }
  };

  const handleCopyDetails = async () => {
    if (!savedSetup) {
      return;
    }

    const details = [
      `${savedSetup.tableName}`,
      `Host: ${savedSetup.playerName}`,
      `Starting chips: ${formatChips(savedSetup.startingChips)}`,
      `Table code: ${savedSetup.tableCode}`,
    ].join("\n");

    setCopyState("pending");

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(details);
      } else {
        await copyWithFallback(details);
      }
      setCopyState("copied");
    } catch {
      try {
        await copyWithFallback(details);
        setCopyState("copied");
      } catch {
        setCopyState("error");
      }
    }
  };

  const copyStatus =
    copyState === "pending"
      ? "Copying details…"
      : copyState === "copied"
        ? "Details copied to your clipboard."
        : copyState === "error"
          ? "Could not copy details. You can copy the table code manually."
          : "";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-lenis-prevent
        className="setup-dialog max-h-[calc(100vh-2rem)] overflow-y-auto border-[#6f2088] bg-[#0e0b0f] p-0 text-[#fbf5fe] shadow-[0_24px_80px_rgba(0,0,0,0.55)] sm:max-w-[590px]"
        showCloseButton={false}
        onOpenAutoFocus={event => {
          if (step === "form") {
            event.preventDefault();
            playerNameInputRef.current?.focus();
          }
        }}
      >
        <div className="setup-shell relative overflow-hidden">
          <div className="setup-top-accent h-1.5 bg-[#932db9]" />
          <div className="setup-leaf-glow pointer-events-none absolute -top-24 -right-20 h-48 w-48 rounded-full bg-[#6f2088] blur-3xl" />

          <DialogClose asChild>
            <button
              type="button"
              className="setup-close absolute top-5 right-5 inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#6f2088] bg-[#18121b]/90 text-[#edd3fb] transition hover:border-[#d081f1] hover:bg-[#3b0949] hover:text-[#fbf5fe] focus-visible:ring-2 focus-visible:ring-[#d081f1] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e0b0f] focus-visible:outline-none"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Close table setup</span>
            </button>
          </DialogClose>

          {step === "form" ? (
            <form
              className="setup-form relative p-6 sm:p-8"
              noValidate
              onSubmit={handleSubmit}
            >
              <DialogHeader className="setup-header items-start gap-3 pr-10 text-left">
                <div className="setup-eyebrow inline-flex items-center gap-2 rounded-full border border-[#6f2088] bg-[#3b0949] px-3 py-1 text-[11px] font-bold tracking-[0.16em] text-[#edd3fb]">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  LOCAL TABLE SETUP
                </div>
                <DialogTitle className="setup-title font-serif text-3xl leading-[1.05] tracking-[-0.035em] text-[#fbf5fe] sm:text-[2.15rem]">
                  Your next poker night starts here.
                </DialogTitle>
                <DialogDescription className="setup-description max-w-[430px] text-[15px] leading-6 text-[#edd3fb]">
                  Set the table for your crew in a few thoughtful details.
                </DialogDescription>
              </DialogHeader>

              <div className="setup-notice mt-6 flex items-center gap-2 rounded-xl border border-[#8c2542] bg-[#430e1d] px-3.5 py-3 text-xs font-bold tracking-[0.11em] text-[#e98392]">
                <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                RANKED TABLES · ELO ONLY
              </div>

              <div className="setup-fields mt-6 space-y-5">
                <div className="setup-field space-y-2">
                  <label
                    className="setup-label text-sm font-semibold text-[#f6e9fe]"
                    htmlFor="setup-player-name"
                  >
                    Your name
                  </label>
                  <input
                    ref={playerNameInputRef}
                    id="setup-player-name"
                    name="playerName"
                    type="text"
                    autoComplete="name"
                    required
                    maxLength={32}
                    value={playerName}
                    onChange={event => {
                      setPlayerName(event.target.value);
                      if (playerNameError) setPlayerNameError("");
                    }}
                    aria-invalid={Boolean(playerNameError)}
                    aria-describedby={
                      playerNameError ? "setup-player-name-error" : undefined
                    }
                    className="setup-input h-12 w-full rounded-xl border border-[#5e206f] bg-[#18121b] px-3.5 text-[15px] text-[#fbf5fe] shadow-sm outline-none transition placeholder:text-[#e1b0f7] hover:border-[#932db9] focus:border-[#d081f1] focus:ring-2 focus:ring-[#d081f1] focus:ring-offset-2 focus:ring-offset-[#0e0b0f]"
                    placeholder="What should the crew call you?"
                  />
                  <div className="setup-field-meta flex min-h-5 items-start justify-between gap-3 text-xs">
                    <p
                      id="setup-player-name-error"
                      className="setup-field-error text-[#e98392]"
                      role={playerNameError ? "alert" : undefined}
                    >
                      {playerNameError}
                    </p>
                    <span className="setup-character-count ml-auto shrink-0 text-[#e1b0f7]">
                      {playerName.length}/32
                    </span>
                  </div>
                </div>

                <div className="setup-field space-y-2">
                  <label
                    className="setup-label text-sm font-semibold text-[#f6e9fe]"
                    htmlFor="setup-table-name"
                  >
                    Table name
                  </label>
                  <input
                    id="setup-table-name"
                    name="tableName"
                    type="text"
                    required
                    maxLength={50}
                    value={tableName}
                    onChange={event => {
                      setTableName(event.target.value);
                      if (tableNameError) setTableNameError("");
                    }}
                    aria-invalid={Boolean(tableNameError)}
                    aria-describedby={
                      tableNameError ? "setup-table-name-error" : undefined
                    }
                    className="setup-input h-12 w-full rounded-xl border border-[#5e206f] bg-[#18121b] px-3.5 text-[15px] text-[#fbf5fe] shadow-sm outline-none transition placeholder:text-[#e1b0f7] hover:border-[#932db9] focus:border-[#d081f1] focus:ring-2 focus:ring-[#d081f1] focus:ring-offset-2 focus:ring-offset-[#0e0b0f]"
                  />
                  <div className="setup-field-meta flex min-h-5 items-start justify-between gap-3 text-xs">
                    <p
                      id="setup-table-name-error"
                      className="setup-field-error text-[#e98392]"
                      role={tableNameError ? "alert" : undefined}
                    >
                      {tableNameError}
                    </p>
                    <span className="setup-character-count ml-auto shrink-0 text-[#e1b0f7]">
                      {tableName.length}/50
                    </span>
                  </div>
                </div>

                <fieldset className="setup-chip-field space-y-3">
                  <legend className="setup-label text-sm font-semibold text-[#f6e9fe]">
                    Starting chips
                  </legend>
                  <div className="setup-chip-options grid grid-cols-3 gap-2">
                    {startingChipOptions.map(option => {
                      const isSelected = option === startingChips;

                      return (
                        <button
                          key={option}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => setStartingChips(option)}
                          className={`setup-chip-option rounded-xl border px-2 py-3 text-center transition focus-visible:ring-2 focus-visible:ring-[#d081f1] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e0b0f] focus-visible:outline-none ${
                            isSelected
                              ? "border-[#8625a6] bg-[#8625a6] text-white shadow-[0_6px_16px_rgba(0,0,0,0.35)]"
                              : "border-[#5e206f] bg-[#18121b] text-[#f6e9fe] hover:border-[#ba50e5] hover:bg-[#3b0949]"
                          }`}
                        >
                          <span className="setup-chip-amount block text-base font-bold">
                            {formatChips(option)}
                          </span>
                          <span
                            className={`setup-chip-caption mt-0.5 block text-[10px] font-semibold tracking-[0.08em] ${
                              isSelected ? "text-[#f6e9fe]" : "text-[#e1b0f7]"
                            }`}
                          >
                            CHIPS
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              </div>

              {storageError ? (
                <p
                  className="setup-storage-error mt-5 rounded-xl border border-[#8c2542] bg-[#430e1d] px-3.5 py-3 text-sm leading-5 text-[#e98392]"
                  role="alert"
                >
                  {storageError}
                </p>
              ) : null}

              <div className="setup-actions mt-7">
                <button
                  type="submit"
                  className="setup-submit inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#932db9] px-5 text-sm font-bold text-white shadow-[0_8px_18px_rgba(0,0,0,0.4)] transition hover:bg-[#8625a6] focus-visible:ring-2 focus-visible:ring-[#d081f1] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e0b0f] focus-visible:outline-none"
                >
                  <Dices className="h-4 w-4" aria-hidden="true" />
                  Prepare my table
                </button>
                <p className="setup-local-note mt-3 text-center text-xs leading-5 text-[#e1b0f7]">
                  Your table setup is saved in this browser. Multiplayer is
                  coming next.
                </p>
              </div>
            </form>
          ) : savedSetup ? (
            <div className="setup-success relative p-6 sm:p-8">
              <DialogHeader className="setup-success-header items-start gap-3 pr-10 text-left">
                <div className="setup-success-icon flex h-11 w-11 items-center justify-center rounded-full bg-[#3b0949] text-[#d081f1]">
                  <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
                </div>
                <div>
                  <DialogTitle className="setup-title font-serif text-3xl leading-[1.05] tracking-[-0.035em] text-[#fbf5fe] sm:text-[2.15rem]">
                    Your table is prepared.
                  </DialogTitle>
                  <DialogDescription className="setup-description mt-2 text-[15px] leading-6 text-[#edd3fb]">
                    Here are the details for your local poker night.
                  </DialogDescription>
                </div>
              </DialogHeader>

              <div className="setup-summary mt-7 overflow-hidden rounded-2xl border border-[#6f2088] bg-[#18121b]">
                <div className="setup-summary-header flex items-center gap-2 border-b border-[#6f2088] bg-[#3b0949] px-4 py-3 text-xs font-bold tracking-[0.12em] text-[#edd3fb]">
                  <Dices className="h-4 w-4" aria-hidden="true" />
                  TABLE DETAILS
                </div>
                <dl className="setup-summary-list divide-y divide-[#5e206f] px-4">
                  <div className="setup-summary-row flex items-center justify-between gap-5 py-3.5">
                    <dt className="setup-summary-label text-sm text-[#e1b0f7]">
                      Table
                    </dt>
                    <dd className="setup-summary-value text-right text-sm font-bold text-[#fbf5fe]">
                      {savedSetup.tableName}
                    </dd>
                  </div>
                  <div className="setup-summary-row flex items-center justify-between gap-5 py-3.5">
                    <dt className="setup-summary-label text-sm text-[#e1b0f7]">
                      Host
                    </dt>
                    <dd className="setup-summary-value text-right text-sm font-bold text-[#fbf5fe]">
                      {savedSetup.playerName}
                    </dd>
                  </div>
                  <div className="setup-summary-row flex items-center justify-between gap-5 py-3.5">
                    <dt className="setup-summary-label text-sm text-[#e1b0f7]">
                      Starting stack
                    </dt>
                    <dd className="setup-summary-value text-right text-sm font-bold text-[#fbf5fe]">
                      {formatChips(savedSetup.startingChips)} chips
                    </dd>
                  </div>
                  <div className="setup-summary-row flex items-center justify-between gap-5 py-3.5">
                    <dt className="setup-summary-label text-sm text-[#e1b0f7]">
                      Table code
                    </dt>
                    <dd className="setup-table-code rounded-md bg-[#0e0b0f] px-2 py-1 font-mono text-base font-bold tracking-[0.16em] text-[#d081f1] shadow-sm">
                      {savedSetup.tableCode}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="setup-success-actions mt-6 space-y-3">
                <button
                  type="button"
                  onClick={handleCopyDetails}
                  disabled={copyState === "pending"}
                  className="setup-copy-button inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#932db9] px-5 text-sm font-bold text-white shadow-[0_8px_18px_rgba(0,0,0,0.4)] transition hover:bg-[#8625a6] focus-visible:ring-2 focus-visible:ring-[#d081f1] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e0b0f] focus-visible:outline-none disabled:cursor-wait disabled:opacity-70"
                >
                  {copyState === "copied" ? (
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  ) : copyState === "pending" ? (
                    <Clipboard
                      className="h-4 w-4 animate-pulse"
                      aria-hidden="true"
                    />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  )}
                  {copyState === "pending"
                    ? "Copying details…"
                    : "Copy details"}
                </button>
                <p
                  className={`setup-copy-status min-h-5 text-center text-xs leading-5 ${
                    copyState === "error" ? "text-[#e98392]" : "text-[#e1b0f7]"
                  }`}
                  aria-live="polite"
                >
                  {copyStatus}
                </p>
                <button
                  type="button"
                  onClick={resetForm}
                  className="setup-reset-button inline-flex h-11 w-full items-center justify-center rounded-xl border border-[#6f2088] bg-[#18121b] px-5 text-sm font-bold text-[#f6e9fe] transition hover:border-[#d081f1] hover:bg-[#3b0949] focus-visible:ring-2 focus-visible:ring-[#d081f1] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e0b0f] focus-visible:outline-none"
                >
                  Make another table
                </button>
                <DialogClose asChild>
                  <button
                    type="button"
                    className="setup-finish-button inline-flex h-11 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold text-[#e1b0f7] transition hover:bg-[#3b0949] hover:text-[#fbf5fe] focus-visible:ring-2 focus-visible:ring-[#d081f1] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e0b0f] focus-visible:outline-none"
                  >
                    Close
                  </button>
                </DialogClose>
              </div>

              <p className="setup-local-note mt-4 text-center text-xs leading-5 text-[#e1b0f7]">
                Your table setup is saved in this browser. Multiplayer is coming
                next.
              </p>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
