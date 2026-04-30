# AGENTS.md

This repository uses a keyboard accessibility audit harness built with Playwright and axe-core.

## Scope

- Main implementation: `src/run-keyboard-audit.js`
- Package docs: `README.md`
- Top-level docs: `README.md`

## Current crawl behavior

- Crawl mode is enabled with `--crawl`.
- Seed URLs are passed via repeated `--url` flags.
- Crawl defaults to same-origin links only.
- Maximum discovered/audited pages is controlled by `--max-pages` (default `20`).
- Use `--include-external` to allow discovered off-origin links.
- Crawl runs in safe mode by default; use `--active-probes` to force interaction probes.
- Non-HTML-like assets (images, PDFs, archives, media, fonts) are skipped during crawl discovery.

## Examples

```bash
npm run test:keyboard -- --url https://example.com --crawl --max-pages 20
npm run test:keyboard -- --url https://example.com --crawl --include-external --max-pages 30
```

## Notes for future changes

- Keep crawl breadth-first to prioritize top-level navigation.
- Keep report output stable (`report.crawl` and per-page data shape).
- Prefer adding flags over changing defaults to avoid breaking existing automation.

