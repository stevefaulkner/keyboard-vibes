# keyboard-vibes
test harness for keyboard tests built using chatgpt. 

**article:** [keyboard testing with the POWER OF AI!](https://html5accessibility.com/stuff/2026/04/29/keyboard-testing-with-the-power-of-ai/)

## NOTE: 

This app/script uses no AI by default, you need to make your own deal with that devil 

>This tool automates keyboard operability testing for web pages using Playwright and axe-core

**This is an experiment only**
I have no idea how accurate it the output is.
Use with extreme caution and awareness. Modify it as you like!

# Keyboard Operability JS – Setup and Usage Guide

## 1. Overview

This tool automates keyboard operability testing for web pages using **Playwright** and **axe-core**.

It evaluates:

- Tab and Shift+Tab focus traversal
- Focus visibility (WCAG 2.4.7)
- Keyboard reachability (WCAG 2.1.1)
- Keyboard traps (WCAG 2.1.2)
- Activation via Enter/Space
- Skip links (WCAG 2.4.1)
- Dialog behaviour (Escape + focus return)
- Focus order heuristics (WCAG 2.4.3)
- axe-core accessibility violations

Activation probing means the runner attempts keyboard activation (Enter/Space)
on focused controls to detect elements that appear interactive but do not respond
to keyboard input.

> This is an automated audit tool — not a full replacement for manual accessibility testing.

---

## 2. Prerequisites

- macOS, Linux, or Windows
- Node.js 24 or later
- Internet connection

Check Node:

```
node -v
npm -v
```

---

## 3. Installation

### Step 1 — Navigate

From the repository root:

```
cd keyboard-vibes
```

---

### Step 2 — Install dependencies

```
npm install
```

---

### Step 3 — Install browsers

```
npm run install:browsers
```

---

## 4. Running

### Basic

```
npm run test:keyboard -- --url https://example.com --headed
```

### Multiple URLs

```
npm run test:keyboard -- \
  --url https://example.com \
  --url https://www.gov.uk
```

### Options

- `--max-tabs 200`
- `--output-dir reports-custom`
- `--headed`
- `--crawl`
- `--max-pages 50`
- `--include-external`
- `--same-domain`
- `--same-host-family`
- `--safe-mode`
- `--active-probes`

### Crawl a site (seed URLs -> discover links -> test discovered pages)

The crawl mode starts from one or more `--url` seed pages, discovers links,
and audits those discovered pages too.

Default crawl behavior:

- Breadth-first discovery from the seed pages
- Same-origin links only (unless `--include-external` is used)
- Use `--same-domain` to include seed-domain subdomains while excluding unrelated domains
- Use `--same-host-family` to keep only the seed host plus its `www`/non-`www` pair
- Non-HTML-like assets (images, PDFs, archives, fonts, media) are skipped
- Maximum discovered pages controlled by `--max-pages` (default `20`)
- Safe mode is automatically enabled during crawl

Examples:

```bash
# Crawl and audit up to 20 pages on the same origin (safe mode auto-enabled)
npm run test:keyboard -- --url https://example.com --crawl --max-pages 20

# Use multiple seed pages to improve coverage of major sections
npm run test:keyboard -- \
  --url https://example.com \
  --url https://example.com/docs \
  --url https://example.com/blog \
  --crawl --max-pages 60

# Include discovered off-origin links (for federated docs or partner properties)
npm run test:keyboard -- --url https://example.com --crawl --include-external --max-pages 40

# Keep crawl within seed domain and subdomains only (for example, va.gov + www.va.gov)
npm run test:keyboard -- --url https://va.gov --crawl --same-domain --max-pages 30

# Keep crawl to only seed host family (for example, va.gov and www.va.gov)
npm run test:keyboard -- --url https://va.gov --crawl --same-host-family --max-pages 30

# Force active probes during crawl (higher risk on production flows)
npm run test:keyboard -- --url https://example.com --crawl --active-probes --max-pages 20
```

Safe mode notes:

- `--safe-mode` disables active interaction probes (activation, skip-link activation,
  dialog open/close checks)
- Crawl mode enables safe mode by default unless `--active-probes` is set
- For production sites, prefer safe mode to reduce side effects

---

## 5. Output

Reports are generated in:

```
/reports/
```

When crawl is used and `--output-dir` is omitted, reports default to a domain folder:

- `reports/<seed-host>-<max-pages>/`
- Example: `reports/va.gov-30/`

Suggested structure for repeated runs:

- `reports/` for normal audits
- `reports/smoke/` for smoke test runs
- `reports/smoke/safe/` for safe-mode smoke test runs

Includes:

- JSON report
- Markdown report

---

## 6. What the Tool Detects

### Keyboard Reachability (WCAG 2.1.1)
Elements not reachable via keyboard.

### Focus Visibility (WCAG 2.4.7)
Missing visible focus indicators.

### Keyboard Trap (WCAG 2.1.2)
Focus loops.

### Activation Issues
Enter/Space failures.

### Skip Links (WCAG 2.4.1)
Incorrect behaviour.

### Dialog Behaviour
Escape + focus return.

### Focus Order (WCAG 2.4.3)
Visual vs DOM mismatch.

---

## 7. Common Errors

### Cannot find module 'playwright'
```
npm install
```

### Browser not launching
```
npm run install:browsers
```

### Synced folder issues
If browser automation is unstable inside synced folders (OneDrive, iCloud, Dropbox),
move the project to a normal local development path and run again.

---

## 8. Workflow

1. Run tool
2. Review report
3. Fix issues
4. Re-run

Suggested crawl workflow:

1. Start with 2 to 5 representative seed URLs
2. Run crawl with a moderate limit (`--max-pages 20` to `--max-pages 60`)
3. Review severe issues first across discovered pages
4. Increase max pages or add seeds to cover missed site sections

---

## 9. Limitations

- Not a replacement for manual testing
- No screen reader validation
- Limited ARIA validation

---

## 10. Extensions

- CI integration
- visual focus maps
- regression tracking

---

## 11. Accessibility Resources

- Project-specific reporting guide: `ACCESSIBILITY.md`
- Accessibility reference: https://mgifford.github.io/ACCESSIBILITY.md/
- Accessibility bug reporting best practices:
  https://mgifford.github.io/ACCESSIBILITY.md/examples/ACCESSIBILITY_BUG_REPORTING_BEST_PRACTICES.html

### Reporting process (recommended)

When filing issues from this audit output, include:

- Exact URL where the problem occurs
- Severity and WCAG mapping from the report
- Selector and issue type from the report
- Keyboard-only reproduction steps (Tab, Shift+Tab, Enter, Space, Escape)
- Expected behavior vs actual behavior
- Suggested remediation from the "Recommended action" column
- Browser/OS and assistive technology context if relevant

Use the bug-reporting best-practices page above to keep reports actionable,
consistent, and easy for engineering teams to triage.
