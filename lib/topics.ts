// Topic / keyword trends without AI: count words and two-word phrases in titles of new content.

const STOPWORDS = new Set(
  `a about above after again against all also am an and any are as at be because been before being below between
  both but by can could did do does doing down during each few for from further had has have having he her here hers
  him his how i if in into is it its itself just let me more most my no nor not now of off on once only or other our
  ours out over own same she should so some such than that the their theirs them then there these they this those
  through to too under until up very was we were what when where which while who whom why will with would you your
  yours yourself vs via per get got make makes made use using used one two three four five six seven eight nine ten
  new best top guide guides tips tip complete ultimate list ways things thing step steps easy simple full need know
  everything why what how which who really actually here there today now latest updated update part ever every
  page home blog blogs post posts article read more learn click https http www com`.split(/\s+/).filter(Boolean),
);
/** Short tokens that are meaningful on their own. */
const SHORT_OK = new Set(["ai", "ui", "ux", "3d", "5g", "ev", "ar", "vr", "hr", "pr", "ca"]);

export interface Term {
  term: string;
  /** Number of posts/pages mentioning it in the window. */
  count: number;
  /** Same, in the previous window of equal length. */
  prevCount: number;
}

export interface TopicReport {
  docs: number;
  prevDocs: number;
  phrases: Term[];
  words: Term[];
  categories: Term[];
}

export function tokenize(text: string, brandTokens: Set<string>): string[][] {
  // Split into runs of meaningful words; stopwords break phrases ("course in noida" ≠ "course noida").
  const runs: string[][] = [[]];
  // Drop the full brand name as a phrase ("Course Unbox"), keeping its words elsewhere ("SEO course").
  // " the " is a stopword, so it also breaks the phrase run where the brand was.
  let source = text.toLowerCase();
  for (const b of brandTokens) if (b.includes(" ")) source = source.split(b).join(" the ");
  for (const raw of source.replace(/[^\p{L}\p{N}]+/gu, " ").split(" ")) {
    const token = raw.trim();
    const keep =
      token &&
      !STOPWORDS.has(token) &&
      !brandTokens.has(token) &&
      !/^\d+$/.test(token) &&
      (token.length >= 3 || SHORT_OK.has(token));
    if (keep) runs[runs.length - 1].push(token);
    else if (runs[runs.length - 1].length) runs.push([]);
  }
  return runs.filter((r) => r.length);
}

function termsOf(text: string, brandTokens: Set<string>) {
  const words = new Set<string>();
  const phrases = new Set<string>();
  for (const run of tokenize(text, brandTokens)) {
    run.forEach((w) => words.add(w));
    for (let i = 0; i + 1 < run.length; i++) phrases.add(`${run[i]} ${run[i + 1]}`);
  }
  return { words, phrases };
}

function count(docs: string[], brand: Set<string>) {
  const words = new Map<string, number>();
  const phrases = new Map<string, number>();
  for (const doc of docs) {
    const t = termsOf(doc, brand);
    t.words.forEach((w) => words.set(w, (words.get(w) ?? 0) + 1));
    t.phrases.forEach((p) => phrases.set(p, (phrases.get(p) ?? 0) + 1));
  }
  return { words, phrases };
}

function rank(current: Map<string, number>, previous: Map<string, number>, limit: number, minCount: number): Term[] {
  return [...current]
    .filter(([, n]) => n >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, n]) => ({ term, count: n, prevCount: previous.get(term) ?? 0 }));
}

/**
 * The competitor's own name, removed from topics: the full name as a phrase ("course unbox"),
 * the name squashed ("courseunbox") and the domain label ("makemytrip"). Individual words of
 * the name stay, so "Course Unbox" doesn't hide "SEO course".
 */
export function brandTokensFor(name: string, host: string): Set<string> {
  const lower = name.toLowerCase().replace(/\s+/g, " ").trim();
  const label = host.replace(/^www\./, "").split(".")[0].toLowerCase();
  return new Set([lower, lower.replace(/[^\p{L}\p{N}]+/gu, ""), label].filter((t) => t.length >= 2));
}

/**
 * @param docs      title (+ H1) of each new post/page in the window
 * @param prevDocs  same for the previous window
 * @param categories / prevCategories  RSS categories per post, flattened
 */
export function buildTopicReport(
  docs: string[],
  prevDocs: string[],
  categories: string[],
  prevCategories: string[],
  brand: Set<string>,
): TopicReport {
  const cur = count(docs, brand);
  const prev = count(prevDocs, brand);
  const tally = (list: string[]) => {
    const m = new Map<string, number>();
    for (const c of list) m.set(c.toLowerCase(), (m.get(c.toLowerCase()) ?? 0) + 1);
    return m;
  };
  // A single post isn't a trend: need 2+ mentions once there's enough content.
  const min = docs.length >= 4 ? 2 : 1;
  return {
    docs: docs.length,
    prevDocs: prevDocs.length,
    phrases: rank(cur.phrases, prev.phrases, 15, min),
    words: rank(cur.words, prev.words, 20, min),
    categories: rank(tally(categories), tally(prevCategories), 12, 1),
  };
}
