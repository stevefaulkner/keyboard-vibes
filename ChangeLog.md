# Keyboard Operability JS – Major Change Log

Starting from the vanilla JavaScript version.

---

## v0.3 — `keyboard-operability-js-stable`

**Purpose:** Rebuilt the harness as plain JavaScript after the TypeScript/`tsx`/esbuild versions caused browser-context errors on Windows.

### Major changes

- Removed TypeScript, `tsx`, and esbuild.
- Switched to a single CommonJS runner:

  ```text
  src/run-keyboard-audit.js
  ```

- Added stable Windows-friendly execution:

  ```powershell
  npm run test:keyboard -- --url https://example.com --headed
  ```

- Included core checks:
  - Tab traversal
  - Shift+Tab traversal
  - focus visibility heuristic
  - possible keyboard trap detection
  - keyboard reachability detection
  - Enter/Space activation heuristic
  - skip-link probe
  - dialog Escape/focus-return probe
  - focus-order heuristic
  - axe-core scan

- Generated JSON and Markdown reports.

### Status

- First stable JavaScript baseline.
- Still had some helper/global scoping issues.

---

## v0.4 — `keyboard-operability-js-stable-v2`

**Purpose:** Remove remaining global-helper dependency bugs.

### Major changes

- Removed dependency on browser globals such as `stableSelector`.
- Inlined selector/name helper logic inside each Playwright `page.evaluate()` call.
- Fixed repeated `ReferenceError: stableSelector is not defined`.
- Improved reliability of DOM sampling in browser context.

### Status

- Became the first genuinely usable vanilla JavaScript version.

---

## v0.5 — `keyboard-operability-js-pro`

**Purpose:** Turn the basic script into a more complete audit/reporting tool.

### Major changes

- Added screenshots for focus steps.
- Added optional numbered focus-order visualisation.
- Added HTML dashboard output.
- Added WCAG summary mapping.
- Added `latest.json`, `latest.md`, and `dashboard.html`.
- Added GitHub Actions workflow.
- Added CI-friendly exit behaviour.
- Added visual focus marker overlays.
- Added richer Markdown reporting.

### New outputs

```text
reports/
  latest.json
  latest.md
  dashboard.html
  screenshots/
```

### Status

- First “Pro” version with dashboard and CI support.

---

## v0.6 — `keyboard-operability-js-pro-responsive`

**Purpose:** Add responsive breakpoint and zoom testing.

### Major changes

- Added `--responsive`.
- Added custom viewport testing:

  ```powershell
  --viewport 320x568
  --viewport 1024x768
  ```

- Added custom zoom testing:

  ```powershell
  --zoom 1
  --zoom 2
  --zoom 4
  ```

- Added default responsive matrix:
  - 320 × 568 at 100%
  - 375 × 667 at 100%
  - 768 × 1024 at 100%
  - 1024 × 768 at 100%
  - 1280 × 720 at 100%
  - 1440 × 900 at 100%
  - 1280 × 720 at 200%
  - 1280 × 720 at 400%

- Added responsive comparison table in Markdown and HTML reports.
- Added viewport/zoom metadata to each page audit.

### Status

- First version supporting breakpoint/zoom comparisons.

---

## v0.7

**Purpose:** Fix false positives on native HTML dialog pages.

Triggered by testing:

```text
https://stevefaulkner.github.io/AT-browser-tests/test-files/dialog.html
```

### Major changes

- Fixed duplicate focus stops by stopping traversal when Tab returned to an already-seen selector.
- Changed native dialog detection from counting all `<dialog>` elements to checking:

  ```css
  dialog[open]
  ```

- Avoided pressing `Space` after `Enter` if `Enter` already opened a dialog.
- Added dialog cleanup between probes using `Escape`.
- Improved native dialog activation handling.

### Status

- Reduced false positives on pages with closed `<dialog>` elements already present in the DOM.

---

## v0.8

**Purpose:** Fix cascading false activation failures caused by link navigation.

### Problem found

- The activation probe tested normal links before buttons.
- On the dialog test page, activating a reference link navigated away.
- Later button probes failed because the harness was no longer on the original page.

### Major changes

- Skipped normal native links during activation probing.
- Kept links in focus-order evidence.
- Activation probing focused on:
  - `button`
  - `summary`
  - `role="button"`
  - `role="menuitem"`
  - `role="tab"`
  - `role="switch"`
  - `role="checkbox"`
  - `role="radio"`

- Added page restoration if a probe navigated away.
- Changed unreliable probe setup failures to:

  ```text
  activation-not-tested
  ```

  instead of confirmed failures.

- Changed focus-order heuristic to use document coordinates rather than viewport coordinates.

### Status

- Conceptually correct, but had a packaging bug.

### Known issue

- Accidentally dropped `getInteractiveElements()` from the runner.

---

## v0.9

**Purpose:** Repair the v0.8 packaging bug.

### Major changes

- Restored missing `getInteractiveElements()`.
- Preserved v0.8 activation-probe fixes.
- Preserved native-link skipping.
- Preserved page restoration after navigation.
- Preserved `activation-not-tested` classification.

### Status

- Corrected v0.8 and became the stable version of the false-activation fix.

---

## v1.0

**Purpose:** Make axe-core findings human understandable.

### Problem found

Raw axe output such as:

```text
axe-core violation: landmark-one-main
```

was not useful enough for QA reporting.

### Major changes

- Added `formatAxeIssue()`.
- Added axe impact-to-severity mapping.
- Added plain-English axe descriptions.
- Added fields to JSON evidence:
  - `problem`
  - `whyItMatters`
  - `suggestedFix`
  - `affectedNodes`
  - `exampleTargets`
  - `helpUrl`

- Added Markdown section:

  ```text
  axe-core findings in plain language
  ```

### Example improvement

From:

```text
axe-core violation: landmark-one-main
```

To:

```text
Page is missing a main landmark.

Why it matters:
Screen reader and keyboard users often use landmarks to jump directly to the main content.

Suggested fix:
Wrap the primary page content in a <main> element, or add role="main" to the element that contains the main content.
```

### Status

- Major reporting-quality improvement.

---

## v1.1

**Purpose:** Add scoped screenshot support.

### Major changes

- Added screenshot scope option:

  ```powershell
  --screenshot-scope container
  --screenshot-scope element
  --screenshot-scope page
  ```

- Intended default screenshot mode:

  ```powershell
  --screenshot-scope container
  ```

- Added metadata to focus samples:
  - `screenshotScope`
  - `screenshotTarget`

- Attempted to capture nearest meaningful containers such as:
  - `dialog`
  - `form`
  - `fieldset`
  - `section`
  - `article`
  - `nav`
  - `table`
  - `li`
  - ARIA groups/regions

### Status

- Feature was added, but the first implementation was not sufficient.

### Known issue

- Some screenshots still appeared effectively full-page because large containers such as `main` or broad `section` wrappers could be selected.
- Some paths still allowed page-like screenshots.

---

## v1.2

**Purpose:** Make screenshot scoping stricter.

### Major changes

- Removed the obvious `fullPage: true` screenshot path for focus steps.
- Changed scoped screenshots to use explicit clipped crops.
- Added crop controls:

  ```powershell
  --screenshot-padding 24
  --screenshot-max-width 900
  --screenshot-max-height 650
  ```

- Rejected containers that were effectively page-sized.
- Added `screenshotClip` metadata in JSON.

### Status

- Better scoped screenshot intent, but still had a crop-coordinate bug.

### Known issue

Some pages produced:

```text
page.screenshot: Clipped area is either empty or outside the resulting image
```

Cause:

- The crop rectangle could be calculated outside the current viewport after scrolling/focus movement.

---

## v1.3

**Purpose:** Make scoped screenshots robust.

### Major changes

- Reworked screenshot capture to clamp all clips to the current viewport.
- Scrolled focused element into view before calculating crop.
- Rejected page-sized containers more aggressively.
- Added retry logic after scrolling.
- Added safe fallback to viewport screenshot rather than aborting the run.
- Ensured screenshot failures do not stop the whole audit.
- Preserved crop metadata:

  ```json
  {
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

### Status

- Fixed screenshot aborts caused by invalid crop rectangles.
- Best scoped-screenshot implementation before the focus-order heuristic update.

---

## v1.4

**Purpose:** Improve the focus-order heuristic based on review feedback.

### Problem found

The previous focus-order heuristic was too simplistic:

- It treated upward movement of more than a fixed pixel threshold as suspicious.
- It assumed left-to-right visual order.
- It could misreport expected right-to-left movement on RTL pages.
- It could misreport focus movement inside horizontally or vertically scrollable regions.
- It relied on fixed “magic number” thresholds such as 30px and 40px.

### Major changes

- Allowed upward-only focus movement.
- Changed the heuristic to flag **backwards visual movement**, not upward movement by itself.
- In left-to-right layouts, suspicious movement is:
  - leftward within the same row
  - up-left movement

- In right-to-left layouts, suspicious movement is:
  - rightward within the same row
  - up-right movement

- Added RTL support using:
  - `dir`
  - CSS `direction`
  - document-level direction
  - element/container direction where available

- Added scroll-awareness:
  - page scroll changes are ignored for focus-order warnings
  - scroll-container changes are ignored
  - horizontally scrollable regions are treated as expected movement contexts

- Replaced fixed thresholds with relative tolerance based on:
  - root font size
  - previous focused element size
  - current focused element size

- Added heuristic notes into JSON evidence explaining:
  - upward-only movement is allowed
  - inline direction is direction-aware
  - scroll-related transitions are ignored
  - thresholds are relative rather than fixed pixels

### Status

- Current recommended version.
- Focus-order reporting is more conservative and less likely to report false positives in:
  - side panels
  - RTL pages
  - carousels
  - horizontally scrollable regions
  - zoomed layouts
  - multi-column layouts

### Important note

Focus-order findings remain heuristic/manual-review signals. They should not be treated as confirmed WCAG failures without manual inspection.

---

# Summary by capability

| Capability | Introduced |
|---|---|
| Plain JavaScript / no TypeScript transform | v0.3 |
| Stable selector/name helper handling | v0.4 |
| HTML dashboard | v0.5 |
| Screenshots | v0.5 |
| Numbered focus visualisation | v0.5 |
| GitHub Actions CI | v0.5 |
| WCAG summary | v0.5 |
| Responsive viewport matrix | v0.6 |
| Zoom testing | v0.6 |
| Native dialog activation fix | v0.7 |
| Duplicate focus-stop reduction | v0.7 |
| Link-navigation activation cascade fix | v0.8/v0.9 |
| Human-readable axe-core output | v1.0 |
| Screenshot scope option | v1.1 |
| Explicit crop controls | v1.2 |
| Robust viewport-clamped scoped screenshots | v1.3 |
| Direction-aware focus-order heuristic | v1.4 |
| RTL-aware visual-order handling | v1.4 |
| Scroll-aware focus-order heuristic | v1.4 |
| Relative focus-order thresholds | v1.4 |
