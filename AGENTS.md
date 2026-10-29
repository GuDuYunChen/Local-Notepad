# Current module: 2F.114 / 4.247.0 local two-note comparison

Accepted master042db00172114d85ad76cff4eba5450d1022d81e/tree1bd8858605c2c039cfa628d7ae4a47f52c4ca40b is completed2F113 (PR19 merged, productCI1779/native91). Work on feature/local-note-comparison-2f114. Read docs/LOCAL_NOTE_COMPARISON_2F114.md. Deliver explicit two-note selection, one readonly saved-body snapshot, bounded exact text/raw differences, original guarded source opening, privacy-confirmed revalidated export, cancellation/errors and current-version native/full installation as ONE module. No merge, deletion, body writes, schema or dependencies change. Older entries below are retained history, not unresolved current work.

---

# Current module: 2F.113 / 4.246.0 local duplicate-note inspection

Accepted master f60ef2562b595dfbd5b4513b3c6a43c22d872856/tree846024d1619f4c02ee6718b0ab14c434366f2ed9 is completed2F112. Work on feature/local-duplicate-notes-2f113; read docs/LOCAL_DUPLICATE_NOTES_2F113.md. Deliver exact saved-body grouping, complete scope, search/two-level pagination, fresh-source original guarded navigation, explicitly confirmed private export with revalidation, cancellation/errors and current-version native/full installation together. Do not delete/merge notes, read attachment content or change protected saving/schema/dependencies. Historical references below do not reopen accepted work.

---

# Current module: 2F.112 / 4.245.0 local trash recovery workspace

Accepted baseline master8683fc5119a1f53269e7bff9acdb01daa26e0b23/tree7418529253ded3266a27a196b60aaa1c04729b16 is accepted 2F111. Work on feature/local-trash-recovery-2f112; read docs/LOCAL_TRASH_RECOVERY_2F112.md. Deliver complete snapshot/search/paging, explicit original/available destination, atomic subtree recovery, strict conflicts and scope, durable uncertainty/read-only reconciliation, original guarded opening and full current-version native/install validation as ONE module. No permanent deletion, body writes, schema or dependency changes. Historical references below do not reopen accepted work.

---

# Current module: 2F.111 / 4.244.0 local folder workspace

Accepted master `b0d02d0f1b29054390f55608904e253343e64421`, tree `9b3701e7318d902554da4d012a81eb2152fc7bb8`, is accepted 2F.110. Work on `feature/local-folder-workspace-2f111`; read `docs/LOCAL_FOLDER_WORKSPACE_2F111.md`. Deliver browsing, create/rename, selected atomic moves, guarded note opening, empty-folder-only trash, durable uncertainty/reconciliation and full current-version native/install acceptance together. Never add a note-body write or recursively delete through this workspace. Keep original storage/save/receipt/quit policies, schema14, locked dependencies and all installation gates. Older references below are retained history, not current open work.

---

# Current module: 2F.110 / 4.243.0 local quick actions

Accepted master `bf5f0ed5cb4cad4a1f1b0f874a87fa093b47f6e4` / tree `23d22c72321747b1314b418082bc453276f83ec0` is 2F.109, already merged and verified. Work on `feature/local-actions-2f110`; read `docs/LOCAL_ACTIONS_2F110.md`. Deliver the local registry, search/category/keyboard panel, original-owner navigation/save decisions, cancellations/errors and actual new-version native/install acceptance as one module. No arbitrary commands, cloud or second note-write path. Older module references below are retained history.

---

# Local-Notepad development

Current local module: 2F.109 / 4.242.0 local task center, branch `feature/local-task-center-2f109`. Read `docs/LOCAL_TASK_CENTER_2F109.md`. Accepted master928caf6c/tree f600aa7f is 2F108/4.241.0 after CI1771 and Windows76. Preserve historical issues, saving/receipts/quit protections, schema14 and dependencies. Deliver saved checklist discovery, explicit coverage, filtering/paging, fresh-source guarded navigation, completion through the original editor and return/reload, private export, cancellation/errors and current-version native/install acceptance together. No separate task-body writes, cloud or multidevice feature.


Read `docs/DEVELOPMENT_HANDOFF.md` before resuming an interrupted task.
Work on `feature/local-task-center-2f109` from the accepted master baseline. The older branch/PR references below are historical. Do not merge master as part of ordinary stage development.

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
