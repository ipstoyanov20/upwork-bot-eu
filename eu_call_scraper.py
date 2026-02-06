#!/usr/bin/env python3
"""
EU Calls Scraper using Playwright and MySQL

- Opens the EU Funding & Tenders opportunities page
- Types the term `HEALTH` into the main search box
- Scrapes visible result entries (title, reference/call id, start date, deadline date, programme, link)
- Temporarily stores results in a Python list and writes `scraped_results.json`
- Connects to local MySQL and inserts each record into a table (creates DB/table if needed)

Requirements:
- pip install playwright mysql-connector-python
- python -m playwright install

Run:
python eu_call_scraper.py

"""

import os
import re
import json
import time
import logging
from datetime import datetime
from typing import List, Dict, Optional

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
import mysql.connector
from mysql.connector import errorcode

# --- Configuration (use env vars when possible) ---
DB_HOST = os.environ.get("DB_HOST", "127.0.0.1")
DB_USER = os.environ.get("DB_USER", "root")
DB_PASS = os.environ.get("DB_PASS", "")
DB_NAME = os.environ.get("DB_NAME", "eu_calls")
DB_TABLE = os.environ.get("DB_TABLE", "calls")

START_URL = (
    "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/"
    "calls-for-proposals?isExactMatch=true&status=31094501,31094502,31094503&order=DESC&"
    "pageNumber=1&pageSize=50&sortBy=startDate"
)
SEARCH_TERM = "HEALTH"
JSON_DUMP_FILE = "scraped_results.json"

# --- Logging ---
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# Launch mode: set to False to open a real/visible browser window.
# Can be overridden with environment vars: HEADLESS=1 or USE_CHROME_CHANNEL=1
HEADLESS = os.environ.get("HEADLESS", "0").lower() not in ("0", "false", "no")
USE_CHROME_CHANNEL = os.environ.get("USE_CHROME_CHANNEL", "0").lower() in ("1", "true", "yes")

# --- Helpers: parsing and locating ---

def find_search_input(page):
    """Try several reasonable selectors to find the main search input.
    Returns a Playwright locator or raises RuntimeError if none found.
    """
    selectors = [
        'input[placeholder*=Search]',
        'input[type=search]',
        'input[aria-label*=Search]',
        'input[id*=search]',
        'input[name*=search]',
        'input[placeholder*=keyword]',
        'input[name=keyword]'
    ]
    for sel in selectors:
        try:
            locator = page.locator(sel)
            if locator.count() > 0:
                # pick first visible one
                for i in range(locator.count()):
                    loc = locator.nth(i)
                    try:
                        if loc.is_visible():
                            logger.debug(f"Found search input using selector: {sel}")
                            return loc
                    except Exception:
                        continue
        except Exception:
            continue
    # As a last fallback, try the first input on the page that is visible
    try:
        inputs = page.query_selector_all('input')
        for inp in inputs:
            try:
                if inp.is_visible():
                    logger.debug("Falling back to first visible input element.")
                    return inp
            except Exception:
                continue
    except Exception:
        pass
    raise RuntimeError("Could not locate the search input field on the page")


def parse_date(text: str) -> Optional[str]:
    """Try multiple date formats and return ISO date string YYYY-MM-DD if possible.
    If parsing fails, return None.
    """
    if not text:
        return None
    text = text.strip()
    # common date patterns
    patterns = [
        (r"(\d{2}/\d{2}/\d{4})", ["%d/%m/%Y"]),
        (r"(\d{4}-\d{2}-\d{2})", ["%Y-%m-%d"]),
        # e.g. 1 January 2025 or 01 January 2025
        (r"(\d{1,2}\s+\w+\s+\d{4})", ["%d %B %Y", "%d %b %Y"]),
        # Month name then year (take first day)
        (r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}", ["%B %Y"]),
    ]
    # attempt to directly parse with dateutil if available
    try:
        from dateutil import parser as dateutil_parser

        dt = dateutil_parser.parse(text, dayfirst=True)
        return dt.date().isoformat()
    except Exception:
        pass

    for pat, fmts in patterns:
        m = re.search(pat, text, flags=re.IGNORECASE)
        if m:
            s = m.group(1)
            for fmt in fmts:
                try:
                    # If pattern was 'Month Year' and format is '%B %Y', set day to 1
                    if fmt == "%B %Y":
                        dt = datetime.strptime(s, fmt)
                        return datetime(dt.year, dt.month, 1).date().isoformat()
                    dt = datetime.strptime(s, fmt)
                    return dt.date().isoformat()
                except Exception:
                    continue
    # attempt to find any 4-digit year and build a date with Jan 1
    m = re.search(r"(\d{4})", text)
    if m:
        try:
            y = int(m.group(1))
            return datetime(y, 1, 1).date().isoformat()
        except Exception:
            pass
    return None


def extract_fields_from_container(text: str) -> Dict[str, Optional[str]]:
    """Extract Title is handled separately; this extracts reference, start_date, deadline_date, programme from the block text."""
    out = {"reference": None, "start_date": None, "deadline_date": None, "programme": None}
    if not text:
        return out
    # Normalize whitespace and split lines
    t = re.sub(r"\s+", " ", text)
    # Reference detection
    ref_match = re.search(r"(?:Ref(?:erence)?|Call\s*ID|Call identifier|Reference\s*ID)[:\s-]*([A-Z0-9\-/]+)", t, flags=re.IGNORECASE)
    if ref_match:
        out["reference"] = ref_match.group(1).strip()
    else:
        # fallback: sometimes reference appears as "ID: 2021..." or a colon followed by an alnum code
        alt = re.search(r"\bID[:\s]*([A-Z0-9\-\/]{4,})\b", t, flags=re.IGNORECASE)
        if alt:
            out["reference"] = alt.group(1).strip()

    # Dates: try to locate explicit start and deadline by keywords
    start_match = re.search(r"start(?:ing)?\s*date[:\s]*([\w\d ,\-/]+)", t, flags=re.IGNORECASE)
    deadline_match = re.search(r"(deadline|closing date)[:\s]*([\w\d ,\-/]+)", t, flags=re.IGNORECASE)
    if start_match:
        out["start_date"] = parse_date(start_match.group(1))
    if deadline_match:
        out["deadline_date"] = parse_date(deadline_match.group(2))

    # If not found, gather all date-like fragments and heuristically assign
    if not out["start_date"] or not out["deadline_date"]:
        # find all date-like fragments
        date_candidates = re.findall(r"\d{1,2}/\d{1,2}/\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+\w+\s+\d{4}|\w+\s+\d{4}", t)
        parsed = [parse_date(dc) for dc in date_candidates]
        parsed = [p for p in parsed if p]
        if parsed:
            if not out["start_date"]:
                out["start_date"] = parsed[0]
            if len(parsed) > 1 and not out["deadline_date"]:
                out["deadline_date"] = parsed[1]

    # Programme extraction
    prog_match = re.search(r"Programme[:\s]*([\w\s\-&,()\/]+)(?:\.|$)", t, flags=re.IGNORECASE)
    if prog_match:
        out["programme"] = prog_match.group(1).strip()
    else:
        # sometimes 'Programme' may be uppercase in a line - try to extract the word after Programme label
        lines = [ln.strip() for ln in t.split('\n') if ln.strip()]
        for ln in lines:
            if ln.lower().startswith('programme'):
                parts = ln.split(':', 1)
                if len(parts) > 1:
                    out['programme'] = parts[1].strip()
                    break
    return out


# --- Database helpers ---

def get_db_connection(create_db_if_missing=True):
    """Return a mysql.connector connection. Create database if it doesn't exist (optionally)."""
    try:
        # connect without database first to possibly create it
        conn = mysql.connector.connect(host=DB_HOST, user=DB_USER, password=DB_PASS)
        cursor = conn.cursor()
        if create_db_if_missing:
            try:
                cursor.execute(f"CREATE DATABASE IF NOT EXISTS `{DB_NAME}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
                logger.info(f"Ensured database `{DB_NAME}` exists.")
            except mysql.connector.Error as err:
                logger.exception("Failed creating database: %s", err)
                raise
        cursor.close()
        conn.close()
        # now connect to the database
        conn = mysql.connector.connect(host=DB_HOST, user=DB_USER, password=DB_PASS, database=DB_NAME, charset='utf8mb4')
        return conn
    except mysql.connector.Error as err:
        logger.exception("MySQL connection error: %s", err)
        raise


def ensure_table_exists(conn):
    """Create the target table if it does not exist."""
    create_table_sql = f"""
    CREATE TABLE IF NOT EXISTS `{DB_TABLE}` (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title TEXT,
      reference VARCHAR(255),
      start_date DATE,
      deadline_date DATE,
      programme VARCHAR(255),
      link TEXT,
      scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """
    cursor = conn.cursor()
    try:
        cursor.execute(create_table_sql)
        conn.commit()
        logger.info(f"Ensured table `{DB_TABLE}` exists in database `{DB_NAME}`.")
    finally:
        cursor.close()


def insert_call_record(conn, record: Dict):
    """Insert a single scraped call record into the DB."""
    sql = f"INSERT INTO `{DB_TABLE}` (title, reference, start_date, deadline_date, programme, link) VALUES (%s,%s,%s,%s,%s,%s)"
    vals = (
        record.get('title'),
        record.get('reference'),
        record.get('start_date'),
        record.get('deadline_date'),
        record.get('programme'),
        record.get('link'),
    )
    cursor = conn.cursor()
    try:
        cursor.execute(sql, vals)
        conn.commit()
        return cursor.lastrowid
    except mysql.connector.Error:
        logger.exception('Failed to insert record: %s', record)
        conn.rollback()
        raise
    finally:
        cursor.close()


# --- Main scraping logic ---

def scrape_and_store():
    results: List[Dict] = []

    with sync_playwright() as pw:
        launch_args = {"headless": HEADLESS}
        # when running headed, slow down a bit for visibility
        if not HEADLESS:
            launch_args["slow_mo"] = 50
        if USE_CHROME_CHANNEL:
            launch_args["channel"] = "chrome"
        browser = pw.chromium.launch(**launch_args)
        context = browser.new_context()
        page = context.new_page()
        try:
            logger.info(f"Navigating to {START_URL}")
            page.goto(START_URL, timeout=30000)

            # wait for network to be mostly idle and a reasonable main element to appear
            try:
                page.wait_for_load_state('networkidle', timeout=20000)
            except PlaywrightTimeoutError:
                logger.debug('Network idle wait timed out, continuing anyway')

            # find the main search input and type the term
            try:
                search_input = find_search_input(page)
                # clear any existing text, focus and type
                try:
                    search_input.fill('')
                except Exception:
                    pass
                search_input.click()
                search_input.type(SEARCH_TERM, delay=100)
                # press Enter to trigger search
                try:
                    search_input.press('Enter')
                except Exception:
                    # fallback: click a search button if exists
                    try:
                        btn = page.locator('button:has-text("Search")')
                        if btn.count() > 0:
                            btn.first.click()
                    except Exception:
                        pass
            except RuntimeError as e:
                logger.exception('Search input not found: %s', e)
                # continue to try to scrape visible results from the page as-is

            # Wait for results to appear: look for links to call details
            try:
                page.wait_for_selector('a[href*="/call-details"]', timeout=20000)
            except PlaywrightTimeoutError:
                logger.info('No explicit call-details links detected with selector, will try broader selectors')

            # Gather anchors that likely point to detailed calls
            anchors = page.query_selector_all('a[href*="/call-details"]')
            if not anchors:
                # fallback: find anchors under opportunity/results containers
                anchors = page.query_selector_all('a')
                # filter those that contain expected path fragments
                anchors = [a for a in anchors if a.get_attribute('href') and ('/opportunities' in a.get_attribute('href') or '/call' in a.get_attribute('href'))]

            logger.info(f'Found {len(anchors)} candidate anchors for detailed calls')

            seen_links = set()
            for a in anchors:
                try:
                    href = a.get_attribute('href')
                    if not href:
                        continue
                    # normalize absolute URL
                    if href.startswith('/'):
                        href = 'https://ec.europa.eu' + href
                    if href in seen_links:
                        continue
                    seen_links.add(href)

                    # extract title from the anchor text
                    title = (a.text_content() or '').strip()

                    # get surrounding container text to parse other fields
                    container_text = a.evaluate('el => { const c = el.closest("li, tr, div, article, section"); return c ? c.innerText : el.parentElement.innerText; }')

                    parsed = extract_fields_from_container(container_text or '')

                    record = {
                        'title': title if title else None,
                        'reference': parsed.get('reference'),
                        'start_date': parsed.get('start_date'),
                        'deadline_date': parsed.get('deadline_date'),
                        'programme': parsed.get('programme'),
                        'link': href,
                    }
                    logger.debug('Scraped record: %s', record)
                    results.append(record)
                except Exception:
                    logger.exception('Error while processing an anchor element')

            logger.info(f'Scraped {len(results)} records in total')

        finally:
            try:
                context.close()
                browser.close()
            except Exception:
                pass

    # Save to temporary JSON list
    try:
        with open(JSON_DUMP_FILE, 'w', encoding='utf-8') as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        logger.info(f'Wrote temporary JSON snapshot to {JSON_DUMP_FILE}')
    except Exception:
        logger.exception('Failed to write JSON snapshot')

    # Store into MySQL database
    if not results:
        logger.info('No results to insert into database.')
        return

    try:
        conn = get_db_connection(create_db_if_missing=True)
        ensure_table_exists(conn)
        inserted = 0
        for rec in results:
            try:
                insert_call_record(conn, rec)
                inserted += 1
            except Exception:
                logger.exception('Failed to insert a record; continuing with others')
        logger.info(f'Inserted {inserted}/{len(results)} records into `{DB_NAME}.{DB_TABLE}`')
    except Exception:
        logger.exception('Database operations failed')
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


if __name__ == '__main__':
    try:
        scrape_and_store()
    except Exception:
        logger.exception('Fatal error in scraping process')
        raise
