/**
 * similarity.js — deterministic domain analysis engine for phishPhinger.
 *
 * Depends on TOP_DOMAINS being loaded first (top-domains.js).
 * Works in both a browser-extension service worker (importScripts) and
 * a plain Node.js environment (for unit tests).
 */

// ---------------------------------------------------------------------------
// 1. Registered-domain extraction
// ---------------------------------------------------------------------------

/**
 * Known two-component TLDs.  Minimal set covering common phishing targets;
 * all 100 Cloudflare top-domain entries use single-component TLDs so this
 * list is only needed when checking user-visited hosts.
 */
const TWO_PART_TLDS = new Set([
  'co.uk', 'co.jp', 'co.in', 'co.nz', 'co.id', 'co.za', 'co.kr',
  'com.au', 'com.br', 'com.ar', 'com.mx', 'com.cn', 'com.hk',
  'gov.uk', 'gov.au', 'ac.uk', 'org.uk', 'net.au',
]);

/**
 * Return the registered domain (eTLD+1) for a hostname.
 * Strips a leading "www." before processing.
 *
 * Examples:
 *   "store.apple.com"   -> "apple.com"
 *   "audit-apple.com"   -> "audit-apple.com"
 *   "foo.bar.co.uk"     -> "bar.co.uk"
 */
function getRegisteredDomain(hostname) {
  const h = hostname.toLowerCase().replace(/^www\./, '');
  const parts = h.split('.');
  if (parts.length > 2 && TWO_PART_TLDS.has(parts.slice(-2).join('.'))) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

/**
 * Return the SLD token (everything left of the last dot) for a registered
 * domain.  For "apple.com" returns "apple"; for "cdn-apple.com" returns
 * "cdn-apple"; for "bar.co.uk" returns "bar".
 */
function getSLD(registeredDomain) {
  const parts = registeredDomain.split('.');
  // Drop the TLD component(s) — just the first label(s)
  // For "apple.com" -> ["apple","com"] -> "apple"
  // For "bar.co.uk" -> ["bar","co","uk"] -> "bar"
  return parts[0];
}

// ---------------------------------------------------------------------------
// 2. Normalisation helpers
// ---------------------------------------------------------------------------

/** Map of leet-speak digit/symbol substitutions to their ASCII equivalents. */
const LEET_MAP = {
  '0': 'o', '1': 'l', '3': 'e', '4': 'a',
  '5': 's', '6': 'g', '7': 't', '8': 'b', '@': 'a',
};

/**
 * Normalise common leet-speak substitutions.
 * e.g. "app1e" -> "apple", "g00gle" -> "google"
 */
function normalizeLeet(s) {
  return s
    .replace(/[013456789@]/g, c => LEET_MAP[c] !== undefined ? LEET_MAP[c] : c)
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w');
}

/**
 * Minimal confusable-character mapping: Cyrillic and Greek lookalikes -> Latin.
 * Based on the most commonly abused characters in IDN homograph attacks.
 */
const CONFUSABLE_MAP = {
  // Cyrillic
  '\u0430': 'a',  // а -> a
  '\u0435': 'e',  // е -> e
  '\u043e': 'o',  // о -> o
  '\u0440': 'p',  // р -> p
  '\u0441': 'c',  // с -> c
  '\u0445': 'x',  // х -> x
  '\u0456': 'i',  // і -> i
  '\u0458': 'j',  // ј -> j
  '\u0455': 's',  // ѕ -> s
  // Greek
  '\u03b1': 'a',  // α -> a
  '\u03bf': 'o',  // ο -> o
  '\u03c1': 'p',  // ρ -> p
  '\u03bd': 'v',  // ν -> v
  '\u03c4': 't',  // τ -> t
  '\u03b5': 'e',  // ε -> e
  '\u03ba': 'k',  // κ -> k
  '\u03b9': 'i',  // ι -> i
};

const CONFUSABLE_RE = new RegExp(
  '[' + Object.keys(CONFUSABLE_MAP).join('') + ']',
  'g'
);

/**
 * Normalise Unicode homograph characters to their ASCII equivalents.
 * Applies NFKD decomposition, strips combining marks, then maps confusables.
 */
function normalizeHomograph(s) {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')  // strip combining diacritical marks
    .replace(CONFUSABLE_RE, c => CONFUSABLE_MAP[c] || c)
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// 3. Levenshtein distance
// ---------------------------------------------------------------------------

/**
 * Compute the Levenshtein edit distance between strings a and b.
 * O(|a|*|b|) time, O(min(|a|,|b|)) space.
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  // Ensure a is the shorter string for the space optimisation
  if (a.length > b.length) { const t = a; a = b; b = t; }
  let row = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = j;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const tmp = row[i];
      row[i] = Math.min(row[i] + 1, row[i - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[a.length];
}

/**
 * Maximum edit distance to flag as a typosquat.
 * Short brand names get a tighter threshold to avoid false positives.
 */
function editThreshold(brand) {
  if (brand.length <= 4) return 1;
  if (brand.length <= 8) return 2;
  return 3;
}

// ---------------------------------------------------------------------------
// 4. Main classifier
// ---------------------------------------------------------------------------

/**
 * Classify a hostname.
 *
 * Returns null if the domain is safe (exact match or legitimate subdomain of
 * a top-100 domain), or an object { resembles, reason } if suspicious.
 *
 * @param {string} hostname  e.g. "audit-apple.com" or "store.apple.com"
 * @returns {{ resembles: string, reason: string } | null}
 */
function classifyDomain(hostname) {
  if (!hostname || hostname.indexOf('.') === -1) return null;

  const regDomain = getRegisteredDomain(hostname);
  const h = hostname.toLowerCase();

  // -------------------------------------------------------------------------
  // SAFE pre-pass: check against ALL top-100 entries before any suspicious
  // checks.  This ensures that a domain like "cdn-apple.com" (which is itself
  // in the top-100 list) is not flagged just because it contains a brand token
  // ("apple") from a different top-100 entry.
  // -------------------------------------------------------------------------
  for (const entry of TOP_DOMAINS) {
    if (regDomain === entry.domain) return null;   // exact registered-domain match
    if (h === entry.domain) return null;            // exact hostname match
    if (h.endsWith('.' + entry.domain)) return null; // legitimate subdomain
  }

  // -------------------------------------------------------------------------
  // SUSPICIOUS checks: compare query against every top-100 brand token.
  // -------------------------------------------------------------------------
  const qSLD = getSLD(regDomain);  // e.g. "audit-apple"

  // Pre-compute normalised variants of the query SLD (deduplicated)
  const variantSet = new Set([
    qSLD,
    normalizeLeet(qSLD),
    normalizeHomograph(qSLD),
    normalizeLeet(normalizeHomograph(qSLD)),
  ]);
  const variants = Array.from(variantSet);

  for (const entry of TOP_DOMAINS) {
    const brand = entry.sld;  // e.g. "apple"

    for (const v of variants) {
      // Check 1: brand-substring containment
      // "audit-apple" contains "apple" but is not "apple" -> suspicious
      if (v.includes(brand) && v !== brand) {
        return { resembles: entry.domain, reason: 'brand-substring' };
      }

      // Check 2: TLD swap — same SLD, different TLD
      // "apple.net" has qSLD "apple" == brand "apple" but regDomain != entry.domain
      if (v === brand && regDomain !== entry.domain) {
        return { resembles: entry.domain, reason: 'tld-swap' };
      }

      // Check 3: typosquatting via edit distance
      // Only compare if lengths are within plausible range to reduce false positives
      const lenDiff = Math.abs(v.length - brand.length);
      const threshold = editThreshold(brand);
      if (lenDiff <= threshold && levenshtein(v, brand) <= threshold) {
        return { resembles: entry.domain, reason: 'typosquat' };
      }
    }
  }

  return null;  // no resemblance found
}

// ---------------------------------------------------------------------------
// 5. Export (Node.js / test runner compatibility)
// ---------------------------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getRegisteredDomain,
    getSLD,
    normalizeLeet,
    normalizeHomograph,
    levenshtein,
    editThreshold,
    classifyDomain,
  };
}
