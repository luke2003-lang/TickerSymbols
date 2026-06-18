import { normalizeWhitespace, resolveBatch, resolveName } from '../lib/lookup.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  const apiKey = process.env.GEMINI_API_KEY || '';

  if (Array.isArray(body.names)) {
    const names = body.names
      .map(name => normalizeWhitespace(name))
      .filter(Boolean);

    if (!names.length) {
      return res.status(400).json({ error: 'Missing names' });
    }

    const results = await resolveBatch(names, apiKey);
    return res.status(200).json({ results });
  }

  const name = normalizeWhitespace(body.name);
  if (!name) {
    return res.status(400).json({ error: 'Missing name' });
  }

  const result = await resolveName(name, apiKey);
  return res.status(200).json(result);
}
