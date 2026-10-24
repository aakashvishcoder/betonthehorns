import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowUpRight, Search, Sparkles, UsersRound } from "lucide-react";
import PokerAppShell, {
  usePokerMotion,
} from "@/components/poker-app/PokerAppShell";
import {
  Avatar,
  DeckCard,
  PageHeading,
  Panel,
  Pill,
} from "@/components/poker-app/PokerUI";
import TableSetup from "@/components/poker/TableSetup";
import FlowingMenu, {
  type FlowingMenuItem,
} from "@/components/react-bits/FlowingMenu";
import {
  formatChips,
  sampleTables,
  type SampleTable,
} from "@/lib/poker-design";
import "@/styles/play.css";

type PlayMode = SampleTable["category"];

const playModes: { label: PlayMode; note: string; count: number }[] = [
  { label: "Casual", note: "Easy hands, familiar faces.", count: 2 },
  { label: "Private", note: "Keep the table close.", count: 1 },
  { label: "Tournament", note: "A little more on the line.", count: 1 },
];

const modeItems: FlowingMenuItem[] = playModes.map(mode => ({
  text: mode.label,
  meta: `${mode.count} tables`,
  marquee: `${mode.label} · ${mode.note}`,
}));

function categoryTone(category: PlayMode): "violet" | "maroon" | "neutral" {
  if (category === "Private") return "maroon";
  if (category === "Tournament") return "violet";
  return "neutral";
}

function paceTone(category: PlayMode): "violet" | "maroon" | "muted" {
  if (category === "Private") return "maroon";
  if (category === "Tournament") return "violet";
  return "muted";
}

export default function PlayPage() {
  const { paused } = usePokerMotion();
  const [activeMode, setActiveMode] = useState<PlayMode>("Casual");
  const [searchQuery, setSearchQuery] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);

  const filteredTables = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    return sampleTables.filter(
      table =>
        table.category === activeMode &&
        table.name.toLocaleLowerCase().includes(normalizedQuery)
    );
  }, [activeMode, searchQuery]);

  const resetFilters = () => {
    setActiveMode("Casual");
    setSearchQuery("");
  };

  return (
    <PokerAppShell section="play">
      <div className="play-page">
        <PageHeading
          eyebrow="THE LOBBY · SAMPLE TABLES"
          title="A good night starts here."
          description="Choose a fictional room, explore the table preview, or set up a local demo for your people."
          action={
            <button
              type="button"
              className="club-button"
              onClick={() => setSetupOpen(true)}
            >
              Create a table <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          }
        />

        <section
          className="play-featured"
          aria-labelledby="play-featured-title"
        >
          <Panel className="play-featured-copy">
            <div className="play-featured-kicker">
              <Pill tone="maroon">LOCAL DESIGN DEMO</Pill>
              <span>For the people you know by name.</span>
            </div>
            <h2 id="play-featured-title">
              A table feels better when it feels like yours.
            </h2>
            <p>
              This lobby is a design preview with fictional sample rooms and
              play chips only. Nothing here is a live queue or real-money game.
            </p>
            <div className="play-featured-actions">
              <Link
                href="/table"
                className="club-button club-button--secondary"
              >
                Quick preview <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
              <button
                type="button"
                className="club-button--ghost"
                onClick={() => setSetupOpen(true)}
              >
                Play with your people
              </button>
            </div>
          </Panel>

          <Panel
            className="play-featured-hand"
            aria-label="Featured sample hand"
          >
            <span className="play-hand-label">
              <Sparkles size={14} aria-hidden="true" /> FEATURED HAND
            </span>
            <div className="play-card-pair" aria-hidden="true">
              <DeckCard card="AS" width={110} foil />
              <DeckCard card="KH" width={110} foil />
            </div>
            <p>Two good cards. The rest is the story you tell later.</p>
          </Panel>
        </section>

        <section className="play-lobby" aria-labelledby="play-lobby-title">
          <div className="club-section-heading">
            <div>
              <span className="club-eyebrow">PICK THE MOOD</span>
              <h2 id="play-lobby-title">Find your kind of table.</h2>
            </div>
            <p className="club-muted">
              Sample rooms only. Filter the lobby by the way you want to play.
            </p>
          </div>

          <div className="play-lobby-grid">
            <Panel className="play-mode-panel">
              <div className="play-mode-heading">
                <span>TABLE STYLE</span>
                <small>Choose one</small>
              </div>
              <FlowingMenu
                items={modeItems}
                activeIndex={playModes.findIndex(
                  mode => mode.label === activeMode
                )}
                onItemClick={(_item, index, event) => {
                  event.preventDefault();
                  setActiveMode(playModes[index].label);
                }}
                paused={paused}
                speed={24}
                direction="alternate"
                followCursor={0.12}
                duration={0.42}
                stretch={0.22}
                magnet={0.08}
                bandInset={4}
                bandRadius={8}
                textColor="#f6e9fe"
                bgColor="transparent"
                marqueeBgColor="rgba(121, 34, 61, 0.76)"
                marqueeTextColor="#fbe8ea"
                borderColor="rgba(208, 129, 241, 0.2)"
                showIndex
                align="left"
                intro={false}
                ariaLabel="Sample table category"
                className="play-mode-menu"
              />
            </Panel>

            <Panel className="play-people-panel">
              <span className="play-people-icon">
                <UsersRound size={19} aria-hidden="true" />
              </span>
              <div>
                <Pill tone="maroon">PRIVATE TABLE</Pill>
                <h3>Play with your people.</h3>
                <p>
                  Set up a local table and pass the details to the group chat
                  when you are ready.
                </p>
                <button
                  type="button"
                  className="club-button--ghost"
                  onClick={() => setSetupOpen(true)}
                >
                  Start local setup{" "}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </button>
              </div>
            </Panel>
          </div>
        </section>

        <section
          className="play-tables-section"
          aria-labelledby="play-tables-title"
        >
          <div className="play-table-toolbar">
            <div>
              <span className="club-eyebrow">SAMPLE TABLES</span>
              <h2 id="play-tables-title">{activeMode} rooms</h2>
            </div>
            <label className="play-search" htmlFor="table-search">
              <Search size={16} aria-hidden="true" />
              <span>Search by table name</span>
              <input
                id="table-search"
                type="search"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder="Search this style"
              />
            </label>
          </div>

          <Panel className="play-table-panel">
            {filteredTables.length > 0 ? (
              <div className="club-table-scroll">
                <table className="club-table play-table">
                  <thead>
                    <tr>
                      <th scope="col">Table</th>
                      <th scope="col">Seats</th>
                      <th scope="col">Blinds</th>
                      <th scope="col">Buy-in</th>
                      <th scope="col">Pace</th>
                      <th scope="col">
                        <span className="play-sr-only">Preview</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTables.map(table => (
                      <tr key={table.id}>
                        <td>
                          <div className="play-table-name">
                            <Avatar
                              name={table.name}
                              size={34}
                              tone={categoryTone(table.category)}
                            />
                            <div>
                              <strong>{table.name}</strong>
                              <span>{table.description}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="play-table-value">
                            {table.players} / {table.maxPlayers}
                          </span>
                          <small>seats</small>
                        </td>
                        <td>
                          <span className="play-table-value">
                            {table.blinds}
                          </span>
                          <small>blinds</small>
                        </td>
                        <td>
                          <span className="play-table-value">
                            {formatChips(table.buyIn)}
                          </span>
                          <small>play chips</small>
                        </td>
                        <td>
                          <Pill tone={paceTone(table.category)}>
                            {table.pace}
                          </Pill>
                        </td>
                        <td>
                          <Link
                            href={`/table?room=${table.id}`}
                            className="club-button--ghost play-preview-link"
                            aria-label={`Preview the ${table.name} sample table`}
                          >
                            Preview table{" "}
                            <ArrowUpRight size={14} aria-hidden="true" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="club-empty play-empty">
                <Pill tone="muted">NO SAMPLE TABLES</Pill>
                <h3>Nothing matches that table name.</h3>
                <p>
                  Try another search, or return to the easygoing Casual sample
                  rooms.
                </p>
                <button
                  type="button"
                  className="club-button--secondary"
                  onClick={resetFilters}
                >
                  Reset filters
                </button>
              </div>
            )}
          </Panel>
        </section>
      </div>

      <TableSetup open={setupOpen} onOpenChange={setSetupOpen} />
    </PokerAppShell>
  );
}
