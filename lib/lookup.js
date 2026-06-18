const FOREIGN_EXCHANGES = new Set([
  'ASX', 'BME', 'BOM', 'BSE', 'CVE', 'FRA', 'HEL', 'HKSE', 'JSE', 'LSE',
  'MCX', 'MEX', 'NSE', 'NZX', 'OSL', 'PAR', 'STO', 'SWX', 'TSX', 'TSXV', 'TYO'
]);

const FOREIGN_SYMBOL_SUFFIXES = [
  '.AS', '.AT', '.AX', '.BK', '.BO', '.BR', '.CO', '.DE', '.F', '.HE', '.HK',
  '.IC', '.JK', '.JO', '.KS', '.KQ', '.L', '.MC', '.MI', '.MX', '.NS', '.NZ',
  '.OL', '.PA', '.SI', '.SS', '.ST', '.SW', '.SZ', '.T', '.TO', '.TW', '.V'
];

const US_EXCHANGE_HINTS = [
  'AMEX', 'ARCA', 'BATS', 'NASDAQ', 'NAS', 'NCM', 'NGM', 'NMS', 'NYSE', 'NYQ',
  'OQB', 'OQX', 'OTC', 'OTCBB', 'OTCMKTS', 'PINK', 'PNK'
];

const BAD_QUOTE_TYPES = new Set(['ALTSYMBOL', 'CRYPTOCURRENCY', 'CURRENCY', 'FUTURE', 'INDEX']);
const STOPWORDS = new Set([
  'AND', 'CAPITAL', 'CLASS', 'CO', 'COMMON', 'CORP', 'CORPORATION', 'FUND',
  'HOLDINGS', 'INC', 'INCORPORATED', 'LIMITED', 'PLC', 'SHARES', 'STOCK',
  'THE', 'TRUST'
]);

const QUOTE_TYPE_SCORE = {
  EQUITY: 40,
  ETF: 38,
  MUTUALFUND: 36
};

const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' }
];

export function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function standardizeName(name) {
  return normalizeWhitespace(String(name || ''))
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/\bINTL\b/g, 'INTERNATIONAL')
    .replace(/\bTECH\b/g, 'TECHNOLOGY')
    .replace(/\bSVCS\b/g, 'SERVICES')
    .replace(/\bCAP STK\b/g, 'CAPITAL STOCK')
    .replace(/\bCOM STK\b/g, 'COMMON STOCK')
    .replace(/\bCL\s+([A-Z0-9]+)\b/g, 'CLASS $1')
    .replace(/[(),/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripDescriptors(name) {
  return normalizeWhitespace(name
    .replace(/\b(PAR VALUE|REGISTERED|REGD|NEW|OLD)\b/g, ' ')
    .replace(/\b(ADR|ADS|SPON ADR|SPONSORED ADR|DEPOSITARY SHARES?)\b/g, ' ')
    .replace(/\b(PREF|PREFERRED|PREFERENCE)\b/g, ' ')
    .replace(/\b(TRUST|FUND|FUNDS|ETF|ETFS|PORTFOLIO|PORTFOLIOS)\b/g, ' ')
    .replace(/\b(COMMON STOCK|CAPITAL STOCK|COMMON|CAPITAL|COM|STOCK)\b/g, ' ')
    .replace(/\b(ORDINARY SHARES?|ORD SHS?|SHARES?|SHS?)\b/g, ' ')
    .replace(/\b(UNITS?|UTS|RIGHTS?|RTS|WARRANTS?|WTS)\b/g, ' ')
    .replace(/\s+/g, ' '));
}

function removeClassMarkers(name) {
  return normalizeWhitespace(name
    .replace(/\bCLASS\s+[A-Z0-9]+\b/g, ' ')
    .replace(/\bSERIES\s+[A-Z0-9]+\b/g, ' ')
    .replace(/\s+/g, ' '));
}

function buildSearchQueries(name) {
  const original = normalizeWhitespace(name);
  const standardized = standardizeName(name);
  const stripped = stripDescriptors(standardized);
  const base = removeClassMarkers(stripped);

  return [...new Set(
    [base, stripped, standardized, original]
      .map(normalizeWhitespace)
      .filter(Boolean)
  )];
}

function tokenize(value) {
  return normalizeWhitespace(String(value || ''))
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter(token => token && !STOPWORDS.has(token));
}

function overlapScore(query, candidate) {
  const queryTokens = tokenize(query);
  const candidateTokens = tokenize(candidate);

  if (!queryTokens.length || !candidateTokens.length) {
    return 0;
  }

  const candidateSet = new Set(candidateTokens);
  const matched = queryTokens.filter(token => candidateSet.has(token)).length;
  const coverage = matched / queryTokens.length;
  return Math.round(coverage * 30);
}

function isForeignSymbol(symbol) {
  const upper = String(symbol || '').toUpperCase();
  return FOREIGN_SYMBOL_SUFFIXES.some(suffix => upper.endsWith(suffix));
}

function isUsExchange(exchange) {
  const upper = String(exchange || '').toUpperCase();
  return US_EXCHANGE_HINTS.some(hint => upper.includes(hint));
}

function sanitizeTicker(rawTicker) {
  const upper = normalizeWhitespace(String(rawTicker || ''))
    .toUpperCase()
    .replace(/^:+|:+$/g, '')
    .replace(/[)\],.;:]+$/g, '');

  if (!upper || upper === 'NOT_FOUND' || BAD_QUOTE_TYPES.has(upper)) {
    return null;
  }

  if (upper.endsWith('-USD') || upper.includes(' ')) {
    return null;
  }

  if (isForeignSymbol(upper)) {
    return null;
  }

  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(upper) ? upper : null;
}

function scoreQuote(quote, query) {
  const symbol = sanitizeTicker(quote?.symbol);
  const exchange = String(quote?.exchange || '').toUpperCase();
  const quoteType = String(quote?.quoteType || '').toUpperCase();

  if (!symbol || BAD_QUOTE_TYPES.has(quoteType)) {
    return -Infinity;
  }

  if (FOREIGN_EXCHANGES.has(exchange) && !isUsExchange(exchange)) {
    return -Infinity;
  }

  let score = QUOTE_TYPE_SCORE[quoteType] ?? 8;

  if (isUsExchange(exchange)) {
    score += 18;
  }

  if (exchange.includes('OTC') || exchange.includes('PNK') || exchange.includes('PINK')) {
    score += 8;
  }

  score += overlapScore(query, quote?.shortname || '');
  score += overlapScore(query, quote?.longname || '');
  score += overlapScore(query, quote?.displayName || '');

  const standardizedQuery = standardizeName(query);
  const longName = standardizeName(quote?.longname || quote?.shortname || quote?.displayName || '');

  if (longName && (longName.includes(standardizedQuery) || standardizedQuery.includes(longName))) {
    score += 12;
  }

  if (/CLASS [A-Z0-9]+/.test(standardizedQuery) && !/CLASS [A-Z0-9]+/.test(longName)) {
    score -= 4;
  }

  return score;
}

async function fetchJson(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function tryYahoo(name) {
  let bestMatch = null;

  for (const query of buildSearchQueries(name)) {
    try {
      const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=12&newsCount=0`;
      const response = await fetchJson(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      if (!response.ok) {
        continue;
      }

      const data = await response.json();
      const quotes = Array.isArray(data?.quotes) ? data.quotes : [];

      for (const quote of quotes) {
        const score = scoreQuote(quote, query);
        if (score > (bestMatch?.score ?? -Infinity)) {
          bestMatch = {
            score,
            ticker: sanitizeTicker(quote.symbol)
          };
        }
      }
    } catch (error) {
      console.error('Yahoo lookup failed', { query, error: error?.message });
    }
  }

  return bestMatch && bestMatch.score >= 45 ? bestMatch.ticker : null;
}

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .map(part => typeof part?.text === 'string' ? part.text : '')
    .join('')
    .trim();
}

function normalizeResultName(value) {
  return normalizeWhitespace(String(value || ''))
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function buildGeminiBatchPrompt(names) {
  const entries = names.map((name, index) => {
    const cleaned = buildSearchQueries(name)[0] || name;
    return `${index + 1}. Original: "${normalizeWhitespace(name)}" | Cleaned: "${cleaned}"`;
  }).join('\n');

  return [
    'Identify the best US-traded ticker symbol for each security name.',
    'Rules:',
    '- If there is both a foreign listing and a US OTC ticker, always return the OTC ticker.',
    '- Never return a foreign exchange symbol.',
    '- Prefer a US OTC/Pink Sheets ticker over TSX, TSXV, LSE, ASX, HKEX, and any other non-US exchange.',
    '- Otherwise return the best US-listed stock, ETF, or mutual fund ticker.',
    '- Reject crypto symbols, currency pairs, and foreign suffixes like .TO or .V.',
    '- Example: Arras Minerals Corp -> ARRKF, not ARK.',
    '- If no US-traded ticker exists, return NOT_FOUND.',
    'Return JSON only in this exact shape:',
    '{"results":[{"name":"Apple Inc","ticker":"AAPL"}]}',
    'Use each original name exactly as provided in the "name" field.',
    'Security names:',
    entries
  ].join('\n');
}

function parseGeminiBatchResults(rawText, names) {
  const results = new Map(names.map(name => [name, null]));
  if (!rawText) {
    return results;
  }

  try {
    const parsed = JSON.parse(rawText);
    const items = Array.isArray(parsed?.results) ? parsed.results : [];
    const byNormalized = new Map(names.map(name => [normalizeResultName(name), name]));

    for (const item of items) {
      const original = byNormalized.get(normalizeResultName(item?.name));
      if (!original) {
        continue;
      }

      results.set(original, sanitizeTicker(item?.ticker));
    }
  } catch (error) {
    console.error('Gemini batch parse failed', { error: error?.message });
  }

  return results;
}

async function tryGeminiBatch(names, apiKey) {
  const prompt = buildGeminiBatchPrompt(names);
  let sawRateLimit = false;
  let retryAfterMs = 30000;

  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetchJson(
          `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.1
              }
            })
          },
          18000
        );

        if (response.status === 429) {
          sawRateLimit = true;
          retryAfterMs = Math.max(retryAfterMs, 5000 * (attempt + 1));
          console.error('Gemini lookup failed', { model: model.id, status: response.status, attempt: attempt + 1 });
          await sleep(900 * (attempt + 1));
          continue;
        }

        if (!response.ok) {
          console.error('Gemini lookup failed', { model: model.id, status: response.status });
          break;
        }

        const data = await response.json();
        const results = parseGeminiBatchResults(extractGeminiText(data), names);
        return {
          results,
          source: model.label,
          rateLimited: false,
          retryAfterMs: 0
        };
      } catch (error) {
        console.error('Gemini lookup failed', { model: model.id, error: error?.message, attempt: attempt + 1 });
        await sleep(500 * (attempt + 1));
      }
    }
  }

  if (sawRateLimit) {
    return {
      results: new Map(names.map(name => [name, null])),
      source: 'Gemini rate limited',
      rateLimited: true,
      retryAfterMs
    };
  }

  return null;
}

export async function resolveBatchDetailed(names, apiKey) {
  const orderedNames = names
    .map(name => normalizeWhitespace(name))
    .filter(Boolean);

  const results = {};
  const unresolved = [];

  for (const name of orderedNames) {
    const yahoo = await tryYahoo(name);
    if (yahoo) {
      results[name] = { ticker: yahoo, source: 'Yahoo Finance' };
    } else {
      unresolved.push(name);
    }
  }

  if (!unresolved.length) {
    return { results, deferredNames: [], pollAfterMs: 0 };
  }

  if (!apiKey) {
    for (const name of unresolved) {
      results[name] = { ticker: 'NEEDS_REVIEW', source: '—' };
    }
    return { results, deferredNames: [], pollAfterMs: 0 };
  }

  const gemini = await tryGeminiBatch(unresolved, apiKey);
  if (gemini?.rateLimited) {
    return {
      results,
      deferredNames: unresolved,
      pollAfterMs: gemini.retryAfterMs || 30000
    };
  }

  if (gemini) {
    for (const name of unresolved) {
      const ticker = gemini.results.get(name);
      if (ticker) {
        results[name] = { ticker, source: gemini.source };
      }
    }
  }

  for (const name of unresolved) {
    if (!results[name]) {
      results[name] = { ticker: 'NEEDS_REVIEW', source: '—' };
    }
  }

  return { results, deferredNames: [], pollAfterMs: 0 };
}

export async function resolveBatch(names, apiKey) {
  const detail = await resolveBatchDetailed(names, apiKey);
  const results = { ...detail.results };

  for (const name of detail.deferredNames) {
    results[name] = { ticker: 'NEEDS_REVIEW', source: 'Gemini rate limited' };
  }

  return results;
}

export async function resolveName(name, apiKey) {
  const normalizedName = normalizeWhitespace(name);
  if (!normalizedName) {
    return { ticker: 'NEEDS_REVIEW', source: '—' };
  }

  const results = await resolveBatch([normalizedName], apiKey);
  return results[normalizedName] || { ticker: 'NEEDS_REVIEW', source: '—' };
}
