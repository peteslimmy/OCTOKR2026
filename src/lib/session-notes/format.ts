/**
 * The vocabulary of the note format beyond plain markdown (ADR-116). Everything a person can choose is a fixed name from one of the lists below, never free text:
 *   ++underline++   ~~strike-through~~   {c:red}coloured words{/c}   {h:yellow}highlighted words{/h}
 *   {center}  {right}  {justify}   at the very start of a paragraph, heading or quote: how that block is aligned
 *   "  - item" (two spaces per level, three levels at most): a nested list
 * Because only these names are accepted, a note can never carry a style, a class or an attribute that a person typed.
 */
export const TEXT_COLOURS = [
  { key: "red", label: "Red", hex: "#b91c1c" }, { key: "orange", label: "Orange", hex: "#c2410c" }, { key: "green", label: "Green", hex: "#15803d" },
  { key: "teal", label: "Teal", hex: "#0f766e" }, { key: "blue", label: "Blue", hex: "#1d4ed8" }, { key: "purple", label: "Purple", hex: "#7e22ce" },
  { key: "pink", label: "Pink", hex: "#be185d" }, { key: "brown", label: "Brown", hex: "#78350f" }, { key: "grey", label: "Grey", hex: "#565d66" },
] as const;

export const HIGHLIGHTS = [
  { key: "yellow", label: "Yellow", hex: "#fef08a" }, { key: "green", label: "Green", hex: "#bbf7d0" }, { key: "blue", label: "Blue", hex: "#bfdbfe" },
  { key: "pink", label: "Pink", hex: "#fbcfe8" }, { key: "orange", label: "Orange", hex: "#fed7aa" }, { key: "grey", label: "Grey", hex: "#e5e7eb" },
] as const;

export const ALIGNMENTS = ["center", "right", "justify"] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

export const MAX_LIST_DEPTH = 3;

export const isTextColour = (k: string | null | undefined): k is (typeof TEXT_COLOURS)[number]["key"] => !!k && TEXT_COLOURS.some((c) => c.key === k);
export const isHighlight = (k: string | null | undefined): k is (typeof HIGHLIGHTS)[number]["key"] => !!k && HIGHLIGHTS.some((c) => c.key === k);
export const isAlignment = (k: string | null | undefined): k is Alignment => !!k && (ALIGNMENTS as readonly string[]).includes(k);

/** The alignment marker at the start of a block's text, and the text without it. */
export function splitAlignment(text: string): { align: Alignment | null; rest: string } {
  const m = /^\{(center|right|justify)\}/.exec(text);
  return m ? { align: m[1] as Alignment, rest: text.slice(m[0].length) } : { align: null, rest: text };
}

// ---- sections: the minutes page is one stored text, shown as one card per "## " heading ("## Notes", "## Actions", ...: the headings the Take notes template already uses)

export interface Section { id: string; title: string | null; md: string }

export const DEFAULT_SECTIONS: readonly { title: string; md: string }[] = [
  { title: "Notes", md: "" }, { title: "Recommendations", md: "" }, { title: "Actions", md: "- [ ] " }, { title: "Next steps", md: "" },
];

let counter = 0;
export const sectionId = () => `s${Date.now().toString(36)}${(counter++).toString(36)}`;

/** The stored text cut at its "## " headings. Text before the first heading becomes a card without a title. An empty note gets the four standard cards. */
export function splitSections(md: string): Section[] {
  const lines = (md ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out: Section[] = [];
  let cur: { title: string | null; body: string[] } = { title: null, body: [] };
  const close = () => {
    const body = cur.body.join("\n").trim();
    if (cur.title !== null || body) out.push({ id: sectionId(), title: cur.title, md: body });
  };
  for (const line of lines) {
    const h = /^## (.+)$/.exec(line);
    if (h) { close(); cur = { title: h[1].trim(), body: [] }; } else cur.body.push(line);
  }
  close();
  return out.length ? out : DEFAULT_SECTIONS.map((s) => ({ id: sectionId(), title: s.title, md: s.md }));
}

/** The cards back into the one stored text. A title is one line; a card without a title (only ever the first) is written without a heading. */
export function joinSections(sections: Section[]): string {
  return sections
    .map((s) => {
      const body = s.md.trim();
      if (s.title === null) return body;
      const title = s.title.replace(/\s+/g, " ").trim() || "Untitled section";
      return body ? `## ${title}\n\n${body}` : `## ${title}`;
    })
    .filter(Boolean)
    .join("\n\n");
}
