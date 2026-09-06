# Pointer selection regression tests

Run `npm install`, then `npm run test:pointer`. The runner uses installed Chrome
or Edge, falling back to Playwright Chromium. If none is available, install it
with `npx playwright install chromium`.

The test bundles the production extension with a minimal Obsidian API stub and
uses real CodeMirror views and browser mouse events. A table widget contains a
nested editor: selecting its text must never dispatch a transaction in the outer
editor. It also checks ordinary click deferral, drag selection, cancellation,
window blur, widget controls, disabled mode, and source mode.

To check an older revision in PowerShell:

```powershell
$env:TSH_BASELINE_REF = '1.2.1'
try { npm run test:pointer } finally { Remove-Item Env:TSH_BASELINE_REF }
```

Version 1.2.1 fails the table isolation assertion. The harness does not emulate
Obsidian's entire table renderer; verify cell editing and link reveal in Obsidian
as well. The 2026-09-06 real-app before/after verification is recorded in ADR 0001.
