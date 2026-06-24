import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import { get, put } from '@vercel/blob';

import { resolveBatchDetailed } from './lookup.js';
import { buildEnrichedWorkbook, parseWorkbookSummary } from './workbook.js';

const JOB_CHUNK_SIZE = 60;
const GEMINI_TAIL_CHUNK_SIZE = 8;
const GEMINI_RETRY_CHUNK_SIZE = 4;
const DEFAULT_POLL_AFTER_MS = 900;
const RATE_LIMIT_POLL_FLOOR_MS = 15000;
const YAHOO_CONCURRENCY = 8;
const MAX_RECENT_RESULTS = 40;
const LOCAL_DATA_ROOT = path.join(process.cwd(), '.tmp', 'jobs');

function nowIso() {
  return new Date().toISOString();
}

function sanitizeFilename(filename) {
  return String(filename || 'holdings.xlsx')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'holdings.xlsx';
}

function hasBlobStore() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID));
}

function assertStorageConfigured() {
  if (!hasBlobStore() && process.env.VERCEL) {
    throw new Error('Vercel Blob is not configured for this project');
  }
}

function statePath(jobId) {
  return `jobs/${jobId}/state.json`;
}

function inputPath(jobId, filename) {
  return `jobs/${jobId}/input/${sanitizeFilename(filename)}`;
}

function outputPath(jobId) {
  return `jobs/${jobId}/output/Ticker_Enriched.xlsx`;
}

function localPathFromBlobPath(blobPath) {
  return path.join(LOCAL_DATA_ROOT, ...blobPath.split('/'));
}

async function ensureLocalDirectory(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function putBytes(blobPath, bytes, contentType) {
  assertStorageConfigured();

  if (hasBlobStore()) {
    await put(blobPath, bytes, {
      access: 'private',
      allowOverwrite: true,
      contentType
    });
    return;
  }

  const filePath = localPathFromBlobPath(blobPath);
  await ensureLocalDirectory(filePath);
  await fs.writeFile(filePath, bytes);
}

async function putJson(blobPath, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2), 'utf8');
  await putBytes(blobPath, bytes, 'application/json; charset=utf-8');
}

async function getBytes(blobPath) {
  assertStorageConfigured();

  if (hasBlobStore()) {
    const response = await get(blobPath, { access: 'private' });
    if (!response || response.statusCode !== 200 || !response.stream) {
      return null;
    }

    const buffer = Buffer.from(await new Response(response.stream).arrayBuffer());
    return buffer;
  }

  try {
    return await fs.readFile(localPathFromBlobPath(blobPath));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function getJson(blobPath) {
  const bytes = await getBytes(blobPath);
  if (!bytes) {
    return null;
  }

  return JSON.parse(Buffer.from(bytes).toString('utf8'));
}

function trimRecentResults(results) {
  return results.slice(0, MAX_RECENT_RESULTS);
}

function formatJobMessage(state) {
  if (state.error) {
    return state.error;
  }

  if (state.status === 'complete') {
    return `Finished ${state.progress.processedNames} of ${state.counts.uniqueNames} names.`;
  }

  if (state.geminiCooldownUntil) {
    return `Gemini cooling down while Yahoo keeps processing the rest of the sheet.`;
  }

  if (state.lastProcessedName) {
    return `Last processed: ${state.lastProcessedName}`;
  }

  return 'Queued for processing.';
}

function summarizeJob(state) {
  return {
    id: state.id,
    filename: state.filename,
    status: state.status,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    counts: state.counts,
    progress: state.progress,
    recentResults: state.recentResults,
    pendingNames: state.pendingNames.length,
    resultReady: Boolean(state.resultPath),
    pollAfterMs: state.pollAfterMs,
    message: formatJobMessage(state),
    error: state.error
  };
}

function getDeferredAttempts(state, name) {
  return state.deferredAttemptsByName?.[name] || 0;
}

function getChunkSize(state) {
  const sample = state.pendingNames.slice(0, JOB_CHUNK_SIZE);
  if (!sample.length) {
    return JOB_CHUNK_SIZE;
  }

  const everyNameDeferredBefore = sample.every(name => getDeferredAttempts(state, name) > 0);
  if (!everyNameDeferredBefore) {
    return JOB_CHUNK_SIZE;
  }

  const maxAttempts = Math.max(...sample.map(name => getDeferredAttempts(state, name)));
  return maxAttempts >= 3 ? GEMINI_RETRY_CHUNK_SIZE : GEMINI_TAIL_CHUNK_SIZE;
}

async function saveState(state) {
  state.updatedAt = nowIso();
  await putJson(statePath(state.id), state);
  return state;
}

async function loadState(jobId) {
  return getJson(statePath(jobId));
}

async function finalizeJob(state) {
  const originalWorkbook = await getBytes(state.inputPath);
  if (!originalWorkbook) {
    throw new Error('Original workbook could not be loaded for final output');
  }

  const outputBuffer = buildEnrichedWorkbook(originalWorkbook, state.resultsByName);
  const resultPath = outputPath(state.id);
  await putBytes(resultPath, outputBuffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  state.resultPath = resultPath;
  state.status = 'complete';
  state.pollAfterMs = 0;
  state.cooldownUntil = null;
  await saveState(state);
  return state;
}

export async function createJob({ filename, fileBuffer }) {
  if (!fileBuffer?.length) {
    throw new Error('Missing spreadsheet file');
  }

  const summary = parseWorkbookSummary(fileBuffer);
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const storedInputPath = inputPath(id, filename);

  await putBytes(storedInputPath, fileBuffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  const state = {
    id,
    filename: sanitizeFilename(filename),
    status: 'queued',
    createdAt,
    updatedAt: createdAt,
    inputPath: storedInputPath,
    resultPath: null,
    counts: {
      totalRows: summary.totalRows,
      lookupRows: summary.lookupRows,
      existingRows: summary.existingRows,
      uniqueNames: summary.uniqueNames.length
    },
    progress: {
      processedNames: 0,
      foundNames: 0,
      reviewNames: 0
    },
    pendingNames: summary.uniqueNames,
    deferredAttemptsByName: {},
    resultsByName: {},
    recentResults: [],
    lastProcessedName: null,
    geminiCooldownUntil: null,
    pollAfterMs: DEFAULT_POLL_AFTER_MS,
    error: null
  };

  await saveState(state);
  return summarizeJob(state);
}

export async function getJob(jobId, { advance = false } = {}) {
  const state = await loadState(jobId);
  if (!state) {
    return null;
  }

  if (!advance || state.status === 'complete' || state.status === 'failed') {
    return summarizeJob(state);
  }

  const nextState = await advanceJobState(state);
  return summarizeJob(nextState);
}

async function advanceJobState(state) {
  if (state.status === 'complete' || state.status === 'failed') {
    return state;
  }

  state.deferredAttemptsByName = state.deferredAttemptsByName || {};

  const now = Date.now();
  const geminiCooldownTime = state.geminiCooldownUntil ? Date.parse(state.geminiCooldownUntil) : 0;
  const geminiReady = !geminiCooldownTime || now >= geminiCooldownTime;

  if (!state.pendingNames.length) {
    return finalizeJob(state);
  }

  state.status = 'running';
  if (geminiReady) {
    state.geminiCooldownUntil = null;
  }

  const chunkSize = getChunkSize(state);
  const chunk = state.pendingNames.slice(0, chunkSize);
  const apiKey = process.env.GEMINI_API_KEY || '';
  const lookup = await resolveBatchDetailed(chunk, apiKey, {
    allowGemini: geminiReady,
    yahooConcurrency: YAHOO_CONCURRENCY
  });
  const deferredSet = new Set(lookup.deferredNames);
  const stillPending = state.pendingNames.slice(chunk.length);

  for (const name of chunk) {
    if (deferredSet.has(name)) {
      continue;
    }

    const match = lookup.results[name] || { ticker: 'NEEDS_REVIEW', source: '—' };
    state.resultsByName[name] = match;
    delete state.deferredAttemptsByName[name];
    state.progress.processedNames += 1;

    if (match.ticker === 'NEEDS_REVIEW') {
      state.progress.reviewNames += 1;
    } else {
      state.progress.foundNames += 1;
    }

    state.lastProcessedName = name;
    state.recentResults = trimRecentResults([
      { name, ticker: match.ticker, source: match.source },
      ...state.recentResults
    ]);
  }

  for (const name of lookup.deferredNames) {
    state.deferredAttemptsByName[name] = getDeferredAttempts(state, name) + 1;
  }

  state.pendingNames = stillPending.concat(lookup.deferredNames);

  if (lookup.rateLimited) {
    const pollAfterMs = Math.max(lookup.pollAfterMs || RATE_LIMIT_POLL_FLOOR_MS, RATE_LIMIT_POLL_FLOOR_MS);
    state.geminiCooldownUntil = new Date(Date.now() + pollAfterMs).toISOString();
  }

  const remainingCooldownMs = state.geminiCooldownUntil
    ? Math.max(Date.parse(state.geminiCooldownUntil) - Date.now(), 0)
    : 0;

  if (state.pendingNames.length && remainingCooldownMs && !stillPending.length) {
    state.pollAfterMs = Math.max(remainingCooldownMs, 1000);
  } else {
    state.pollAfterMs = DEFAULT_POLL_AFTER_MS;
  }

  if (!state.pendingNames.length) {
    return finalizeJob(state);
  }

  return saveState(state);
}

export async function getJobResult(jobId) {
  const state = await loadState(jobId);
  if (!state || !state.resultPath) {
    return null;
  }

  const buffer = await getBytes(state.resultPath);
  if (!buffer) {
    return null;
  }

  return {
    buffer,
    filename: `Ticker_Enriched_${sanitizeFilename(state.filename)}`
  };
}
