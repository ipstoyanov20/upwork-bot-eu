Puppeteer scraper for EU Calls-for-Proposals

Usage

- Install dependencies:

```bash
npm install
```

- Run with a keyword as argument:

```bash
node puppeteer_scraper.js "climate" 
```

If no argument is provided the script will prompt for a keyword.

What it does

- Opens the EU calls-for-proposals page in a visible Chrome window.
- Finds a search input on the page and types the provided keyword, then presses Enter.
- Extracts proposal details and writes `eu_proposals_extracted.json` in the project root.

Firebase Realtime Database integration

After the scraper finishes it can automatically upload `eu_proposals_extracted.json` to Firebase Realtime Database.

Local JSON export report (summary / budget tables / annexes / downloads)

If you have a Firebase RTDB export JSON in the project root named:

- `upworkbot-790d5-default-rtdb-export (1).json`

You can view a generated report in the Next.js app:

```bash
cd web
npm install
npm run dev
```

Then open `/report` in the web app to see:

- Summary cards
- Budget tables (parsed from proposal `topics[]` rows, e.g. `Budget (EUR) - Year : 2025`)
- Annexes and download links
- One-click CSV/JSON downloads for each table

Setup

1. Install dependencies:

```bash
npm install
```

2. Provide Firebase credentials via environment variables. Create a `.env` file in the project root with one of the following options:

- Using a service account JSON file path:

FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json
FIREBASE_DATABASE_URL=https://<YOUR_PROJECT>.firebaseio.com

- Or embed the service account JSON contents (be careful with secrets):

FIREBASE_SERVICE_ACCOUNT_JSON="{ \"type\": \"service_account\", ... }"
FIREBASE_DATABASE_URL=https://<YOUR_PROJECT>.firebaseio.com

- Or rely on Application Default Credentials (not recommended for local dev).

3. Run the scraper:

```bash
npm run scrape:initial -- "your search keyword"
```

If Firebase env is set, the script will try to upload results to the RTDB path `/eu_proposals` and push a new node with `createdAt`, `sourceFile`, and `data`.

Notes

- Use `FIREBASE_DATABASE_URL` from your Firebase Realtime Database dashboard.
- Protect your service account credentials. Do not commit them to version control.

Auto-detection

- If you place a Firebase service account JSON in the project root (for example `upworkbot-790d5-firebase-adminsdk-fbsvc-f7f940e183.json`), the project will attempt to auto-detect and use it when no `FIREBASE_SERVICE_ACCOUNT_PATH` or `FIREBASE_SERVICE_ACCOUNT_JSON` is provided.
- The code will also try to derive a reasonable `FIREBASE_DATABASE_URL` from the service account `project_id` when `FIREBASE_DATABASE_URL` is not explicitly set; verify the derived URL and update if necessary.
