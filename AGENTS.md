# Local-Notepad development

Current local module: 2F.99 /4.232.0 complete local document import workspace. Read docs/LOCAL_DOCUMENT_IMPORT_2F99.md. Accepted base b6ad9c63587a7af0625c94a7ebe0b2c23e69ca6f /4.231.2 is PR2 comment6235630783. Complete real native file selection/drop, isolated bounded conversion, title/folder/preview, explicit batch confirmation, immutable receipts, per-item results, stop/close/restart recovery, safe result opening and actionable failures. Persist every confirmed intent before POST; unknown outcomes keep the same UUID and payload, read back before retry, and never recreate deleted/missing results. Do not silently discard damaged records or incomplete folder pages. Build and package the import worker; preserve all existing modules, original save/discard/cancel/quit, schema14 and679 dependency nodes. The original Wiki creation-epoch and source-owned navigation protections remain. No cloud/multidevice or rejected dependency export.

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
Observe the same workflow at least 90 seconds apart. At 30 external connector calls, checkpoint and reassess the remaining work instead of unbounded polling/downloads.
Record final acceptance in a PR comment/local report, not a new source commit just to update status and restart every workflow.

Application versions are not phase numbers. For a code-bearing user delivery, explicitly increment the patch version for fixes or minor version for features; keep schema14 and dependency nodes unchanged. Use `npm run version:patch` or `npm run version:minor`, then run `node scripts/check-app-version.mjs --previous-version=<last-accepted-app-version>` before pushing. Check the new installer, not a renamed old binary. Do not increment versions automatically during builds, create release tags, or make status-only version commits. See `docs/APP_VERSION_2F62_1.md`.

User delivery requirement: one complete functional workflow per delivery, including entry, normal operation, result, cancellation/failure handling and verification. Internal commits are not separate user-facing stages. Do not extend the completed offline-report feature with more tiny controls. Fix reproduced blockers before selecting a new full feature; do not make the user repeatedly request missing portions.
