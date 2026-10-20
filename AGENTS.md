# Local-Notepad development

Current local module: 2F.101 / 4.234.0 local shortcut management. Read docs/LOCAL_SHORTCUT_MANAGEMENT_2F101.md. The accepted product baseline is eefed2c4812417eb50481572f0ed5532ea1211ff / 4.233.2, with final PR acceptance comment 6289980546 and complete Windows installation verifier c8965dce1c66ee792eb1dee52d098a8b75784f71. The 2F.100 reading/editing, asynchronous image/table, unapplied field and native evidence repairs have completed acceptance; its earlier source snapshots do not reopen those finished tasks. Complete one local shortcut workflow: existing entry points, searchable commands, capture, conflicts/reserved keys, apply/persist, actual command dispatch, cancel/reset and local storage/external-change errors. Reuse the existing search, editor command palette and save/leave/quit paths. Preserve all reading, import and Wiki protections, schema14 and 679 dependency nodes. Cloud/multidevice work stays deferred. This source checkpoint does not claim the new HEAD, 4.234.0 EXE or installation lifecycle has passed; use the actual ref and latest PR acceptance record.

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
