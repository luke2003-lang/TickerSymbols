# Ticker Symbols

Server-side spreadsheet enrichment for missing US ticker symbols.

The resolver is designed to return the current tradable US ticker. If a company has renamed itself or changed tickers, the app returns the active ticker in use today rather than an older historical symbol.

The app now uses a job flow instead of resolving everything live in the browser:

1. Upload a workbook with `securityName` and `tickerSymbol` columns.
2. The server creates a job and stores the workbook.
3. Each status poll advances the job through a chunk of unresolved names.
4. Yahoo handles easy cases first.
5. Gemini is only used for unresolved leftovers, with OTC symbols preferred over foreign listings.
6. When the job completes, the app downloads a finished workbook.

## Required Vercel setup

Set these before deploying:

- `GEMINI_API_KEY`
- A Vercel Blob store connected to the project so `BLOB_READ_WRITE_TOKEN` is available

Without Blob, the deployed app cannot persist jobs across requests. Local development falls back to `.tmp/jobs`.

## Local development

```bash
npm install
vercel dev
```

## Notes

- Rows with blank, `?`, or `NEEDS_REVIEW` tickers are candidates for lookup.
- The app returns the current tradable US ticker, including for renamed companies and recent ticker changes.
- The app always prefers a US OTC ticker over a foreign exchange symbol.
- `NEEDS_REVIEW` cells are highlighted yellow in the output workbook.
- If Gemini rate-limits, the job cools down and retries later instead of immediately marking the remaining names as unresolved.
