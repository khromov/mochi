import { requestCache, requestMemo } from 'mochi-framework';

export interface Counters {
  uncached: number;
  cached: number;
}

/**
 * Per-request tallies, themselves stored in the request cache — so every
 * facet on the page increments the same object without module-level state
 * leaking between requests.
 */
export function counters(): Counters {
  return requestCache('demo:crusoe:counters', () => ({ uncached: 0, cached: 0 }));
}

// The text of Robinson Crusoe, read once at module load and trimmed to Defoe's
// prose — the Project Gutenberg header/footer is boilerplate that would skew the
// word counts (and hand "unenforceability" the longest-word crown). The file
// read is one-time setup; the expensive, repeated work is analyze() below — that
// is what gets memoized, the same way pure CPU (not I/O) was the memoized cost
// before.
const RAW = await Bun.file('./src/demos/request-cache/robinson-crusoe.txt').text();
const bodyStart = RAW.indexOf('***', RAW.indexOf('*** START OF') + 3) + 3;
const BOOK = RAW.slice(bodyStart, RAW.indexOf('*** END OF'));

// Very common English words carry no signal in a top-words list; drop them so
// the narrative's real vocabulary (shore, boat, island, Friday…) rises to the top.
const STOPWORDS = new Set(
  "a an the and or but if of to in into on upon at by for from with without within as than then so such no not nor only own same other another some any each few many more most all both very much well now here there when where while though yet also about before after over under again ever never how what which who whom whose that this these those i me my we us our you your he him his she her it its they them their been being am is are was were be do does did done have has had having would should could shall will may might must can cannot thus therefore hence unto amongst out up down".split(
    ' ',
  ),
);

const THEME_WORDS = ['island', 'sea', 'ship', 'god', 'friday', 'money', 'fear'] as const;

export interface Analysis {
  words: number;
  unique: number;
  sentences: number;
  /** Estimated reading time in minutes at 250 wpm. */
  readingMinutes: number;
  /** All words sorted by descending frequency, stopwords excluded. */
  topWords: Array<[string, number]>;
  themes: Array<[string, number]>;
  longestSentenceWords: number;
  longestSentenceExcerpt: string;
  longestWord: string;
  /** Count of words appearing exactly once (hapax legomena). */
  hapax: number;
}

/**
 * The heavy pass: tokenize the whole book, count every word, split sentences,
 * and derive all five facets in one sweep. ~16–25ms of pure CPU — the unit of
 * work we want to run once, not once per facet.
 */
function analyze(text: string): Analysis {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }

  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  let longestSentenceWords = 0;
  let longestSentenceExcerpt = '';
  for (const s of sentences) {
    const n = (s.match(/[a-z']+/gi) ?? []).length;
    if (n > longestSentenceWords) {
      longestSentenceWords = n;
      longestSentenceExcerpt = s.replace(/\s+/g, ' ').trim();
    }
  }

  let longestWord = '';
  let hapax = 0;
  for (const [word, count] of freq) {
    if (count === 1) {
      hapax++;
    }
    if (word.length > longestWord.length) {
      longestWord = word;
    }
  }

  const topWords = [...freq.entries()].filter(([w]) => !STOPWORDS.has(w)).sort((a, b) => b[1] - a[1]);
  const themes = THEME_WORDS.map((w) => [w, freq.get(w) ?? 0] as [string, number]);

  return {
    words: words.length,
    unique: freq.size,
    sentences: sentences.length,
    readingMinutes: Math.round(words.length / 250),
    topWords,
    themes,
    longestSentenceWords,
    longestSentenceExcerpt,
    longestWord,
    hapax,
  };
}

function analyzeUncached(): Analysis {
  counters().uncached++;
  return analyze(BOOK);
}

/**
 * The same analysis, memoized for the duration of one request. The counter
 * lives inside the wrapped function, so it only ticks on a miss — a hit never
 * runs this body at all. Zero args means a single shared entry: however many
 * facets ask for the analysis, the book is parsed once per request.
 */
const analyzeCached = requestMemo(
  (): Analysis => {
    counters().cached++;
    return analyze(BOOK);
  },
  { namespace: 'demo:crusoe' },
);

// Five independent facets. Each is a separate consumer that asks for the whole
// analysis and keeps only its slice — naively that's five full parses; through
// analyzeCached() it's one parse and four hits.

export interface Overview {
  words: number;
  unique: number;
  sentences: number;
  readingMinutes: number;
}

function toOverview(a: Analysis): Overview {
  return { words: a.words, unique: a.unique, sentences: a.sentences, readingMinutes: a.readingMinutes };
}

export const overview = () => toOverview(analyzeCached());
export const overviewUncached = () => toOverview(analyzeUncached());

export const topWords = () => analyzeCached().topWords.slice(0, 12);
export const topWordsUncached = () => analyzeUncached().topWords.slice(0, 12);

export const themes = () => analyzeCached().themes;
export const themesUncached = () => analyzeUncached().themes;

export interface Extremes {
  longestSentenceWords: number;
  longestSentenceExcerpt: string;
  longestWord: string;
}

function toExtremes(a: Analysis): Extremes {
  return {
    longestSentenceWords: a.longestSentenceWords,
    longestSentenceExcerpt: a.longestSentenceExcerpt,
    longestWord: a.longestWord,
  };
}

export const extremes = () => toExtremes(analyzeCached());
export const extremesUncached = () => toExtremes(analyzeUncached());

export const richness = () => analyzeCached().hapax;
export const richnessUncached = () => analyzeUncached().hapax;
