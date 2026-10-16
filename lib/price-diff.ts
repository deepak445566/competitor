// Turns the prices that disappeared from a page and the ones that appeared into readable
// "before → after" moves. A page lists many prices without saying which product each belongs to,
// so each old price is matched with the closest new price in the same currency.

export interface PriceMove {
  before: string;
  after: string;
  /** Change in percent: negative = cheaper. */
  pct: number;
}

export interface PriceChanges {
  moves: PriceMove[];
  /** New prices with no old price close enough to be the same product. */
  added: string[];
  /** Old prices with no new price close enough. */
  removed: string[];
}

/** Prices further apart than this factor are treated as different products, not one price that changed. */
const MAX_RATIO = 2;

/** Normalized prices look like "₹24,999", "$1,200" or "AED 450" (see normalizePrice). */
function parse(text: string) {
  const m = text.match(/^(.*?)(\d[\d,]*(?:\.\d+)?)$/);
  if (!m) return null;
  const value = Number(m[2].replace(/,/g, ""));
  return value > 0 ? { currency: m[1].trim(), value } : null;
}

export function pairPrices(removed: string[] = [], added: string[] = []): PriceChanges {
  const before = removed.map((text) => ({ text, p: parse(text) }));
  const after = added.map((text) => ({ text, p: parse(text) }));

  // Closest pairs first (by ratio, so ₹100 → ₹120 and ₹10,000 → ₹12,000 count as equally close).
  const candidates: { i: number; j: number; distance: number }[] = [];
  before.forEach(({ p: b }, i) =>
    after.forEach(({ p: a }, j) => {
      if (!b || !a || b.currency !== a.currency) return;
      const distance = Math.abs(Math.log(a.value / b.value));
      if (distance <= Math.log(MAX_RATIO)) candidates.push({ i, j, distance });
    }),
  );
  candidates.sort((x, y) => x.distance - y.distance);

  const usedBefore = new Set<number>();
  const usedAfter = new Set<number>();
  const moves: PriceMove[] = [];
  for (const { i, j } of candidates) {
    if (usedBefore.has(i) || usedAfter.has(j)) continue;
    usedBefore.add(i);
    usedAfter.add(j);
    const b = before[i].p!.value;
    const a = after[j].p!.value;
    moves.push({ before: before[i].text, after: after[j].text, pct: ((a - b) / b) * 100 });
  }
  moves.sort((x, y) => Math.abs(y.pct) - Math.abs(x.pct)); // biggest moves first

  return {
    moves,
    added: after.filter((_, j) => !usedAfter.has(j)).map((a) => a.text),
    removed: before.filter((_, i) => !usedBefore.has(i)).map((b) => b.text),
  };
}

/** "−12%", "+4.5%" */
export function formatPct(pct: number): string {
  const size = Math.abs(pct);
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${size < 10 ? size.toFixed(1).replace(/\.0$/, "") : Math.round(size)}%`;
}

/** "₹24,999 → ₹21,999 (−12%), new ₹9,999, removed ₹4,500 +2 more" */
export function describePriceChange(removed?: string[], added?: string[], max = 3): string {
  const { moves, added: fresh, removed: gone } = pairPrices(removed, added);
  const parts = [
    ...moves.map((m) => `${m.before} → ${m.after} (${formatPct(m.pct)})`),
    ...fresh.map((p) => `new ${p}`),
    ...gone.map((p) => `removed ${p}`),
  ];
  return parts.length > max ? `${parts.slice(0, max).join(", ")} +${parts.length - max} more` : parts.join(", ");
}
