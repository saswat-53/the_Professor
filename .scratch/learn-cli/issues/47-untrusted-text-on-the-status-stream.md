# 47: Untrusted text on the terminal's status stream is shown raw

**What to build:** When stderr is a terminal, nothing a repository, a git history or a model can put in a name or a message reaches the terminal as an escape sequence: it is removed from the status lines, and shown visibly (not removed) in the request that `--dry-run` and `--show-prompt` print, since that one exists to show exactly what is sent.

**Blocked by:** none

**Status:** ready, but two decisions below are the owner's to confirm first

**Concepts to look up:** terminal escape injection (OSC window titles, CSI cursor moves), untrusted input, a single choke point versus escaping at every call, `isatty` per stream (stdout and stderr are separate), Unicode control pictures (U+2400 block, where `␛` stands for ESC).

## The problem, with evidence

The model's text on stdout is already stripped of escape sequences when stdout is a terminal. Everything on **stderr** is not: `status()` in `src/cli/main.ts` paints and writes the text as it is, and `printRequest` writes the request as it is. File names, file contents, git commit messages and a model's earlier answers are all untrusted, so a repository someone else made can retitle your terminal window, move the cursor, or hide text just by being explained.

Found by running each path with a hostile name or content (an OSC "set window title" sequence, `ESC ] 0 ; … BEL`) in a throwaway project, `--dry-run` so no server or key was needed, and looking for the raw sequence in the output:

| Path | What was raw on the stream |
| --- | --- |
| A. The Context report | the file's name |
| B. `--dry-run` and `--show-prompt`: the printed request | the file's contents |
| C. The error for a file that does not exist | the name as typed |
| D. `--diff` | changed files' names, and the patch |
| E. `--blame` | the file's name, and a commit message |
| F. Word search: "also found in" | the names of other files that define the word |
| G. `--show-prompt` inside a chat (from reading the code, not yet probed) | every earlier turn is printed again, including the model's own answers |

The chat footer is not affected: it cleans its names itself (ticket 45). The chat's own output (answers, quiz questions) already goes through the stripper.

## Decisions to confirm (the owner's, recommended answers given)

1. **When to act.** Strip when **stderr** is a terminal, not when stdout is. `learn file | less` has a piped stdout and a terminal stderr, which the current output mode (decided by stdout) gets wrong. With stderr redirected to a file, nothing changes, so logs keep the truth. *Recommended: yes.*
2. **The request that `--dry-run` and `--show-prompt` print.** Removing escape sequences would show something other than what is sent, which is the point of those flags. Show them as control pictures instead (`␛]0;title␇`), and bidi and zero-width characters as `<U+202E>`. *Recommended: make visible for the request, strip for everything else.*

## Behaviour

- [ ] One choke point: every status line (`info`, `warning`, `error`) passes through the escape stripper before it is painted, when stderr is a terminal. No call site has to remember to; the Context report, errors, notes, warnings and the chat's reports all go through it
- [ ] The stripper runs before the colour is added, so the tool's own dim, yellow and red are never removed; newlines and tabs survive, so multi-line reports keep their layout
- [ ] The printed request (`--dry-run`, `--show-prompt`, and each follow-up under `--chat --show-prompt`, earlier turns included) shows control characters, escape sequences, C1 characters, bidi overrides and zero-width characters visibly, and is otherwise exactly what is sent. Newlines and tabs are left alone
- [ ] Both behave as before when stderr is not a terminal: the text is exactly as it was, so a log is faithful
- [ ] The decision is made in one place with the existing output-mode decision (`outputMode` gains a stderr-terminal flag), not a second check; `NO_COLOR` and `TERM=dumb` change colour only, never this, because stripping is for safety and not for looks
- [ ] Core stays free of terminals: the work is in `src/cli/`, and the boundary test still passes
- [ ] The README sentence about the model's text being cleaned in a terminal says the same of status lines and names; the **Plain mode / Terminal mode** glossary entry says which stream each rule follows

## Safety case

Every path in the table above has a test that runs the real CLI on a pty (stderr a terminal) with a hostile name, content or message, and asserts on the bytes:

- [ ] A, C, D, E and F: after the run, the output holds none of the OSC sequence, no BEL, and no other ESC byte beyond the tool's own colour codes; the readable parts of the names are still there (for example `ab.ts` from `a␛[31m␛]0;…␇b.ts`)
- [ ] B and G: the same hostile content shows as `␛]0;…␇` in the request, so a reader sees what would be sent; the bytes the model actually receives are unchanged (a test on the fake server's received body)
- [ ] The same runs with stderr redirected to a file leave the bytes exactly as they were
- [ ] A run with stdout piped and stderr a terminal still strips (the `| less` case)
- [ ] Hostile text split across writes cannot get through: a status line is cleaned whole, so a sequence cannot be completed by the next line

## Break it

- [ ] Remove the stripper from `status()`: tests A, C, D, E and F fail
- [ ] Strip the printed request instead of making it visible: the B/G test fails (and so does "the model receives what the request showed")
- [ ] Decide by stdout instead of stderr: the `| less` test fails
- [ ] Paint before stripping: the colour codes disappear, and a test of coloured status lines fails
- [ ] Add a new `process.stderr.write` of a name that bypasses `status()`: nothing catches it, which is why the table above has one test per path; note in the ticket whether a test that searches `src/cli/` for direct `process.stderr.write` calls of anything but constants is worth adding

## Glossary and docs

- [ ] `GLOSSARY.md`: the **Plain mode / Terminal mode** entry says that the stripping of status lines follows stderr being a terminal, and that the printed request shows control characters visibly
- [ ] `README.md`: the sentence in "Output streams" says names, file contents and git text on stderr are cleaned too when stderr is a terminal

## Out of scope

- Content scanning or redaction of secrets (unchanged: the Sensitive-file rules go by name only).
- Anything written to disk (`/save` notes keep the real text, with their existing warning).
- The text the user types themselves, such as a file name on their own command line, except where it is echoed back in an error (case C, which is included because scripts and pasted commands can carry hostile text).

## CI

The pty tests are timing-sensitive like the others: wait on observable output, and never on one wait followed by another that the same read could have satisfied (see ticket 45's note).

## Comments
