# Phase 2F.11.1 — Recover interrupted acceptance and reject incomplete native evidence

Baseline: 06baacecaa4972a82744f9d551f35e21fa2fab3a. Keep feature/knowledge-os-phase2, Draft PR #2, 4.189.0/schema13. Do not merge master or advance to the next feature stage before acceptance.

## Confirmed evidence

After the chat reply failed, a fresh PR read showed Phase 2F.11 had already been pushed. Push #1247 / run 36295491289 reported both Linux 108553441936 and Windows 108553909817 as completed/success. However, downloading artifact 10923094671 and verifying SHA-256 fb8fcd4d8189dfec31dc9e36749283cadf21f66d807a7ed7441bda6a1e8e16b8 showed only light-1180.png and checks.json with complete:false and ONE report. The green workflow is therefore not sufficient native acceptance. It does not prove dark/narrow/final-page/search scenarios ran.

The script destroys its sole BrowserWindow after each scenario without subscribing to window-all-closed. Electron's documented default is to quit when all windows close. This explains the zero-exit premature stop consistent with the one-scene artifact; the awaited JavaScript loop is not itself a process-lifetime guarantee. Reference: https://www.electronjs.org/docs/latest/api/app#event-window-all-closed

## Repair

Subscribe to window-all-closed only in this synthetic test harness so the next scenario can run. Existing success/failure app.exit paths and the 60-second watchdog remain. The product application lifecycle is not modified.

Run the native harness from an independent Node parent. Before starting, delete ONLY this harness's generated test-results/sync-conflict-queue directory, preventing stale artifacts from satisfying a new execution. Preserve failures for upload. Require a successful child exit AND complete:true, current GitHub commit identity, explicit native search/focus receipts, zero writes, and all five ordered scenarios with exact counts/ranges. Require all nine contrast probes per scene to be final and >=4.5:1, stable frames, valid layout, no active markup, and five PNG files with appropriate signatures/headers/trailers and dimensions matching their reported image size and actual viewport. Requested 1180x900 windows can be clamped by the runner desktop (the original light PNG was 1008x681); this is recorded, not guessed to be a missing screenshot. Header checks are not image decoding; manual screenshot review is still required. A zero process exit can no longer waive missing evidence.

The Node parent has a 70-second process ceiling to catch a broken child after its existing 60-second watchdog; CI's 18/30-minute limits remain unchanged. It does not create a new retry or silently repeat a failing render.

No production JavaScript/CSS, queue consent/search behavior, backend, dependencies, schema, credentials or synchronization operations change in this repair.

## Tests and verification boundaries

Added 13 independent Node tests, including the EXACT downloaded complete:false JSON from the falsely green run as a negative fixture. Tests cover zero-exit early termination, missing/duplicate scenes, contrast and probe failures, missing or truncated PNG evidence, wrong commit identity, failed native process, and immutable inputs. PNG unit fixtures test the structural checks only, not a claimed Chromium rendering.

Local Node 13/13 and native-script syntax checks passed. Baseline workflow blob 70ac0281022ffd0391b01f4d3a79a16fef81f3f8 and native script blob b4669a415bdd4e30b9f71ac8aeb56b068ee26222 were reconstructed from connector reads and matched before editing. Container DNS access failed; no new local full-repository React/Go/Electron/Windows pass is claimed.

Both platform-specific existing queue test steps now additionally run these tests; all old commands remain. Windows native queue step launches the Node parent instead of directly treating Electron exit 0 as sufficient evidence. No existing gates, relative order or thresholds are removed. Full acceptance requires this new commit's CI plus all five screenshots, not #1247's green status or this document.
