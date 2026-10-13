# 2F.86 local installation repair / 4.219.1

Complete the outstanding install/upgrade/uninstall gate of the local recycle-bin module; this is not a new small feature. Previous product 191439e /4.219.0 passed its documented application/build gates but explicitly did not test real NSIS installation. First real install run38351114480, verifierd5e4fa7, artifact11790494019 failed: installer exited0 but required files were not at the complete Unicode/space installation target. Preserve that raw failure; exit0 alone is insufficient.

The pinned24.13.3 multiUser.nsh still uses tokenized StdUtils.GetParameter for /D=. Upstream electron-builder PR9196/commit21e4ea2 fixes paths containing spaces by parsing the full final parameter; the upstream issue is7946. NSIS documents /D= must be last and unquoted even with spaces. The previous known-folder backport9564 stays intact. The actual delivered EXE's decompressed NSIS header and embedded7z confirm the old parser and expected Chinese executable, so this is not solved by removing the space/path test or renaming an expected application.

The repair backports9196's register-preserving GetDParameter macro to both user and machine paths. Dependencies, installation scope/UAC policy, runtime, data retention, Go/Electron/save/quit/schema14 and all product workflows stay unchanged. Template admission remains exact: originalafa90464, old audited461144ae, final91b585786c8e8b9c69181a32771f57322b7800b21f50af9c82daf9d99f10d6b1. Unknown/partial edits fail before replacement. New patch reverses byte-exactly to the prior audited patch and original; LF/CRLF and repeated preparation remain supported.

Original11 installer test contracts remain; their expected parser and reverse-fixture preparation are updated for the new complete template, with6 additional contracts. Local17/17 passed against both original and fully prepared dependency fixtures. These are not Windows execution. Actual npm run version:patch produced4.219.1; full metadata blobs075b9637/d7d71ada match independently prepared bytes,679 dependency nodes unchanged. Auxiliary metadata job38351993137 creates only full blobs and does not move product refs.

Full current-source builds/regressions and actual Windows installation lifecycle remain required after this source commit. Installation test stays on ci/local-installation-2f86 using exact installer hashes. Verify fresh install, real installed recycle bin, normal native close, old-version upgrade, native save, same-version reinstall, uninstall and reinstall with retained notes/attachments/backups. Scope: disposable hostedWindows/current-user silent installation, not every user's OS, machine-wide/UAC or interactive wizard. No production deployment.

46 historical catalog entries and12 assistant execution classes are retained; this newly discovered installation-path defect is recorded here separately. Do not repeat prior source submissions or erase failed evidence. Final results belong in PR#2 and delivery, not an extra status-only product commit. No cloud/multi-device development, master merge, forced ref update or official release.

Primary sources:
https://github.com/electron-userland/electron-builder/pull/9196
https://github.com/electron-userland/electron-builder/issues/7946
https://raw.githubusercontent.com/electron-userland/electron-builder/v26.0.19/packages/app-builder-lib/templates/nsis/multiUser.nsh
https://nsis.sourceforge.io/Which_command_line_parameters_can_be_used_to_configure_installers
