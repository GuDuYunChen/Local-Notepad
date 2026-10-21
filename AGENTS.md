# Local-Notepad development

Current local module: 2F.102 / 4.235.0 local document export workspace. Read docs/LOCAL_DOCUMENT_EXPORT_2F102.md. The accepted product baseline is d3f47277a6a148bf62e50f22b3bf068819a7e1fe / 4.234.0, with final PR acceptance comment 6307542211 and complete Windows installation verifier 08f3a543cb7b036b7f8049100dbf1651bc3851a5. The 2F.101 shortcut, find focus, visible recording feedback and Wiki outline readiness repairs have completed acceptance; earlier candidate failures stay as history and do not reopen finished acceptance. Complete the existing Word/Markdown export workflow: selection, frozen saved-body preview, native directory consent, exclusive outputs, per-file verified receipts, cancellation/continuation and failed-only retries. Do not save editor drafts as a side effect of export. Preserve all reading, import, shortcut, Wiki and save/leave/quit protections, schema14 and 679 dependency nodes. Cloud/multidevice work stays deferred. This source checkpoint does not claim the new HEAD, 4.235.0 EXE or installation lifecycle has passed; use the actual ref and latest PR acceptance record.

Read `docs/DEVELOPMENT_HANDOFF.md` before resuming an interrupted task.
Work on `feature/knowledge-os-phase2` / Draft PR #2 unless the user explicitly changes that direction. Do not merge master as part of ordinary stage development.

Resolve the current remote HEAD before interpreting a stage name or an older PR description. Treat source completion, current-HEAD CI acceptance and verified deliverables as separate checkpoints.
Use `npm ci --no-audit --no-fund` with the committed package-lock.json. Do not remove the lock or add an npm-install fallback to make a test pass.
Preserve existing save/receipt/queue/reference/quit invariants. Do not require extra manual saves or weaken dirty-editor exit protection to fix unrelated UI work.
Fix reproduced problems before starting another functional stage; preserve original failing evidence and regenerate current-HEAD evidence.
Keep test fixtures isolated from user data. Never report synthetic Windows tests as on-site testing of the user's workspace.
Write a concise PR checkpoint after pushing and a separate final acceptance record. Missing final chat output does not mean prior successful repository writes were lost.

Before touching code, read `docs/KNOWN_ISSUES.md` and `docs/STAGE_REVIEW_PROTOCOL.md`.
Run `node scripts/stage-review.mjs catalog` to check the incident/regression links; it is NOT a test run.
Use current-HEAD workflow path+event checks, not old PR titles or display names. All-green CI still requires artifact verification.
Keep progress concise and put full logs in files. Do not repeatedly fetch whole-PR diffs or unchanged reports.
Do not blindly retry unchanged failures. One evidence-justified transient retry per affected job is the limit before recording a blocked checkpoint.
When a tool write is blocked, stop that write; preserve a local handoff and report the failure. Do not bypass a safety rejection or fabricate a successful comment.
These process limits do not diagnose or guarantee prevention of ChatGPT stream failures.

Read `docs/ASSISTANT_EXECUTION_INCIDENTS.md` for assistant-caused execution risks; do not substitute the product defect catalog for that request.
Before pushing, test negative evidence/scope cases locally. Do not chain a new feature onto an unaccepted fix.
Before a code-bearing push, run the unfiltered default Vitest suite as well as the focused test:ui list; the default suite also reaches shared Electron source pins and real loopback/Go contracts. Use the exact CI Go toolchain when needed. Missing tools, EPERM, filtered cases or a file-level pass are not full-suite acceptance. Review every protected source pin affected by an intentional change before rebasing its exact digest; preserve the original assertions and failures.
Observe the same workflow at least 90 seconds apart. At 30 external connector calls, checkpoint and reassess the remaining work instead of unbounded polling/downloads.
Record final acceptance in a PR comment/local report, not a new source commit just to update status and restart every workflow.

Application versions are not phase numbers. For a code-bearing user delivery, explicitly increment the patch version for fixes or minor version for features; keep schema14 and dependency nodes unchanged. Use `npm run version:patch` or `npm run version:minor`, then run `node scripts/check-app-version.mjs --previous-version=<last-accepted-app-version>` before pushing. Check the new installer, not a renamed old binary. Do not increment versions automatically during builds, create release tags, or make status-only version commits. See `docs/APP_VERSION_2F62_1.md`.

User delivery requirement: one complete functional workflow per delivery, including entry, normal operation, result, cancellation/failure handling and verification. Internal commits are not separate user-facing stages. Do not extend the completed offline-report feature with more tiny controls. Fix reproduced blockers before selecting a new full feature; do not make the user repeatedly request missing portions.
