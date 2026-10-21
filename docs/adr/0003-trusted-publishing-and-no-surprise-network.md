# Publish with trusted publishing; the only network call is your endpoint

Releases go out from GitHub Actions using npm trusted publishing (OIDC), so there is no long-lived npm token and provenance is attached automatically. The tool has no telemetry, no analytics and no update check, and makes no network call except to the endpoint the user configured. A test or CI guard enforces that, and the README states that the configured endpoint receives the user's code. The tool handles people's source code, so a provable "nothing else leaves your machine" is part of the product, not an implementation detail.

## Consequences

Trusted publishing needs a public GitHub repo, a public package, a `repository.url` that exactly matches the repo, npm CLI 11.5.1 or newer, and Node 22.14 or newer in the release job. The trusted publisher is configured in the package's settings on npmjs.com, and the first successful publish must happen within 2 days of creating that configuration.
