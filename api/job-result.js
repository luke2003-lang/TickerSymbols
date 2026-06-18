import { getJobResult } from '../lib/jobs.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const jobId = String(req.query?.id || '').trim();
    if (!jobId) {
      return res.status(400).json({ error: 'Missing id' });
    }

    const result = await getJobResult(jobId);
    if (!result) {
      return res.status(404).json({ error: 'Result not ready' });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.status(200).send(result.buffer);
  } catch (error) {
    console.error('Job result API failed', { error: error?.message });
    return res.status(500).json({ error: error?.message || 'Unexpected server error' });
  }
}
