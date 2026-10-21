# Refuse to send sensitive files to a model by default

Everything gathered into an Excerpt or Context leaves the machine for a third-party model, so a Reference that touches `.env`, a key file, or a gitignored file could leak secrets. We refuse by default, check every file in the Excerpt and the Context (not just the Reference), and name the rule that blocked it. `--allow-sensitive` overrides, and a localhost endpoint is exempt because nothing leaves the machine. We considered "warn and send anyway" and rejected it: a leaked key cannot be un-sent.

## Consequences

Piped and clipboard input has no filename, so the filename rules cannot cover it; the Context report says so. Content scanning and redaction is a later step.
