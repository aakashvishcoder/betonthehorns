import { Fragment, type ReactNode } from "react";

/**
 * The bits of Markdown the coach uses (paragraphs, - / 1. lists, # headings, **bold**,
 * *italic*, `code`) as React elements, so nothing is ever injected as HTML.
 * `tail` (the typing cursor) is placed at the end of the last block.
 */
export function formatReply(text: string, tail?: ReactNode): ReactNode {
  const blocks = toBlocks(text);
  return blocks.map((block, i) => {
    const end = i === blocks.length - 1 ? tail : null;
    if (block.kind === "ul" || block.kind === "ol") {
      const List = block.kind;
      return (
        <List key={i}>
          {block.lines.map((line, j) => (
            <li key={j}>
              {inline(line)}
              {j === block.lines.length - 1 && end}
            </li>
          ))}
        </List>
      );
    }
    if (block.kind === "h") {
      return (
        <p key={i} className="coach-heading">
          {inline(block.lines[0]!)}
          {end}
        </p>
      );
    }
    return (
      <p key={i}>
        {block.lines.map((line, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(line)}
          </Fragment>
        ))}
        {end}
      </p>
    );
  });
}

type Block = { kind: "p" | "ul" | "ol" | "h"; lines: string[] };

const BULLET = /^\s*[-*•]\s+/;
const NUMBER = /^\s*\d+[.)]\s+/;
const HEADING = /^\s*#{1,4}\s+/;

function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const last = blocks.at(-1);
    if (!line.trim()) {
      blocks.push({ kind: "p", lines: [] }); // paragraph break
      continue;
    }
    const kind = HEADING.test(line) ? "h" : BULLET.test(line) ? "ul" : NUMBER.test(line) ? "ol" : "p";
    const content = line.replace(HEADING, "").replace(BULLET, "").replace(NUMBER, "");
    if (kind !== "h" && last && last.kind === kind && (kind !== "p" || last.lines.length > 0)) last.lines.push(content);
    else if (last && last.kind === "p" && last.lines.length === 0) Object.assign(last, { kind, lines: [content] });
    else blocks.push({ kind, lines: [content] });
  }
  return blocks.filter((b) => b.lines.length > 0);
}

/** **bold**, *italic* / _italic_, `code`. An unclosed marker (mid-typing) shows as plain text. */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`|\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_/g;
  let at = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index! > at) parts.push(text.slice(at, m.index));
    const key = m.index;
    if (m[1] !== undefined) parts.push(<strong key={key}>{m[1]}</strong>);
    else if (m[2] !== undefined) parts.push(<code key={key}>{m[2]}</code>);
    else parts.push(<em key={key}>{m[3] ?? m[4]}</em>);
    at = m.index! + m[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}
