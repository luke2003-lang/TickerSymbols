const FOREIGN = new Set(['TSXV','TSX','CVE','LSE','ASX','HKSE','TYO','FRA','AMS','MCX','NSE','BSE','BOM','STO','HEL','OSL','NZX','JSE']);
const US_PREF = ['PNK','OTC','PINK','OTCBB','NYSE','NMS','NGM','NCM','BATS','ARCA','NASDAQ'];

function otcRank(exchange) {
  const ex = (exchange || '').toUpperCase();
  const i = US_PREF.findIndex(p => ex.includes(p));
  return i === -1 ? 99 : i;
}

async function tryYahoo(name) {
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(name)}&quotesCount=10&newsCount=0`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!r.ok) return null;
    const data = await r.json();
    const quotes = (data.quotes || []).filter(q => {
      const ex = (q.exchange || '').toUpperCase();
      return !FOREIGN.has(ex) && q.symbol;
    });
    if (!quotes.length) return null;
    quotes.sort((a, b) => otcRank(a.exchange) - otcRank(b.exchange));
    return quotes[0].symbol;
  } catch { return null; }
}

async function tryGemini(name, apiKey) {
  try {
    const prompt = `What is the US stock ticker symbol for: "${name}"? Prefer OTC/Pink Sheets over NYSE/NASDAQ. Ignore all foreign exchange listings (TSX, LSE, ASX, etc). If it's a mutual fund return the fund ticker. If unknown or only foreign-listed, return NOT_FOUND. Reply with ONLY the ticker or NOT_FOUND.`;
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );
    if (!r.ok) return null;
    const data = await r.json();
    const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim().toUpperCase();
    if (!text || text === 'NOT_FOUND') return null;
    const match = text.match(/\b([A-Z]{1,6})\b/);
    return match ? match[1] : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Missing name' });
  }

  // Try Yahoo Finance first (no key needed)
  const yahoo = await tryYahoo(name);
  if (yahoo) {
    return res.status(200).json({ ticker: yahoo, source: 'Yahoo Finance' });
  }

  // Fall back to Gemini
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    const gemini = await tryGemini(name, apiKey);
    if (gemini) {
      return res.status(200).json({ ticker: gemini, source: 'Gemini AI' });
    }
  }

  return res.status(200).json({ ticker: 'NEEDS_REVIEW', source: '—' });
}
