# 01: Thin slice: explain a file against a fake server, plus --dry-run

**What to build:** Running `learn <file>` against a fake OpenAI-compatible server streams the model's explanation to stdout. With `--dry-run`, the assembled request is shown on stderr and no network call is made. This ticket includes the minimal project scaffold (TypeScript, Vitest, tsup), the core explain event stream with an injected model, and base URL and model taken from flags and the environment. Whole file only; no line ranges yet.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] Against a fake server with a scripted reply, `learn` on a real temp file prints the reply on stdout, and the test sees it arrive in more than one chunk before the stream ends
- [ ] With `--dry-run`, the fake server records zero requests, and stderr shows the base URL, the model, and the file content exactly as it would be sent
- [ ] A flag overrides the environment for base URL and model; with neither set, the run fails with a usage message and exit code 2
- [ ] A core test drives explain with a fake model and a real temp file and observes text deltas followed by done
- [ ] The built bundle can be run locally as the `learn` command
