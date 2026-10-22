# 02: Guardrails: core/cli boundary check, Node matrix, version pins

**What to build:** The build fails automatically when the architecture rules in ADR 0002 are broken, and CI proves the tool works on every supported Node version.

**Blocked by:** 01 (Thin slice: explain a file against a fake server, plus --dry-run)

**Status:** done

- [ ] A fixture where core imports from cli makes the check fail
- [ ] A fixture where core touches stdout, argv, or a terminal library makes the check fail
- [ ] A fixture where core imports a file-write API makes the check fail; the rule's allowlist can hold exactly one entry, reserved for the notes writer from ticket 36 (/save), and nothing else may be added
- [ ] CI runs the full test suite on Node 22, 24, and 26 and fails if any of them fails
- [ ] The package declares Node 22 or newer, a Node version file exists, and a lockfile is committed and installed unmodified in CI

## Comments

- Boundary rules live in `test/support/boundary.ts`; `test/core-boundary.test.ts` scans `src/core` recursively and has fixtures proving each rule fails (cli imports incl. side-effect and dynamic, stdout/stderr/stdin/argv, terminal libraries, file-write APIs).
- The file-write rule matches file-write APIs only (`writeFile`, `appendFile`, `createWriteStream`, `cpSync`, ...), not a bare `.write(`. `process.stdout.write("x")` triggers only the stdout rule; a generic `something.write(...)` triggers nothing. A bare `write` is flagged only when imported from `fs`.
- Violations carry `{ rule, line, text }`, so a failing scan shows the line number and offending source.
- The write allowlist is pinned to `[]` by a test; ticket 36 must change that test deliberately when it adds its one entry.
- CI: `.github/workflows/ci.yml` runs typecheck, tests and build on Node 22, 24 and 26 using `npm ci`. Not yet run on GitHub; Node 26 availability in `actions/setup-node@v4` is unconfirmed.
- Known limit: the checker is regex-based, so exotic syntax (e.g. `process["std" + "out"]`) slips through; a TypeScript-compiler-API check would close that.
