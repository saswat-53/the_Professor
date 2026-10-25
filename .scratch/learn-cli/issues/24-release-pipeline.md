# 24: Release pipeline: trusted publishing

**What to build:** Releases are published from CI with provenance and no stored npm token.

**Blocked by:** 02 (Guardrails: core/cli boundary check, Node matrix, version pins), 20 (No-network guard), 21 (Secret-canary test), 23 (README)

**Status:** deferred

- [ ] The package name is re-checked for availability immediately before the first publish
- [ ] The first publish is documented as a manual step from a maintainer's machine with two-factor authentication, followed by configuring the trusted publisher in the package's settings on npmjs.com within two days
- [ ] The release workflow runs only on version tags, mints an ID token, uses a hosted runner with Node 22.14 or newer and npm 11.5.1 or newer, installs from the lockfile, and uses no package-manager cache
- [ ] The package's repository field exactly matches the GitHub repository
- [ ] A dry-run publish from CI passes all checks and publishes nothing
- [ ] After setup, the package is set to require two-factor authentication and disallow tokens, and the maintainer's account has 2FA on

## Comments

- Deferred 2026-10-25 at the maintainer's request: no publishing for now. No other ticket is blocked by this one. Revisit when a first public release is wanted; the README status line ("Nothing is published yet") stays accurate until then.
