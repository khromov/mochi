// Vendored from `postgres-semicolons@0.1.2` (https://github.com/neondatabase/semicolons, MIT, Neon Inc.).
// Extended for SQLite + Postgres migrations: fixes backslash escapes inside `E'…'` strings, adds SQLite
// backtick-quoted identifiers, and keeps `CREATE TRIGGER … BEGIN … END` / `BEGIN ATOMIC … END` intact.

const specialPattern = /[\s\S]*?([;'"`$]|--|\/\*)/y;
const doubleQuote = /[\s\S]*?"/y;
const backtickQuote = /[\s\S]*?`/y;
const singleQuote = /[\s\S]*?'/y;
const singleQuoteOrBackslash = /[\s\S]*?('|\\)/y;
const whitespaceThenSingleQuote = /\s*\n\s*'/y;
const newline = /.*?\n/y;
const commentOpenOrClose = /[\s\S]*?([/][*]|[*][/])/y;
const trailingIdentifier = /(^|[^A-Za-z\u0080-\uFFFF_0-9$])[A-Za-z\u0080-\uFFFF_][A-Za-z\u0080-\uFFFF_0-9$]*$/;
const dollarTag = /([A-Za-z\u0080-\uFFFF_][A-Za-z\u0080-\uFFFF_0-9]*)?[$]/y;
const identifierContinuation = /[A-Za-z\u0080-\uFFFF_0-9$]+/y;
const whitespace = /\s/y;

function indexAfter(str: string, re: RegExp, from: number): number {
  re.lastIndex = from;
  return re.test(str) ? re.lastIndex : -1;
}

function isIdentStart(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code >= 0x80;
}

function isIdentPart(code: number): boolean {
  return isIdentStart(code) || (code >= 48 && code <= 57) || code === 36;
}

interface CompoundState {
  stmtFirstWord: string | null;
  isCreateTrigger: boolean;
  pendingBegin: boolean;
  prevToken: string | null;
  parenDepth: number;
  caseDepth: number;
  compoundDepth: number;
}

function createCompoundState(): CompoundState {
  return {
    stmtFirstWord: null,
    isCreateTrigger: false,
    pendingBegin: false,
    prevToken: null,
    parenDepth: 0,
    caseDepth: 0,
    compoundDepth: 0,
  };
}

function resetCompoundState(state: CompoundState): void {
  state.stmtFirstWord = null;
  state.isCreateTrigger = false;
  state.pendingBegin = false;
  state.prevToken = null;
  state.parenDepth = 0;
  state.caseDepth = 0;
  state.compoundDepth = 0;
}

function markLiteralOrQuotedToken(state: CompoundState): void {
  state.pendingBegin = false;
  state.prevToken = '""';
  if (state.stmtFirstWord === null) {
    state.stmtFirstWord = '""';
  }
}

function scanPlainTokens(sql: string, from: number, to: number, state: CompoundState): void {
  let i = from;
  while (i < to) {
    const code = sql.charCodeAt(i);
    if (code <= 32 || code === 0xfeff) {
      i++;
      continue;
    }
    if (code === 40 /* ( */) {
      state.parenDepth++;
      state.pendingBegin = false;
      state.prevToken = '(';
      if (state.stmtFirstWord === null) {
        state.stmtFirstWord = '(';
      }
      i++;
      continue;
    }
    if (code === 41 /* ) */) {
      if (state.parenDepth > 0) {
        state.parenDepth--;
      }
      state.pendingBegin = false;
      state.prevToken = ')';
      i++;
      continue;
    }
    if (isIdentStart(code)) {
      const start = i;
      i++;
      while (i < to && isIdentPart(sql.charCodeAt(i))) {
        i++;
      }
      const word = sql.slice(start, i).toUpperCase();
      const wasPendingBegin = state.pendingBegin;
      state.pendingBegin = false;
      const qualifiedOrAlias = state.prevToken === '.' || state.prevToken === '[' || state.prevToken === 'AS';
      if (state.stmtFirstWord === null) {
        state.stmtFirstWord = word;
      } else if (!qualifiedOrAlias) {
        if (wasPendingBegin && word === 'ATOMIC' && state.parenDepth === 0) {
          state.compoundDepth++;
        } else if (word === 'TRIGGER' && state.stmtFirstWord === 'CREATE' && state.parenDepth === 0) {
          state.isCreateTrigger = true;
        } else if (word === 'CASE') {
          state.caseDepth++;
        } else if (word === 'BEGIN' && state.parenDepth === 0) {
          if (state.isCreateTrigger && state.compoundDepth === 0) {
            state.compoundDepth++;
          } else {
            state.pendingBegin = true;
          }
        } else if (word === 'END') {
          if (state.caseDepth > 0) {
            state.caseDepth--;
          } else if (state.compoundDepth > 0 && state.parenDepth === 0) {
            state.compoundDepth--;
          }
        }
      }
      state.prevToken = word;
      continue;
    }
    if (code >= 48 && code <= 57) {
      while (i < to && isIdentPart(sql.charCodeAt(i))) {
        i++;
      }
      state.pendingBegin = false;
      state.prevToken = '0';
      if (state.stmtFirstWord === null) {
        state.stmtFirstWord = '0';
      }
      continue;
    }
    state.pendingBegin = false;
    state.prevToken = sql[i]!;
    if (state.stmtFirstWord === null) {
      state.stmtFirstWord = state.prevToken;
    }
    i++;
  }
}

export type SplitPosition = number | [number, number];

export interface ParseSplitsResult {
  positions: SplitPosition[];
  unterminated?: 'quoted string' | 'quoted identifier' | 'dollar-quoted string' | '/* comment';
}

/**
 * Identifies semicolons that separate top-level SQL statements, plus SQL comment ranges.
 * @param sql One or more SQL statements, separated by semicolons.
 * @param standardConformingStrings If `false`, quotes may be backslash-escaped in ordinary strings.
 */
export function parseSplits(sql: string, standardConformingStrings = true): ParseSplitsResult {
  const positions: SplitPosition[] = [];
  const length = sql.length;
  const state = createCompoundState();

  let at = 0;
  let plainStart = 0;

  for (;;) {
    if (at >= length) {
      return { positions };
    }

    at = indexAfter(sql, specialPattern, at);
    if (at === -1) {
      return { positions };
    }

    const ch = sql.charCodeAt(at - 1);
    const matchStart = ch === 45 /* - */ || ch === 42 /* * */ ? at - 2 : at - 1;
    scanPlainTokens(sql, plainStart, matchStart, state);

    switch (ch) {
      case 59 /* ; */:
        if (state.compoundDepth === 0) {
          positions.push(matchStart);
          resetCompoundState(state);
        } else {
          state.pendingBegin = false;
          state.prevToken = ';';
          state.caseDepth = 0;
          state.parenDepth = 0;
        }
        break;

      case 34 /* " */:
      case 96 /* ` */:
      case 39 /* ' */: {
        const isSingleQuote = ch === 39;
        let backslashing = false;
        if (isSingleQuote) {
          if (!standardConformingStrings) {
            backslashing = true;
          } else if (matchStart > 0) {
            const chPrev = sql.charCodeAt(matchStart - 1);
            const precededByIdent = matchStart > 1 && isIdentPart(sql.charCodeAt(matchStart - 2));
            if ((chPrev === 69 /* E */ || chPrev === 101) /* e */ && !precededByIdent) {
              backslashing = true;
            }
          }
        }
        const re = isSingleQuote ? (backslashing ? singleQuoteOrBackslash : singleQuote) : ch === 34 ? doubleQuote : backtickQuote;
        markLiteralOrQuotedToken(state);
        for (;;) {
          at = indexAfter(sql, re, at);
          if (at === -1) {
            return { positions, unterminated: isSingleQuote ? 'quoted string' : 'quoted identifier' };
          }
          if (backslashing && sql.charCodeAt(at - 1) === 92 /* \ */) {
            if (at >= length) {
              return { positions, unterminated: 'quoted string' };
            }
            at += 1;
            continue;
          }
          const chNext = sql.charCodeAt(at);
          if (chNext === ch) {
            at += 1;
          } else {
            if (!isSingleQuote) {
              break;
            }
            const continuingQuote = indexAfter(sql, whitespaceThenSingleQuote, at);
            if (continuingQuote === -1) {
              break;
            }
            at = continuingQuote;
          }
        }
        break;
      }

      case 36 /* $ */: {
        const priorSql = sql.slice(0, matchStart);
        if (trailingIdentifier.test(priorSql)) {
          const contEnd = indexAfter(sql, identifierContinuation, at);
          if (contEnd !== -1) {
            at = contEnd;
          }
          break;
        }

        const tagEnd = indexAfter(sql, dollarTag, at);
        if (tagEnd === -1) {
          const contEnd = indexAfter(sql, identifierContinuation, at);
          if (contEnd !== -1) {
            at = contEnd;
          }
          markLiteralOrQuotedToken(state);
          break;
        }

        const tagStr = sql.slice(matchStart, tagEnd);
        at = sql.indexOf(tagStr, tagEnd);
        if (at === -1) {
          return { positions, unterminated: 'dollar-quoted string' };
        }

        at += tagStr.length;
        markLiteralOrQuotedToken(state);
        break;
      }

      case 45 /* - */:
        at = indexAfter(sql, newline, at);
        if (at === -1) {
          at = length;
        }
        positions.push([matchStart, at]);
        break;

      case 42 /* * */: {
        let commentDepth = 1;
        for (;;) {
          at = indexAfter(sql, commentOpenOrClose, at);
          if (at === -1) {
            return { positions, unterminated: '/* comment' };
          }
          const isOpening = sql.charCodeAt(at - 1) === 42; /* * */
          commentDepth += isOpening ? 1 : -1;
          if (commentDepth === 0) {
            positions.push([matchStart, at]);
            break;
          }
        }
        break;
      }

      default:
        throw new Error('Unexpected character in SQL scanner');
    }

    plainStart = at;
  }
}

/**
 * Uses the output of `parseSplits` to split a string into separate SQL statements.
 * @param cutComments If `true`, remove comments from statements.
 */
export function splitStatements(sql: string, positions: SplitPosition[], cutComments: boolean): string[] {
  const statements: string[] = [];
  let start = 0;
  let statement = '';

  for (const position of positions.concat(sql.length)) {
    const isSemicolon = typeof position === 'number';
    statement += sql.slice(start, isSemicolon ? position : position[0]);

    if (isSemicolon) {
      statements.push(statement.trim());
      statement = '';
      start = position + 1;
    } else if (cutComments) {
      start = position[1];
      const noSpaceBefore = statement.length > 0 && indexAfter(statement, whitespace, statement.length - 1) === -1;
      const noSpaceAfter = start < sql.length && indexAfter(sql, whitespace, start) === -1;
      if (noSpaceBefore && noSpaceAfter) {
        statement += ' ';
      }
    } else {
      start = position[0];
    }
  }
  return statements;
}

/**
 * Uses the output of `parseSplits` to split a string into non-empty SQL statements (preserving comments).
 */
export function nonEmptyStatements(sql: string, positions: SplitPosition[]): string[] {
  const withComments = splitStatements(sql, positions, false);
  const sansComments = splitStatements(sql, positions, true);
  return withComments.filter((_, i) => sansComments[i] !== '');
}
