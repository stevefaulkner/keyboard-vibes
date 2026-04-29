const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;

function readArgs(argv = process.argv.slice(2)) {
  const urls = [];
  let maxTabs = 120;
  let headless = true;
  let outputDir = "reports";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--url") {
      const value = argv[++i];
      if (!value) throw new Error("--url requires a value");
      urls.push(value);
    } else if (arg === "--max-tabs") {
      const value = argv[++i];
      if (!value) throw new Error("--max-tabs requires a value");
      maxTabs = Number(value);
      if (!Number.isInteger(maxTabs) || maxTabs < 1) {
        throw new Error("--max-tabs must be a positive integer");
      }
    } else if (arg === "--headed") {
      headless = false;
    } else if (arg === "--output-dir") {
      const value = argv[++i];
      if (!value) throw new Error("--output-dir requires a value");
      outputDir = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!urls.length) throw new Error("Provide at least one --url");
  return { urls, maxTabs, headless, outputDir };
}

async function auditPage(page, url, maxTabs) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);

  const title = await page.title();
  const axe = await new AxeBuilder({ page }).analyze();

  const interactiveElements = await getInteractiveElements(page);
  const focusOrder = await collectFocusOrder(page, "Tab", maxTabs);
  const reverseFocusOrder = await collectFocusOrder(page, "Shift+Tab", Math.min(40, maxTabs));

  const issues = [];
  issues.push(...detectFocusIssues(focusOrder));
  issues.push(...detectTrapIssues(focusOrder));
  issues.push(...detectReachabilityIssues(interactiveElements, focusOrder));
  issues.push(...await detectActivationIssues(page, focusOrder.slice(0, 25)));

  const skip = await probeSkipLinks(page);
  issues.push(...skip.issues);

  const dialog = await probeDialogFocusReturn(page, focusOrder);
  issues.push(...dialog.issues);

  const order = analyseFocusOrderHeuristic(focusOrder);
  issues.push(...order.issues);

  for (const violation of axe.violations) {
    issues.push({
      severity: "serious",
      wcag: "axe-core",
      type: "axe",
      description: `axe-core violation: ${violation.id}`,
      evidence: violation
    });
  }

  return {
    url,
    title,
    timestamp: new Date().toISOString(),
    axeViolations: axe.violations,
    interactiveElements,
    focusOrder,
    reverseFocusOrder,
    skipLinkProbes: skip.probes,
    dialogProbes: dialog.probes,
    focusOrderHeuristic: order.heuristic,
    issues
  };
}

async function collectFocusOrder(page, direction, maxTabs) {
  await page.locator("body").focus().catch(() => undefined);
  const samples = [];

  for (let step = 1; step <= maxTabs; step++) {
    await page.keyboard.press(direction);
    await page.waitForTimeout(60);

    const sample = await getActiveElementSample(page, step, direction);
    if (sample) samples.push(sample);

    const recent = samples.slice(-10).map((item) => item.selector);
    if (recent.length === 10 && new Set(recent).size <= 2 && step > 12) break;
  }

  return samples;
}

async function getActiveElementSelector(page) {
  return await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    return makeStableSelector(el);

    function makeStableSelector(node) {
      if (node.id) return "#" + CSS.escape(node.id);

      const attrs = ["data-testid", "data-test", "data-cy", "aria-label", "name"];
      for (const attr of attrs) {
        const value = node.getAttribute(attr);
        if (value) {
          return `${node.tagName.toLowerCase()}[${attr}="${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
        }
      }

      const parts = [];
      let current = node;

      while (current && current !== document.documentElement && parts.length < 4) {
        const tag = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (!parent) break;

        const siblings = Array.from(parent.children).filter(
          (child) => child.tagName === current.tagName
        );

        const nth =
          siblings.length > 1
            ? `:nth-of-type(${siblings.indexOf(current) + 1})`
            : "";

        parts.unshift(`${tag}${nth}`);
        current = parent;
      }

      return parts.join(" > ");
    }
  });
}

async function getActiveElementSample(page, step, key) {
  return await page.evaluate(({ step, key }) => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;

    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const outlineWidth = Number.parseFloat(style.outlineWidth || "0");
    const hasOutline =
      style.outlineStyle !== "none" &&
      style.outlineStyle !== "hidden" &&
      outlineWidth > 0;

    return {
      step,
      key,
      tagName: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      accessibleName: getName(el),
      selector: makeStableSelector(el),
      href: el instanceof HTMLAnchorElement ? el.href : null,
      tabIndex: el.tabIndex,
      disabled:
        el.hasAttribute("disabled") ||
        el.getAttribute("aria-disabled") === "true",
      ariaHidden: el.getAttribute("aria-hidden"),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      visible:
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none",
      focusVisible: hasOutline || style.boxShadow !== "none",
      focusStyle: {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
        boxShadow: style.boxShadow,
        borderColor: style.borderColor,
        backgroundColor: style.backgroundColor
      }
    };

    function makeStableSelector(node) {
      if (node.id) return "#" + CSS.escape(node.id);

      const attrs = ["data-testid", "data-test", "data-cy", "aria-label", "name"];
      for (const attr of attrs) {
        const value = node.getAttribute(attr);
        if (value) {
          return `${node.tagName.toLowerCase()}[${attr}="${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
        }
      }

      const parts = [];
      let current = node;

      while (current && current !== document.documentElement && parts.length < 4) {
        const tag = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (!parent) break;

        const siblings = Array.from(parent.children).filter(
          (child) => child.tagName === current.tagName
        );

        const nth =
          siblings.length > 1
            ? `:nth-of-type(${siblings.indexOf(current) + 1})`
            : "";

        parts.unshift(`${tag}${nth}`);
        current = parent;
      }

      return parts.join(" > ");
    }

    function getName(node) {
      const labelledBy = node.getAttribute("aria-labelledby");
      const labelledByText = labelledBy
        ? labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent?.trim() || "")
            .filter(Boolean)
            .join(" ")
        : "";

      const labelsText =
        node.labels && node.labels.length
          ? node.labels[0]?.textContent?.trim() || ""
          : "";

      return (
        node.getAttribute("aria-label") ||
        labelledByText ||
        labelsText ||
        node.getAttribute("alt") ||
        node.getAttribute("title") ||
        node.textContent ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160);
    }
  }, { step, key });
}

async function getInteractiveElements(page) {
  return await page.evaluate(() => {
    const selectors = [
      "a[href]",
      "button",
      "input",
      "select",
      "textarea",
      "summary",
      "details",
      "[role='button']",
      "[role='link']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='switch']",
      "[role='tab']",
      "[role='menuitem']",
      "[role='option']",
      "[role='combobox']",
      "[role='slider']",
      "[role='spinbutton']",
      "[tabindex]",
      "[onclick]",
      "[onkeydown]",
      "[onkeyup]",
      "[contenteditable='true']"
    ].join(",");

    const nodes = Array.from(new Set(Array.from(document.querySelectorAll(selectors))));

    return nodes.map((el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const role = el.getAttribute("role");

      return {
        selector: makeStableSelector(el),
        tagName: el.tagName.toLowerCase(),
        role,
        accessibleName: getName(el),
        tabIndex: el.tabIndex,
        disabled:
          el.hasAttribute("disabled") ||
          el.getAttribute("aria-disabled") === "true",
        ariaHidden: el.getAttribute("aria-hidden"),
        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden",
        pointerLike:
          typeof el.onclick === "function" ||
          el.hasAttribute("onclick") ||
          style.cursor === "pointer" ||
          [
            "button",
            "link",
            "checkbox",
            "radio",
            "switch",
            "tab",
            "menuitem",
            "option",
            "combobox",
            "slider",
            "spinbutton"
          ].includes(role || "")
      };
    });

    function makeStableSelector(node) {
      if (node.id) return "#" + CSS.escape(node.id);

      const attrs = ["data-testid", "data-test", "data-cy", "aria-label", "name"];
      for (const attr of attrs) {
        const value = node.getAttribute(attr);
        if (value) {
          return `${node.tagName.toLowerCase()}[${attr}="${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
        }
      }

      const parts = [];
      let current = node;

      while (current && current !== document.documentElement && parts.length < 4) {
        const tag = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (!parent) break;

        const siblings = Array.from(parent.children).filter(
          (child) => child.tagName === current.tagName
        );

        const nth =
          siblings.length > 1
            ? `:nth-of-type(${siblings.indexOf(current) + 1})`
            : "";

        parts.unshift(`${tag}${nth}`);
        current = parent;
      }

      return parts.join(" > ");
    }

    function getName(node) {
      const labelledBy = node.getAttribute("aria-labelledby");
      const labelledByText = labelledBy
        ? labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent?.trim() || "")
            .filter(Boolean)
            .join(" ")
        : "";

      const labelsText =
        node.labels && node.labels.length
          ? node.labels[0]?.textContent?.trim() || ""
          : "";

      return (
        node.getAttribute("aria-label") ||
        labelledByText ||
        labelsText ||
        node.getAttribute("alt") ||
        node.getAttribute("title") ||
        node.textContent ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160);
    }
  });
}

function detectFocusIssues(focusOrder) {
  const issues = [];

  if (focusOrder.length === 0) {
    issues.push({
      severity: "critical",
      wcag: "2.1.1 Keyboard",
      type: "no-focus",
      description: "No keyboard focusable element was reached with Tab.",
      evidence: {}
    });
    return issues;
  }

  for (const sample of focusOrder) {
    if (!sample.focusVisible && sample.visible) {
      issues.push({
        severity: "serious",
        wcag: "2.4.7 Focus Visible",
        type: "focus-not-visible",
        selector: sample.selector,
        description: "Focused element does not expose an obvious outline or box-shadow focus indicator.",
        evidence: sample
      });
    }
  }

  return issues;
}

function detectTrapIssues(focusOrder) {
  if (focusOrder.length < 12) return [];

  const lastTen = focusOrder.slice(-10).map((item) => item.selector);

  if (new Set(lastTen).size <= 2) {
    return [
      {
        severity: "critical",
        wcag: "2.1.2 No Keyboard Trap",
        type: "possible-keyboard-trap",
        description: "Tab focus appears to be cycling between one or two elements.",
        evidence: focusOrder.slice(-12)
      }
    ];
  }

  return [];
}

function detectReachabilityIssues(interactiveElements, focusOrder) {
  const focusedSelectors = new Set(focusOrder.map((item) => item.selector));
  const issues = [];

  for (const el of interactiveElements) {
    const isExpectedFocusable =
      el.visible &&
      !el.disabled &&
      el.ariaHidden !== "true" &&
      el.pointerLike &&
      el.tabIndex !== -1;

    if (isExpectedFocusable && !focusedSelectors.has(el.selector)) {
      issues.push({
        severity: "serious",
        wcag: "2.1.1 Keyboard",
        type: "not-keyboard-reachable",
        selector: el.selector,
        description: "Visible pointer-like interactive element was not reached during Tab traversal.",
        evidence: el
      });
    }
  }

  return issues;
}

async function detectActivationIssues(page, focusOrder) {
  const issues = [];
  const seen = new Set();

  for (const sample of focusOrder) {
    if (seen.has(sample.selector)) continue;
    seen.add(sample.selector);

    if (!["button", "a", "summary"].includes(sample.tagName) && !sample.role) continue;

    const beforeUrl = page.url();
    const beforeDialogCount = await page
      .locator("[role='dialog'],dialog,[aria-modal='true']")
      .count()
      .catch(() => 0);

    try {
      await page.locator(sample.selector).focus({ timeout: 1000 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(150);

      if (sample.tagName !== "input") {
        await page.keyboard.press("Space").catch(() => undefined);
        await page.waitForTimeout(150);
      }

      const afterUrl = page.url();
      const afterDialogCount = await page
        .locator("[role='dialog'],dialog,[aria-modal='true']")
        .count()
        .catch(() => 0);

      const changed = afterUrl !== beforeUrl || afterDialogCount !== beforeDialogCount;
      const isNativeLink = sample.tagName === "a" && !!sample.href;
      const isButtonLike =
        sample.tagName === "button" ||
        ["button", "menuitem", "tab"].includes(sample.role || "");

      if ((isNativeLink || isButtonLike) && !changed) {
        issues.push({
          severity: "moderate",
          wcag: "2.1.1 Keyboard",
          type: "activation-failed",
          selector: sample.selector,
          description: "Keyboard activation did not produce an observable URL, dialog, or state change. Manual confirmation recommended.",
          evidence: sample
        });
      }

      if (afterUrl !== beforeUrl) {
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 3000 }).catch(() => undefined);
      }
    } catch (error) {
      issues.push({
        severity: "moderate",
        wcag: "2.1.1 Keyboard",
        type: "activation-failed",
        selector: sample.selector,
        description: "Could not focus or activate element with keyboard.",
        evidence: { sample, error: String(error) }
      });
    }
  }

  return issues;
}

async function probeSkipLinks(page) {
  const skipLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("a[href^='#']"))
      .filter((a) =>
        /skip|main|content/i.test(a.textContent || a.getAttribute("aria-label") || "")
      )
      .slice(0, 10)
      .map((a, index) => {
        if (!a.id) {
          a.setAttribute("data-keyboard-audit-skip-link", String(index));
        }

        return {
          selector: a.id
            ? "#" + CSS.escape(a.id)
            : `[data-keyboard-audit-skip-link="${index}"]`,
          text: (a.textContent || a.getAttribute("aria-label") || "")
            .replace(/\s+/g, " ")
            .trim(),
          href: a.getAttribute("href")
        };
      });
  });

  const probes = [];
  const issues = [];

  for (const link of skipLinks) {
    try {
      await page.locator("body").focus().catch(() => undefined);
      await page.keyboard.press("Tab");
      await page.waitForTimeout(100);

      const firstFocus = await getActiveElementSelector(page);
      const reachedByFirstTab = firstFocus === link.selector;

      await page.locator(link.selector).focus({ timeout: 1000 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(150);

      const focusAfterActivation = await getActiveElementSelector(page);
      const activationMovedFocus =
        !!focusAfterActivation && focusAfterActivation !== link.selector;

      const probe = {
        ...link,
        reachedByFirstTab,
        activationMovedFocus,
        focusAfterActivation
      };

      probes.push(probe);

      if (!reachedByFirstTab || !activationMovedFocus) {
        issues.push({
          severity: "moderate",
          wcag: "2.4.1 Bypass Blocks",
          type: "skip-link-suspect",
          selector: link.selector,
          description: "Skip link exists but was not first in Tab order or did not move focus after activation.",
          evidence: probe
        });
      }
    } catch {
      continue;
    }
  }

  return { probes, issues };
}

async function probeDialogFocusReturn(page, focusOrder) {
  const probes = [];
  const issues = [];

  for (const sample of focusOrder.slice(0, 30)) {
    const looksLikeDialogTrigger = /dialog|modal|open|menu|filter|settings|more/i.test(
      `${sample.accessibleName} ${sample.selector}`
    );

    if (!looksLikeDialogTrigger) continue;

    try {
      await page.locator(sample.selector).focus({ timeout: 1000 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(200);

      const opened = await page
        .locator("[role='dialog'],dialog,[aria-modal='true']")
        .count()
        .then((count) => count > 0)
        .catch(() => false);

      if (!opened) continue;

      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);

      const closedWithEscape = await page
        .locator("[role='dialog'],dialog,[aria-modal='true']")
        .count()
        .then((count) => count === 0)
        .catch(() => false);

      const activeAfterClose = await getActiveElementSelector(page);
      const focusReturnedToTrigger = activeAfterClose === sample.selector;

      const probe = {
        triggerSelector: sample.selector,
        opened,
        closedWithEscape,
        focusReturnedToTrigger,
        activeAfterClose
      };

      probes.push(probe);

      if (!closedWithEscape || !focusReturnedToTrigger) {
        issues.push({
          severity: "serious",
          wcag: "2.1.2 No Keyboard Trap / 2.4.3 Focus Order",
          type: "dialog-focus-return-failed",
          selector: sample.selector,
          description: "Dialog-like interaction did not close with Escape or did not return focus to the trigger.",
          evidence: probe
        });
      }
    } catch {
      continue;
    }
  }

  return { probes, issues };
}

function analyseFocusOrderHeuristic(focusOrder) {
  const inversions = [];
  const visible = focusOrder.filter(
    (item) => item.visible && item.rect.width > 0 && item.rect.height > 0
  );

  for (let i = 1; i < visible.length; i++) {
    const prev = visible[i - 1];
    const current = visible[i];

    const movesFarUp = current.rect.y + 40 < prev.rect.y;
    const movesFarLeftSameRow =
      Math.abs(current.rect.y - prev.rect.y) < 30 &&
      current.rect.x + 40 < prev.rect.x;

    if (movesFarUp || movesFarLeftSameRow) {
      inversions.push({
        from: prev,
        to: current,
        reason: movesFarUp
          ? "Focus moved substantially upward in visual order."
          : "Focus moved substantially leftward within the same visual row."
      });
    }
  }

  const heuristic = { inversions: inversions.slice(0, 20) };
  const issues = [];

  if (inversions.length > 0) {
    issues.push({
      severity: "moderate",
      wcag: "2.4.3 Focus Order",
      type: "focus-order-suspect",
      description: "Tab order appears to move against visual reading order. Manual verification required.",
      evidence: heuristic
    });
  }

  return { heuristic, issues };
}

async function writeReports(report, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(outputDir, `keyboard-audit-${stamp}.json`);
  const mdPath = path.join(outputDir, `keyboard-audit-${stamp}.md`);

  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(mdPath, toMarkdown(report), "utf8");

  return { jsonPath, mdPath };
}

function toMarkdown(report) {
  const lines = [];

  lines.push("# Keyboard operability audit", "");
  lines.push(`Generated: ${report.generatedAt}`, "");

  for (const page of report.pages) {
    lines.push(`## ${page.title || page.url}`, "");
    lines.push(`URL: ${page.url}`, "");
    lines.push("| Metric | Count |", "| --- | --- |");
    lines.push(`| Interactive elements found | ${page.interactiveElements.length} |`);
    lines.push(`| Unique focusable elements reached | ${new Set(page.focusOrder.map((item) => item.selector)).size} |`);
    lines.push(`| axe-core violations | ${page.axeViolations.length} |`);
    lines.push(`| Skip-link probes | ${page.skipLinkProbes.length} |`);
    lines.push(`| Dialog probes | ${page.dialogProbes.length} |`);
    lines.push(`| Focus-order heuristic inversions | ${page.focusOrderHeuristic.inversions.length} |`);
    lines.push(`| Total issues | ${page.issues.length} |`, "");

    if (page.issues.length) {
      lines.push("### Issues", "");
      lines.push("| Severity | WCAG | Type | Selector | Description |");
      lines.push("| --- | --- | --- | --- | --- |");

      for (const issue of page.issues) {
        lines.push(
          `| ${cell(issue.severity)} | ${cell(issue.wcag)} | ${cell(issue.type)} | ${cell(issue.selector || "")} | ${cell(issue.description)} |`
        );
      }

      lines.push("");
    }

    lines.push("### Focus order", "");
    lines.push("| Step | Element | Role | Name | Visible focus |");
    lines.push("| --- | --- | --- | --- | --- |");

    for (const item of page.focusOrder.slice(0, 120)) {
      lines.push(
        `| ${item.step} | ${cell(item.selector)} | ${cell(item.role || "")} | ${cell(item.accessibleName)} | ${item.focusVisible ? "yes" : "no"} |`
      );
    }

    lines.push("");
  }

  return lines.join("\n");
}

function cell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function hasSeriousIssues(issues) {
  return issues.some((issue) => issue.severity === "critical" || issue.severity === "serious");
}

async function main() {
  const { urls, maxTabs, headless, outputDir } = readArgs();

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce"
  });

  const pages = [];

  try {
    for (const url of urls) {
      const page = await context.newPage();
      console.log(`Auditing ${url}`);
      const result = await auditPage(page, url, maxTabs);
      pages.push(result);
      await page.close();
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const report = { generatedAt: new Date().toISOString(), pages };
  const paths = await writeReports(report, outputDir);

  console.log(`JSON report: ${paths.jsonPath}`);
  console.log(`Markdown report: ${paths.mdPath}`);

  const serious = report.pages.flatMap((page) => page.issues).filter((issue) =>
    hasSeriousIssues([issue])
  );

  if (serious.length > 0) {
    console.error(`Found ${serious.length} critical/serious keyboard issue(s).`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
