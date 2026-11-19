# UI focus and hover stability repair / 4.249.1 candidate

## Accepted baseline and user report

The accepted product is 4.249.0 at master `e9da2419e073af155d9a8458c8508ce8d03b600b`
(tree `bc510d581c3b54f38702912701abcb305408d71d`). PR29 and Issue28 retain their
original acceptance and failures. The subsequent user report is tracked in
[Issue31](https://github.com/GuDuYunChen/Local-Notepad/issues/31):

- Clicking a text field adds a separated outer border.
- Hovering the sidebar or notebook rows shifts their content or neighbouring rows.

The working branch is `fix/ui-focus-hover-stability-4-249-1`. This is a repair
of the existing local UI module, not a new business module or the abandoned
PR30 native-control implementation. The existing Ant Design components,
theme variables, schema14, dependencies and save/draft/quit/data policies stay
authoritative.

## Causes and repair boundaries

The shared control stylesheet adds a 2px outline with a positive 2px offset.
Text-editing controls may match `:focus-visible` after a pointer click, so the
existing keyboard test can accept an outline that looks like a second border.
Keep a visible focus indicator, but paint it within the control boundary and
retain the official error/warning colours.

Independent source review also found the locked Ant Design status-specific
`outline:0` rule could override the application's error/warning focus rule.
The status selectors now declare the complete inner outline with sufficient
specificity and exclude disabled controls. Native checks must observe the real
normal and status focus styles; the source review is not a visual pass.

The notebook action container originally changes from `display:none` to
`display:flex` on hover. Its existing 40px Ant Design buttons then enter normal
layout and alter the row's height and title width. Keep the action space in
layout and change visibility without changing geometry; preserve selected-row,
keyboard-focus and focus-within access and the existing rename/delete behavior.

Sidebar legacy `border:0` competes with the official button hover border.
Keep the official border geometry in all states. The More button uses the
existing text variant, without a second button implementation.

The active new/rename dialog wraps an already bordered Ant Design input in a
second custom bordered container. Use the existing Input suffix API for the
fixed extension; preserve the real input's class, value/ref, validation, IME,
disabled, confirm and cancel behavior.

The complete interaction check also reproduced loss of tree focus after
cancelling rename/delete dialogs. Their cancel callbacks now return focus to
the current valid tree item using the existing tree focus helper. If the target
has disappeared, use a visible current/fallback item. Confirmation and all data
write paths remain unchanged. Preserve the original two failing focus tests and
verify native cancellation followed by arrow navigation.

These source findings do not alone establish visual acceptance. The current
browser tool rejected local-page access; that operation was stopped. No other
browser, raw protocol or policy workaround may be used to repeat it. Project
Windows native CI and its recorded real application screenshots remain an
independent required gate.

## Acceptance

1. Preserve the old product under the new native checks and retain its expected
   focus-outline and hover-geometry failures. Bind the baseline product and new
   verifier identities separately. A timeout, missing environment or unrelated
   failure is not a valid regression counterexample.
2. Preserve every old shared-control geometry, keyboard, popup, form and modal
   assertion, all six theme/window combinations and the original 90-second
   native checker budget. Add real pointer and hover measurements and images.
3. Check normal, password, multiline, selection, error/warning and disabled
   controls. Pointer click and keyboard navigation must retain clear feedback
   without an outline painted outside the original field border.
4. Compare sidebar and notebook row, text Range, icon, action-container and
   neighbouring-row rectangles before hover, during hover and after leaving.
   Cover long names, nested/selected/unselected records, minimum window, scroll,
   rename/delete confirmation and cancellation, tree keyboard navigation and
   focus return. Do not replace these with mocked rectangles or CSS-string
   assertions.
5. The shared component fixture uses isolated synthetic records and does not
   claim real-backend coverage. Actual current-version Windows application,
   original full local regression/builds, full installed lifecycle and
   independent acceptance remain required.
6. The current upgrade uses the real accepted 4.249.0 installer:
   115601444 bytes, SHA256
   `2f32acf01ca07cba6c63ab43fdc48700f0f2c9e98ce05c8c93b2a011901e7c52`,
   artifact14349999314 from product run44130882822. Preserve the independent
   original 4.248.0-to-4.248.1 historical upgrade and real historical pins.
7. Publish one coherent repair, verify current-HEAD CI, exact binaries and
   independent review, then merge via PR and verify the actual master tree and
   unchanged main. Final status belongs to Issue31/PR and exact-source evidence;
   this candidate source document does not predeclare acceptance.

## Reproducibility and retained incidents

Use Node24, Go1.24.11, the committed lock and `npm ci`. This session's npm ci
succeeded with Node24.22.3/npm11.9.0 and did not change the lock. The old npm404
is historical, not a current reproduced blockage. Official Go1.24.11 archive
SHA256 is `bceca00afaac856bc48b4cc33db7cd9eb383c81811379faed3bdbc80edb0af65`.

Keep original baseline/failed logs and new verification failures. The local
`go version` executable mismatch, bounded-output truncations, unavailable
optional design-skill references, Vite interface-enumeration error and browser
policy denial are execution/environment records, not product-test passes or
proof of a chat-interruption cause. Do not retry their unchanged conditions.

The first version/upgrade contract run retained a missing generated-fixture
failure and a stale current-upgrade step-name expectation. After building the
required fixtures and updating that exact current-step anchor, the next run
correctly rejected three stale synthetic source blobs. Rebinding only those
active product blobs to the 4.249.1 sources retained every historical template
hash and inverse proof. The subsequent 156-contract run passed; these contract
results do not claim an actual installation.

The later complete installer preparation also found stale current import-source
bindings in the original shortcut and export installed-evidence test fixtures.
Both original product contracts reproduced 74/80 passes and six failures before
the correction. Their current synthetic blobs are rebound to the exact audited
sources without changing historical template hashes, generated-source identity,
inverse proofs, PID rules or any original assertion. The existing product CI
contract step now builds both canonical fixtures and runs these original two
test files explicitly. Preserve the failed TAP and obtain new current-commit CI,
binary and full installed acceptance after this source change; an earlier
candidate's successful package is not the final artifact by implication.
