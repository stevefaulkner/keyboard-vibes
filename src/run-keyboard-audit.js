const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;

function readArgs(argv = process.argv.slice(2)) {
  const urls = [];
  let maxTabs = 120;
  let headless = true;
  let outputDir = "reports";
  let outputDirExplicit = false;
  let crawl = false;
  let maxPages = 20;
  let sameOriginOnly = true;
  let sameDomainOnly = false;
  let sameHostFamilyOnly = false;
  let safeMode = false;
  let forceActiveProbes = false;

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
      outputDirExplicit = true;
    } else if (arg === "--crawl") {
      crawl = true;
    } else if (arg === "--max-pages") {
      const value = argv[++i];
      if (!value) throw new Error("--max-pages requires a value");
      maxPages = Number(value);
      if (!Number.isInteger(maxPages) || maxPages < 1) {
        throw new Error("--max-pages must be a positive integer");
      }
    } else if (arg === "--include-external") {
      sameOriginOnly = false;
    } else if (arg === "--same-domain") {
      sameDomainOnly = true;
      sameOriginOnly = false;
    } else if (arg === "--same-host-family") {
      sameHostFamilyOnly = true;
      sameDomainOnly = false;
      sameOriginOnly = false;
    } else if (arg === "--safe-mode") {
      safeMode = true;
    } else if (arg === "--active-probes") {
      forceActiveProbes = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (safeMode && forceActiveProbes) {
    throw new Error("--safe-mode and --active-probes cannot be used together");
  }

  if (crawl && !forceActiveProbes) {
    safeMode = true;
  }

  if (!urls.length) throw new Error("Provide at least one --url");
  const normalizedUrls = dedupe(urls.map(normalizeUrlOrThrow));

  if (!outputDirExplicit) {
    outputDir = deriveDefaultOutputDir({ crawl, maxPages, urls: normalizedUrls });
  }

  return {
    urls: normalizedUrls,
    maxTabs,
    headless,
    outputDir,
    crawl,
    maxPages,
    sameOriginOnly,
    sameDomainOnly,
    sameHostFamilyOnly,
    safeMode,
    forceActiveProbes
  };
}

function deriveDefaultOutputDir(options) {
  const { crawl, maxPages, urls } = options;

  if (!crawl || !Array.isArray(urls) || urls.length === 0) {
    return "reports";
  }

  let host = "crawl";
  try {
    host = new URL(urls[0]).hostname.toLowerCase();
  } catch {
    host = "crawl";
  }

  const safeHost = host.replace(/[^a-z0-9.-]/g, "-");
  return path.join("reports", `${safeHost}-${maxPages}`);
}

function dedupe(values) {
  return [...new Set(values)];
}

function normalizeUrlOrThrow(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http(s) URLs are supported: ${value}`);
  }

  url.hash = "";
  return url.toString();
}

function shouldSkipCrawlUrl(url) {
  const blockedExtensions = /\.(?:pdf|zip|gz|svg|png|jpg|jpeg|gif|webp|mp4|mp3|mov|avi|woff2?|ttf|eot)(?:$|[?#])/i;
  return blockedExtensions.test(url.pathname);
}

async function extractCrawlLinks(page) {
  return await page.evaluate(() => {
    return Array.from(document.querySelectorAll("a[href]"))
      .map((anchor) => anchor.getAttribute("href"))
      .filter(Boolean)
      .slice(0, 1500);
  });
}

async function discoverUrlsForAudit(context, seedUrls, options) {
  const { maxPages, sameOriginOnly, sameDomainOnly, sameHostFamilyOnly } = options;
  const queue = [...seedUrls];
  const queued = new Set(queue);
  const visited = new Set();
  const discovered = [];
  const seedOrigins = new Set(seedUrls.map((value) => new URL(value).origin));
  const seedDomainSuffixes = buildSeedDomainSuffixes(seedUrls);
  const seedHostFamilyAllowlist = buildSeedHostFamilyAllowlist(seedUrls);

  while (queue.length > 0 && discovered.length < maxPages) {
    const targetUrl = queue.shift();
    queued.delete(targetUrl);

    if (!targetUrl || visited.has(targetUrl)) continue;
    visited.add(targetUrl);

    const page = await context.newPage();

    try {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      discovered.push(targetUrl);

      const hrefs = await extractCrawlLinks(page);
      const base = new URL(targetUrl);

      for (const href of hrefs) {
        let candidate;

        try {
          candidate = new URL(href, base);
        } catch {
          continue;
        }

        if (candidate.protocol !== "http:" && candidate.protocol !== "https:") {
          continue;
        }

        if (sameOriginOnly && !seedOrigins.has(candidate.origin)) {
          continue;
        }

        if (sameDomainOnly && !isHostAllowedForDomains(candidate.hostname, seedDomainSuffixes)) {
          continue;
        }

        if (sameHostFamilyOnly && !seedHostFamilyAllowlist.has(candidate.hostname.toLowerCase())) {
          continue;
        }

        if (shouldSkipCrawlUrl(candidate)) {
          continue;
        }

        candidate.hash = "";
        const normalized = candidate.toString();

        if (visited.has(normalized) || queued.has(normalized)) {
          continue;
        }

        queue.push(normalized);
        queued.add(normalized);
      }
    } catch (error) {
      console.warn(`Skipping crawl URL due to navigation error: ${targetUrl} (${String(error)})`);
    } finally {
      await page.close();
    }
  }

  return discovered;
}

function buildSeedDomainSuffixes(seedUrls) {
  const suffixes = new Set();

  for (const value of seedUrls) {
    const host = new URL(value).hostname.toLowerCase();
    const normalized = host.startsWith("www.") ? host.slice(4) : host;
    suffixes.add(normalized);
  }

  return suffixes;
}

function isHostAllowedForDomains(hostname, allowedDomainSuffixes) {
  const host = String(hostname || "").toLowerCase();

  for (const suffix of allowedDomainSuffixes) {
    if (host === suffix || host.endsWith(`.${suffix}`)) {
      return true;
    }
  }

  return false;
}

function buildSeedHostFamilyAllowlist(seedUrls) {
  const allowlist = new Set();

  for (const value of seedUrls) {
    const host = new URL(value).hostname.toLowerCase();
    const bareHost = host.startsWith("www.") ? host.slice(4) : host;
    allowlist.add(bareHost);
    allowlist.add(`www.${bareHost}`);
  }

  return allowlist;
}

async function auditPage(page, url, maxTabs, options = {}) {
  const { safeMode = false } = options;

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
  const skip = { probes: [], issues: [] };
  const dialog = { probes: [], issues: [] };

  if (!safeMode) {
    issues.push(...await detectActivationIssues(page, focusOrder.slice(0, 25)));

    const skipResult = await probeSkipLinks(page);
    issues.push(...skipResult.issues);
    skip.probes = skipResult.probes;

    const dialogResult = await probeDialogFocusReturn(page, focusOrder);
    issues.push(...dialogResult.issues);
    dialog.probes = dialogResult.probes;
  }

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
    safeMode,
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
  const prefix = buildReportFilePrefix(report);
  const jsonPath = path.join(outputDir, `${prefix}keyboard-audit-${stamp}.json`);
  const mdPath = path.join(outputDir, `${prefix}keyboard-audit-${stamp}.md`);
  const githubIssuesPath = path.join(outputDir, `${prefix}keyboard-audit-${stamp}.github-issues.json`);

  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(mdPath, toMarkdown(report), "utf8");
  await fs.writeFile(
    githubIssuesPath,
    JSON.stringify(buildGitHubIssueExport(report, jsonPath), null, 2),
    "utf8"
  );

  return { jsonPath, mdPath, githubIssuesPath };
}

function buildReportFilePrefix(report) {
  if (!report.crawl?.enabled || !Array.isArray(report.crawl.seedUrls) || report.crawl.seedUrls.length === 0) {
    return "";
  }

  const seedUrl = report.crawl.seedUrls[0];
  let host = "crawl";

  try {
    host = new URL(seedUrl).hostname.toLowerCase();
  } catch {
    host = "crawl";
  }

  const safeHost = host.replace(/[^a-z0-9.-]/g, "-");
  const maxPages = Number.isInteger(report.crawl.maxPages) ? report.crawl.maxPages : "crawl";

  return `${safeHost}-${maxPages}-`;
}

function buildGitHubIssueExport(report, sourceJsonPath) {
  const allIssues = report.pages.flatMap((page) => page.issues || []);
  const uniqueIssues = dedupeIssuesById(allIssues);
  const items = uniqueIssues.map((issue) => {
    const labels = [
      "a11y",
      "keyboard",
      `severity:${String(issue.severity || "unknown").toLowerCase()}`,
      `type:${String(issue.type || "unknown").toLowerCase()}`
    ];

    return {
      issueId: issue.issueId,
      title: createGitHubIssueTitle(issue),
      labels,
      body: createGitHubIssueBody(issue),
      metadata: {
        url: issue.url,
        wcag: issue.wcag,
        severity: issue.severity,
        type: issue.type,
        selector: issue.selector || null,
        ruleId: issue.ruleId || null,
        tool: issue.tool || "keyboard-vibes",
        frequency: issue.frequency || null,
        recommendedAction: issue.recommendedAction || null,
        generatedAt: report.generatedAt
      }
    };
  });

  return {
    formatVersion: "1.0.0",
    generatedAt: report.generatedAt,
    sourceReport: path.basename(sourceJsonPath),
    totalExportedIssues: items.length,
    issues: items
  };
}

function dedupeIssuesById(issues) {
  const seen = new Set();
  const unique = [];

  for (const issue of issues) {
    const key = issue.issueId || `${issue.url}|${issue.type}|${issue.selector}|${issue.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(issue);
  }

  return unique;
}

function createGitHubIssueTitle(issue) {
  const severity = String(issue.severity || "unknown").toUpperCase();
  const type = issue.type || "accessibility-issue";
  const location = issue.selector || issue.url || "page";

  return `[A11Y][${severity}] ${type} at ${location}`.slice(0, 240);
}

function createGitHubIssueBody(issue) {
  return [
    "## Summary",
    issue.description || "Accessibility issue detected by automated keyboard audit.",
    "",
    "## URL",
    issue.url || "N/A",
    "",
    "## Locator",
    issue.selector || issue.locator?.primary || "N/A",
    "",
    "## WCAG / Rule",
    `- WCAG: ${issue.wcag || "N/A"}`,
    `- Rule ID: ${issue.ruleId || "N/A"}`,
    `- Tool: ${issue.tool || "keyboard-vibes"}`,
    "",
    "## Severity",
    issue.severity || "unknown",
    "",
    "## Frequency",
    `- Instances on page: ${issue.frequency?.instancesOnPage ?? "N/A"}`,
    `- Pages affected: ${issue.frequency?.pagesAffected ?? "N/A"}`,
    `- Total pages scanned: ${issue.frequency?.totalPagesScanned ?? "N/A"}`,
    "",
    "## Reproduction",
    ...(issue.reproduction?.keyboardSteps || [
      "Load page",
      "Navigate with keyboard",
      "Observe behavior"
    ]).map((step, idx) => `${idx + 1}. ${step}`),
    "",
    "## Expected behavior",
    issue.expectedBehavior || "Keyboard interaction should be fully operable and predictable.",
    "",
    "## Actual behavior",
    issue.actualBehavior || issue.description || "Observed behavior differs from keyboard accessibility expectations.",
    "",
    "## Recommended remediation",
    issue.recommendedAction || "Manual triage required.",
    "",
    "## Audit metadata",
    `- Issue ID: ${issue.issueId || "N/A"}`
  ].join("\n");
}

function toMarkdown(report) {
  const lines = [];
  const allIssues = report.pages.flatMap((page) => page.issues || []);
  const globalSummary = summarizeIssues(allIssues);

  lines.push("# Keyboard operability audit", "");
  lines.push(`Generated: ${report.generatedAt}`, "");
  lines.push(`Pages audited: ${report.pages.length}`, "");
  lines.push(`Total issues: ${allIssues.length}`, "");

  if (allIssues.length > 0) {
    lines.push("## Overall severity", "");
    lines.push("| Severity | Count |", "| --- | --- |");

    for (const severity of ["critical", "serious", "moderate", "minor", "unknown"]) {
      const count = globalSummary.bySeverity.get(severity) || 0;
      if (count > 0) {
        lines.push(`| ${severity} | ${count} |`);
      }
    }

    lines.push("");
  }

  if (report.crawl?.enabled) {
    lines.push("## Crawl", "");
    lines.push(`Seed URLs: ${report.crawl.seedUrls.length}`, "");
    lines.push(`Audited URLs discovered: ${report.crawl.auditedUrls.length}`, "");
    lines.push(`Max pages: ${report.crawl.maxPages}`, "");
    lines.push(`Same origin only: ${report.crawl.sameOriginOnly ? "yes" : "no"}`, "");
    lines.push(`Safe mode: ${report.crawl.safeMode ? "yes" : "no"}`, "");
    lines.push(`Active probes forced: ${report.crawl.forceActiveProbes ? "yes" : "no"}`, "");
  }

  for (const page of report.pages) {
    const sortedIssues = sortIssues(page.issues || []);
    const pageSummary = summarizeIssues(sortedIssues);

    lines.push(`## ${page.title || page.url}`, "");
    lines.push(`URL: ${page.url}`, "");
    lines.push("| Metric | Count |", "| --- | --- |");
    lines.push(`| Interactive elements found | ${page.interactiveElements.length} |`);
    lines.push(`| Unique focusable elements reached | ${new Set(page.focusOrder.map((item) => item.selector)).size} |`);
    lines.push(`| axe-core violations | ${page.axeViolations.length} |`);
    lines.push(`| Skip-link probes | ${page.skipLinkProbes.length} |`);
    lines.push(`| Dialog probes | ${page.dialogProbes.length} |`);
    lines.push(`| Focus-order heuristic inversions | ${page.focusOrderHeuristic.inversions.length} |`);
    lines.push(`| Total issues | ${sortedIssues.length} |`, "");

    if (sortedIssues.length > 0) {
      lines.push("### What To Fix First", "");

      for (const action of pageSummary.topActions.slice(0, 8)) {
        lines.push(`- [${action.strongestSeverity}] (${action.count}) ${action.action}`);
      }

      lines.push("");
      lines.push("### Issue Breakdown", "");
      lines.push("| Severity | Count |", "| --- | --- |");

      for (const severity of ["critical", "serious", "moderate", "minor", "unknown"]) {
        const count = pageSummary.bySeverity.get(severity) || 0;
        if (count > 0) {
          lines.push(`| ${severity} | ${count} |`);
        }
      }

      lines.push("");
      lines.push("### Issues", "");
      lines.push("| Severity | WCAG | Type | Selector | Description | Recommended action |");
      lines.push("| --- | --- | --- | --- | --- | --- |");

      for (const issue of sortedIssues) {
        lines.push(
          `| ${cell(issue.severity)} | ${cell(issue.wcag)} | ${cell(issue.type)} | ${cell(issue.selector || "")} | ${cell(issue.description)} | ${cell(getIssueRemediation(issue))} |`
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

function severityRank(severity) {
  const ranking = {
    critical: 0,
    serious: 1,
    moderate: 2,
    minor: 3
  };

  return ranking[severity] ?? 4;
}

function sortIssues(issues) {
  return [...issues].sort((left, right) => {
    const bySeverity = severityRank(left.severity) - severityRank(right.severity);
    if (bySeverity !== 0) return bySeverity;

    const byType = String(left.type || "").localeCompare(String(right.type || ""));
    if (byType !== 0) return byType;

    return String(left.selector || "").localeCompare(String(right.selector || ""));
  });
}

function getIssueRemediation(issue) {
  if (issue.type === "axe") {
    const help = issue.evidence?.help;
    const helpUrl = issue.evidence?.helpUrl;

    if (help && helpUrl) {
      return `${help}. See: ${helpUrl}`;
    }

    if (help) {
      return help;
    }

    return "Review the related axe-core rule details and update markup/ARIA accordingly.";
  }

  const byType = {
    "no-focus": "Ensure at least one visible, enabled control is keyboard focusable (native element or tabindex=0).",
    "focus-not-visible": "Add a strong :focus-visible indicator with clear contrast and non-zero outline/box-shadow.",
    "possible-keyboard-trap": "Verify Tab and Shift+Tab both move focus out of the current region/dialog.",
    "not-keyboard-reachable": "Use semantic controls (button/link/input) or add tabindex=0 plus keyboard handlers matching click behavior.",
    "activation-failed": "Ensure Enter/Space trigger the same outcome as click for keyboard-operable controls.",
    "skip-link-suspect": "Make the skip link first in tab order and move focus to the target heading/main region on activation.",
    "dialog-focus-return-failed": "Close dialogs with Escape and return focus to the triggering element when the dialog closes.",
    "focus-order-suspect": "Align DOM/tab order with visual reading order; avoid CSS-only reordering for interactive controls."
  };

  return byType[issue.type] || "Manual review required: reproduce with keyboard-only navigation and apply a semantic/focus-management fix.";
}

function summarizeIssues(issues) {
  const bySeverity = new Map();
  const byType = new Map();
  const actionSummary = new Map();

  for (const issue of issues) {
    const severity = issue.severity || "unknown";
    const type = issue.type || "unknown";
    const action = getIssueRemediation(issue);

    bySeverity.set(severity, (bySeverity.get(severity) || 0) + 1);
    byType.set(type, (byType.get(type) || 0) + 1);

    if (!actionSummary.has(action)) {
      actionSummary.set(action, {
        count: 1,
        strongestSeverity: severity
      });
    } else {
      const current = actionSummary.get(action);
      current.count += 1;

      if (severityRank(severity) < severityRank(current.strongestSeverity)) {
        current.strongestSeverity = severity;
      }
    }
  }

  const topActions = [...actionSummary.entries()]
    .map(([action, meta]) => ({ action, ...meta }))
    .sort((left, right) => {
      const bySeverity = severityRank(left.strongestSeverity) - severityRank(right.strongestSeverity);
      if (bySeverity !== 0) return bySeverity;
      return right.count - left.count;
    });

  return { bySeverity, byType, topActions };
}

function inferLocator(issue) {
  if (issue.selector) {
    return {
      primary: issue.selector,
      strategy: "selector"
    };
  }

  const axeTarget = issue.evidence?.nodes?.[0]?.target?.[0];
  if (axeTarget) {
    return {
      primary: axeTarget,
      strategy: "axe-target"
    };
  }

  return {
    primary: null,
    strategy: "none"
  };
}

function createIssueId(url, issue, locator) {
  const fingerprint = [
    url,
    issue.type || "unknown",
    issue.wcag || "unknown",
    issue.severity || "unknown",
    locator.primary || "page",
    issue.description || ""
  ].join("|");

  return createHash("sha1").update(fingerprint).digest("hex").slice(0, 12);
}

function getExpectedBehavior(issue) {
  const byType = {
    "no-focus": "At least one visible and enabled control receives keyboard focus with Tab.",
    "focus-not-visible": "Focused elements show a clear visible focus indicator.",
    "possible-keyboard-trap": "Tab and Shift+Tab can move focus both forward and backward out of the current region.",
    "not-keyboard-reachable": "Visible interactive controls are reachable using keyboard-only navigation.",
    "activation-failed": "Enter/Space activate interactive controls with the same outcome as click.",
    "skip-link-suspect": "The skip link is first in tab order and moves focus to main content when activated.",
    "dialog-focus-return-failed": "Escape closes dialogs and focus returns to the trigger control.",
    "focus-order-suspect": "Tab sequence follows a logical visual and DOM order.",
    axe: "Markup and ARIA satisfy the referenced axe-core accessibility rule."
  };

  return byType[issue.type] || "Control is fully operable and understandable using keyboard-only navigation.";
}

function createReproScaffold(url) {
  return {
    startingUrl: url,
    keyboardSteps: [
      "Load the page and ensure no mouse interaction is used.",
      "Use Tab and Shift+Tab to move focus to the relevant element or region.",
      "Use Enter, Space, and Escape where applicable to activate and exit components.",
      "Observe focus visibility, focus order, and resulting state changes."
    ]
  };
}

function enrichIssueForReporting(issue, url) {
  const locator = inferLocator(issue);
  const recommendedAction = getIssueRemediation(issue);
  const issueId = createIssueId(url, issue, locator);

  return {
    ...issue,
    issueId,
    url,
    locator,
    selector: issue.selector || locator.primary,
    tool: issue.type === "axe" ? "axe-core" : "keyboard-vibes",
    ruleId: issue.type === "axe" ? issue.evidence?.id || null : null,
    recommendedAction,
    expectedBehavior: getExpectedBehavior(issue),
    actualBehavior: issue.description,
    reproduction: createReproScaffold(url),
    frequency: {
      instancesOnPage: 1,
      pagesAffected: 1,
      totalPagesScanned: 0
    }
  };
}

function buildIssueFrequencyIndex(pages) {
  const pagesByPattern = new Map();
  const totalsByPage = new Map();
  const totalsByPattern = new Map();

  for (const page of pages) {
    const pagePatternCounts = new Map();

    for (const issue of page.issues || []) {
      const patternKey = `${issue.type || "unknown"}|${issue.wcag || "unknown"}|${issue.locator?.primary || "page"}`;
      pagePatternCounts.set(patternKey, (pagePatternCounts.get(patternKey) || 0) + 1);
      totalsByPattern.set(patternKey, (totalsByPattern.get(patternKey) || 0) + 1);
    }

    for (const [patternKey, count] of pagePatternCounts.entries()) {
      if (!pagesByPattern.has(patternKey)) {
        pagesByPattern.set(patternKey, new Set());
      }

      pagesByPattern.get(patternKey).add(page.url);
      totalsByPage.set(`${page.url}|${patternKey}`, count);
    }
  }

  return {
    pagesByPattern,
    totalsByPage,
    totalsByPattern
  };
}

function buildReportSummary(pages) {
  const allIssues = pages.flatMap((page) => page.issues || []);
  const summary = summarizeIssues(allIssues);
  const severityTotals = Object.fromEntries(summary.bySeverity.entries());
  const issueTypeTotals = Object.fromEntries(summary.byType.entries());

  return {
    pagesAudited: pages.length,
    totalIssues: allIssues.length,
    severityTotals,
    issueTypeTotals,
    topFixRecommendations: summary.topActions.slice(0, 10)
  };
}

function enrichReportForAccessibility(report) {
  const pages = report.pages.map((page) => {
    const issues = (page.issues || []).map((issue) => enrichIssueForReporting(issue, page.url));
    return { ...page, issues };
  });

  const { pagesByPattern, totalsByPage } = buildIssueFrequencyIndex(pages);
  const totalPagesScanned = pages.length;

  for (const page of pages) {
    for (const issue of page.issues || []) {
      const patternKey = `${issue.type || "unknown"}|${issue.wcag || "unknown"}|${issue.locator?.primary || "page"}`;
      issue.frequency = {
        instancesOnPage: totalsByPage.get(`${page.url}|${patternKey}`) || 1,
        pagesAffected: pagesByPattern.get(patternKey)?.size || 1,
        totalPagesScanned
      };
    }
  }

  return {
    ...report,
    schemaVersion: "2.1.0",
    reportContext: {
      tool: "keyboard-vibes",
      browserEngine: "playwright-chromium",
      nodeVersion: process.version,
      platform: process.platform
    },
    reportSummary: buildReportSummary(pages),
    pages
  };
}

async function main() {
  const {
    urls,
    maxTabs,
    headless,
    outputDir,
    crawl,
    maxPages,
    sameOriginOnly,
    sameDomainOnly,
    sameHostFamilyOnly,
    safeMode,
    forceActiveProbes
  } = readArgs();

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce"
  });

  const pages = [];
  let urlsToAudit = urls;

  try {
    if (crawl) {
      console.log(`Crawl enabled: discovering up to ${maxPages} pages...`);
      urlsToAudit = await discoverUrlsForAudit(context, urls, {
        maxPages,
        sameOriginOnly,
        sameDomainOnly,
        sameHostFamilyOnly
      });

      if (urlsToAudit.length === 0) {
        throw new Error("Crawl discovered no auditable URLs.");
      }

      console.log(`Crawl discovered ${urlsToAudit.length} page(s).`);
    }

    for (const url of urlsToAudit) {
      const page = await context.newPage();
      console.log(`Auditing ${url}`);
      const result = await auditPage(page, url, maxTabs, { safeMode });
      pages.push(result);
      await page.close();
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    pages,
    crawl: {
      enabled: crawl,
      seedUrls: urls,
      auditedUrls: urlsToAudit,
      maxPages,
      sameOriginOnly,
      sameDomainOnly,
      sameHostFamilyOnly,
      safeMode,
      forceActiveProbes
    }
  };
  const enrichedReport = enrichReportForAccessibility(report);
  const paths = await writeReports(enrichedReport, outputDir);

  console.log(`JSON report: ${paths.jsonPath}`);
  console.log(`Markdown report: ${paths.mdPath}`);
  console.log(`GitHub issue export: ${paths.githubIssuesPath}`);

  const serious = enrichedReport.pages.flatMap((page) => page.issues).filter((issue) =>
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
