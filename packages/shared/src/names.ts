/**
 * Couple-name helpers shared by the guest site (script initials, hero layout) and the admin
 * (monogram derivation). The separator must be a standalone "&", "+" or the word "and";
 * "Anand", "Sandra" and "Brandon" are names, not separators.
 */
const SEP = /^(.+?)\s*(?:[&+]|\s+and\s+)\s*(.+)$/i;

/** "Priya & Arjun" → ["Priya", "Arjun"]; "Ravi at Fifty" → null. */
export function splitCoupleNames(title: string): [string, string] | null {
  const m = title.trim().match(SEP);
  if (!m) return null;
  const a = m[1].trim();
  const b = m[2].trim();
  return a && b ? [a, b] : null;
}

/** "Sandra and Tom" → "S&T"; "Ravi at Fifty" → "R". Uses the first code point so Indic initials survive. */
export function monogramFor(title: string): string {
  const first = (s: string) => Array.from(s.trim())[0]?.toUpperCase() ?? "";
  const parts = splitCoupleNames(title);
  if (parts) return [first(parts[0]), first(parts[1])].filter(Boolean).join("&");
  return first(title);
}
