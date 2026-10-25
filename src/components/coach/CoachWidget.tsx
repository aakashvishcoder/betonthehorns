import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, RotateCcw, X } from "lucide-react";
import LatticeLoader from "@/components/react-bits/LatticeLoader";
import { deckArt } from "@/lib/poker-design";
import { sessionHeader } from "@/lib/session";
import { useCoachBlocked } from "./coachGate";
import { formatReply } from "./formatReply";
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

/** Words (with their spacing) of a reply, for the typing reveal. */
const words = (text: string) => text.match(/\S+\s*|\s+/g) ?? [];
/** Delay before the next word: ~4s for a whole reply at most, with a little human jitter. */
const wordDelay = (total: number) => Math.min(45, Math.max(12, 4000 / total)) * (0.6 + Math.random() * 0.8);
/** While typing, a dangling "**" would show as asterisks; hide it until its closing pair arrives. */
const hideOpenBold = (text: string) =>
  (text.match(/\*\*/g)?.length ?? 0) % 2 ? text.replace(/\*\*(?![\s\S]*\*\*)/, "") : text;
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

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
  /** The reply being typed out: its index and how many words are showing. */
  const [typing, setTyping] = useState<{ index: number; shown: number } | null>(null);
  /** Whether the list is scrolled to the bottom (then new text keeps it there). */
  const [atBottom, setAtBottom] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        "allin-coach-chat",
        JSON.stringify(messages.slice(-30)),
      );
    } catch {}
  }, [messages]);

  // Reveal the newest reply word by word.
  useEffect(() => {
    if (!typing) return;
    const total = words(messages[typing.index]?.content ?? "").length;
    if (typing.shown >= total) {
      setTyping(null);
      return;
    }
    const timer = window.setTimeout(
      () => setTyping({ index: typing.index, shown: typing.shown + 1 }),
      wordDelay(total),
    );
    return () => window.clearTimeout(timer);
  }, [typing, messages]);

  // Follow new text only if the reader is already at the bottom; otherwise leave them be.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && atBottom) list.scrollTop = list.scrollHeight;
  }, [messages, thinking, typing, notice, open, atBottom]);

  function scrollToLatest() {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    setAtBottom(true);
  }

  function clearChat() {
    setMessages([]);
    setTyping(null);
    setNotice(null);
    setAtBottom(true);
    inputRef.current?.focus();
  }

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
    setTyping(null);
    setDraft("");
    setNotice(null);
    setThinking(true);
    setAtBottom(true); // sending a question always jumps to the conversation's end
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        // Signed-in players send their session so the server can keep the coach off at ranked tables.
        headers: { "Content-Type": "application/json", ...sessionHeader() },
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
      if (res.ok && data.reply) {
        setMessages([
          ...next,
          {
            role: "assistant",
            content: data.reply,
            sources: data.sources?.length ? data.sources : undefined,
          },
        ]);
        if (!reducedMotion()) setTyping({ index: next.length, shown: 0 });
      } else
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
            <div className="coach-header-actions">
              {messages.length > 0 && (
                <button
                  type="button"
                  className="coach-close"
                  onClick={clearChat}
                  disabled={thinking}
                  aria-label="Clear the chat"
                  title="New chat"
                >
                  <RotateCcw size={15} />
                </button>
              )}
              <button
                type="button"
                className="coach-close"
                onClick={() => setOpen(false)}
                aria-label="Close the coach"
              >
                <X size={16} />
              </button>
            </div>
          </header>

          <div
            className="coach-messages"
            ref={listRef}
            aria-live="polite"
            data-lenis-prevent
            onScroll={(e) => {
              const el = e.currentTarget;
              setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 32);
            }}
          >
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
            {messages.map((m, i) => {
              const isTyping = typing?.index === i;
              if (m.role === "user")
                return (
                  <div key={i} className="coach-message coach-message--user">
                    {m.content}
                  </div>
                );
              return (
              <div key={i} className="coach-message coach-message--assistant">
                {isTyping ? (
                  <>
                    {/* Screen readers get the whole reply at once, not every word. */}
                    <span className="sr-only">{m.content}</span>
                    <div className="coach-reply" aria-hidden="true">
                      {formatReply(
                        hideOpenBold(words(m.content).slice(0, typing.shown).join("")),
                        <span className="coach-cursor" />,
                      )}
                    </div>
                  </>
                ) : (
                  <div className="coach-reply">{formatReply(m.content)}</div>
                )}
                {m.sources && !isTyping && (
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
              );
            })}
            {thinking && (
              <p className="coach-message coach-message--assistant coach-thinking">
                <LatticeLoader
                  label="Thinking"
                  color="#3b0949"
                  glow
                  glowColor="#932db9"
                  pattern="orbit"
                  cellSize={5}
                  fontSize={13}
                  showTimer={false}
                />
              </p>
            )}
            {notice && <p className="coach-notice">{notice}</p>}
          </div>
          {!atBottom && (
            <button type="button" className="coach-jump" onClick={scrollToLatest}>
              <ArrowDown size={13} /> Latest
            </button>
          )}

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
