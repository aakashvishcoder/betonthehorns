import { useEffect, useState } from "react";
import "@/styles/news.css";

type NewsItem = { title: string; link: string; source: string };

const SUITS = ["♠", "♥", "♣", "♦"];

/** Poker headlines (via the game server's cached SerpApi feed), scrolling like the suit marquee above it. */
export default function NewsTicker() {
  const [items, setItems] = useState<NewsItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/news")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then(
        (data: { items?: NewsItem[] }) =>
          !cancelled && setItems(data.items ?? []),
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (items.length === 0) return null;

  const row = (copy: number) =>
    items.map((item, i) => (
      <li key={`${copy}-${item.link}`} aria-hidden={copy > 0 || undefined}>
        <b className={i % 2 ? "is-red" : undefined}>
          {SUITS[i % SUITS.length]}
        </b>
        <a
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={copy > 0 ? -1 : undefined}
        >
          {item.source && <small>{item.source}</small>}
          {item.title}
        </a>
      </li>
    ));

  return (
    <section className="news-ticker" aria-label="Poker news">
      <span className="news-ticker-label">
        <b>♠</b> POKER NEWS
      </span>
      <div className="news-ticker-viewport">
        {/* Two copies make the loop seamless; only the first is read out or tabbable. */}
        <ul
          className="news-ticker-track"
          style={{ animationDuration: `${items.length * 7}s` }}
        >
          {row(0)}
          {row(1)}
        </ul>
      </div>
    </section>
  );
}
