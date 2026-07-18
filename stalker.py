"""
Scraper for Clarivate's public "Highly Cited Researchers" directory
(https://clarivate.com/highly-cited-researchers/).

This pulls the publicly listed name / category / institution info for
researchers in a given field, the same data anyone can see by browsing
and filtering the page manually.

Key upgrades over the original version
---------------------------------------
1. Uses a `requests.Session` (keeps cookies, handles gzip, connection
   reuse) instead of raw urllib.
2. Detects bot-protection / challenge pages explicitly and reports them
   clearly, instead of silently returning an empty list. Clarivate's
   site sits behind Cloudflare, and requests without a real browser TLS
   fingerprint are sometimes challenged even with a normal User-Agent.
3. Column mapping is derived from the table's own <thead> (or first
   row's <th>/<td> text) instead of hardcoded index positions. Hardcoded
   indices silently produce wrong data if the site ever reorders or
   adds/drops a column -- reading the header row makes the parsing
   correct regardless of column order.
4. Retries with backoff on transient errors (timeouts, 429, 5xx).
5. CLI flags for category, region, institution, name filter, page range,
   and output file, so you're not editing the script to change a query.
6. Cleaner stopping logic: stops when a page returns no rows OR when
   the same page is returned twice in a row (guards against a site that
   ignores an out-of-range `clv-paged` and just re-serves page 1).

Notes
-----
- If the site returns a Cloudflare "checking your browser" / challenge
  page, plain `requests` cannot solve it (it requires executing JS).
  In that case you have two options:
    a) `pip install cloudscraper` -- this script will use it
       automatically if it's installed and a challenge is detected.
    b) Use a real browser automation tool (Playwright/Selenium) instead
       of raw HTTP requests.
- Please respect the site's robots.txt and terms of use, and keep the
  delay between requests -- this script defaults to 1.5s, configurable
  with --delay.
"""

import argparse
import json
import sys
import time
from urllib.parse import urlencode

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://clarivate.com/highly-cited-researchers/"

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": BASE_URL,
}

CHALLENGE_MARKERS = (
    "just a moment",
    "cf-browser-verification",
    "attention required",
    "cf-chl-",
    "checking your browser",
)


def build_session():
    """Build a requests session, preferring cloudscraper if it's installed
    (it can solve simple Cloudflare JS challenges that plain requests can't)."""
    try:
        import cloudscraper  # type: ignore
        return cloudscraper.create_scraper()
    except ImportError:
        session = requests.Session()
        session.headers.update(DEFAULT_HEADERS)
        return session


def looks_like_challenge(html: str) -> bool:
    lowered = html.lower()
    return any(marker in lowered for marker in CHALLENGE_MARKERS)


def fetch_page(session, page_num, category, institution, region, name,
                max_retries=3, timeout=20):
    """Fetch one page of results and return the raw HTML, or None on failure."""
    params = {
        "action": "clv_hcr_members_filter",
        "clv-paged": page_num,
        "clv-category": category,
        "clv-institution": institution,
        "clv-region": region,
        "clv-name": name,
    }
    url = f"{BASE_URL}?{urlencode(params)}"

    for attempt in range(1, max_retries + 1):
        try:
            resp = session.get(url, timeout=timeout)
        except requests.RequestException as exc:
            print(f"  [page {page_num}] request error (attempt {attempt}): {exc}")
            time.sleep(2 * attempt)
            continue

        if resp.status_code == 429:
            wait = 5 * attempt
            print(f"  [page {page_num}] rate-limited (429), waiting {wait}s...")
            time.sleep(wait)
            continue

        if resp.status_code >= 500:
            print(f"  [page {page_num}] server error {resp.status_code} (attempt {attempt})")
            time.sleep(2 * attempt)
            continue

        if resp.status_code == 403 or looks_like_challenge(resp.text):
            print(
                f"  [page {page_num}] blocked by bot protection (status "
                f"{resp.status_code}). Plain HTTP requests can't get past this "
                f"on their own -- see the notes at the top of this script "
                f"for options (cloudscraper / browser automation)."
            )
            return None

        if not resp.ok:
            print(f"  [page {page_num}] unexpected status {resp.status_code}")
            return None

        return resp.text

    print(f"  [page {page_num}] giving up after {max_retries} attempts")
    return None


def parse_table(html, page_num):
    """Parse the results table using header-derived column positions,
    so the mapping stays correct even if column order changes."""
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", class_="table") or soup.find("table")
    if not table:
        print(f"  [page {page_num}] no table found in response")
        return []

    rows = table.find_all("tr")
    if not rows:
        return []

    # Figure out the header -> column-index mapping.
    header_cells = rows[0].find_all(["th", "td"])
    header_labels = [c.get_text(strip=True).lower() for c in header_cells]

    def find_col(*candidates):
        for cand in candidates:
            for i, label in enumerate(header_labels):
                if cand in label:
                    return i
        return None

    col_name = find_col("name")
    col_category = find_col("category", "field")
    col_primary = find_col("primary affiliation", "primary institution", "institution")
    col_secondary = find_col("secondary affiliation", "secondary institution")

    # Fall back to the original fixed layout only if header detection fails
    # entirely (e.g. the header row itself has no text, just icons).
    used_fallback = col_name is None and col_category is None and col_primary is None
    if used_fallback:
        print(f"  [page {page_num}] couldn't detect column headers -- "
              f"falling back to fixed positions (name=1, category=2, "
              f"primary=3, secondary=4). Verify output carefully.")
        col_name, col_category, col_primary, col_secondary = 1, 2, 3, 4

    data_rows = rows[1:]  # skip header row
    page_data = []
    for row in data_rows:
        cols = row.find_all("td")
        if not cols:
            continue

        def cell(idx):
            if idx is None or idx >= len(cols):
                return ""
            return cols[idx].get_text(strip=True)

        name = cell(col_name)
        category = cell(col_category)
        primary = cell(col_primary)
        secondary = cell(col_secondary)

        if not name:
            continue  # skip malformed / empty rows rather than fabricating data

        country = primary.split(",")[-1].strip() if "," in primary else primary

        page_data.append({
            "name": name,
            "country": country,
            "speciality": "Biotechnology - Biology",
            "category": category,
            "primary_affiliation": primary,
            "secondary_affiliations": secondary,
        })

    return page_data


def scrape(category, institution="", region="", name="", max_pages=10,
           limit=100, delay=1.5):
    session = build_session()
    all_researchers = []
    last_html_hash = None

    for page_num in range(1, max_pages + 1):
        print(f"Scraping page {page_num}...")
        html = fetch_page(session, page_num, category, institution, region, name)

        if html is None:
            print("Stopping: could not retrieve page (see message above).")
            break

        # Guard against a paginated endpoint that silently re-serves the
        # same page when clv-paged is out of range.
        html_hash = hash(html)
        if html_hash == last_html_hash:
            print("Stopping: page content repeated, likely reached the end.")
            break
        last_html_hash = html_hash

        page_results = parse_table(html, page_num)
        if not page_results:
            print("Stopping: no rows found on this page.")
            break

        all_researchers.extend(page_results)

        if limit and len(all_researchers) >= limit:
            all_researchers = all_researchers[:limit]
            break

        time.sleep(delay)  # be a respectful client

    return all_researchers


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--category", default="Biology and Biochemistry",
                         help="Field of research to filter by")
    parser.add_argument("--institution", default="", help="Institution filter")
    parser.add_argument("--region", default="", help="Region filter")
    parser.add_argument("--name", default="", help="Name search filter")
    parser.add_argument("--pages", type=int, default=10, help="Max pages to fetch")
    parser.add_argument("--limit", type=int, default=100,
                         help="Max total researchers to keep (0 = no limit)")
    parser.add_argument("--delay", type=float, default=1.5,
                         help="Seconds to wait between page requests")
    parser.add_argument("--out", default="figures.json", help="Output JSON path")
    args = parser.parse_args()

    results = scrape(
        category=args.category,
        institution=args.institution,
        region=args.region,
        name=args.name,
        max_pages=args.pages,
        limit=args.limit or None,
        delay=args.delay,
    )

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"Successfully scraped {len(results)} researchers and saved to {args.out}.")
    if not results:
        sys.exit(1)


if __name__ == "__main__":
    main()
