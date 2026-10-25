import { type FormEvent, useEffect, useRef, useState } from "react";
import { ArrowUp, X } from "lucide-react";
import { deckArt } from "@/lib/poker-design";
import { useCoachBlocked } from "./coachGate";
import "@/styles/coach.css";

type Source = { title: string; link: string; source: string };
type Message = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
};

const HISTORY_SENT = 6;
const STARTERS = [
  "What beats what?",
  "How do blinds work here?",
  "When should I shove in a Sit & Go?",
  "Review my hand: I called a river shove with top pair…",
];

/** Anonymous per-browser id for the daily question cap (until wallet login is merged). */
function browserId() {
  try {
    let id = localStorage.getItem("allin-coach-id");
    if (!id) localStorage.setItem("allin-coach-id", (id = crypto.randomUUID()));
    return id;
  } catch {
    return (browserId.fallback ??= crypto.randomUUID());
  }
}
browserId.fallback = undefined as string | undefined;

function loadChat(): Message[] {
  try {
    return JSON.parse(sessionStorage.getItem("allin-coach-chat") ?? "[]");
  } catch {
    return [];
  }
}

/** The AI poker coach: an ace of spades in the corner that opens into a card-shaped chat. */
export default function CoachWidget() {
  const blocked = useCoachBlocked();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(loadChat);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        "allin-coach-chat",
        JSON.stringify(messages.slice(-30)),
      );
    } catch {}
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, thinking]);

  useEffect(() => {
    if (blocked) setOpen(false);
  }, [blocked]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || thinking) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setDraft("");
    setNotice(null);
    setThinking(true);
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          browserId: browserId(),
          messages: next.slice(-HISTORY_SENT),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        reply?: string;
        sources?: Source[];
        error?: string;
      };
      if (res.ok && data.reply)
        setMessages([
          ...next,
          {
            role: "assistant",
            content: data.reply,
            sources: data.sources?.length ? data.sources : undefined,
          },
        ]);
      else
        setNotice(
          data.error ?? "The coach couldn't answer just now. Please try again.",
        );
    } catch {
      setNotice("Can't reach the coach. Is the game server running?");
    } finally {
      setThinking(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void ask(draft);
  }

  if (blocked) {
    return (
      <div
        className="coach-launcher is-blocked"
        role="img"
        aria-label="The poker coach is off during ranked games"
        title="The coach is off during ranked games"
      >
        <img src={deckArt.BACK} alt="" />
      </div>
    );
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          className="coach-launcher"
          onClick={() => setOpen(true)}
          aria-label="Open the poker coach"
          title="Ask the poker coach"
        >
          <img src={deckArt.AS} alt="" />
          <span className="coach-launcher-label">Coach</span>
        </button>
      )}
      {open && (
        <section className="coach-card" role="dialog" aria-label="Poker coach">
          <span className="coach-index" aria-hidden="true">
            A<b>♠</b>
          </span>
          <span className="coach-index coach-index--flipped" aria-hidden="true">
            A<b>♠</b>
          </span>
          <header className="coach-header">
            <div>
              <h2>The Coach</h2>
              <p>Rules, strategy and hand reviews.</p>
            </div>
            <button
              type="button"
              className="coach-close"
              onClick={() => setOpen(false)}
              aria-label="Close the coach"
            >
              <X size={16} />
            </button>
          </header>

          <div className="coach-messages" ref={listRef} aria-live="polite">
            {messages.length === 0 && (
              <div className="coach-welcome">
                <p>
                  Ask me anything about poker, from what beats a flush to how to
                  play short-stacked in a Sit &amp; Go.
                </p>
                <div className="coach-starters">
                  {STARTERS.map((s) => (
                    <button
                      type="button"
                      key={s}
                      onClick={() =>
                        s.endsWith("…")
                          ? (setDraft(s), inputRef.current?.focus())
                          : void ask(s)
                      }
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`coach-message coach-message--${m.role}`}>
                {m.content}
                {m.sources && (
                  <span className="coach-sources">
                    Sources:{" "}
                    {m.sources.map((s, j) => (
                      <a
                        key={s.link}
                        href={s.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={s.title}
                      >
                        {s.source}
                        {j < m.sources!.length - 1 ? " · " : ""}
                      </a>
                    ))}
                  </span>
                )}
              </div>
            ))}
            {thinking && (
              <p
                className="coach-message coach-message--assistant coach-thinking"
                aria-label="The coach is thinking"
              >
                <span>♠</span>
                <span>♥</span>
                <span>♦</span>
                <span>♣</span>
              </p>
            )}
            {notice && <p className="coach-notice">{notice}</p>}
          </div>

          <form className="coach-form" onSubmit={submit}>
            <label htmlFor="coach-input" className="sr-only">
              Ask the coach
            </label>
            <textarea
              id="coach-input"
              ref={inputRef}
              rows={2}
              maxLength={1000}
              value={draft}
              placeholder="Ask about a hand or a rule…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) submit(e);
              }}
            />
            <button
              type="submit"
              className="coach-send"
              disabled={!draft.trim() || thinking}
              aria-label="Send"
            >
              <ArrowUp size={17} />
            </button>
          </form>
          <footer className="coach-footer">
            <span>ALL IN</span>
          </footer>
        </section>
      )}
    </>
  );
}
