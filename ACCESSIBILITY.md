# ACCESSIBILITY.md

This file defines how accessibility findings from this repository should be turned into actionable bug reports.

## Purpose

The keyboard audit output is useful only if findings are reproducible and fixable.
Use this guide to convert scan output into high-quality tickets.

## Reporting principles

- Reproducibility first: each issue must be easy for engineering to reproduce.
- Actionability second: each issue must include a clear fix direction.
- Consistency always: severity and report fields should be uniform across runs.

## Required bug report fields

Every issue raised from an audit should include:

- URL: exact page URL where the issue occurs.
- Component/element locator:
  - Preferred short locator (stable selector or XPath).
  - Full hierarchical locator when needed for ambiguous components.
- HTML snippet: smallest relevant fragment.
- WCAG mapping: criterion number, name, and level where known.
- Rule metadata:
  - Tool (for example: axe-core).
  - Rule ID (for example: landmark-unique).
- Severity: use one scale consistently.
- Frequency:
  - Instances on page.
  - Pages affected.
  - Total pages scanned.

## Recommended additional fields

- Summary title:
  - Format: Component - Failure (WCAG).
- Description:
  - What is wrong and why this is a user barrier.
- Steps to reproduce:
  - Numbered keyboard steps (Tab/Shift+Tab/Enter/Space/Escape).
- Expected behavior.
- Actual behavior.
- Testing environment:
  - Browser and version.
  - OS.
  - Assistive technology and version (if used).
  - Zoom or viewport context.
- Impact statement:
  - Which user groups are affected and how task completion is blocked.
- Suggested fix:
  - Concrete implementation direction or snippet.

## Severity model

Use this shared severity taxonomy:

- Critical: users cannot complete a core task.
- Serious: key workflow is significantly blocked or degraded.
- Moderate: barrier exists with workaround.
- Minor: low-impact issue.

## Frequency and prioritization

Frequency can raise priority:

- A moderate issue on every major page should be prioritized like a serious issue.
- A low severity issue on high-traffic or top-task pages should be escalated.

## How this project should emit report data

For each issue in output artifacts, include or derive:

- url
- severity
- wcag
- type (rule or issue type)
- selector (and full locator when available)
- description
- recommended action

For aggregate triage output, include:

- pages audited
- total issues
- severity totals
- issue-type totals
- top fix recommendations

## Quality checklist for filing an issue

Before creating a ticket:

- URL is exact.
- Locator is specific enough to find the element quickly.
- WCAG and rule IDs are present where available.
- Steps to reproduce are complete.
- Expected and actual behavior are clearly separated.
- Suggested fix is concrete.
- Severity and frequency are both included.

## Workflow

1. Run audit.
2. Review report summary and top fixes.
3. Group duplicates by rule and locator pattern.
4. Open issues with required fields.
5. Track regressions across re-runs.

## Scope note

This repository emphasizes keyboard operability and related automated checks.
Manual confirmation is still required for final accessibility sign-off.
