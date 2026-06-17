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
  { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' }
];

const FUND_FAMILY_HINTS = [
  'AMERICAN CENTY', 'BLACKROCK', 'BNY MELLON', 'CHARLES SCHWAB', 'COLUMBIA',
  'DFA', 'DOUBLELINE', 'FMI', 'FPA', 'FRANKLIN', 'GLOBAL X', 'GRANDEUR PEAK',
  'INVESCO', 'ISHARES', 'NUVEEN', 'PROSHARES', 'SCHWAB', 'SPDR', 'USAA',
  'VANGUARD', 'VICTORY', 'WASATCH'
];

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function titleCase(value) {
  return value
    .toLowerCase()
    .replace(/\b\w/g, char => char.toUpperCase());
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

function isFundLikeName(name) {
  const upper = standardizeName(name);

  if (FUND_FAMILY_HINTS.some(hint => upper.startsWith(hint))) {
    return true;
  }

  return /\b(ETF|ETFS|FUND|FUNDS|FDS|INDEX|INCOME|BOND|DIVIDEND|TR|TRUST|TARGET|VALUE|GROWTH|REAL ESTATE)\b/.test(upper);
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
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    return response;
  } finally {
    clearTimeout(timeout);
  }
}

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

function parseGeminiTicker(rawText) {
  if (!rawText) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawText);
    return sanitizeTicker(parsed?.ticker);
  } catch {
    const jsonMatch = rawText.match(/"ticker"\s*:\s*"([^"]+)"/i);
    if (jsonMatch) {
      return sanitizeTicker(jsonMatch[1]);
    }

    const textMatch = rawText.toUpperCase().match(/\b[A-Z][A-Z0-9.-]{0,9}\b/);
    return sanitizeTicker(textMatch ? textMatch[0] : '');
  }
}

async function tryGemini(name, apiKey) {
  const queries = buildSearchQueries(name);
  const cleaned = queries[0] || name;
  const prompt = [
    'Identify the best US-traded ticker symbol for this security name.',
    `Original security name: "${normalizeWhitespace(name)}"`,
    `Cleaned security name: "${cleaned}"`,
    'Rules:',
    '- If there is both a foreign listing and a US OTC ticker, always return the OTC ticker.',
    '- Never return a foreign exchange symbol.',
    '- Prefer a US OTC/Pink Sheets ticker over TSX, TSXV, LSE, ASX, HKEX, and any other non-US exchange.',
    '- Otherwise return the best US-listed stock, ETF, or mutual fund ticker.',
    '- Reject crypto symbols, currency pairs, and foreign suffixes like .TO or .V.',
    '- Example: Arras Minerals Corp -> ARRKF, not ARK.',
    '- If no US-traded ticker exists, return NOT_FOUND.',
    'Respond with JSON only in this exact shape:',
    '{"ticker":"AAPL"}',
    'If unknown, respond with:',
    '{"ticker":"NOT_FOUND"}'
  ].join('\n');

  for (const model of GEMINI_MODELS) {
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
        12000
      );

      if (!response.ok) {
        console.error('Gemini lookup failed', { model: model.id, status: response.status });
        continue;
      }

      const data = await response.json();
      const ticker = parseGeminiTicker(extractGeminiText(data));
      if (ticker) {
        return { ticker, source: model.label };
      }
    } catch (error) {
      console.error('Gemini lookup failed', { model: model.id, error: error?.message });
    }
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name } = req.body || {};
  if (!name) {
    return res.status(400).json({ error: 'Missing name' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    const gemini = await tryGemini(name, apiKey);
    if (gemini) {
      return res.status(200).json(gemini);
    }
  } else {
    console.error('Missing GEMINI_API_KEY');
  }

  if (isFundLikeName(name)) {
    const yahoo = await tryYahoo(name);
    if (yahoo) {
      return res.status(200).json({ ticker: yahoo, source: 'Yahoo Finance' });
    }
  }

  return res.status(200).json({ ticker: 'NEEDS_REVIEW', source: '—' });
}
