# Local-Notepad development

Current local module: 2F.108 / 4.241.0 local attachment audit, branch `feature/local-attachment-audit-2f108`. Read `docs/LOCAL_ATTACHMENT_AUDIT_2F108.md`. Accepted master21f987b4/tree d9414895 is 2F107/4.240.0 after CI1770 and Windows75. Preserve historical issues, saving/receipts/quit protections, schema14 and dependencies. Complete read-only inventory, conservative candidate references, missing/blocked/gap reporting, guarded navigation, explicit private export, cancellation/errors and current-version native/install acceptance together. Never infer safe deletion from missing references. Cloud/multidevice remains deferred.


Read `docs/DEVELOPMENT_HANDOFF.md` before resuming an interrupted task.
Work on `feature/local-attachment-audit-2f108` from the accepted master baseline. The older branch/PR references below are historical. Do not merge master as part of ordinary stage development.

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
