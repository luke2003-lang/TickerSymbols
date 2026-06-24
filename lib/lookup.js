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
const MASSIVE_DEFAULT_BASE_URLS = [
  'https://api.massive.com'
];
const MASSIVE_REQUEST_TIMEOUT_MS = 7000;
const MASSIVE_DISABLE_AFTER_FAILURES = 3;
const MASSIVE_COOLDOWN_MS = 60000;

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const runnerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: runnerCount }, () => runWorker()));
  return results;
}

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
  score += overlapScore(query, quote?.prevName || '');

  const standardizedQuery = standardizeName(query);
  const longName = standardizeName(quote?.longname || quote?.shortname || quote?.displayName || '');
  const previousName = standardizeName(quote?.prevName || '');

  if (longName && (longName.includes(standardizedQuery) || standardizedQuery.includes(longName))) {
    score += 12;
  }

  if (previousName && (previousName.includes(standardizedQuery) || standardizedQuery.includes(previousName))) {
    score += 18;
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

function getMassiveBaseUrls() {
  const customBaseUrl = normalizeWhitespace(process.env.MASSIVE_API_BASE_URL || '');
  return [...new Set([customBaseUrl, ...MASSIVE_DEFAULT_BASE_URLS].filter(Boolean))];
}

function shouldTryMassiveQuery(query) {
  const normalized = normalizeWhitespace(query);
  if (normalized.length < 4) {
    return false;
  }

  const tokens = tokenize(normalized);
  if (!tokens.length) {
    return false;
  }

  return tokens.some(token => token.length >= 3) || normalized.length >= 8;
}

function createMassiveRuntime(apiKey) {
  return {
    apiKey,
    baseUrls: getMassiveBaseUrls(),
    cache: new Map(),
    loggedIssues: new Set(),
    consecutiveFailures: 0,
    cooldownUntil: 0,
    disabledReason: null
  };
}

function logMassiveIssue(runtime, key, details) {
  if (!runtime || runtime.loggedIssues.has(key)) {
    return;
  }

  runtime.loggedIssues.add(key);
  console.error('Massive lookup failed', details);
}

function disableMassive(runtime, reason, details) {
  if (!runtime || runtime.disabledReason) {
    return;
  }

  runtime.disabledReason = reason;
  runtime.cooldownUntil = Number.POSITIVE_INFINITY;
  logMassiveIssue(runtime, `disabled:${reason}`, details);
}

async function readResponseSnippet(response) {
  try {
    const text = normalizeWhitespace(await response.text());
    return text ? text.slice(0, 180) : '';
  } catch {
    return '';
  }
}

function scoreMassiveResult(result, query) {
  const symbol = sanitizeTicker(result?.ticker);
  const market = String(result?.market || '').toLowerCase();
  const locale = String(result?.locale || '').toLowerCase();

  if (!symbol) {
    return -Infinity;
  }

  if (result?.active === false) {
    return -Infinity;
  }

  if (!['otc', 'stocks'].includes(market)) {
    return -Infinity;
  }

  if (locale && locale !== 'us') {
    return -Infinity;
  }

  let score = market === 'otc' ? 38 : 34;
  score += overlapScore(query, result?.name || '');

  const standardizedQuery = standardizeName(query);
  const standardizedName = standardizeName(result?.name || '');

  if (standardizedName && (standardizedName.includes(standardizedQuery) || standardizedQuery.includes(standardizedName))) {
    score += 14;
  }

  if (market === 'otc') {
    score += 6;
  }

  return score;
}

async function searchMassiveTickers(query, market, runtime) {
  if (!runtime?.apiKey || runtime.disabledReason || Date.now() < runtime.cooldownUntil) {
    return [];
  }

  const normalizedQuery = normalizeWhitespace(query);
  if (!shouldTryMassiveQuery(normalizedQuery)) {
    return [];
  }

  const cacheKey = `${market}:${normalizedQuery}`;
  if (runtime.cache.has(cacheKey)) {
    return runtime.cache.get(cacheKey);
  }

  let sawTransientFailure = false;

  for (const baseUrl of runtime.baseUrls) {
    try {
      const url = new URL('/v3/reference/tickers', baseUrl);
      url.searchParams.set('search', normalizedQuery);
      url.searchParams.set('market', market);
      url.searchParams.set('active', 'true');
      url.searchParams.set('limit', '12');
      const response = await fetchJson(url.toString(), {
        headers: {
          Authorization: `Bearer ${runtime.apiKey}`
        }
      }, MASSIVE_REQUEST_TIMEOUT_MS);

      if (response.status === 404) {
        continue;
      }

      if (response.status === 400) {
        logMassiveIssue(runtime, `400:${baseUrl}`, {
          baseUrl,
          market,
          status: response.status,
          detail: await readResponseSnippet(response)
        });
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        disableMassive(runtime, 'auth', {
          baseUrl,
          market,
          status: response.status,
          detail: await readResponseSnippet(response)
        });
        break;
      }

      if (response.status === 429) {
        runtime.cooldownUntil = Date.now() + MASSIVE_COOLDOWN_MS;
        logMassiveIssue(runtime, `429:${baseUrl}`, {
          baseUrl,
          market,
          status: response.status,
          retryAfterMs: MASSIVE_COOLDOWN_MS
        });
        runtime.cache.set(cacheKey, []);
        return [];
      }

      if (!response.ok) {
        sawTransientFailure = response.status >= 500 || response.status === 408;
        logMassiveIssue(runtime, `${response.status}:${baseUrl}`, {
          baseUrl,
          market,
          status: response.status,
          detail: sawTransientFailure ? await readResponseSnippet(response) : ''
        });
        continue;
      }

      const data = await response.json();
      const results = Array.isArray(data?.results) ? data.results : [];
      runtime.consecutiveFailures = 0;
      runtime.cache.set(cacheKey, results);
      return results;
    } catch (error) {
      sawTransientFailure = true;
      logMassiveIssue(runtime, `error:${baseUrl}:${error?.name || 'unknown'}`, {
        baseUrl,
        market,
        error: error?.message
      });
    }
  }

  if (sawTransientFailure) {
    runtime.consecutiveFailures += 1;
    if (runtime.consecutiveFailures >= MASSIVE_DISABLE_AFTER_FAILURES) {
      disableMassive(runtime, 'transient', {
        failureCount: runtime.consecutiveFailures
      });
    }
  }

  runtime.cache.set(cacheKey, []);
  return [];
}

async function tryMassiveReference(name, runtime) {
  let bestMatch = null;
  const queries = buildSearchQueries(name)
    .filter(shouldTryMassiveQuery)
    .slice(0, 2);

  for (const query of queries) {
    for (const market of ['otc', 'stocks']) {
      const results = await searchMassiveTickers(query, market, runtime);

      for (const result of results) {
        const score = scoreMassiveResult(result, query);
        if (score > (bestMatch?.score ?? -Infinity)) {
          bestMatch = {
            score,
            ticker: sanitizeTicker(result?.ticker)
          };
        }
      }

      if (bestMatch && bestMatch.score >= 60) {
        return bestMatch.ticker;
      }
    }
  }

  return bestMatch && bestMatch.score >= 42 ? bestMatch.ticker : null;
}

async function searchYahooQuotes(query, quotesCount = 12) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=${quotesCount}&newsCount=0`;
  const response = await fetchJson(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  return Array.isArray(data?.quotes) ? data.quotes : [];
}

async function fetchTickerMetadata(ticker) {
  try {
    const quotes = await searchYahooQuotes(ticker, 8);
    const target = sanitizeTicker(ticker);
    if (!target) {
      return null;
    }

    return quotes.find(quote => sanitizeTicker(quote?.symbol) === target) || null;
  } catch (error) {
    console.error('Ticker metadata lookup failed', { ticker, error: error?.message });
    return null;
  }
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

function buildCorporateActionPrompt(names) {
  const entries = names.map((name, index) => `${index + 1}. "${normalizeWhitespace(name)}"`).join('\n');

  return [
    'Identify the current US-traded ticker symbol for each company name below.',
    'Important rules:',
    '- If the company recently changed its corporate name or ticker, return the current ticker in use today.',
    '- If an old name now maps to a renamed public company, return the new ticker, not the historical ticker.',
    '- Prefer a US OTC ticker over a foreign listing when both exist.',
    '- Never return a foreign exchange symbol.',
    '- If no current US-traded ticker exists, return NOT_FOUND.',
    'Return JSON only in this exact shape:',
    '{"results":[{"name":"AirNet Technology","ticker":"YDKG"}]}',
    'Company names:',
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
  async function requestGemini(prompt) {
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

  async function validateResults(resultMap) {
    const cache = new Map();
    const invalidNames = [];

    for (const [name, ticker] of resultMap.entries()) {
      if (!ticker) {
        continue;
      }

      if (!cache.has(ticker)) {
        cache.set(ticker, await fetchTickerMetadata(ticker));
      }

      const metadata = cache.get(ticker);
      if (!metadata) {
        resultMap.set(name, null);
        invalidNames.push(name);
        continue;
      }

      const validationScore = scoreQuote(metadata, name);
      if (validationScore < 55) {
        resultMap.set(name, null);
        invalidNames.push(name);
      }
    }

    return invalidNames;
  }

  const initial = await requestGemini(buildGeminiBatchPrompt(names));
  if (initial?.rateLimited || !initial) {
    return initial;
  }

  let invalidNames = await validateResults(initial.results);
  const unresolvedNames = names.filter(name => !initial.results.get(name));

  if (!unresolvedNames.length) {
    return initial;
  }

  const retry = await requestGemini(buildCorporateActionPrompt(unresolvedNames));
  if (retry?.rateLimited) {
    return retry;
  }

  if (retry) {
    invalidNames = await validateResults(retry.results);
    for (const name of unresolvedNames) {
      const ticker = retry.results.get(name);
      if (ticker) {
        initial.results.set(name, ticker);
      }
    }
  }

  const stubbornNames = unresolvedNames.filter(name => !initial.results.get(name) && invalidNames.includes(name));
  for (const name of stubbornNames.slice(0, 6)) {
    const singleRetry = await requestGemini(buildCorporateActionPrompt([name]));
    if (!singleRetry || singleRetry.rateLimited) {
      if (singleRetry?.rateLimited) {
        return singleRetry;
      }
      continue;
    }

    const stillInvalid = await validateResults(singleRetry.results);
    if (!stillInvalid.length) {
      const ticker = singleRetry.results.get(name);
      if (ticker) {
        initial.results.set(name, ticker);
      }
    }
  }

  return initial;
}

export async function resolveBatchDetailed(names, apiKey, options = {}) {
  const allowGemini = options.allowGemini !== false;
  const yahooConcurrency = Math.max(1, options.yahooConcurrency || 1);
  const massiveConcurrency = Math.max(1, options.massiveConcurrency || 2);
  const massiveApiKey = process.env.MASSIVE_API_KEY || '';
  const massiveRuntime = massiveApiKey ? createMassiveRuntime(massiveApiKey) : null;
  const orderedNames = names
    .map(name => normalizeWhitespace(name))
    .filter(Boolean);

  const results = {};
  const unresolved = [];
  const yahooResults = await mapWithConcurrency(orderedNames, yahooConcurrency, async name => {
    const yahoo = await tryYahoo(name);
    return { name, yahoo };
  });

  for (const entry of yahooResults) {
    if (entry.yahoo) {
      results[entry.name] = { ticker: entry.yahoo, source: 'Yahoo Finance' };
    } else {
      unresolved.push(entry.name);
    }
  }

  const unresolvedAfterMassive = [];

  if (massiveApiKey && unresolved.length) {
    const massiveResults = await mapWithConcurrency(unresolved, massiveConcurrency, async name => {
      const ticker = await tryMassiveReference(name, massiveRuntime);
      return { name, ticker };
    });

    for (const entry of massiveResults) {
      if (entry.ticker) {
        results[entry.name] = { ticker: entry.ticker, source: 'Massive Reference' };
      } else {
        unresolvedAfterMassive.push(entry.name);
      }
    }
  } else {
    unresolvedAfterMassive.push(...unresolved);
  }

  if (!unresolvedAfterMassive.length) {
    return { results, deferredNames: [], pollAfterMs: 0, rateLimited: false };
  }

  if (!apiKey) {
    for (const name of unresolvedAfterMassive) {
      results[name] = { ticker: 'NEEDS_REVIEW', source: '—' };
    }
    return { results, deferredNames: [], pollAfterMs: 0, rateLimited: false };
  }

  if (!allowGemini) {
    return { results, deferredNames: unresolvedAfterMassive, pollAfterMs: 0, rateLimited: false };
  }

  const gemini = await tryGeminiBatch(unresolvedAfterMassive, apiKey);
  if (gemini?.rateLimited) {
    return {
      results,
      deferredNames: unresolvedAfterMassive,
      pollAfterMs: gemini.retryAfterMs || 30000,
      rateLimited: true
    };
  }

  if (gemini) {
    for (const name of unresolvedAfterMassive) {
      const ticker = gemini.results.get(name);
      if (ticker) {
        results[name] = { ticker, source: gemini.source };
      }
    }
  }

  for (const name of unresolvedAfterMassive) {
    if (!results[name]) {
      results[name] = { ticker: 'NEEDS_REVIEW', source: '—' };
    }
  }

  return { results, deferredNames: [], pollAfterMs: 0, rateLimited: false };
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
