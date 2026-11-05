# 44: Capture token usage into SessionStats (and `--usage` for one-shot)

**What to build:** The numbers a footer needs: tokens per request and per Session, from the provider when it reports them and from a labelled estimate when it doesn't. Plus a one-shot `--usage` line. No footer drawing here (that is 45).

**Blocked by:** 34 (Session cap and context window)

**Status:** implemented, awaiting Linux CI and the smoke test

**Concepts to look up:** `stream_options.include_usage` (OpenAI-compatible streaming), async iteration over a stream, the usage fields in the Vercel AI SDK result, token estimation (chars ÷ 4), data-versus-presentation split.

## Behaviour

- [x] Core exposes a plain `SessionStats` value (no ANSI, no terminal width, no I/O): input and output tokens for the last request, totals for the Session, whether each figure is `reported` or `estimated`, the focused reference label, model, level, and the context window when the endpoint is local. It is updated after each turn and after a cancelled turn (with whatever is known)
- [x] The first request of a chat asks the endpoint for usage on the stream. When the endpoint reports it, `SessionStats` holds the reported numbers and marks them `reported`
- [x] When the endpoint accepts the request but sends no usage, `SessionStats` holds a chars ÷ 4 estimate of the request and of the answer, marked `estimated`, and nothing is retried
- [x] When the endpoint answers 400 and the error names `stream_options`, **before any output was streamed**, the request is sent once more without it; this succeeds, the chat's model adapter remembers "no usage here" for the rest of the chat (in memory only, never in the config file), and later requests do not ask again. Figures from then on are `estimated`
- [ ] The retry happens once per Session at most, and a second 400 is reported as an ordinary provider error
- [x] One dim stderr note per chat says usage is estimated for this endpoint, naming the host only (no path, no query, no key)
- [x] `--usage` (one-shot only) prints one dim line to stderr after the explanation in terminal mode (`in 1.2k · out 340 · <model>`, with `~` when estimated); nothing in plain mode; it is listed in `--help`
- [x] `--usage` with `--chat` is rejected up front with exit code 2 and a message saying the chat footer already shows usage; nothing is sent
- [x] Core stays free of `process`, ANSI and terminal code (the boundary test still passes)

## Safety case: the `stream_options` retry

The retry is the only automatic retry in the tool (ADR 0004), so it is narrow, and each way it could go wrong has a test against the fake OpenAI-compatible server (the CLI as a black box, seam 2):

- [x] Rejected path: a server that answers 400 naming `stream_options` gets exactly two requests; the second has no `stream_options`; the answer streams; the note appears once; a second chat turn sends no `stream_options` at all
- [x] Accepted-but-no-usage path: a server that accepts the field and streams without a usage chunk gets one request, `estimated` figures, and no note about a rejection
- [x] A 400 about a different field is not retried, and is reported as the usual provider error
- [x] A 401 is not retried (bad key message as before); a 429 is not retried (rate-limit message and Retry-After handling as before)
- [x] A 400 that arrives mid-stream, after output was already written, is not retried and is not shown as a usage problem
- [x] A cancelled request (Ctrl-C) is not retried
- [x] The API key never appears in stdout, stderr, the note, `--show-prompt` or debug output on any of the paths above (the secret-canary test is extended to cover this ticket's output)
- [x] The only host contacted is the configured endpoint (the no-network guard stays green)

## Break it

- [x] Delete the `include_usage` request option: the "reports usage" test must fail
- [x] Make the retry fire on any 400: the "different field" test must fail
- [ ] Make the retry fire after output has streamed: the mid-stream test must fail
- [ ] Print the Authorization header in the note: the canary test must fail
- [x] Let `--usage` through with `--chat`: the exit-code-2 test must fail

## Glossary

- [x] `GLOSSARY.md` has **SessionStats** and **Usage (reported vs estimated)** entries, and the Session entry points to SessionStats; the in-memory "no usage here" memory is described under Usage

## Notes

Verify before calling it done: run once against local Ollama and once against one hosted endpoint (the opt-in smoke test), and record in this file whether each reported streamed usage. Whether `ai`'s `streamText` surfaces usage for the `@ai-sdk/openai-compatible` provider without `includeUsage` set is unconfirmed; the lookup so far only shows the provider adds `stream_options` when `includeUsage` is on.

## Comments

### Progress (commits 17ed32f, 9fe2f03, e0760af, 50efc66, e95e2b3, ba8d32f, and the glossary commit)

Done and checked above. Still open:

- [ ] Once-per-Session retry limit with a second 400: the code lets a 400 naming `stream_options` on the retry fall through to the ordinary provider error, but no test names that case.
- [ ] Break-it "retry after output has streamed": the `yielded` guard cannot be reached from the wire (a real HTTP 400 cannot follow a started body, and a mid-stream error is an SSE event with no status), so no test fails when it is removed. It stays as defence in depth, with a comment saying so.
- [ ] Break-it "print the Authorization header in the note": not run.
- [ ] Smoke test: one run against local Ollama and one against a hosted endpoint, recording here whether each reported streamed usage. The fake endpoint in the tests sends usage in the OpenAI chunk shape; real endpoints may differ.
- [ ] A green Linux CI run (Node 22, 24 and 26 on ubuntu-24.04): the chat-memory and `--usage` tests drive a pty.

