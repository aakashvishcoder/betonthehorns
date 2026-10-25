import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, Trophy } from "lucide-react";
import { Link, Redirect, useRoute } from "wouter";
import PokerAppShell from "@/components/poker-app/PokerAppShell";
import {
  Avatar,
  CopyHash,
  explorerTx,
  SolanaMark,
  PageHeading,
  Panel,
  Pill,
  RankMedal,
  StatTile,
} from "@/components/poker-app/PokerUI";
import { api, type ProfileBadge, type PublicProfile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { gameModes } from "@/lib/game-modes";
import { shortAddress } from "@/lib/utils";
import "@/styles/profile.css";
import AnalysisPanel from "@/components/analysis/AnalysisPanel";
import EloChart from "@/components/profile/EloChart";

const STARTING_ELO = 1200;

function lockedProgress(badge: ProfileBadge, profile: PublicProfile) {
  const goal = Number(badge.key.split(":")[1]);
  if (badge.kind === "hands" && Number.isFinite(goal)) {
    return `${profile.hands.toLocaleString()} / ${goal.toLocaleString()} hands`;
  }
  if (badge.kind === "wins" && Number.isFinite(goal)) {
    return `${profile.wins.toLocaleString()} / ${goal.toLocaleString()} wins`;
  }
  const mode = gameModes.find((item) => item.id === badge.mode)?.label ?? "this mode";
  return `Finish one ${mode} match to mint this rank.`;
}

export default function ProfilePage() {
  const [, params] = useRoute<{ address: string }>("/profile/:address");
  const { isAuthenticated, address: myAddress } = useAuth();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [shown, setShown] = useState<string[]>([]);
  const [savingBadges, setSavingBadges] = useState(false);
  const [showLocked, setShowLocked] = useState(false);
  const lookedUp = params?.address ?? "";
  const mine = Boolean(myAddress && myAddress === lookedUp);
  const shownName = profile?.displayName || (lookedUp ? shortAddress(lookedUp) : "Wallet");

  useEffect(() => {
    if (!lookedUp) return;
    let cancelled = false;
    setProfile(null);
    setError(null);
    void api
      .profile(lookedUp)
      .then((record) => {
        if (cancelled) return;
        setProfile(record);
        setDraftName(record.displayName ?? "");
        setShown(record.badges.filter((badge) => badge.shown).map((badge) => badge.key));
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [lookedUp]);

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!myAddress) return;
    setSavingName(true);
    setNameError(null);
    try {
      const saved = await api.setDisplayName(myAddress, draftName);
      setProfile((current) =>
        current ? { ...current, displayName: saved.displayName } : current,
      );
      setDraftName(saved.displayName ?? "");
      window.dispatchEvent(new CustomEvent("horns-name", { detail: saved.displayName }));
    } catch (err) {
      setNameError((err as Error).message);
    } finally {
      setSavingName(false);
    }
  }

  async function saveBadges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!myAddress) return;
    setSavingBadges(true);
    setError(null);
    try {
      const saved = await api.setShowcase(myAddress, shown);
      setProfile(saved);
      setShown(saved.badges.filter((badge) => badge.shown).map((badge) => badge.key));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingBadges(false);
    }
  }

  if (!params?.address) {
    if (isAuthenticated && myAddress) {
      return <Redirect to={`/profile/${myAddress}`} />;
    }
    return <Redirect to="/leaderboard" />;
  }

  const modes = profile?.modes ?? gameModes.map((mode) => ({
    mode: mode.id,
    elo: STARTING_ELO,
    rank: "Bronze",
    games: 0,
    wins: 0,
    hands: 0,
  }));
  const earnedBadges = (profile?.badges ?? []).filter((badge) => badge.earned);
  const visibleBadges = earnedBadges.filter((badge) => (mine ? true : badge.shown));
  const latest = profile?.recent[0];

  return (
    <PokerAppShell section="profile">
      <div className="profile-page">
        <PageHeading
          eyebrow={mine ? "YOUR WALLET" : "PUBLIC PROFILE"}
          title={shownName}
          description={`${shortAddress(lookedUp)} · Separate ELO and rank dNFTs for Hands Up, SNG 4, and SNG 6.`}
          action={
            <Link href="/play" className="club-button">
              Queue a mode <ArrowUpRight size={15} />
            </Link>
          }
        />

        <section className="profile-overview" aria-label="Wallet identity">
          <Panel className="profile-identity-panel">
            <div className="profile-identity-topline">
              <span>SOLANA WALLET</span>
              <Pill tone={mine ? "maroon" : "violet"}>
                {mine ? "You" : "Public"}
              </Pill>
            </div>
            <div className="profile-identity">
              <Avatar name={shownName} size={62} className="profile-avatar" />
              <div>
                <div className="profile-name-line">
                  <h2>{shownName}</h2>
                </div>
                <p className="profile-handle">{lookedUp}</p>
                <p className="profile-bio">
                  Ranked Hold’em on Solana. Each mode has its own ELO, starting at 1,200. A win against a higher rating moves it further.
                </p>
                {mine && (
                  <form className="profile-name-form" onSubmit={(event) => void saveName(event)}>
                    <label htmlFor="display-name">DISPLAY NAME</label>
                    <div>
                      <input
                        id="display-name"
                        value={draftName}
                        maxLength={18}
                        placeholder="Name at the table"
                        onChange={(event) => setDraftName(event.target.value)}
                      />
                      <button className="club-button" type="submit" disabled={savingName}>
                        {savingName ? "Saving…" : "Save"}
                      </button>
                    </div>
                    <p>This name shows on your seat and in table chat. Leave it blank to use your wallet.</p>
                    {nameError && <p className="profile-name-error">{nameError}</p>}
                  </form>
                )}
              </div>
            </div>
          </Panel>

          <Panel className="profile-featured-panel">
            <div className="profile-panel-kicker">
              <Trophy size={14} /> LATEST RATING
            </div>
            <div className="profile-featured-content">
              <div>
                {latest ? (
                  <>
                    <h2>
                      {latest.delta > 0 ? "+" : ""}
                      {latest.delta} ELO
                    </h2>
                    <p>
                      {gameModes.find((mode) => mode.id === latest.mode)?.label} · now {latest.elo}
                    </p>
                  </>
                ) : (
                  <>
                    <h2>No settled matches yet.</h2>
                    <p>Ratings appear here after a table finishes.</p>
                  </>
                )}
              </div>
            </div>
          </Panel>
        </section>

        {error && <p className="profile-name-error">{error}</p>}

        <section className="profile-stats" aria-label="Career totals">
          <StatTile label="Games" value={profile?.games ?? 0} note="All modes" />
          <StatTile
            label="Wins"
            value={profile?.wins ?? 0}
            note="Tables won"
            tone="violet"
          />
          <StatTile
            label="Hands"
            value={profile?.hands ?? 0}
            note="Hands played"
          />
          <StatTile
            label="Shown dNFTs"
            value={visibleBadges.filter((badge) => badge.shown).length}
            note={mine ? "Chosen for the public profile" : "Public showcase"}
            tone="maroon"
          />
        </section>

        <section className="profile-modes" aria-label="ELO by mode">
          {gameModes.map((mode) => {
            const stats = modes.find((item) => item.mode === mode.id);
            return (
              <Panel key={mode.id} className="profile-mode-card">
                <div className="profile-mode-head">
                  <span>{mode.label}</span>
                  <RankMedal rank={stats?.rank ?? "Bronze"} size={26} />
                </div>
                <strong>{stats?.elo ?? STARTING_ELO}</strong>
                <small>
                  {stats?.rank ?? "Bronze"}
                  {stats && stats.games > 0 ? " dNFT" : ""} · {stats?.games ?? 0} games
                </small>
              </Panel>
            );
          })}
        </section>

        {lookedUp && <EloChart walletId={lookedUp} />}

        <section className="profile-highlights" aria-label="dNFT milestones">
          {visibleBadges.length === 0 && (
            <Panel className="profile-highlight">
              <Trophy size={17} />
              <div>
                <span>{mine ? "NONE YET" : "PRIVATE"}</span>
                <strong>{mine ? "No dNFTs yet" : "No public dNFTs"}</strong>
                <small>
                  {mine
                    ? "Finish a match to earn one. Only badges you have can be shown."
                    : "This wallet has not chosen any earned badges to show."}
                </small>
              </div>
            </Panel>
          )}
          {visibleBadges.map((item) => (
            <Panel key={item.key} className="profile-highlight">
              {item.kind === "rank" ? (
                <RankMedal rank={item.tier ?? "Bronze"} size={28} />
              ) : (
                <Trophy size={17} />
              )}
              <div>
                <span>{item.shown ? "SHOWN" : "HIDDEN"}</span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </div>
            </Panel>
          ))}
        </section>

        {mine && profile && (
          <section className="profile-history" aria-label="Profile settings">
            <div className="profile-history-heading">
              <div>
                <span className="club-section-heading">PROFILE SETTINGS</span>
                <h2>Choose the dNFTs on your public profile.</h2>
              </div>
            </div>
            <Panel className="profile-history-panel">
              <form className="profile-showcase-form" onSubmit={(event) => void saveBadges(event)}>
                {earnedBadges.length === 0 ? (
                  <p className="profile-showcase-empty">
                    Finish a match to earn a dNFT. Only badges you already have can be shown on your public profile.
                  </p>
                ) : (
                  <ul className="profile-showcase">
                    {earnedBadges.map((badge) => (
                      <li key={badge.key}>
                        <label className="profile-showcase-item">
                          <input
                            type="checkbox"
                            checked={shown.includes(badge.key)}
                            onChange={(event) => {
                              setShown((current) =>
                                event.target.checked
                                  ? [...current, badge.key]
                                  : current.filter((key) => key !== badge.key),
                              );
                            }}
                          />
                          {badge.kind === "rank" ? (
                            <RankMedal rank={badge.tier ?? "Bronze"} size={28} />
                          ) : (
                            <Trophy size={16} />
                          )}
                          <span>
                            <strong>{badge.label}</strong>
                            <small>{badge.detail}</small>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                {showLocked && (
                  <ul className="profile-showcase profile-showcase--locked">
                    {profile.badges
                      .filter((badge) => !badge.earned)
                      .map((badge) => (
                        <li key={badge.key}>
                          <div className="profile-showcase-item">
                            {badge.kind === "rank" ? (
                              <RankMedal rank={badge.tier ?? "Bronze"} size={28} />
                            ) : (
                              <Trophy size={16} />
                            )}
                            <span>
                              <strong>{badge.label}</strong>
                              <small>{lockedProgress(badge, profile)}</small>
                            </span>
                            <em>Locked</em>
                          </div>
                        </li>
                      ))}
                  </ul>
                )}
                <div className="profile-showcase-footer">
                  <button
                    className="club-button club-button--secondary"
                    type="button"
                    onClick={() => setShowLocked((open) => !open)}
                  >
                    {showLocked ? "Hide locked dNFTs" : "View locked dNFTs"}
                  </button>
                  {earnedBadges.length > 0 && (
                    <button className="club-button" type="submit" disabled={savingBadges}>
                      {savingBadges ? "Saving…" : "Save showcase"}
                    </button>
                  )}
                </div>
              </form>
            </Panel>
          </section>
        )}

        <section className="profile-history" aria-labelledby="past-games-heading">
          <div className="profile-history-heading">
            <div>
              <span className="club-section-heading">RECENT MATCHES</span>
              <h2 id="past-games-heading">Rating history.</h2>
            </div>
          </div>
          <div className="profile-games">
            {(profile?.recent ?? []).map((game) => (
              <Panel key={`${game.time}-${game.mode}-${game.matchId ?? ""}`} className="profile-game">
                <div className="profile-game-meta">
                  <time>{new Date(game.time).toLocaleString()}</time>
                  <span>{gameModes.find((mode) => mode.id === game.mode)?.label}</span>
                  <strong>{game.elo} ELO</strong>
                  <b
                    className={
                      game.delta > 0
                        ? "profile-net profile-net--positive"
                        : game.delta < 0
                          ? "profile-net profile-net--negative"
                          : "profile-net"
                    }
                  >
                    {game.delta > 0 ? "+" : ""}
                    {game.delta}
                  </b>
                </div>
                <CopyHash label="Commit" value={game.commitHash} hidden="No commit stored" />
                <CopyHash
                  label="Seed"
                  value={game.revealSeed}
                  hidden="Revealed when the match finished"
                />
                <div className="profile-game-chain">
                  <span className="solana-kicker">
                    <SolanaMark />
                    On Solana
                  </span>
                  {(game.chain ?? []).length === 0 ? (
                    <p>No transaction was recorded for this match.</p>
                  ) : (
                    <ul>
                      {(game.chain ?? []).map((tx) => (
                        <li key={tx.signature}>
                          <a href={explorerTx(tx.signature)} target="_blank" rel="noreferrer">
                            {tx.label}
                          </a>
                          <code>{tx.signature.slice(0, 8)}…{tx.signature.slice(-6)}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {mine && game.matchId && <AnalysisPanel kind="match" target={game.matchId} />}
              </Panel>
            ))}
            {(profile?.recent.length ?? 0) === 0 && (
              <Panel className="profile-history-panel">
                <div className="club-empty">No rating changes yet.</div>
              </Panel>
            )}
          </div>
        </section>
      </div>
    </PokerAppShell>
  );
}
