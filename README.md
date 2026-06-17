# Ticker Symbol Lookup

A browser-based tool to fill in missing stock ticker symbols in a spreadsheet. No server required — all processing happens in the user's browser.

## Deploy to Vercel (free, ~2 minutes)

1. **Create a GitHub account** at github.com if you don't have one
2. **Create a new repository** — click the + icon → "New repository", name it `ticker-app`, set it to Public, click "Create repository"
3. **Upload these files** — click "uploading an existing file", drag in all three files (`public/index.html`, `vercel.json`, `README.md`), click "Commit changes"
4. **Go to vercel.com** — sign up with your GitHub account
5. **Click "Add New Project"** → import your `ticker-app` repository → click **Deploy**
6. Done! Vercel gives you a URL like `ticker-app.vercel.app` to share

## How to use

1. Get a free Gemini API key at aistudio.google.com/app/apikey
2. Open the app URL
3. Enter your Gemini key
4. Upload your spreadsheet (needs `securityName` and `tickerSymbol` columns)
5. Click "Start lookup"
6. Download the enriched spreadsheet

## Notes

- Rows with blank, `?`, or `NEEDS_REVIEW` tickers get looked up
- Always prefers US OTC/Pink Sheets ticker over foreign exchange listings
- `NEEDS_REVIEW` rows in the download are highlighted yellow
- Your spreadsheet never leaves your browser
