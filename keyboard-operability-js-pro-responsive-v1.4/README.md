# Keyboard Operability JS Pro Responsive v1.0

This version fixes two issues observed on native HTML dialog tests:

1. **Duplicate focus stops**: forward focus collection now stops when Tab traversal returns to a previously seen selector instead of logging repeated cycles up to `--max-tabs`.
2. **False activation failures on native dialogs**: activation detection now checks `dialog[open]` and visible dialog-like elements, not the total number of dialog elements in the DOM.

## Install

```powershell
npm install
npm run install:browsers
```

## Basic run

```powershell
npm run test:keyboard -- --url https://stevefaulkner.github.io/AT-browser-tests/test-files/dialog.html --headed
```

## Responsive run

```powershell
npm run test:keyboard -- --url https://stevefaulkner.github.io/AT-browser-tests/test-files/dialog.html --responsive --headed
```

## Full visual run

```powershell
npm run test:keyboard -- `
  --url https://stevefaulkner.github.io/AT-browser-tests/test-files/dialog.html `
  --responsive `
  --screenshots `
  --visualize `
  --headed `
  --no-fail
```

## Custom viewport and zoom

```powershell
npm run test:keyboard -- `
  --url https://example.com `
  --viewport 320x568 `
  --viewport 1024x768 `
  --zoom 1 `
  --zoom 2
```

Reports are written to `reports/`.

Open:

```text
reports/dashboard.html
```


## v1.0 fixes

- Restores the helper functions accidentally dropped from v1.0.
- Native links are skipped by activation probing unless they explicitly behave like buttons.
- Activation probing restores the original page if a probe navigates away.
- Probe setup errors are reported as `activation-not-tested` with minor severity, not as confirmed activation failures.
- Focus-order heuristics use document coordinates, reducing false positives caused by scroll movement.


## v1.0 axe-core reporting improvements

Raw axe messages such as:

```text
axe-core violation: landmark-one-main
```

are now replaced with plain-English findings, for example:

```text
Page is missing a main landmark.
```

The JSON evidence now includes:

- `problem`
- `whyItMatters`
- `suggestedFix`
- `affectedNodes`
- `exampleTargets`
- `helpUrl`

The Markdown report also includes an “axe-core findings in plain language” section.


## Scoped screenshots

Screenshots now default to **container-scoped capture** instead of full-page capture.
For each focus stop, the harness tries to capture the nearest meaningful container (for example a dialog, form, section, table row, list item, fieldset, or ARIA group). If that fails, it falls back to the focused element, then to a clipped viewport image, and only finally to a page image.

You can control this with:

```powershell
npm run test:keyboard -- --url https://example.com --screenshots --screenshot-scope container
```

Available values:

- `container` (default)
- `element`
- `page`


## v1.2 screenshot clipping fix

Version 1.2 changes screenshot capture from Playwright element screenshots to explicit clipped crops. This prevents large containers such as `main`, `section`, or page-level wrappers from producing images that look like full-page screenshots.

New controls:

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
  --screenshot-max-width 700 `
  --screenshot-max-height 450
```
