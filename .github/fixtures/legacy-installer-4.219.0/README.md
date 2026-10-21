# Original 4.219.0 installer path counterexample

These binary parts preserve the original installer used by the existing Windows path-failure probe. They are an input fixture for the dedicated installer verification branch. The executable is neither rebuilt nor executed during reconstruction.

| Original source | Exact identity |
| --- | --- |
| Repository | GuDuYunChen/Local-Notepad |
| Product commit | 191439e04ddbf6b4423194d2978ae72da926df3c |
| Workflow run | 38337004784 |
| Artifact ID | 11785294620 |
| Artifact name | local-notepad-windows-191439e04ddbf6b4423194d2978ae72da926df3c |
| Original artifact ZIP bytes | 104200414 |
| Original artifact ZIP SHA256 | 0709e0db717e5ccaae97328e5ed165470530dff1ab67e7c58a587278e40413c3 |
| EXE name | Notepad-4.219.0-Setup.exe |
| EXE bytes | 104197801 |
| EXE SHA256 | b3fab086b8f34f2dd7025223e8322a80b2e0634bfbc88631b25ad2d0d727b43a |
| EXE Git blob | 5f77866ad72ba3698a5b8ffa3c2a53307739b86f |
| PE file and product versions | 4.219.0.0 |

The previous artifact download reported `Artifact not found` in installer run 39406497176, before the actual installation lifecycle began. That response alone does not establish why the artifact was unavailable. The recovered original EXE was independently checked against the existing whole-file pin and its PE version resources before splitting.

`manifest.json` records 17 ordered parts: the first 16 contain 6291456 bytes each; the last contains 3534505 bytes. The local `.gitattributes` marks `*.bin` as binary so Windows checkout cannot translate line endings.

From this repository root, `node scripts/prepare-legacy-installer.mjs` accepts no arguments. It refuses missing, extra, nonregular or noncanonical fixture entries, verifies each actual part, reconstructs the actual full buffer, and calls the unchanged `verifyInstaller(bytes, LEGACY_DEFECT)`. Only after verification does it exclusively create `.installer-input/legacy/Notepad-4.219.0-Setup.exe`; an existing output is never replaced. Source and failure receipts go to the job log, without adding members to the installation evidence artifact.

The original Windows lifecycle runner verifies that same installer again before running the unchanged unquoted path probe. Reconstruction does not fill in probe results or establish installation acceptance. The actual truncation observation, cleanup, two legacy commands, all current and upgrade installation checks, and their original budgets remain required.
