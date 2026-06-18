import { createJob, getJob } from '../lib/jobs.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const filename = String(req.body?.filename || 'holdings.xlsx');
      const fileDataBase64 = String(req.body?.fileDataBase64 || '');

      if (!fileDataBase64) {
        return res.status(400).json({ error: 'Missing fileDataBase64' });
      }

      const fileBuffer = Buffer.from(fileDataBase64, 'base64');
      const job = await createJob({ filename, fileBuffer });
      return res.status(201).json(job);
    }

    if (req.method === 'GET') {
      const jobId = String(req.query?.id || '').trim();
      if (!jobId) {
        return res.status(400).json({ error: 'Missing id' });
      }

      const job = await getJob(jobId, { advance: true });
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      return res.status(200).json(job);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Job API failed', { error: error?.message });
    return res.status(500).json({ error: error?.message || 'Unexpected server error' });
  }
}
