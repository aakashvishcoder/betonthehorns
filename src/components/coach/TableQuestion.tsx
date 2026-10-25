import { useRef, useState } from "react";
import LatticeLoader from "@/components/react-bits/LatticeLoader";
import PromptBar from "@/components/react-bits/PromptBar";
import { sessionHeader } from "@/lib/session";

const PROMPTS: Record<string, string> = {
  "/rules": "What beats what in Texas Hold'em?",
  "/blinds": "How do the blinds work here?",
  "/shove": "When should I shove in a sit and go?",
  "/review": "Review my hand:",
};

function browserId() {
  try {
    let id = localStorage.getItem("allin-coach-id");
    if (!id) localStorage.setItem("allin-coach-id", (id = crypto.randomUUID()));
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function expand(text: string) {
  const hit = Object.keys(PROMPTS).find(
    (key) => text === key || text.startsWith(`${key} `),
  );
  if (!hit) return text;
  const rest = text.slice(hit.length).trim();
  return rest ? `${PROMPTS[hit]} ${rest}` : PROMPTS[hit];
}

/** One question to the coach, from the play dashboard. The ace card still holds the longer chat. */
export default function TableQuestion() {
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  async function send(text: string) {
    const question = expand(text).trim();
    if (!question) return;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sessionHeader() },
        signal: next.signal,
        body: JSON.stringify({
          browserId: browserId(),
          messages: [{ role: "user", content: question }],
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        reply?: string;
        error?: string;
      };
      if (res.ok && data.reply) setReply(data.reply);
      else setError(data.error ?? "The coach couldn't answer just now.");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError("Can't reach the coach. Is the game server running?");
    } finally {
      if (controller.current === next) setBusy(false);
    }
  }

  return (
    <section className="play-ask" aria-label="Ask the coach">
      <span className="club-eyebrow">BEFORE YOU SIT</span>
      <h2>Ask the coach.</h2>
      <p>Type / for a starting question. The ace in the corner keeps the longer thread.</p>
      <PromptBar
        placeholder="Ask about a hand, a rule, or a shove…"
        sources={[]}
        models={[]}
        efforts={[]}
        commands={[
          { key: "rules", name: "/rules", description: "What beats what" },
          { key: "blinds", name: "/blinds", description: "How the blinds work here" },
          { key: "shove", name: "/shove", description: "Short-stacked in a sit-and-go" },
          { key: "review", name: "/review", description: "Walk through a hand I played" },
        ]}
        busy={busy}
        onSend={(text) => void send(text)}
        onStop={() => controller.current?.abort()}
        background="#141016"
        color="#fbf5fe"
        menuBackground="#1c121c"
        sparkColor="#d081f1"
        width={760}
        radius={18}
      />
      {busy && (
        <LatticeLoader
          label="Thinking"
          color="#e1b0f7"
          glow
          glowColor="#932db9"
          pattern="orbit"
          showTimer={false}
        />
      )}
      {reply && <p className="play-ask-reply">{reply}</p>}
      {error && <p className="play-ask-error">{error}</p>}
    </section>
  );
}
