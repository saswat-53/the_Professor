# Professor

`learn` is a command-line tool that explains the code you point it at, with the *why* and not just the *what*, at your level (beginner, intermediate, or expert). It works with any OpenAI-compatible endpoint, including free local models through Ollama, using your own API key.

**Status: early development.** Nothing is published yet and there is nothing to install. The design is settled and the first tickets are about to be built.

## Privacy promise

- Strictly read-only: it never modifies your files. The only thing it will ever write is notes you explicitly save.
- Files that likely hold secrets (`.env`, private keys, gitignored files) are refused by default. This is a safety net, not a guarantee: it goes by file names and gitignore rules, so a key hardcoded in an ordinary source file passes every rule. Only content scanning, a later step, can catch that.
- Your API key is read from an environment variable (later, the OS keychain). It is never stored in a config file or passed on the command line.
- No telemetry, no analytics, no update check. The only network connection is to the endpoint you configure, and that endpoint receives the code you ask about.

## Reporting bugs

Error messages can contain file names and paths from your machine (a path outside your home directory is printed in full). Read the text before pasting it into a public issue, and remove anything you don't want shared.

## Design

- [Spec](.scratch/learn-cli/spec.md)
- [Tickets](.scratch/learn-cli/issues/)
- [Decision records](docs/adr/)
- [Glossary](GLOSSARY.md)

## Credits

Planning and development workflow uses the agent skills from [Matt Pocock's skills](https://github.com/mattpocock/skills) (MIT licensed). They are not included in this repository; `skills-lock.json` records the versions used.

## Licence

[MIT](LICENSE)
