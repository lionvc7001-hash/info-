#!/usr/bin/env python3
"""Move older news and articles from the live feeds into archive files.

The feeds are expected to be arrays ordered newest first.  The newest entries
are retained in place; every entry after that limit is appended to its archive.
Existing archive entries are not duplicated (URLs are used as identifiers).
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any


FEEDS = (
    ("news.json", "oldnews.json"),
    ("articles.json", "oldarticles.json"),
)


def read_items(path: Path) -> list[dict[str, Any]]:
    """Return a JSON array, treating a missing or empty archive as empty."""
    if not path.exists() or not path.read_text(encoding="utf-8").strip():
        return []

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"{path} is not valid JSON: {error}") from error

    if not isinstance(data, list):
        raise ValueError(f"{path} must contain a JSON array")
    if not all(isinstance(item, dict) for item in data):
        raise ValueError(f"{path} must contain only JSON objects")
    return data


def write_json_atomically(path: Path, items: list[dict[str, Any]]) -> None:
    """Write without leaving a partially-written JSON file if interrupted."""
    with NamedTemporaryFile("w", encoding="utf-8", dir=path.parent,
                            delete=False) as temporary:
        json.dump(items, temporary, ensure_ascii=False, indent=2)
        temporary.write("\n")
        temporary_path = temporary.name
    os.replace(temporary_path, path)


def archive_feed(feed_path: Path, archive_path: Path, keep: int) -> int:
    current = read_items(feed_path)
    archive = read_items(archive_path)
    retained, older = current[:keep], current[keep:]

    # URL is stable for these feeds.  Fall back to the full object for records
    # without a URL so that malformed data is still handled safely.
    known_urls = {item.get("url") for item in archive if item.get("url")}
    additions = [
        item for item in older
        if not item.get("url") or item["url"] not in known_urls
    ]

    if not older:
        print(f"{feed_path.name}: {len(current)} items; nothing to archive.")
        return 0

    write_json_atomically(archive_path, archive + additions)
    write_json_atomically(feed_path, retained)
    print(
        f"{feed_path.name}: archived {len(additions)} item(s), "
        f"kept {len(retained)}; {archive_path.name} now has "
        f"{len(archive) + len(additions)} item(s)."
    )
    return len(additions)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Archive older entries from news.json and articles.json."
    )
    parser.add_argument(
        "--keep", type=int, default=50,
        help="number of newest entries to retain in each live feed (default: 50)",
    )
    args = parser.parse_args()
    if args.keep < 0:
        parser.error("--keep must be zero or greater")

    root = Path(__file__).resolve().parent
    for feed_name, archive_name in FEEDS:
        archive_feed(root / feed_name, root / archive_name, args.keep)


if __name__ == "__main__":
    main()
