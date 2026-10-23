# Refuse to send sensitive files to a model by default

Everything gathered into an Excerpt or Context leaves the machine for a third-party model, so a Reference that touches `.env`, a key file, or a gitignored file could leak secrets. We refuse by default, check every file in the Excerpt and the Context (not just the Reference), and name the rule that blocked it. `--allow-sensitive` overrides, and a localhost endpoint is exempt because nothing leaves the machine. We considered "warn and send anyway" and rejected it: a leaked key cannot be un-sent.

## Consequences

Piped and clipboard input has no filename, so the filename rules cannot cover it; the Context report says so. Content scanning and redaction is a later step.

The localhost exemption trusts the address, not the destination: 127.0.0.1 can be a tunnel, a port forward or a proxy to another machine, so the Context report says when the check was skipped because the endpoint is local, and names the host. The same goes for `--allow-sensitive`: the report says what was let through and where it went. If the check cannot run, it fails closed when it is enforced and reads without a note when it is not; the two are different on purpose.
