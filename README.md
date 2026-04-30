# keyboard-vibes
test harness for keyboard tests built using chatgpt. 

**article:** [keyboard testing with the POWER OF AI!](https://html5accessibility.com/stuff/2026/04/29/keyboard-testing-with-the-power-of-ai/)

## NOTE: 

This app/script uses no AI by default, you need to make your own deal with that devil 

>This tool automates keyboard operability testing for web pages using Playwright and axe-core

**This is an experiment only**
I have no idea how accurate it the output is.
Use with extreme caution and awareness. Modify it as you like!

# Keyboard Operability JS Stable v2 – Setup and Usage Guide

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

> This is an automated audit tool — not a full replacement for manual accessibility testing.

---

## 2. Prerequisites

- Windows 10 or 11  
- Node.js (v18 or later recommended)  
- Internet connection  

Check Node:

```
node -v
npm -v
```

---

## 3. Installation

### Step 1 — Extract

Unzip:

```
keyboard-operability-js-stable-v2.zip
```

---

### Step 2 — Navigate

```
cd C:\Users\<your-user>\test\keyboard-operability-js-stable-v2
```

---

### Step 3 — Install dependencies

```
npm install
```

---

### Step 4 — Install browsers

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

---

## 5. Output

Reports are generated in:

```
/reports/
```

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

### OneDrive issues
Move to:
```
C:\dev\keyboard-operability-js-stable-v2
```

---

## 8. Workflow

1. Run tool
2. Review report
3. Fix issues
4. Re-run

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
