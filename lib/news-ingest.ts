/**
 * News & Intelligence ingest (premium redesign Wave 2, Oct 14, 2026).
 *
 * Fetches a fixed source list (local AZ outlets + wire services + sector
 * trade press), screens every story against the portal's own entities and
 * Ethan's relevance lanes, and stores survivors in mi_news for the agent
 * summary pass and the UI. Runs as source `intel_news` — event cadence
 * (the 30-min runtime cron; also inside the daily `all` run).
 *
 * Feed verification (live-fetched from the build machine, Oct 14, 2026):
 *   DIRECT RSS — Phoenix Business Journal (feeds.bizjournals.com/phoenix,
 *     25 items; the /news/feed and /news/rss paths 404), Aviation Week
 *     (aviationweek.com/rss.xml, 10), Defense News (arc outboundfeeds rss,
 *     25), Fierce Healthcare (rss.xml, 10), Construction Dive
 *     (/feeds/news/, 10), Manufacturing Dive (/feeds/news/, 10).
 *   Hospitality trade press (§5, live-fetched Oct 17, 2026): Restaurant
 *     Business (/feed, 50 items — /rss.xml is Atom with no <item>),
 *     Nation's Restaurant News (nrn.com/rss.xml, 50), Hotel Business
 *     (hotelbusiness.com/feed/, 10). All three are national feeds: the
 *     relevance screen keeps their stories only on a tracked-entity hit
 *     (tracked hospitality groups included) or a sector event.
 *   GOOGLE NEWS FALLBACK (site:-scoped) — AZ Big Media (/feed/ redirects
 *     to the homepage; WP feeds disabled), Arizona Republic / azcentral
 *     (402 to non-browser clients), Axios Phoenix (no local RSS exists;
 *     api.axios.com/feed is the national firehose), Business Wire
 *     (feed.businesswire.com feed IDs are topical — no AZ geographic
 *     feed), PR Newswire (no AZ state feed; the list feed is global),
 *     Modern Healthcare (403 on /rss.xml and /section/rss/main).
 *
 * Licensing: publisher text is NEVER stored as a summary. The RSS snippet
 * is kept in raw_snippet for matching/debug only; summaries are written
 * later by an agent in our own words (see lib/news-db.ts).
 */
import { logSync } from "./market-db";
import {
  insertNewsItem,
  getRecentNewsRows,
  appendAlsoCoveredBy,
  loadMatchEntities,
  loadClassifierState,
  type ClassifierState,
  type MatchEntity,
  type MatchLoadStats,
  type RecentNewsRow,
} from "./news-db";
import {
  NEWS_MIN_RELEVANCE,
  classifySector,
  scoreRelevance,
  feedbackDelta,
} from "./news-classify";
import type { MiNewsItem, MiNewsMatch } from "./types";

/* ---------------- feeds ---------------- */

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

interface NewsFeed {
  name: string;
  short: string;
  kind: "rss" | "gnews";
  url?: string;
  query?: string;
  /** The outlet itself is Arizona — its stories count as AZ-placed. */
  local?: boolean;
}

const NEWS_FEEDS: NewsFeed[] = [
  { name: "Phoenix Business Journal", short: "PBJ", kind: "rss", url: "https://feeds.bizjournals.com/phoenix", local: true },
  { name: "AZ Big Media", short: "AZBM", kind: "gnews", query: "site:azbigmedia.com when:7d", local: true },
  { name: "Arizona Republic", short: "AZRep", kind: "gnews", query: "site:azcentral.com when:7d", local: true },
  { name: "Axios Phoenix", short: "Axios", kind: "gnews", query: "site:axios.com Phoenix Arizona when:7d", local: true },
  { name: "Business Wire", short: "BW", kind: "gnews", query: "site:businesswire.com Arizona when:7d" },
  { name: "PR Newswire", short: "PRN", kind: "gnews", query: "site:prnewswire.com Arizona when:7d" },
  { name: "Aviation Week", short: "AvWk", kind: "rss", url: "https://aviationweek.com/rss.xml" },
  { name: "Defense News", short: "DefN", kind: "rss", url: "https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml" },
  { name: "Modern Healthcare", short: "ModH", kind: "gnews", query: "site:modernhealthcare.com when:7d" },
  { name: "Fierce Healthcare", short: "Fierce", kind: "rss", url: "https://www.fiercehealthcare.com/rss.xml" },
  { name: "Construction Dive", short: "ConDive", kind: "rss", url: "https://www.constructiondive.com/feeds/news/" },
  { name: "Manufacturing Dive", short: "MfgDive", kind: "rss", url: "https://www.manufacturingdive.com/feeds/news/" },
  { name: "Restaurant Business", short: "RB", kind: "rss", url: "https://www.restaurantbusinessonline.com/feed" },
  { name: "Nation's Restaurant News", short: "NRN", kind: "rss", url: "https://www.nrn.com/rss.xml" },
  { name: "Hotel Business", short: "HB", kind: "rss", url: "https://hotelbusiness.com/feed/" },
];

/* ---------------- RSS parsing ----------------
 * Mirrors parseRss / the junk blocklist in lib/market-ingest.ts (those are
 * module-private there; this file stays self-contained like
 * filings-ingest.ts and permits-ingest.ts). Keep the two junk lists in
 * step when either changes. */

interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  description: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&nbsp;/g, " ");
}

function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
  for (const b of blocks) {
    const get = (tag: string) => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return m ? decodeEntities(m[1].trim().replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")) : "";
    };
    items.push({ title: get("title"), link: get("link"), pubDate: get("pubDate"), source: get("source"), description: get("description") });
  }
  return items;
}

function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Non-event noise — mirror of JUNK_HEADLINE in lib/market-ingest.ts. */
const JUNK_HEADLINE =
  /\b(how to|what to know|opinion|editorial|podcast|webinar|sponsored|price target|dividend|earnings call|top \d+|best stocks?|stocks? to (buy|watch)|shares? (rise|risen|fall|fell|jump|drop|surge|plunge|slide|soar|climb|dip)|stock is trending|trending stocks?|lawsuit|indicted|arrested|coupon|giveaway|campaign|endorses?|endorsement|poll (shows|says|finds)|slams|blasts|feud|scandal)\b/i;

/* ---------------- relevance screen ----------------
 * Sector + relevance decisions live in lib/news-classify.ts (News
 * overhaul, Oct 17, 2026): a weighted keyword/entity classifier over
 * headline + snippet, a deal-signal relevance model with a display
 * threshold, and named hard-exclude categories that never reach the
 * feed. This file keeps only the entity matching + ingest mechanics. */

const PORTAL_SECTORS = new Set([
  "Aerospace & Defense",
  "Healthcare",
  "Advanced Manufacturing",
  "Specialty Trades & Construction",
  "Hospitality",
]);

function normalizeHeadline(h: string): string {
  return h
    .toLowerCase()
    .replace(/\s+-\s+[^-]+$/, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set(["the", "and", "for", "with", "its", "new", "says", "will", "from", "that", "this", "are", "has", "have", "inc", "llc", "corp", "company"]);

function headlineTokens(h: string): Set<string> {
  return new Set(
    normalizeHeadline(h)
      .split(" ")
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
  );
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of Array.from(a)) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

interface Screened {
  score: number;
  kind: MiNewsItem["kind"];
  matched: MiNewsMatch[];
  sector: string | null;
  sectorConfidence: number;
  sectorTags: string[];
  relevanceReason: string | null;
  dealSignal: boolean;
}

type ScreenResult =
  | { status: "keep"; screened: Screened }
  | { status: "hard"; category: string }
  | { status: "below" };

/** Screen one story: entity matching first (tracked names — fit
 * companies, pipeline deals, Directory people, competing buyers, the
 * watchlist, tracked hospitality groups), then the classifier +
 * relevance model from lib/news-classify.ts, with Ethan's learned
 * corrections and "Not relevant" adjustments applied. Hard-excluded
 * categories and sub-threshold stories never insert. */
function screenItem(
  headline: string,
  snippet: string,
  sourceName: string,
  entities: MatchEntity[],
  state: ClassifierState,
  publishedAt: Date | null
): ScreenResult {
  const hay = `${headline} ${stripHtml(snippet)}`;
  const hayLc = hay.toLowerCase();
  // Tokens keep internal apostrophes so single-word names like
  // "McDonald's" or "Fry's" can match at all (splitting on ' would
  // shred them into fragments that never equal the name).
  const tokens = new Set(hayLc.split(/[^a-z0-9']+/).filter(Boolean));

  const matched: MiNewsMatch[] = [];
  let watchlistHit = false;
  let entityHit = false;
  let companySector: string | null = null;
  for (const e of entities) {
    if (matched.length >= 5) break;
    const nameLc = e.name.toLowerCase();
    const hit = nameLc.includes(" ") ? hayLc.includes(nameLc) : tokens.has(nameLc);
    if (!hit) continue;
    matched.push({ type: e.type, id: e.id, name: e.name });
    if (e.type === "watchlist") watchlistHit = true;
    else {
      entityHit = true;
      // A tracked company/group whose sector we already know votes for
      // that sector below — a stronger signal than vocabulary alone.
      if ((e.type === "company" || e.type === "hospitality") && e.sector && PORTAL_SECTORS.has(e.sector) && !companySector) companySector = e.sector;
    }
  }

  const verdict = classifySector(headline, "", hay, state.corrections);
  // A matched tracked company's known sector overrides the vocabulary
  // vote when the classifier itself found no confident sector — the
  // entity record is ground truth about what the company IS.
  const sector =
    verdict.sector === "Other" && companySector ? companySector : verdict.sector;
  const matchedTypes = matched.map((m) => m.type);
  const rel = scoreRelevance({
    headline,
    summary: "",
    snippet: hay,
    sector,
    matchedTypes,
    publishedAt: publishedAt ? publishedAt.toISOString() : null,
  });
  if (rel.hardExclude) return { status: "hard", category: rel.hardExclude.category };
  let score = rel.score;
  // Learned "Not relevant" feedback applies to future stories from the
  // same source / on the same topic tokens.
  const delta = feedbackDelta(sourceName, headline, state.adjustments);
  if (delta !== 0) score = Math.max(0, Math.min(100, score + delta));
  if (score < NEWS_MIN_RELEVANCE) return { status: "below" };

  const kind: MiNewsItem["kind"] = watchlistHit
    ? "watchlist"
    : entityHit
      ? "entity"
      : rel.dealSignal
        ? "event"
        : "sector";
  return {
    status: "keep",
    screened: {
      score,
      kind,
      matched,
      sector,
      sectorConfidence: verdict.confidence,
      sectorTags: verdict.tags,
      relevanceReason: rel.reason,
      dealSignal: rel.dealSignal,
    },
  };
}

/* ---------------- og:image ---------------- */

/** Publisher link-preview image (og:image) — the one image the licensing
 * rules allow us to hotlink/store a reference to, credited to the source. */
async function fetchOgImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 300000);
    const tag =
      html.match(/<meta[^>]+property=["']og:image["'][^>]*>/i) ??
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]*>/i);
    if (!tag) return null;
    const c = tag[0].match(/content=["']([^"']+)["']/i);
    if (!c) return null;
    const img = c[1].replace(/&amp;/g, "&");
    return img.startsWith("http") ? img : null;
  } catch {
    return null;
  }
}

/* ---------------- ingest ---------------- */

const IMAGE_FETCH_CAP = 12;

export async function ingestIntelNews(): Promise<number> {
  const loadStats: MatchLoadStats = { hospitalityTotal: 0, hospitalityMatchable: 0, hospitalityGenericSkipped: 0 };
  const entities = await loadMatchEntities(loadStats);
  const classifierState = await loadClassifierState();
  const recent: RecentNewsRow[] = await getRecentNewsRows(72);
  const seenLinks = new Set<string>();
  const seenKeys = new Set<string>();
  const tally = new Map<string, { fetched: number; kept: number }>();
  /** Per-feed health for the xcheck verdict: a feed that 403s or dies
   * is named in the log, never silently absent (cross-reference rule). */
  const feedHealth = new Map<string, string>();
  let fetched = 0;
  let kept = 0;
  let inserted = 0;
  let merged = 0;
  let dupSkipped = 0;
  let imagesFetched = 0;
  let hardExcluded = 0;
  let belowBar = 0;
  const hardCats = new Map<string, number>();

  interface Candidate {
    headline: string;
    url: string;
    sourceName: string;
    publishedAt: Date | null;
    snippet: string;
    screened: Screened;
    dedupeKey: string;
  }
  const candidates: Candidate[] = [];

  for (const feed of NEWS_FEEDS) {
    const t = { fetched: 0, kept: 0 };
    tally.set(feed.short, t);
    const feedUrl =
      feed.kind === "rss"
        ? (feed.url as string)
        : `https://news.google.com/rss/search?q=${encodeURIComponent(feed.query as string)}&hl=en-US&gl=US&ceid=US:en`;
    let xml = "";
    try {
      const res = await fetch(feedUrl, {
        headers: { "User-Agent": BROWSER_UA },
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) {
        feedHealth.set(feed.short, `http ${res.status}`);
        continue;
      }
      xml = await res.text();
      feedHealth.set(feed.short, "ok");
    } catch {
      feedHealth.set(feed.short, "fetch error");
      continue;
    }
    for (const item of parseRss(xml)) {
      if (!item.link || !item.title) continue;
      t.fetched++;
      fetched++;
      if (seenLinks.has(item.link)) continue;
      seenLinks.add(item.link);
      // Google News titles carry a " - Publisher" suffix; direct feeds don't.
      const headline = (feed.kind === "gnews" ? item.title.replace(/\s+-\s+[^-]+$/, "") : item.title).trim().slice(0, 300);
      if (!headline || JUNK_HEADLINE.test(headline)) continue;
      const dedupeKey = normalizeHeadline(headline).slice(0, 220);
      if (!dedupeKey || seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);
      const pub = item.pubDate ? new Date(item.pubDate) : null;
      const publishedAt = pub && Number.isFinite(pub.getTime()) ? pub : null;
      const sourceName = (item.source || "").trim() || feed.name;
      const result = screenItem(headline, item.description, sourceName, entities, classifierState, publishedAt);
      if (result.status === "hard") {
        hardExcluded++;
        hardCats.set(result.category, (hardCats.get(result.category) ?? 0) + 1);
        continue;
      }
      if (result.status === "below") {
        belowBar++;
        continue;
      }
      t.kept++;
      kept++;
      candidates.push({
        headline,
        url: item.link,
        sourceName,
        publishedAt,
        snippet: stripHtml(item.description).slice(0, 600),
        screened: result.screened,
        dedupeKey,
      });
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  // Highest score first so the best version of a story wins the insert and
  // later outlets merge into it as also_covered_by.
  candidates.sort((a, b) => b.screened.score - a.screened.score);

  for (const cand of candidates) {
    const primary = cand.screened.matched.find((m) => m.type !== "watchlist") ?? cand.screened.matched[0];
    if (primary) {
      const candTokens = headlineTokens(cand.headline);
      const dupe = recent.find(
        (r) =>
          r.matched.some((m) => m.type === primary.type && m.id === primary.id) &&
          tokenOverlap(candTokens, headlineTokens(r.headline)) >= 0.6
      );
      if (dupe) {
        if (cand.sourceName !== dupe.sourceName && !dupe.alsoCoveredBy.includes(cand.sourceName)) {
          await appendAlsoCoveredBy(dupe.id, cand.sourceName);
          dupe.alsoCoveredBy.push(cand.sourceName);
        }
        merged++;
        continue;
      }
    }
    let imageUrl: string | null = null;
    let imageCredit: string | null = null;
    if (imagesFetched < IMAGE_FETCH_CAP) {
      imagesFetched++;
      imageUrl = await fetchOgImage(cand.url);
      if (imageUrl) imageCredit = `${cand.sourceName} — publisher preview image`;
    }
    const id = await insertNewsItem({
      dedupeKey: cand.dedupeKey,
      headline: cand.headline,
      url: cand.url,
      sourceName: cand.sourceName,
      publishedAt: cand.publishedAt ? cand.publishedAt.toISOString() : null,
      sector: cand.screened.sector,
      sectorConfidence: cand.screened.sectorConfidence,
      sectorTags: cand.screened.sectorTags,
      relevanceScore: cand.screened.score,
      relevanceReason: cand.screened.relevanceReason,
      dealSignal: cand.screened.dealSignal,
      kind: cand.screened.kind,
      matched: cand.screened.matched,
      imageUrl,
      imageCredit,
      rawSnippet: cand.snippet,
    });
    if (id) {
      inserted++;
      recent.push({
        id,
        headline: cand.headline,
        sourceName: cand.sourceName,
        matched: cand.screened.matched,
        alsoCoveredBy: [],
      });
    } else {
      dupSkipped++;
    }
  }

  const perSource = Array.from(tally.entries())
    .map(([short, t]) => `${short} ${t.kept}/${t.fetched}`)
    .join(", ");
  const feedGaps = Array.from(feedHealth.entries())
    .filter(([, h]) => h !== "ok")
    .map(([short, h]) => `${short} ${h}`)
    .join(", ");
  const hardStr = Array.from(hardCats.entries()).map(([c, n]) => `${c} ${n}`).join(", ");
  const verdict = `fetched ${fetched} · kept ${kept} · inserted ${inserted} · merged ${merged} · dup ${dupSkipped} · hard-excluded ${hardExcluded}${hardStr ? ` (${hardStr})` : ""} · below-bar ${belowBar} · entities ${entities.length} (hosp groups ${loadStats.hospitalityMatchable}/${loadStats.hospitalityTotal} matchable, ${loadStats.hospitalityGenericSkipped} generic-skipped) · per-source kept/fetched: ${perSource}${feedGaps ? ` · FEED GAPS: ${feedGaps}` : ""}`;
  await logSync("intel-news-xcheck", "ok", kept, verdict.slice(0, 950));
  await logSync("intel_news", "ok", inserted, verdict.slice(0, 950));
  return inserted;
}
