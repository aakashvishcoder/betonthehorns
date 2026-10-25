import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import PokerAppShell from "@/components/poker-app/PokerAppShell";
import { PageHeading } from "@/components/poker-app/PokerUI";
import LatticeLoader from "@/components/react-bits/LatticeLoader";
import { api } from "@/lib/api";
import "@/styles/news-page.css";

type Story = { title: string; link: string; source: string; date: string };

const SUITS = ["♠", "♥", "♣", "♦"];

function storyDate(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function refreshedLabel(updatedAt: number) {
  if (!updatedAt) return "Waiting on the first pull.";
  const hours = Math.max(0, Math.round((Date.now() - updatedAt) / 3_600_000));
  if (hours < 1) return "Updated within the last hour.";
  if (hours === 1) return "Updated about an hour ago.";
  return `Updated about ${hours} hours ago.`;
}

export default function NewsPage() {
  const [stories, setStories] = useState<Story[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .news()
      .then((payload) => {
        if (cancelled) return;
        setStories(payload.items);
        setUpdatedAt(payload.updatedAt);
      })
      .catch(() => {
        if (!cancelled) {
          setStories([]);
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PokerAppShell section="news">
      <div className="news-page">
        <PageHeading
          eyebrow="FROM THE CIRCUIT"
          title="Poker news."
          description="WSOP, WPT, and EPT headlines from the last week."
        />
        {stories === null ? (
          <div className="news-page-loading">
            <LatticeLoader
              label="Shuffling"
              color="#e1b0f7"
              glow
              glowColor="#932db9"
              pattern="spiral"
              showTimer={false}
            />
          </div>
        ) : stories.length === 0 ? (
          <p className="news-page-empty">
            {failed
              ? "The news feed did not answer. Try again in a minute."
              : "No tournament headlines in the last week."}
          </p>
        ) : (
          <>
            <p className="news-page-meta">{refreshedLabel(updatedAt)}</p>
            <ol className="news-list">
              {stories.map((story, index) => (
                <li key={story.link}>
                  <a
                    href={story.link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span
                      className={
                        index % 2
                          ? "news-suit news-suit--red"
                          : "news-suit"
                      }
                      aria-hidden="true"
                    >
                      {SUITS[index % SUITS.length]}
                    </span>
                    <span className="news-copy">
                      <span className="news-kicker">
                        {story.source || "Poker"}
                        {story.date ? <i>{storyDate(story.date)}</i> : null}
                      </span>
                      <strong>{story.title}</strong>
                    </span>
                    <ArrowUpRight size={18} aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </PokerAppShell>
  );
}
