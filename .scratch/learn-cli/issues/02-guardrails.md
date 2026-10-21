# 02: Guardrails: core/cli boundary check, Node matrix, version pins

**What to build:** The build fails automatically when the architecture rules in ADR 0002 are broken, and CI proves the tool works on every supported Node version.

**Blocked by:** 01 (Thin slice: explain a file against a fake server, plus --dry-run)

**Status:** ready-for-agent

- [ ] A fixture where core imports from cli makes the check fail
- [ ] A fixture where core touches stdout, argv, or a terminal library makes the check fail
- [ ] A fixture where core imports a file-write API makes the check fail; the rule's allowlist can hold exactly one entry, reserved for the notes writer from ticket 36 (/save), and nothing else may be added
- [ ] CI runs the full test suite on Node 22, 24, and 26 and fails if any of them fails
- [ ] The package declares Node 22 or newer, a Node version file exists, and a lockfile is committed and installed unmodified in CI
