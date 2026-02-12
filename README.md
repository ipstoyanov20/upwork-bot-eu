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
- Opens a separate Chrome instance (test browser) and leaves both browsers open.

Notes

- The browsers are launched non-headless and will remain open — press Ctrl+C to exit the script.
- If the script cannot find the search input it will log an error but leave browsers open for inspection.
