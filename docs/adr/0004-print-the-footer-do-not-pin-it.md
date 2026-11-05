# Print the chat footer before each prompt; do not pin it to the screen

The chat shows a one-line footer (project, focused reference, model, level, token usage, context fill) printed just above each prompt, as dim text, from one pure function `renderFooter(stats, width)`. It is not pinned to the bottom of the screen, and the chat stays on `node:readline`. A screen-owning TUI (Ink, or ANSI scroll regions on top of readline) would give a persistent footer and a bordered live input box, but it takes over stdin and the render loop, which the pasted-block convention, Ctrl-C handling, hidden key input and the Linux-CI-tested cancellation paths all depend on; scroll regions are also uneven across terminals. A printed line keeps scrollback intact, needs no new dependency, works in every terminal that already runs the chat, and is snapshot-testable as a string. The numbers come from a plain `SessionStats` value owned by core (no ANSI, no terminal width), so the later desktop app reuses them and the CLI alone decides how to draw them.

Ink is deferred, not rejected: if a bordered, live input box is wanted later, it gets its own ADR, and `renderFooter` is the seam it would replace.

## Consequences

- To report token usage on a streamed answer, the OpenAI-compatible provider has to ask for it (`stream_options: { include_usage: true }`), and some endpoints reject that field. The provider therefore retries once without it when, and only when, a 400 names `stream_options` before any output was streamed. This is the one automatic retry in the tool; the spec's "no automatic retries" rule otherwise stands. It goes to the same configured endpoint, so the no-surprise-network promise of ADR 0003 is unchanged.
- Where an endpoint reports no usage, the footer shows a labelled estimate (`~`), never an invented exact figure.
- Context fill is shown only for local endpoints, where `--context-window` is a real setting. There is no built-in table of hosted-model windows, because a stale table is wrong data.
- The footer is rendered from project names, file names and model names, all of which are untrusted text: they go through the existing escape stripper and are measured by display width after stripping.
