# keyboard-vibes
test harness for keyboard tests built using chatgpt. 

**article:** [keyboard testing with the POWER OF AI!](https://html5accessibility.com/stuff/2026/04/29/keyboard-testing-with-the-power-of-ai/)

## NOTE: 

This app/script uses no AI by default, you need to make your own deal with that devil 

>This tool automates keyboard operability testing for web pages using Playwright and axe-core

**This is an experiment only**
I have no idea how accurate it the output is.
Use with extreme caution and awareness. Modify it as you like!


# Keyboard Operability JS Pro Responsive v1.4

A Windows-friendly keyboard operability audit harness using **Playwright** and **axe-core**.

The tool audits web pages for keyboard operability issues, captures evidence, and produces JSON, Markdown, and HTML dashboard reports. Version 1.4 adds a more conservative, direction-aware, scroll-aware focus-order heuristic.

---

## What this tool tests

The harness collects automated evidence for:

- Tab and Shift+Tab traversal
- visible focus indicators
- keyboard reachability
- possible keyboard traps
- Enter/Space activation on relevant controls
- native HTML dialog activation
- dialog Escape/focus-return behaviour
- skip-link behaviour
- focus-order heuristics
- focus-obscured heuristics
- axe-core accessibility rules
- responsive viewport and zoom differences

It is designed to support accessibility triage and regression testing. It does **not** replace expert WCAG review.

---

## Key features

- Responsive testing across viewport sizes and zoom levels
- WCAG-oriented issue mapping
- Human-readable axe-core findings
- JSON, Markdown, and HTML dashboard output
- Focus-order tables
- Container-scoped focus screenshots
- Optional numbered focus-order visualisation
- Direction-aware focus-order heuristic
- RTL-aware visual-order handling
- Scroll-aware focus-order heuristic
- Relative focus-order thresholds instead of fixed pixel thresholds
- CI-ready exit codes
- GitHub Actions workflow included

---

## Version 1.4 changes

### Focus-order heuristic improvements

Version 1.4 updates the visual focus-order heuristic to reduce false positives.

The heuristic now:

- allows upward-only focus movement
- flags backwards visual movement rather than upward movement by itself
- supports right-to-left layouts
- ignores transitions caused by page scrolling
- ignores transitions inside scrollable regions
- handles horizontally scrollable regions more conservatively
- replaces fixed 30px/40px thresholds with relative tolerances

In left-to-right layouts, the heuristic treats these as suspicious:

- leftward movement within the same row
- up-left movement

In right-to-left layouts, the heuristic treats these as suspicious:

- rightward movement within the same row
- up-right movement

The heuristic uses:

- document direction
- element/container direction
- `dir`
- CSS `direction`
- root font size
- focused element size
- scroll state

Focus-order findings remain **manual-review signals**, not confirmed WCAG failures.

---

## Previous major improvements retained

### Human-readable axe-core reporting

axe-core rule IDs are converted into plain-language findings with:

- problem summary
- why it matters
- suggested fix
- affected node count
- example targets
- help URL

For example, instead of:

```text
axe-core violation: landmark-one-main
```

The report gives information such as:

```text
Page is missing a main landmark.

Why it matters:
Screen reader and keyboard users often use landmarks to jump directly to the main content.

Suggested fix:
Wrap the primary page content in a <main> element, or add role="main" to the element that contains the main content.
```

### Robust scoped screenshots

Screenshots use viewport-clamped crops and reject page-sized containers where possible.

The harness tries this fallback order:

1. nearest useful container that is not effectively the whole page/viewport
2. focused element with padding
3. bounded clipped region around the focused element
4. viewport fallback if clipping is impossible

Each focus sample in the JSON report may include:

```json
{
  "screenshot": "screenshots/example/focus-003.png",
  "screenshotScope": "container",
  "screenshotTarget": "dialog",
  "screenshotClip": {
    "x": 120,
    "y": 80,
    "width": 700,
    "height": 450
  }
}
```

### Native dialog handling

The harness checks native HTML dialog state using:

```css
dialog[open]
```

This prevents false activation failures caused by closed `<dialog>` elements being present in the DOM.

Activation probing skips normal native links by default, because activating external links can navigate away from the test page and cause cascading false positives. Links are still included in the focus-order evidence.

---

## Installation

Use PowerShell on Windows.

```powershell
cd C:\Users\<your-user>\test\keyboard-operability-js-pro-responsive-v1.4
npm install
npm run install:browsers
```

If Playwright browser installation fails, run:

```powershell
npx playwright install chromium
```

---

## Basic usage

```powershell
npm run test:keyboard -- --url https://example.com --headed
```

---

## Full visual audit

```powershell
npm run test:keyboard -- `
  --url https://example.com `
  --screenshots `
  --visualize `
  --headed
```

This produces:

- JSON report
- Markdown report
- HTML dashboard
- scoped screenshots
- numbered focus-order overlays

---

## Responsive audit

```powershell
npm run test:keyboard -- `
  --url https://example.com `
  --responsive `
  --screenshots `
  --visualize `
  --headed
```

When `--responsive` is used without custom viewport or zoom options, the default matrix is:

- 320 × 568 at 100%
- 375 × 667 at 100%
- 768 × 1024 at 100%
- 1024 × 768 at 100%
- 1280 × 720 at 100%
- 1440 × 900 at 100%
- 1280 × 720 at 200%
- 1280 × 720 at 400%

---

## Custom viewport and zoom testing

```powershell
npm run test:keyboard -- `
  --url https://example.com `
  --viewport 320x568 `
  --viewport 1024x768 `
  --zoom 1 `
  --zoom 2 `
  --screenshots `
  --visualize
```

This runs every supplied viewport/zoom combination.

---

## Screenshot scope options

Version 1.4 supports:

```powershell
--screenshot-scope container
--screenshot-scope element
--screenshot-scope page
```

### `container`

Captures a bounded crop around the nearest useful container.

```powershell
npm run test:keyboard -- `
  --url https://example.com `
  --screenshots `
  --screenshot-scope container
```

### `element`

Captures a bounded crop around only the focused element.

```powershell
npm run test:keyboard -- `
  --url https://example.com `
  --screenshots `
  --screenshot-scope element
```

### `page`

Captures the current viewport/page image.

```powershell
npm run test:keyboard -- `
  --url https://example.com `
  --screenshots `
  --screenshot-scope page
```

---

## Screenshot crop controls

Use these options to control screenshot crops:

```powershell
--screenshot-padding 24
--screenshot-max-width 900
--screenshot-max-height 650
```

Example:

```powershell
npm run test:keyboard -- `
  --url https://example.com `
  --screenshots `
  --visualize `
  --screenshot-scope container `
  --screenshot-padding 24 `
  --screenshot-max-width 700 `
  --screenshot-max-height 450
```

---

## Command options

| Option | Description |
|---|---|
| `--url <url>` | Target URL. Can be repeated. |
| `--responsive` | Run the default viewport/zoom matrix. |
| `--viewport 375x667` | Add a custom viewport. Can be repeated. |
| `--zoom 2` | Add a custom zoom level. Can be repeated. |
| `--max-tabs 120` | Maximum Tab presses per page/viewport run. |
| `--output-dir reports` | Output directory. |
| `--headed` | Show browser UI. |
| `--screenshots` | Capture screenshots for focus steps. |
| `--visualize` | Add numbered focus-order overlays to screenshots. Also enables screenshots. |
| `--screenshot-limit 80` | Limit screenshots per page/viewport run. |
| `--screenshot-scope container` | Screenshot scope: `container`, `element`, or `page`. |
| `--screenshot-padding 24` | Padding around screenshot crop. |
| `--screenshot-max-width 900` | Maximum screenshot crop width. |
| `--screenshot-max-height 650` | Maximum screenshot crop height. |
| `--no-fail` | Always exit 0, even if issues are found. Useful for exploratory audits. |

---

## Output files

Reports are written to `reports/` by default.

```text
reports/
  latest.json
  latest.md
  dashboard.html
  keyboard-audit-<timestamp>.json
  keyboard-audit-<timestamp>.md
  dashboard-<timestamp>.html
  screenshots/
```

Open this file first:

```text
reports/dashboard.html
```

---

## Report contents

The dashboard includes:

- total issue count
- severity summary
- WCAG summary
- responsive comparison by viewport/zoom
- per-page/per-breakpoint issue tables
- focus-order table
- screenshot links
- human-readable axe-core findings

---

## Focus-order reporting

Focus-order findings are reported as:

```text
focus-order-suspect
```

These are heuristic findings.

The JSON evidence includes notes explaining the calculation, for example:

- upward-only focus movement is allowed
- inline direction is derived from `dir`/CSS direction
- RTL pages expect right-to-left inline progression
- transitions involving page or scroll-container movement are ignored
- thresholds are relative to root font size and focused element size

Manual review is required before treating these as WCAG 2.4.3 failures.

---

## axe-core reporting

The JSON evidence for axe findings includes:

- `problem`
- `whyItMatters`
- `suggestedFix`
- `affectedNodes`
- `exampleTargets`
- `helpUrl`

The Markdown report includes an **axe-core findings in plain language** section.

---

## Testing the dialog reference page

```powershell
npm run test:keyboard -- `
  --url https://stevefaulkner.github.io/AT-browser-tests/test-files/dialog.html `
  --headed `
  --no-fail
```

For screenshots:

```powershell
npm run test:keyboard -- `
  --url https://stevefaulkner.github.io/AT-browser-tests/test-files/dialog.html `
  --headed `
  --screenshots `
  --visualize `
  --screenshot-scope container `
  --screenshot-padding 24 `
  --screenshot-max-width 700 `
  --screenshot-max-height 450 `
  --no-fail
```

Single-line version:

```powershell
npm run test:keyboard -- --url https://stevefaulkner.github.io/AT-browser-tests/test-files/dialog.html --screenshots --visualize --screenshot-scope container --screenshot-padding 24 --screenshot-max-width 700 --screenshot-max-height 450 --headed --no-fail
```

---

## CI usage

A GitHub Actions workflow is included at:

```text
.github/workflows/keyboard-audit.yml
```

Update the URL in that file to point at your staging, preview, or production environment.

Example audit command inside CI:

```bash
npm run test:keyboard -- \
  --url https://example.com \
  --responsive \
  --screenshots \
  --visualize
```

Reports are uploaded as workflow artifacts.

---

## Exit codes

By default:

- exits `0` when no critical/serious issues are found
- exits `1` when critical/serious issues are found

Use this for exploratory runs:

```powershell
--no-fail
```

---

## Recommended workflow

1. Run the harness locally with `--headed`.
2. Review `reports/dashboard.html`.
3. Use screenshots to inspect focus visibility and sequence.
4. Review focus-order warnings manually.
5. Confirm suspected issues manually.
6. Fix the page or component.
7. Re-run with the same viewport/zoom matrix.
8. Add the command to CI once the baseline is stable.

---

## Known limitations

This tool provides automated evidence. It cannot fully determine:

- whether focus order is meaningful in every layout
- whether a focus indicator is sufficiently visible under every WCAG 2.2 scenario
- whether a custom widget fully implements the expected ARIA pattern
- whether screen reader output is correct
- whether a keyboard interaction is semantically appropriate for a specific component design
- whether a focus-order heuristic warning is a genuine user-impacting issue

Use the output as a regression and triage signal, then confirm findings manually.

---

## Troubleshooting

### `Cannot find module 'playwright'`

Run:

```powershell
npm install
```

### Browser does not launch

Run:

```powershell
npm run install:browsers
```

or:

```powershell
npx playwright install chromium
```

### OneDrive or file-locking problems

Move the project outside OneDrive, for example:

```text
C:\dev\keyboard-operability-js-pro-responsive-v1.4
```

Then reinstall:

```powershell
npm install
npm run install:browsers
```

---

## Example commands

### Single page, no screenshots

```powershell
npm run test:keyboard -- --url https://example.com --headed
```

### Single page, container screenshots

```powershell
npm run test:keyboard -- `
  --url https://example.com `
  --screenshots `
  --screenshot-scope container `
  --headed
```

### Responsive matrix with visual screenshots

```powershell
npm run test:keyboard -- `
  --url https://example.com `
  --responsive `
  --screenshots `
  --visualize `
  --headed
```

### Custom matrix

```powershell
npm run test:keyboard -- `
  --url https://example.com `
  --viewport 320x568 `
  --viewport 768x1024 `
  --viewport 1440x900 `
  --zoom 1 `
  --zoom 2 `
  --screenshots `
  --screenshot-scope container
```
