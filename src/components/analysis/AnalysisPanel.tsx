import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import LatticeLoader from "@/components/react-bits/LatticeLoader";
import { api, type Analysis, type AnalysisKind } from "@/lib/api";
import "@/styles/analysis.css";

/**
 * Post-game analysis for one ranked match or one day of puzzles: shows a saved analysis if
 * there is one, otherwise a button that asks the server to write it (private to the player).
 */
export default function AnalysisPanel({
  kind,
  target,
  label = "Analyze my game",
}: {
  kind: AnalysisKind;
  target: string;
  label?: string;
}) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [status, setStatus] = useState<"checking" | "idle" | "running" | "error">("checking");
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setStatus("checking");
    api
      .savedAnalysis(kind, target)
      .then((data) => {
        if (!live) return;
        setAnalysis(data.analysis);
        setStatus("idle");
      })
      .catch(() => live && setStatus("idle"));
    return () => {
      live = false;
    };
  }, [kind, target]);

  async function run() {
    setStatus("running");
    setError("");
    try {
      setAnalysis((await api.runAnalysis(kind, target)).analysis);
      setStatus("idle");
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
    }
  }

  if (status === "checking" || status === "running") {
    return (
      <div className="analysis-start">
        <LatticeLoader
          label={status === "checking" ? "Checking" : "Reviewing the hand"}
          color="#e1b0f7"
          glow
          glowColor="#932db9"
          pattern="spiral"
          showTimer={status === "running"}
        />
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="analysis-start">
        <button type="button" className="club-button" onClick={() => void run()}>
          <Sparkles size={14} />
          {label}
        </button>
        {status === "error" && (
          <>
            <LatticeLoader
              status="error"
              label="Reviewing the hand"
              errorLabel="Couldn't review"
              color="#e1b0f7"
              showTimer={false}
            />
            <p className="analysis-error">{error}</p>
          </>
        )}
      </div>
    );
  }

  return (
    <section className="analysis" aria-label="Post-game analysis">
      <header className="analysis-head">
        <span className="analysis-grade" aria-label={`Grade ${analysis.grade}`}>
          {analysis.grade}
        </span>
        <div>
          <span className="club-eyebrow">POST-GAME ANALYSIS</span>
          <h3>{analysis.headline}</h3>
        </div>
      </header>
      <p className="analysis-summary">{analysis.summary}</p>
      <div className="analysis-lists">
        <div>
          <h4>Strengths</h4>
          <ul>
            {analysis.strengths.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4>Leaks</h4>
          <ul>
            {analysis.leaks.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      </div>
      {analysis.keyHands.length > 0 && (
        <div className="analysis-hands">
          <h4>Key spots</h4>
          {analysis.keyHands.map((h) => (
            <article key={`${h.ref}-${h.title}`} className="analysis-hand">
              <span className="analysis-ref">{h.ref}</span>
              <strong>{h.title}</strong>
              <dl>
                <dt>You</dt>
                <dd>{h.youDid}</dd>
                <dt>Better</dt>
                <dd>{h.better}</dd>
                <dt>Why</dt>
                <dd>{h.why}</dd>
              </dl>
            </article>
          ))}
        </div>
      )}
      <p className="analysis-focus">
        <strong>Work on next:</strong> {analysis.focus}
      </p>
    </section>
  );
}
