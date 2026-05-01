
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;

const WCAG_MAP = {
  "2.1.1 Keyboard": { level: "A", category: "Operable" },
  "2.1.2 No Keyboard Trap": { level: "A", category: "Operable" },
  "2.4.1 Bypass Blocks": { level: "A", category: "Operable" },
  "2.4.3 Focus Order": { level: "A", category: "Operable" },
  "2.4.7 Focus Visible": { level: "AA", category: "Operable" },
  "2.4.11 Focus Not Obscured": { level: "AA", category: "Operable" },
  "axe-core": { level: "mixed", category: "Automated rules" }
};

const DEFAULT_VIEWPORTS = [
  { name: "mobile-320", width: 320, height: 568 },
  { name: "mobile-375", width: 375, height: 667 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-small", width: 1024, height: 768 },
  { name: "desktop-1280", width: 1280, height: 720 },
  { name: "desktop-1440", width: 1440, height: 900 }
];

const DEFAULT_RESPONSIVE_MATRIX = [
  ...DEFAULT_VIEWPORTS.map((viewport) => ({ viewport, zoom: 1 })),
  { viewport: { name: "desktop-1280", width: 1280, height: 720 }, zoom: 2 },
  { viewport: { name: "desktop-1280", width: 1280, height: 720 }, zoom: 4 }
];

function readArgs(argv = process.argv.slice(2)) {
  const urls = [];
  const viewports = [];
  const zooms = [];
  const options = {
    maxTabs: 120,
    headless: true,
    outputDir: "reports",
    screenshots: false,
    visualize: false,
    screenshotLimit: 80,
    screenshotScope: "container",
    screenshotPadding: 24,
    screenshotMaxWidth: 900,
    screenshotMaxHeight: 650,
    focusOrderInlineToleranceMultiplier: 1.5,
    failOnSerious: true,
    responsive: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--url") urls.push(requireValue(argv, ++i, "--url"));
    else if (arg === "--max-tabs") options.maxTabs = positiveInt(requireValue(argv, ++i, "--max-tabs"), "--max-tabs");
    else if (arg === "--headed") options.headless = false;
    else if (arg === "--output-dir") options.outputDir = requireValue(argv, ++i, "--output-dir");
    else if (arg === "--screenshots") options.screenshots = true;
    else if (arg === "--visualize") { options.visualize = true; options.screenshots = true; }
    else if (arg === "--screenshot-limit") options.screenshotLimit = positiveInt(requireValue(argv, ++i, "--screenshot-limit"), "--screenshot-limit");
    else if (arg === "--screenshot-scope") options.screenshotScope = parseScreenshotScope(requireValue(argv, ++i, "--screenshot-scope"));
    else if (arg === "--screenshot-padding") options.screenshotPadding = positiveInt(requireValue(argv, ++i, "--screenshot-padding"), "--screenshot-padding");
    else if (arg === "--screenshot-max-width") options.screenshotMaxWidth = positiveInt(requireValue(argv, ++i, "--screenshot-max-width"), "--screenshot-max-width");
    else if (arg === "--screenshot-max-height") options.screenshotMaxHeight = positiveInt(requireValue(argv, ++i, "--screenshot-max-height"), "--screenshot-max-height");
    else if (arg === "--no-fail") options.failOnSerious = false;
    else if (arg === "--responsive") options.responsive = true;
    else if (arg === "--viewport") viewports.push(parseViewport(requireValue(argv, ++i, "--viewport")));
    else if (arg === "--zoom") zooms.push(parseZoom(requireValue(argv, ++i, "--zoom")));
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!urls.length) throw new Error("Provide at least one --url");
  options.urls = urls;
  options.matrix = buildMatrix(options.responsive, viewports, zooms);
  return options;
}

function buildMatrix(responsive, customViewports, customZooms) {
  if (customViewports.length || customZooms.length) {
    const viewports = customViewports.length ? customViewports : [{ name: "desktop-1280", width: 1280, height: 720 }];
    const zooms = customZooms.length ? customZooms : [1];
    return viewports.flatMap((viewport) => zooms.map((zoom) => ({ viewport, zoom })));
  }
  if (responsive) return DEFAULT_RESPONSIVE_MATRIX;
  return [{ viewport: { name: "desktop-1280", width: 1280, height: 720 }, zoom: 1 }];
}

function parseViewport(value) {
  const match = /^(\d+)x(\d+)$/i.exec(value.trim());
  if (!match) throw new Error(`Invalid viewport "${value}". Use WIDTHxHEIGHT, for example 375x667.`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  return { name: `${width}x${height}`, width, height };
}

function parseZoom(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid zoom "${value}". Use values such as 1, 1.5, 2, or 4.`);
  return n;
}

function parseScreenshotScope(value) {
  const normalized = String(value || "").toLowerCase();
  if (!["container", "element", "page"].includes(normalized)) {
    throw new Error(`Invalid screenshot scope "${value}". Use container, element, or page.`);
  }
  return normalized;
}

function requireValue(argv, index, name) {
  if (!argv[index]) throw new Error(`${name} requires a value`);
  return argv[index];
}

function positiveInt(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

async function auditPage(page, url, options, pageIndex, matrixItem) {
  await page.setViewportSize({ width: matrixItem.viewport.width, height: matrixItem.viewport.height });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
  await applyZoom(page, matrixItem.zoom);
  await page.waitForTimeout(150);

  const title = await page.title();
  const safePageName = slugify(`${new URL(url).hostname}-${pageIndex}-${matrixItem.viewport.name}-zoom-${matrixItem.zoom}`);
  const axe = await new AxeBuilder({ page }).analyze();
  const interactiveElements = await getInteractiveElements(page);
  const focusOrder = await collectFocusOrder(page, "Tab", options, safePageName);
  const reverseFocusOrder = await collectFocusOrder(page, "Shift+Tab", { ...options, screenshots: false, visualize: false }, safePageName);

  const issues = [
    ...detectFocusIssues(focusOrder),
    ...detectTrapIssues(focusOrder),
    ...detectReachabilityIssues(interactiveElements, focusOrder),
    ...detectObscuredFocusIssues(focusOrder),
    ...await detectActivationIssues(page, focusOrder.slice(0, 25))
  ];

  const skip = await probeSkipLinks(page);
  issues.push(...skip.issues);

  const dialog = await probeDialogFocusReturn(page, focusOrder);
  issues.push(...dialog.issues);

  const order = analyseFocusOrderHeuristic(focusOrder, await getDocumentDirection(page));
  issues.push(...order.issues);

  for (const violation of axe.violations) {
    issues.push(formatAxeIssue(violation));
  }

  return {
    url,
    title,
    timestamp: new Date().toISOString(),
    viewport: matrixItem.viewport,
    zoom: matrixItem.zoom,
    effectiveCssViewport: await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio })),
    documentDirection: await getDocumentDirection(page),
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

async function getDocumentDirection(page) {
  return await page.evaluate(() => {
    const docEl = document.documentElement;
    const body = document.body;
    const dir =
      docEl.getAttribute("dir") ||
      body?.getAttribute("dir") ||
      window.getComputedStyle(docEl).direction ||
      "ltr";

    const lang =
      docEl.getAttribute("lang") ||
      body?.getAttribute("lang") ||
      navigator.language ||
      "";

    return {
      dir: String(dir || "ltr").toLowerCase() === "rtl" ? "rtl" : "ltr",
      lang
    };
  }).catch(() => ({ dir: "ltr", lang: "" }));
}

async function applyZoom(page, zoom) {
  await page.evaluate((zoom) => {
    document.documentElement.style.zoom = String(zoom);
    document.documentElement.setAttribute("data-keyboard-audit-zoom", String(zoom));
  }, zoom);
}

/*
 * v0.7 fix:
 * Do not log repeated focus cycles as duplicate focus stops.
 * Stop forward traversal once a selector repeats. For this audit purpose, the first repeated
 * selector indicates that browser Tab traversal has wrapped or entered a cycle.
 */
async function collectFocusOrder(page, direction, options, safePageName) {
  await page.locator("body").focus().catch(() => undefined);
  const samples = [];
  const seenSelectors = new Set();
  let previousSelector = null;

  for (let rawStep = 1; rawStep <= options.maxTabs; rawStep++) {
    await page.keyboard.press(direction);
    await page.waitForTimeout(60);

    const sample = await getActiveElementSample(page, rawStep, direction);
    if (!sample) continue;

    if (sample.selector === previousSelector) continue;

    if (seenSelectors.has(sample.selector)) {
      break;
    }

    seenSelectors.add(sample.selector);
    previousSelector = sample.selector;
    sample.step = samples.length + 1;

    if (options.visualize && direction === "Tab") await addFocusMarker(page, sample.step);

    if (options.screenshots && direction === "Tab" && sample.step <= options.screenshotLimit) {
      const screenshotPath = path.join(options.outputDir, "screenshots", safePageName, `focus-${String(sample.step).padStart(3, "0")}.png`);
      await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
      const capture = await captureFocusScreenshot(page, sample, screenshotPath, options);
      sample.screenshot = path.relative(options.outputDir, screenshotPath).replace(/\\/g, "/");
      sample.screenshotScope = capture.scope;
      sample.screenshotTarget = capture.target;
      sample.screenshotClip = capture.clip || null;
      sample.screenshotClip = capture.clip || null;
    }

    samples.push(sample);
  }

  return samples;
}

async function captureFocusScreenshot(page, sample, screenshotPath, options) {
  const requestedScope = options.screenshotScope || "container";

  if (requestedScope === "page") {
    await page.screenshot({ path: screenshotPath });
    return { scope: "page", target: "viewport" };
  }

  const clipInfo = await buildScopedScreenshotClip(page, sample, {
    scope: requestedScope,
    padding: options.screenshotPadding || 24,
    maxWidth: options.screenshotMaxWidth || 900,
    maxHeight: options.screenshotMaxHeight || 650
  });

  if (clipInfo && clipInfo.clip && clipInfo.clip.width > 0 && clipInfo.clip.height > 0) {
    await page.screenshot({ path: screenshotPath, clip: clipInfo.clip });
    return clipInfo;
  }

  await page.screenshot({ path: screenshotPath });
  return { scope: "viewport-fallback", target: sample.selector };
}

async function buildScopedScreenshotClip(page, sample, settings) {
  return await page.evaluate(({ sample, settings }) => {
    function resolve(selector) {
      if (!selector) return null;
      try { return document.querySelector(selector); }
      catch { return null; }
    }

    function stableSelector(node) {
      if (!node || !(node instanceof Element)) return "";
      if (node.id) return "#" + CSS.escape(node.id);
      const attrs = ["data-testid", "data-test", "data-cy", "aria-label", "name"];
      for (const attr of attrs) {
        const value = node.getAttribute(attr);
        if (value) return `${node.tagName.toLowerCase()}[${attr}="${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
      }
      const parts = [];
      let current = node;
      while (current && current !== document.documentElement && parts.length < 4) {
        const tag = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (!parent) break;
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : "";
        parts.unshift(`${tag}${nth}`);
        current = parent;
      }
      return parts.join(" > ");
    }

    function rectFor(el) {
      if (!el || !(el instanceof Element)) return null;
      const rect = el.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return null;
      return {
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
        right: rect.left + window.scrollX + rect.width,
        bottom: rect.top + window.scrollY + rect.height,
        width: rect.width,
        height: rect.height
      };
    }

    function documentSize() {
      const body = document.body;
      const html = document.documentElement;
      return {
        width: Math.max(body ? body.scrollWidth : 0, html.scrollWidth, html.clientWidth),
        height: Math.max(body ? body.scrollHeight : 0, html.scrollHeight, html.clientHeight)
      };
    }

    function isPageSized(rect) {
      const viewportArea = window.innerWidth * window.innerHeight;
      const rectArea = rect.width * rect.height;
      return (rect.width >= window.innerWidth * 0.92 && rect.height >= window.innerHeight * 0.82) || rectArea >= viewportArea * 0.85;
    }

    function chooseContainer(el) {
      if (settings.scope === "element") return el;
      const preferredSelector = [
        "dialog", "form", "fieldset", "details", "table", "thead", "tbody", "tr", "td", "th",
        "ul", "ol", "li", "article", "section", "aside", "nav",
        "[role='dialog']", "[role='group']", "[role='region']", "[role='tabpanel']",
        "[role='menu']", "[role='listbox']", "[role='radiogroup']", "[role='toolbar']",
        "[data-testid]", "[data-test]", "[data-cy]"
      ].join(",");

      let fallback = null;
      let current = el.parentElement;
      while (current && current !== document.body && current !== document.documentElement) {
        const rect = current.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0 && !isPageSized(rect)) {
          if (!fallback) fallback = current;
          if (current.matches(preferredSelector)) return current;
        }
        current = current.parentElement;
      }
      return fallback || el;
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(value, max));
    }

    function crop(targetRect, focusRect, padding, maxWidth, maxHeight) {
      const doc = documentSize();
      const width = Math.max(1, Math.min(maxWidth, doc.width, Math.max(focusRect.width + padding * 2, Math.min(targetRect.width + padding * 2, maxWidth))));
      const height = Math.max(1, Math.min(maxHeight, doc.height, Math.max(focusRect.height + padding * 2, Math.min(targetRect.height + padding * 2, maxHeight))));
      const focusCenterX = focusRect.left + focusRect.width / 2;
      const focusCenterY = focusRect.top + focusRect.height / 2;
      const minX = Math.max(0, targetRect.left - padding);
      const minY = Math.max(0, targetRect.top - padding);
      const maxX = Math.min(doc.width - width, targetRect.right + padding - width);
      const maxY = Math.min(doc.height - height, targetRect.bottom + padding - height);
      let x = focusCenterX - width / 2;
      let y = focusCenterY - height / 2;
      x = maxX >= minX ? clamp(x, minX, maxX) : clamp(x, 0, Math.max(0, doc.width - width));
      y = maxY >= minY ? clamp(y, minY, maxY) : clamp(y, 0, Math.max(0, doc.height - height));
      return { x: Math.floor(x), y: Math.floor(y), width: Math.floor(width), height: Math.floor(height) };
    }

    const active = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    const focusEl = resolve(sample.selector) || active;
    if (!focusEl || !(focusEl instanceof Element)) return null;
    const focusRect = rectFor(focusEl);
    if (!focusRect) return null;
    const target = chooseContainer(focusEl);
    const targetRect = rectFor(target) || focusRect;
    const padding = Number(settings.padding) || 24;
    const maxWidth = Math.max(120, Number(settings.maxWidth) || 900);
    const maxHeight = Math.max(80, Number(settings.maxHeight) || 650);
    const clip = crop(targetRect, focusRect, padding, maxWidth, maxHeight);
    return {
      scope: settings.scope === "element" ? "element-clip" : "container-clip",
      target: stableSelector(target),
      clip,
      targetRect: { x: Math.round(targetRect.left), y: Math.round(targetRect.top), width: Math.round(targetRect.width), height: Math.round(targetRect.height) }
    };
  }, { sample, settings }).catch(() => null);
}

async function captureFocusScreenshot(page, sample, screenshotPath, options) {
  const requestedScope = options.screenshotScope || "container";

  if (requestedScope === "page") {
    await page.screenshot({ path: screenshotPath });
    return { scope: "page", target: sample.selector, clip: null };
  }

  let clipInfo = await buildViewportClampedClip(page, sample, options, requestedScope);

  if (clipInfo && clipInfo.clip && clipInfo.clip.width > 0 && clipInfo.clip.height > 0) {
    try {
      await page.screenshot({ path: screenshotPath, clip: clipInfo.clip });
      return { scope: clipInfo.scope, target: clipInfo.target, clip: clipInfo.clip };
    } catch {
      await page.locator(sample.selector).first().scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => undefined);
      await page.waitForTimeout(50).catch(() => undefined);
      clipInfo = await buildViewportClampedClip(page, sample, options, requestedScope);

      if (clipInfo && clipInfo.clip && clipInfo.clip.width > 0 && clipInfo.clip.height > 0) {
        try {
          await page.screenshot({ path: screenshotPath, clip: clipInfo.clip });
          return { scope: `${clipInfo.scope}-retry`, target: clipInfo.target, clip: clipInfo.clip };
        } catch {}
      }
    }
  }

  // Final fallback: bounded current viewport screenshot, not full-page.
  await page.screenshot({ path: screenshotPath });
  return { scope: "viewport-fallback", target: sample.selector, clip: null };
}

async function buildViewportClampedClip(page, sample, options, requestedScope) {
  return await page.evaluate(({ sample, options, requestedScope }) => {
    function query(selector) {
      if (!selector) return null;
      try {
        return document.querySelector(selector);
      } catch {
        return null;
      }
    }

    function stableSelector(node) {
      if (!node || !(node instanceof Element)) return "";
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
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : "";
        parts.unshift(`${tag}${nth}`);
        current = parent;
      }
      return parts.join(" > ");
    }

    function isUsefulContainer(el, focused) {
      if (!el || !(el instanceof Element)) return false;
      if (el === document.documentElement || el === document.body) return false;

      const rect = el.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;

      const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
      const rectArea = rect.width * rect.height;

      if (rect.width >= window.innerWidth * 0.96 && rect.height >= window.innerHeight * 0.80) return false;
      if (rectArea >= viewportArea * 0.75) return false;

      const focusRect = focused.getBoundingClientRect();
      const focusArea = Math.max(1, focusRect.width * focusRect.height);
      if (rectArea > focusArea * 80 && rect.height > focusRect.height * 10) return false;

      return true;
    }

    function findUsefulContainer(focused) {
      const selectors = [
        "dialog", "form", "fieldset", "table", "tr", "td", "th",
        "ul", "ol", "li", "details",
        "[role='dialog']", "[role='group']", "[role='region']", "[role='tabpanel']",
        "[role='menu']", "[role='listbox']", "[role='radiogroup']", "[role='toolbar']",
        "[data-testid]", "[data-test]", "[data-cy]",
        "article", "section", "aside", "nav", "main"
      ];

      for (const selector of selectors) {
        const candidate = focused.closest(selector);
        if (candidate && candidate !== focused && isUsefulContainer(candidate, focused)) {
          return candidate;
        }
      }

      if (focused.parentElement && isUsefulContainer(focused.parentElement, focused)) {
        return focused.parentElement;
      }

      return focused;
    }

    function clamp(value, min, max) {
      return Math.min(Math.max(value, min), max);
    }

    function makeClipFromRect(rect, padding, maxWidth, maxHeight) {
      if (!rect || rect.width <= 0 || rect.height <= 0) return null;

      let left = rect.left - padding;
      let top = rect.top - padding;
      let right = rect.right + padding;
      let bottom = rect.bottom + padding;

      left = clamp(left, 0, Math.max(0, window.innerWidth - 1));
      top = clamp(top, 0, Math.max(0, window.innerHeight - 1));
      right = clamp(right, left + 1, window.innerWidth);
      bottom = clamp(bottom, top + 1, window.innerHeight);

      let width = right - left;
      let height = bottom - top;

      if (width > maxWidth) {
        const centerX = left + width / 2;
        width = maxWidth;
        left = clamp(centerX - width / 2, 0, Math.max(0, window.innerWidth - width));
      }

      if (height > maxHeight) {
        const centerY = top + height / 2;
        height = maxHeight;
        top = clamp(centerY - height / 2, 0, Math.max(0, window.innerHeight - height));
      }

      left = Math.floor(left);
      top = Math.floor(top);
      width = Math.floor(Math.max(1, Math.min(width, window.innerWidth - left)));
      height = Math.floor(Math.max(1, Math.min(height, window.innerHeight - top)));

      if (left < 0 || top < 0 || width <= 0 || height <= 0) return null;
      if (left + width > window.innerWidth) width = window.innerWidth - left;
      if (top + height > window.innerHeight) height = window.innerHeight - top;
      if (width <= 0 || height <= 0) return null;

      return { x: left, y: top, width, height };
    }

    const focused = query(sample.selector) || document.activeElement;
    if (!focused || !(focused instanceof Element)) return null;

    focused.scrollIntoView({ block: "center", inline: "nearest" });

    const padding = Math.max(0, Number(options.screenshotPadding || 24));
    const maxWidth = Math.max(1, Math.min(Number(options.screenshotMaxWidth || 900), window.innerWidth));
    const maxHeight = Math.max(1, Math.min(Number(options.screenshotMaxHeight || 650), window.innerHeight));

    let target = focused;
    let scope = "element";

    if (requestedScope === "container") {
      target = findUsefulContainer(focused);
      scope = target === focused ? "element" : "container";
    }

    let rect = target.getBoundingClientRect();
    let clip = makeClipFromRect(rect, padding, maxWidth, maxHeight);

    if (!clip) {
      target = focused;
      scope = "element";
      rect = focused.getBoundingClientRect();
      clip = makeClipFromRect(rect, padding, maxWidth, maxHeight);
    }

    if (!clip) return null;

    return { scope, target: stableSelector(target), clip };
  }, { sample, options, requestedScope }).catch(() => null);
}

async function addFocusMarker(page, step) {
  await page.evaluate((step) => {
    const el = document.activeElement;
    if (!el || el === document.body) return;
    const rect = el.getBoundingClientRect();
    const marker = document.createElement("div");
    marker.textContent = String(step);
    marker.style.position = "absolute";
    marker.style.zIndex = "2147483647";
    marker.style.background = "yellow";
    marker.style.color = "black";
    marker.style.border = "2px solid black";
    marker.style.borderRadius = "999px";
    marker.style.font = "bold 13px/1 Arial, sans-serif";
    marker.style.padding = "3px 6px";
    marker.style.top = `${Math.max(0, rect.top + window.scrollY)}px`;
    marker.style.left = `${Math.max(0, rect.left + window.scrollX)}px`;
    marker.style.pointerEvents = "none";
    document.body.appendChild(marker);
    if (el instanceof HTMLElement) {
      el.style.outline = "4px solid #ff00ff";
      el.style.outlineOffset = "3px";
    }
  }, step);
}

async function getDialogState(page) {
  return await page.evaluate(() => {
    function visible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }
    return {
      nativeOpenCount: document.querySelectorAll("dialog[open]").length,
      visibleDialogLikeCount: Array.from(document.querySelectorAll("[role='dialog'],[aria-modal='true']")).filter(visible).length,
      openNativeSelectors: Array.from(document.querySelectorAll("dialog[open]")).map((el, index) => el.id ? "#" + CSS.escape(el.id) : `dialog[open]:nth-of-type(${index + 1})`)
    };
  });
}

function dialogStateChanged(before, after) {
  return before.nativeOpenCount !== after.nativeOpenCount ||
    before.visibleDialogLikeCount !== after.visibleDialogLikeCount ||
    JSON.stringify(before.openNativeSelectors) !== JSON.stringify(after.openNativeSelectors);
}

async function closeOpenDialogs(page) {
  for (let i = 0; i < 5; i++) {
    const state = await getDialogState(page);
    if (state.nativeOpenCount === 0 && state.visibleDialogLikeCount === 0) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(100);
  }
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
        if (value) return `${node.tagName.toLowerCase()}[${attr}="${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
      }
      const parts = [];
      let current = node;
      while (current && current !== document.documentElement && parts.length < 4) {
        const tag = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (!parent) break;
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : "";
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
    const hasOutline = style.outlineStyle !== "none" && style.outlineStyle !== "hidden" && outlineWidth > 0;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const elementAtCenter = centerX >= 0 && centerY >= 0 && centerX <= window.innerWidth && centerY <= window.innerHeight ? document.elementFromPoint(centerX, centerY) : null;

    const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize || "16") || 16;
    const nearestScrollContainer = findNearestScrollContainer(el);

    return {
      step, key,
      tagName: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      accessibleName: getName(el),
      selector: makeStableSelector(el),
      containerSelector: makeContainerSelector(el),
      containerTagName: findContainer(el)?.tagName?.toLowerCase() || el.parentElement?.tagName?.toLowerCase() || el.tagName.toLowerCase(),
      href: el instanceof HTMLAnchorElement ? el.href : null,
      tabIndex: el.tabIndex,
      disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
      ariaHidden: el.getAttribute("aria-hidden"),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      documentRect: { x: Math.round(rect.x + window.scrollX), y: Math.round(rect.y + window.scrollY), width: Math.round(rect.width), height: Math.round(rect.height) },
      scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      rootFontSize,
      direction: getResolvedDirection(el),
      scrollContainer: nearestScrollContainer,
      visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
      focusVisible: hasOutline || style.boxShadow !== "none",
      possiblyObscured: !!elementAtCenter && elementAtCenter !== el && !el.contains(elementAtCenter),
      obscuringSelector: elementAtCenter && elementAtCenter !== el && !el.contains(elementAtCenter) ? makeStableSelector(elementAtCenter) : null,
      focusStyle: { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor, boxShadow: style.boxShadow, borderColor: style.borderColor, backgroundColor: style.backgroundColor }
    };

    function makeStableSelector(node) {
      if (node.id) return "#" + CSS.escape(node.id);
      const attrs = ["data-testid", "data-test", "data-cy", "aria-label", "name"];
      for (const attr of attrs) {
        const value = node.getAttribute(attr);
        if (value) return `${node.tagName.toLowerCase()}[${attr}="${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
      }
      const parts = [];
      let current = node;
      while (current && current !== document.documentElement && parts.length < 4) {
        const tag = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (!parent) break;
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : "";
        parts.unshift(`${tag}${nth}`);
        current = parent;
      }
      return parts.join(" > ");
    }

    function findContainer(node) {
      const containerSelector = [
        "dialog", "main", "section", "article", "aside", "nav", "form", "fieldset",
        "table", "thead", "tbody", "tr", "td", "th", "ul", "ol", "li", "details",
        "[role='dialog']", "[role='group']", "[role='region']", "[role='tabpanel']",
        "[role='menu']", "[role='listbox']", "[role='radiogroup']", "[role='toolbar']",
        "[data-testid]", "[data-test]", "[data-cy]"
      ].join(",");
      const found = node.closest(containerSelector);
      if (found && found !== node) return found;
      return node.parentElement || node;
    }

    function makeContainerSelector(node) {
      return makeStableSelector(findContainer(node));
    }

    function getResolvedDirection(node) {
      const dir =
        node.closest("[dir]")?.getAttribute("dir") ||
        document.documentElement.getAttribute("dir") ||
        document.body?.getAttribute("dir") ||
        window.getComputedStyle(node).direction ||
        window.getComputedStyle(document.documentElement).direction ||
        "ltr";

      return String(dir || "ltr").toLowerCase() === "rtl" ? "rtl" : "ltr";
    }

    function findNearestScrollContainer(node) {
      let current = node.parentElement;

      while (current && current !== document.documentElement && current !== document.body) {
        const style = window.getComputedStyle(current);
        const canScrollX =
          (style.overflowX === "auto" || style.overflowX === "scroll" || style.overflowX === "overlay") &&
          current.scrollWidth > current.clientWidth + 1;
        const canScrollY =
          (style.overflowY === "auto" || style.overflowY === "scroll" || style.overflowY === "overlay") &&
          current.scrollHeight > current.clientHeight + 1;

        if (canScrollX || canScrollY) {
          return {
            selector: makeStableSelector(current),
            scrollLeft: Math.round(current.scrollLeft),
            scrollTop: Math.round(current.scrollTop),
            clientWidth: Math.round(current.clientWidth),
            clientHeight: Math.round(current.clientHeight),
            scrollWidth: Math.round(current.scrollWidth),
            scrollHeight: Math.round(current.scrollHeight),
            canScrollX,
            canScrollY
          };
        }

        current = current.parentElement;
      }

      return null;
    }

    function getName(node) {
      const labelledBy = node.getAttribute("aria-labelledby");
      const labelledByText = labelledBy ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() || "").filter(Boolean).join(" ") : "";
      const labelsText = node.labels && node.labels.length ? node.labels[0]?.textContent?.trim() || "" : "";
      return (node.getAttribute("aria-label") || labelledByText || labelsText || node.getAttribute("alt") || node.getAttribute("title") || node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);
    }
  }, { step, key });
}

async function getInteractiveElements(page) {
  return await page.evaluate(() => {
    const selectors = ["a[href]", "button", "input", "select", "textarea", "summary", "details", "[role='button']", "[role='link']", "[role='checkbox']", "[role='radio']", "[role='switch']", "[role='tab']", "[role='menuitem']", "[role='option']", "[role='combobox']", "[role='slider']", "[role='spinbutton']", "[tabindex]", "[onclick]", "[onkeydown]", "[onkeyup]", "[contenteditable='true']"].join(",");
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
        disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
        ariaHidden: el.getAttribute("aria-hidden"),
        visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
        pointerLike: typeof el.onclick === "function" || el.hasAttribute("onclick") || style.cursor === "pointer" || ["button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "option", "combobox", "slider", "spinbutton"].includes(role || "")
      };
    });

    function makeStableSelector(node) {
      if (node.id) return "#" + CSS.escape(node.id);
      const attrs = ["data-testid", "data-test", "data-cy", "aria-label", "name"];
      for (const attr of attrs) {
        const value = node.getAttribute(attr);
        if (value) return `${node.tagName.toLowerCase()}[${attr}="${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
      }
      const parts = [];
      let current = node;
      while (current && current !== document.documentElement && parts.length < 4) {
        const tag = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (!parent) break;
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : "";
        parts.unshift(`${tag}${nth}`);
        current = parent;
      }
      return parts.join(" > ");
    }

    function getName(node) {
      const labelledBy = node.getAttribute("aria-labelledby");
      const labelledByText = labelledBy ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() || "").filter(Boolean).join(" ") : "";
      const labelsText = node.labels && node.labels.length ? node.labels[0]?.textContent?.trim() || "" : "";
      return (node.getAttribute("aria-label") || labelledByText || labelsText || node.getAttribute("alt") || node.getAttribute("title") || node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);
    }
  });
}

function detectFocusIssues(focusOrder) {
  const issues = [];
  if (focusOrder.length === 0) {
    issues.push({ severity: "critical", wcag: "2.1.1 Keyboard", type: "no-focus", selector: "", description: "No keyboard focusable element was reached with Tab.", evidence: {} });
    return issues;
  }
  for (const sample of focusOrder) {
    if (!sample.focusVisible && sample.visible) issues.push({ severity: "serious", wcag: "2.4.7 Focus Visible", type: "focus-not-visible", selector: sample.selector, description: "Focused element does not expose an obvious outline or box-shadow focus indicator.", evidence: sample });
  }
  return issues;
}

function detectObscuredFocusIssues(focusOrder) {
  return focusOrder.filter((sample) => sample.possiblyObscured).map((sample) => ({ severity: "moderate", wcag: "2.4.11 Focus Not Obscured", type: "focus-obscured-suspect", selector: sample.selector, description: "Focused element may be obscured at its centre point. Manual verification recommended.", evidence: sample }));
}

function detectTrapIssues(focusOrder) {
  if (focusOrder.length < 12) return [];
  const lastTen = focusOrder.slice(-10).map((item) => item.selector);
  return new Set(lastTen).size <= 2 ? [{ severity: "critical", wcag: "2.1.2 No Keyboard Trap", type: "possible-keyboard-trap", selector: "", description: "Tab focus appears to be cycling between one or two elements.", evidence: focusOrder.slice(-12) }] : [];
}

function detectReachabilityIssues(interactiveElements, focusOrder) {
  const focusedSelectors = new Set(focusOrder.map((item) => item.selector));
  const issues = [];
  for (const el of interactiveElements) {
    const expected = el.visible && !el.disabled && el.ariaHidden !== "true" && el.pointerLike && el.tabIndex !== -1;
    if (expected && !focusedSelectors.has(el.selector)) issues.push({ severity: "serious", wcag: "2.1.1 Keyboard", type: "not-keyboard-reachable", selector: el.selector, description: "Visible pointer-like interactive element was not reached during Tab traversal.", evidence: el });
  }
  return issues;
}

/*
 * v0.7 fix:
 * Native dialog activation is success when `dialog[open]` changes.
 * Do not press Space after Enter if Enter already opened a dialog/state changed.
 */
async function detectActivationIssues(page, focusOrder) {
  const issues = [];
  const seen = new Set();
  const originalUrl = page.url();

  for (const sample of focusOrder) {
    if (seen.has(sample.selector)) continue;
    seen.add(sample.selector);

    if (!shouldProbeActivation(sample)) continue;

    try {
      await restoreOriginalPageIfNeeded(page, originalUrl);
      await closeOpenDialogs(page);

      const locator = page.locator(sample.selector).first();
      const count = await locator.count().catch(() => 0);
      if (count < 1) {
        issues.push({
          severity: "minor",
          wcag: "2.1.1 Keyboard",
          type: "activation-not-tested",
          selector: sample.selector,
          description: "Activation probe skipped because the sampled selector was not found after restoring the page.",
          evidence: { sample }
        });
        continue;
      }

      await locator.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => undefined);
      await locator.focus({ timeout: 2000 });

      const beforeUrl = page.url();
      const beforeDialogs = await getDialogState(page);
      const beforeElementState = await getElementState(page, sample.selector);

      await page.keyboard.press("Enter");
      await page.waitForTimeout(250);

      let afterUrl = page.url();
      let afterDialogs = await getDialogState(page);
      let afterElementState = await getElementState(page, sample.selector);

      let changed =
        afterUrl !== beforeUrl ||
        dialogStateChanged(beforeDialogs, afterDialogs) ||
        JSON.stringify(beforeElementState) !== JSON.stringify(afterElementState);

      if (!changed && shouldAlsoTrySpace(sample)) {
        await locator.focus({ timeout: 1000 }).catch(() => undefined);
        await page.keyboard.press("Space").catch(() => undefined);
        await page.waitForTimeout(250);

        afterUrl = page.url();
        afterDialogs = await getDialogState(page);
        afterElementState = await getElementState(page, sample.selector);

        changed =
          afterUrl !== beforeUrl ||
          dialogStateChanged(beforeDialogs, afterDialogs) ||
          JSON.stringify(beforeElementState) !== JSON.stringify(afterElementState);
      }

      if (!changed) {
        issues.push({
          severity: "moderate",
          wcag: "2.1.1 Keyboard",
          type: "activation-failed",
          selector: sample.selector,
          description: "Keyboard activation did not produce an observable URL, open-dialog, or element state change. Manual confirmation recommended.",
          evidence: { sample, beforeDialogs, afterDialogs, beforeElementState, afterElementState }
        });
      }

      await closeOpenDialogs(page);
      await restoreOriginalPageIfNeeded(page, originalUrl);
    } catch (error) {
      issues.push({
        severity: "minor",
        wcag: "2.1.1 Keyboard",
        type: "activation-not-tested",
        selector: sample.selector,
        description: "Activation probe could not be completed reliably. This is a harness limitation, not a confirmed accessibility failure.",
        evidence: { sample, error: String(error) }
      });
      await closeOpenDialogs(page).catch(() => undefined);
      await restoreOriginalPageIfNeeded(page, originalUrl).catch(() => undefined);
    }
  }

  return issues;
}

function shouldProbeActivation(sample) {
  if (!sample || sample.disabled || sample.ariaHidden === "true") return false;
  const role = sample.role || "";
  const tag = sample.tagName || "";
  if (tag === "a" && role !== "button") return false;
  return tag === "button" || tag === "summary" || role === "button" || role === "menuitem" || role === "tab" || role === "switch" || role === "checkbox" || role === "radio";
}

function shouldAlsoTrySpace(sample) {
  const tag = sample.tagName || "";
  const role = sample.role || "";
  return tag === "button" || tag === "summary" || role === "button" || role === "checkbox" || role === "radio" || role === "switch";
}

async function restoreOriginalPageIfNeeded(page, originalUrl) {
  const currentNoHash = stripHash(page.url());
  const originalNoHash = stripHash(originalUrl);
  if (currentNoHash !== originalNoHash) {
    await page.goto(originalUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  }
}

function stripHash(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return String(value).split("#")[0];
  }
}

async function getElementState(page, selector) {
  return await page.locator(selector).first().evaluate((el) => ({
    checked: el.getAttribute("aria-checked"),
    selected: el.getAttribute("aria-selected"),
    expanded: el.getAttribute("aria-expanded"),
    pressed: el.getAttribute("aria-pressed"),
    disabled: el.getAttribute("aria-disabled"),
    open: el.hasAttribute("open"),
    value: "value" in el ? el.value : null,
    text: el.textContent ? el.textContent.replace(/\s+/g, " ").trim().slice(0, 120) : ""
  })).catch(() => null);
}

async function probeSkipLinks(page) {
  const skipLinks = await page.evaluate(() => Array.from(document.querySelectorAll("a[href^='#']")).filter((a) => /skip|main|content/i.test(a.textContent || a.getAttribute("aria-label") || "")).slice(0, 10).map((a, index) => {
    if (!a.id) a.setAttribute("data-keyboard-audit-skip-link", String(index));
    return { selector: a.id ? "#" + CSS.escape(a.id) : `[data-keyboard-audit-skip-link="${index}"]`, text: (a.textContent || a.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim(), href: a.getAttribute("href") };
  }));
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
      const activationMovedFocus = !!focusAfterActivation && focusAfterActivation !== link.selector;
      const probe = { ...link, reachedByFirstTab, activationMovedFocus, focusAfterActivation };
      probes.push(probe);
      if (!reachedByFirstTab || !activationMovedFocus) issues.push({ severity: "moderate", wcag: "2.4.1 Bypass Blocks", type: "skip-link-suspect", selector: link.selector, description: "Skip link exists but was not first in Tab order or did not move focus after activation.", evidence: probe });
    } catch {}
  }
  return { probes, issues };
}

async function probeDialogFocusReturn(page, focusOrder) {
  const probes = [];
  const issues = [];
  for (const sample of focusOrder.slice(0, 30)) {
    if (!/dialog|modal|open|menu|filter|settings|more/i.test(`${sample.accessibleName} ${sample.selector}`)) continue;
    try {
      await closeOpenDialogs(page);
      await page.locator(sample.selector).focus({ timeout: 1000 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(200);
      const openedState = await getDialogState(page);
      const opened = openedState.nativeOpenCount > 0 || openedState.visibleDialogLikeCount > 0;
      if (!opened) continue;
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      const closedState = await getDialogState(page);
      const closedWithEscape = closedState.nativeOpenCount === 0 && closedState.visibleDialogLikeCount === 0;
      const activeAfterClose = await getActiveElementSelector(page);
      const focusReturnedToTrigger = activeAfterClose === sample.selector;
      const probe = { triggerSelector: sample.selector, opened, closedWithEscape, focusReturnedToTrigger, activeAfterClose };
      probes.push(probe);
      if (!closedWithEscape || !focusReturnedToTrigger) issues.push({ severity: "serious", wcag: "2.1.2 No Keyboard Trap", type: "dialog-focus-return-failed", selector: sample.selector, description: "Dialog-like interaction did not close with Escape or did not return focus to the trigger.", evidence: probe });
      await closeOpenDialogs(page);
    } catch {
      await closeOpenDialogs(page).catch(() => undefined);
    }
  }
  return { probes, issues };
}

function analyseFocusOrderHeuristic(focusOrder, pageDirection = { dir: "ltr" }) {
  const inversions = [];
  const visible = focusOrder.filter((item) => item.visible && item.rect.width > 0 && item.rect.height > 0);
  const pageDir = pageDirection && pageDirection.dir === "rtl" ? "rtl" : "ltr";

  function pos(item) {
    return item.documentRect || item.rect;
  }

  function inlineStart(item) {
    const p = pos(item);
    return (item.direction || pageDir) === "rtl" ? p.x + p.width : p.x;
  }

  function blockStart(item) {
    return pos(item).y;
  }

  function relativeTolerance(prev, current) {
    const fontSize = Math.max(1, prev.rootFontSize || current.rootFontSize || 16);
    const prevSize = Math.max(prev.rect.width || 0, prev.rect.height || 0);
    const currentSize = Math.max(current.rect.width || 0, current.rect.height || 0);

    // Replaces previous fixed 30px/40px thresholds. The tolerance scales with
    // text size and target size, which is more robust for zoomed layouts and
    // large controls.
    return Math.max(fontSize * 1.5, Math.min(96, Math.max(prevSize, currentSize) * 0.35));
  }

  function directionForPair(prev, current) {
    if (prev.direction && current.direction && prev.direction === current.direction) return prev.direction;
    return pageDir;
  }

  function movedAgainstInlineDirection(prev, current, tolerance) {
    const dir = directionForPair(prev, current);
    const prevInline = inlineStart(prev);
    const currentInline = inlineStart(current);

    // In LTR, suspicious inline movement is backwards to the left.
    // In RTL, suspicious inline movement is backwards to the right.
    return dir === "rtl"
      ? currentInline > prevInline + tolerance
      : currentInline < prevInline - tolerance;
  }

  function movedUp(prev, current, tolerance) {
    return blockStart(current) < blockStart(prev) - tolerance;
  }

  function sameRow(prev, current, tolerance) {
    return Math.abs(blockStart(current) - blockStart(prev)) <= tolerance;
  }

  function scrollChanged(prev, current) {
    if (!prev || !current) return false;

    if (prev.scroll && current.scroll) {
      const pageScrollXChanged = Math.abs((current.scroll.x || 0) - (prev.scroll.x || 0)) > 1;
      const pageScrollYChanged = Math.abs((current.scroll.y || 0) - (prev.scroll.y || 0)) > 1;
      if (pageScrollXChanged || pageScrollYChanged) return true;
    }

    const prevScroller = prev.scrollContainer;
    const currentScroller = current.scrollContainer;

    if (prevScroller && currentScroller && prevScroller.selector === currentScroller.selector) {
      const xChanged = Math.abs((currentScroller.scrollLeft || 0) - (prevScroller.scrollLeft || 0)) > 1;
      const yChanged = Math.abs((currentScroller.scrollTop || 0) - (prevScroller.scrollTop || 0)) > 1;
      if (xChanged || yChanged) return true;
    }

    // If focus moves into or out of a horizontally scrollable region, do not
    // apply the visual-order heuristic to that transition. Carousels, tables,
    // and zoomed layouts frequently scroll horizontally during keyboard use.
    if (
      (prevScroller && prevScroller.canScrollX) ||
      (currentScroller && currentScroller.canScrollX)
    ) {
      return true;
    }

    return false;
  }

  for (let i = 1; i < visible.length; i++) {
    const prev = visible[i - 1];
    const current = visible[i];
    const tolerance = relativeTolerance(prev, current);

    if (scrollChanged(prev, current)) continue;

    const backwardsInline = movedAgainstInlineDirection(prev, current, tolerance);
    const upward = movedUp(prev, current, tolerance);
    const sameVisualRow = sameRow(prev, current, tolerance);

    // Upward movement alone is allowed. This commonly happens in sidebars,
    // menus, multi-column layouts, and responsive layouts.
    //
    // Flag only:
    // - backwards movement within the same row, or
    // - diagonal movement upwards and backwards.
    //
    // For LTR this means leftward or up-left. For RTL this means rightward or
    // up-right.
    if (backwardsInline && (sameVisualRow || upward)) {
      const dir = directionForPair(prev, current);
      inversions.push({
        from: prev,
        to: current,
        reason:
          dir === "rtl"
            ? "Focus moved backward in RTL visual order (rightward, or up-right)."
            : "Focus moved backward in LTR visual order (leftward, or up-left).",
        tolerance,
        direction: dir
      });
    }
  }

  const heuristic = {
    direction: pageDir,
    inversions: inversions.slice(0, 20),
    notes: [
      "Upward-only focus movement is allowed.",
      "Inline direction is derived from dir/CSS direction; RTL pages expect right-to-left progression.",
      "Transitions involving page or scroll-container movement are ignored.",
      "Thresholds are relative to root font size and focused element size rather than fixed pixel values."
    ]
  };

  const issues = inversions.length ? [{
    severity: "moderate",
    wcag: "2.4.3 Focus Order",
    type: "focus-order-suspect",
    selector: "",
    description: "Tab order appears to move backwards in visual order. Manual verification required.",
    evidence: heuristic
  }] : [];

  return { heuristic, issues };
}

function formatAxeIssue(violation) {
  const affected = Array.isArray(violation.nodes) ? violation.nodes.length : 0;
  const firstTargets = Array.isArray(violation.nodes)
    ? violation.nodes
        .flatMap((node) => Array.isArray(node.target) ? node.target : [])
        .slice(0, 5)
    : [];

  const human = humanizeAxeViolation(violation);
  const severity = mapAxeImpactToSeverity(violation.impact);

  return {
    severity,
    wcag: "axe-core",
    type: "axe",
    selector: firstTargets.join(", "),
    description: human.summary,
    evidence: {
      id: violation.id,
      impact: violation.impact,
      rule: violation.help || violation.id,
      problem: human.problem,
      whyItMatters: human.whyItMatters,
      suggestedFix: human.suggestedFix,
      affectedNodes: affected,
      exampleTargets: firstTargets,
      helpUrl: violation.helpUrl,
      nodes: violation.nodes
    }
  };
}

function mapAxeImpactToSeverity(impact) {
  if (impact === "critical") return "critical";
  if (impact === "serious") return "serious";
  if (impact === "moderate") return "moderate";
  return "minor";
}

function humanizeAxeViolation(violation) {
  const id = violation.id;
  const help = violation.help || "";
  const description = violation.description || "";
  const affected = Array.isArray(violation.nodes) ? violation.nodes.length : 0;
  const affectedText = affected === 1 ? "1 affected element" : `${affected} affected elements`;

  const custom = {
    "landmark-one-main": {
      problem: "The page does not have a single main landmark.",
      whyItMatters:
        "Screen reader and keyboard users often use landmarks to jump directly to the main content. Without a main landmark, the page is harder to navigate efficiently.",
      suggestedFix:
        "Wrap the primary page content in a <main> element, or add role=\"main\" to the element that contains the main content. Ensure there is only one main landmark on the page.",
      summary: `Page is missing a main landmark (${affectedText}).`
    },
    "region": {
      problem: "Some visible page content is not inside a landmark region.",
      whyItMatters:
        "Landmarks help assistive technology users understand the page structure and move between major sections.",
      suggestedFix:
        "Place page content inside appropriate landmarks such as <header>, <nav>, <main>, <aside>, or <footer>. For test/demo pages this may be lower priority than functional keyboard issues.",
      summary: `Some page content is outside landmarks (${affectedText}).`
    },
    "button-name": {
      problem: "A button does not have an accessible name.",
      whyItMatters:
        "Screen reader users need a clear button name to understand what action the button performs.",
      suggestedFix:
        "Provide visible text inside the button, or use aria-label/aria-labelledby when visible text is not possible.",
      summary: `Button is missing an accessible name (${affectedText}).`
    },
    "link-name": {
      problem: "A link does not have an accessible name.",
      whyItMatters:
        "Screen reader users need meaningful link text to understand the destination or purpose of the link.",
      suggestedFix:
        "Provide meaningful visible link text, or use aria-label/aria-labelledby when appropriate.",
      summary: `Link is missing an accessible name (${affectedText}).`
    },
    "aria-dialog-name": {
      problem: "A dialog does not have an accessible name.",
      whyItMatters:
        "When a dialog opens, assistive technology users need to know what the dialog is for.",
      suggestedFix:
        "Add aria-label or aria-labelledby to the dialog, usually referencing the dialog heading.",
      summary: `Dialog is missing an accessible name (${affectedText}).`
    },
    "color-contrast": {
      problem: "Text contrast is below the required threshold.",
      whyItMatters:
        "Low contrast can make text difficult or impossible to read for users with low vision or colour perception differences.",
      suggestedFix:
        "Increase foreground/background contrast to meet WCAG contrast requirements.",
      summary: `Text has insufficient colour contrast (${affectedText}).`
    },
    "document-title": {
      problem: "The page does not have a useful document title.",
      whyItMatters:
        "The page title is announced by screen readers and shown in browser tabs. It helps users identify where they are.",
      suggestedFix:
        "Add a concise, descriptive <title> element.",
      summary: `Page title is missing or not useful (${affectedText}).`
    },
    "html-has-lang": {
      problem: "The page does not specify its language.",
      whyItMatters:
        "Screen readers use the page language to choose the correct pronunciation rules.",
      suggestedFix:
        "Add a lang attribute to the <html> element, for example <html lang=\"en\">.",
      summary: `Page language is not specified (${affectedText}).`
    },
    "image-alt": {
      problem: "An image is missing alternative text.",
      whyItMatters:
        "Screen reader users need text alternatives for informative images.",
      suggestedFix:
        "Add appropriate alt text for informative images, or use alt=\"\" for decorative images.",
      summary: `Image is missing alternative text (${affectedText}).`
    },
    "label": {
      problem: "A form control does not have an associated label.",
      whyItMatters:
        "Labels help screen reader users understand what information is expected in a form field.",
      suggestedFix:
        "Associate a visible <label> with the control, or use aria-label/aria-labelledby when necessary.",
      summary: `Form control is missing a label (${affectedText}).`
    }
  };

  if (custom[id]) return custom[id];

  const problem = help || description || `axe-core rule failed: ${id}`;
  const whyItMatters = description || "This automated accessibility rule found a potential barrier that should be reviewed.";
  const suggestedFix = inferAxeFix(violation);

  return {
    problem,
    whyItMatters,
    suggestedFix,
    summary: `${problem} (${affectedText}).`
  };
}

function inferAxeFix(violation) {
  const id = violation.id || "";
  if (id.includes("aria")) return "Review the ARIA attributes, roles, and relationships on the affected element(s).";
  if (id.includes("landmark") || id === "region") return "Review the page landmark structure and wrap content in appropriate semantic regions.";
  if (id.includes("name")) return "Provide a meaningful accessible name using visible text, aria-label, or aria-labelledby.";
  if (id.includes("label")) return "Associate the form control with a visible label or an appropriate accessible name.";
  if (id.includes("contrast")) return "Adjust colours to meet the required contrast ratio.";
  return "Review the affected element(s) using the axe help URL and confirm the appropriate semantic, keyboard, or accessible-name fix.";
}

function summarizeReport(report) {
  const severityCounts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const wcag = {};
  const responsive = {};
  for (const page of report.pages) {
    const key = `${page.viewport.name} @ ${page.zoom}x`;
    if (!responsive[key]) responsive[key] = { pages: 0, issues: 0, critical: 0, serious: 0, moderate: 0, focusableReached: 0, interactiveElements: 0 };
    responsive[key].pages++;
    responsive[key].issues += page.issues.length;
    responsive[key].focusableReached += new Set(page.focusOrder.map((item) => item.selector)).size;
    responsive[key].interactiveElements += page.interactiveElements.length;
    for (const issue of page.issues) {
      severityCounts[issue.severity] = (severityCounts[issue.severity] || 0) + 1;
      responsive[key][issue.severity] = (responsive[key][issue.severity] || 0) + 1;
      const wcagKey = issue.wcag || "Unmapped";
      if (!wcag[wcagKey]) wcag[wcagKey] = { count: 0, severity: { critical: 0, serious: 0, moderate: 0, minor: 0 }, meta: WCAG_MAP[wcagKey] || {} };
      wcag[wcagKey].count++;
      wcag[wcagKey].severity[issue.severity] = (wcag[wcagKey].severity[issue.severity] || 0) + 1;
    }
  }
  return { severityCounts, wcag, responsive, totalIssues: Object.values(severityCounts).reduce((sum, n) => sum + n, 0) };
}

async function writeReports(report, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  report.summary = summarizeReport(report);
  const jsonPath = path.join(outputDir, `keyboard-audit-${stamp}.json`);
  const mdPath = path.join(outputDir, `keyboard-audit-${stamp}.md`);
  const htmlPath = path.join(outputDir, `dashboard-${stamp}.html`);
  const md = toMarkdown(report);
  const html = toHtmlDashboard(report);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(mdPath, md, "utf8");
  await fs.writeFile(htmlPath, html, "utf8");
  await fs.writeFile(path.join(outputDir, "latest.json"), JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(path.join(outputDir, "latest.md"), md, "utf8");
  await fs.writeFile(path.join(outputDir, "dashboard.html"), html, "utf8");
  return { jsonPath, mdPath, htmlPath };
}

function toMarkdown(report) {
  const lines = ["# Keyboard operability responsive audit", "", `Generated: ${report.generatedAt}`, "", "## Responsive comparison", "", "| Viewport / zoom | Pages | Issues | Critical | Serious | Moderate | Focusable reached | Interactive elements |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"];
  for (const [key, data] of Object.entries(report.summary.responsive)) lines.push(`| ${cell(key)} | ${data.pages} | ${data.issues} | ${data.critical || 0} | ${data.serious || 0} | ${data.moderate || 0} | ${data.focusableReached} | ${data.interactiveElements} |`);
  lines.push("", "## WCAG summary", "", "| WCAG | Level | Category | Issues | Critical | Serious | Moderate | Minor |", "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |");
  for (const [wcag, data] of Object.entries(report.summary.wcag)) lines.push(`| ${cell(wcag)} | ${cell(data.meta.level || "")} | ${cell(data.meta.category || "")} | ${data.count} | ${data.severity.critical || 0} | ${data.severity.serious || 0} | ${data.severity.moderate || 0} | ${data.severity.minor || 0} |`);
  lines.push("");
  for (const page of report.pages) {
    lines.push(`## ${page.title || page.url}`, "", `URL: ${page.url}`, "", `Viewport: ${page.viewport.width}x${page.viewport.height} (${page.viewport.name})`, `Zoom: ${page.zoom}x`, `Effective CSS viewport: ${page.effectiveCssViewport.width}x${page.effectiveCssViewport.height}`, "", "| Metric | Count |", "| --- | ---: |", `| Interactive elements found | ${page.interactiveElements.length} |`, `| Unique focusable elements reached | ${new Set(page.focusOrder.map((item) => item.selector)).size} |`, `| axe-core violations | ${page.axeViolations.length} |`, `| Total issues | ${page.issues.length} |`, "");
    if (page.issues.length) {
      lines.push("### Issues", "", "| Severity | WCAG | Type | Selector | Description |", "| --- | --- | --- | --- | --- |");
      for (const issue of page.issues) lines.push(`| ${cell(issue.severity)} | ${cell(issue.wcag)} | ${cell(issue.type)} | ${cell(issue.selector || "")} | ${cell(issue.description)} |`);
      lines.push("");
    }

    const axeIssues = page.issues.filter((issue) => issue.type === "axe");
    if (axeIssues.length) {
      lines.push("### axe-core findings in plain language", "");
      for (const issue of axeIssues) {
        const evidence = issue.evidence || {};
        lines.push(`#### ${cell(evidence.problem || issue.description)}`, "");
        lines.push(`- **Rule:** ${cell(evidence.rule || evidence.id || "axe-core")}`);
        lines.push(`- **Impact:** ${cell(evidence.impact || issue.severity)}`);
        lines.push(`- **Affected elements:** ${evidence.affectedNodes || 0}`);
        if (evidence.exampleTargets && evidence.exampleTargets.length) {
          lines.push(`- **Example target(s):** ${cell(evidence.exampleTargets.join(", "))}`);
        }
        if (evidence.whyItMatters) lines.push(`- **Why it matters:** ${cell(evidence.whyItMatters)}`);
        if (evidence.suggestedFix) lines.push(`- **Suggested fix:** ${cell(evidence.suggestedFix)}`);
        if (evidence.helpUrl) lines.push(`- **More info:** ${evidence.helpUrl}`);
        lines.push("");
      }
    }

    lines.push("### Focus order", "", "| Step | Element | Container | Role | Name | Visible focus | Screenshot |", "| ---: | --- | --- | --- | --- | --- |");
    for (const item of page.focusOrder.slice(0, 160)) lines.push(`| ${item.step} | ${cell(item.selector)} | ${cell(item.containerSelector || "")} | ${cell(item.role || "")} | ${cell(item.accessibleName)} | ${item.focusVisible ? "yes" : "no"} | ${item.screenshot ? `[${item.screenshotScope || "image"}](${item.screenshot})` : ""} |`);
    lines.push("");
  }
  return lines.join("\n");
}

function toHtmlDashboard(report) {
  const responsiveRows = Object.entries(report.summary.responsive).map(([key, data]) => `<tr><td>${h(key)}</td><td>${data.pages}</td><td>${data.issues}</td><td class="critical">${data.critical || 0}</td><td class="serious">${data.serious || 0}</td><td class="moderate">${data.moderate || 0}</td><td>${data.focusableReached}</td><td>${data.interactiveElements}</td></tr>`).join("");
  const wcagRows = Object.entries(report.summary.wcag).map(([wcag, data]) => `<tr><td>${h(wcag)}</td><td>${h(data.meta.level || "")}</td><td>${h(data.meta.category || "")}</td><td>${data.count}</td><td class="critical">${data.severity.critical || 0}</td><td class="serious">${data.severity.serious || 0}</td><td class="moderate">${data.severity.moderate || 0}</td><td>${data.severity.minor || 0}</td></tr>`).join("");
  const pageSections = report.pages.map((page) => {
    const issueRows = page.issues.map((issue) => `<tr><td class="${h(issue.severity)}">${h(issue.severity)}</td><td>${h(issue.wcag)}</td><td>${h(issue.type)}</td><td><code>${h(issue.selector || "")}</code></td><td>${h(issue.description)}</td></tr>`).join("") || `<tr><td colspan="5">No issues detected.</td></tr>`;
    const focusRows = page.focusOrder.slice(0, 160).map((item) => `<tr><td>${item.step}</td><td><code>${h(item.selector)}</code></td><td><code>${h(item.containerSelector || "")}</code></td><td>${h(item.role || "")}</td><td>${h(item.accessibleName || "")}</td><td>${item.focusVisible ? "yes" : "no"}</td><td>${item.screenshot ? `<a href="${h(item.screenshot)}">${h(item.screenshotScope || "screenshot")}</a>` : ""}</td></tr>`).join("");
    return `<section><h2>${h(page.title || page.url)}</h2><p><a href="${h(page.url)}">${h(page.url)}</a></p><p><strong>Viewport:</strong> ${page.viewport.width}x${page.viewport.height} (${h(page.viewport.name)}) &nbsp; <strong>Zoom:</strong> ${page.zoom}x &nbsp; <strong>Effective CSS viewport:</strong> ${page.effectiveCssViewport.width}x${page.effectiveCssViewport.height}</p><div class="cards"><div><strong>${page.interactiveElements.length}</strong><span>interactive elements</span></div><div><strong>${new Set(page.focusOrder.map((i) => i.selector)).size}</strong><span>focusable reached</span></div><div><strong>${page.issues.length}</strong><span>issues</span></div></div><h3>Issues</h3><table><thead><tr><th>Severity</th><th>WCAG</th><th>Type</th><th>Selector</th><th>Description</th></tr></thead><tbody>${issueRows}</tbody></table><h3>Focus order</h3><table><thead><tr><th>Step</th><th>Selector</th><th>Role</th><th>Name</th><th>Visible focus</th><th>Screenshot</th></tr></thead><tbody>${focusRows}</tbody></table></section>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Keyboard operability responsive dashboard</title><style>body{font-family:system-ui,Segoe UI,sans-serif;margin:2rem;color:#1f2937}table{border-collapse:collapse;width:100%;margin:1rem 0 2rem}th,td{border:1px solid #d1d5db;padding:.5rem;vertical-align:top}th{background:#f3f4f6;text-align:left}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1rem}.cards div{border:1px solid #d1d5db;border-radius:12px;padding:1rem;background:#f9fafb}.cards strong{display:block;font-size:2rem}.critical{color:#991b1b;font-weight:700}.serious{color:#b45309;font-weight:700}.moderate{color:#1d4ed8;font-weight:700}section{border-top:3px solid #111827;margin-top:2rem;padding-top:1rem}code{font-size:.85em}</style></head><body><h1>Keyboard operability responsive dashboard</h1><p>Generated: ${h(report.generatedAt)}</p><div class="cards"><div><strong>${report.summary.totalIssues}</strong><span>total issues</span></div><div><strong>${report.summary.severityCounts.critical}</strong><span>critical</span></div><div><strong>${report.summary.severityCounts.serious}</strong><span>serious</span></div><div><strong>${report.pages.length}</strong><span>page/viewport runs</span></div></div><h2>Responsive comparison</h2><table><thead><tr><th>Viewport / zoom</th><th>Pages</th><th>Issues</th><th>Critical</th><th>Serious</th><th>Moderate</th><th>Focusable reached</th><th>Interactive elements</th></tr></thead><tbody>${responsiveRows}</tbody></table><h2>WCAG summary</h2><table><thead><tr><th>WCAG</th><th>Level</th><th>Category</th><th>Issues</th><th>Critical</th><th>Serious</th><th>Moderate</th><th>Minor</th></tr></thead><tbody>${wcagRows}</tbody></table>${pageSections}</body></html>`;
}

function cell(value) { return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ").trim(); }
function h(value) { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function hasSeriousIssues(issues) { return issues.some((issue) => issue.severity === "critical" || issue.severity === "serious"); }
function slugify(value) { return String(value).toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "page"; }

async function main() {
  const options = readArgs();
  await fs.mkdir(options.outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: options.headless });
  const pages = [];
  try {
    for (const [urlIndex, url] of options.urls.entries()) {
      for (const [matrixIndex, matrixItem] of options.matrix.entries()) {
        const context = await browser.newContext({ viewport: { width: matrixItem.viewport.width, height: matrixItem.viewport.height }, reducedMotion: "reduce" });
        const page = await context.newPage();
        console.log(`Auditing ${url} at ${matrixItem.viewport.width}x${matrixItem.viewport.height}, zoom ${matrixItem.zoom}x`);
        pages.push(await auditPage(page, url, options, urlIndex + 1 + matrixIndex, matrixItem));
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  const report = { generatedAt: new Date().toISOString(), matrix: options.matrix, pages };
  const paths = await writeReports(report, options.outputDir);
  console.log(`JSON report: ${paths.jsonPath}`);
  console.log(`Markdown report: ${paths.mdPath}`);
  console.log(`HTML dashboard: ${paths.htmlPath}`);
  console.log(`Latest dashboard: ${path.join(options.outputDir, "dashboard.html")}`);
  const serious = report.pages.flatMap((page) => page.issues).filter((issue) => hasSeriousIssues([issue]));
  if (options.failOnSerious && serious.length > 0) {
    console.error(`Found ${serious.length} critical/serious keyboard issue(s).`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
