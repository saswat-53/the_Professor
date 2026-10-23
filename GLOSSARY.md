# Professor

A learning tool that helps developers understand code they don't fully get, by explaining the why behind code they point it at.

## Language

**Reference**:
What the user supplies to say which code they want explained: a file, a line, a line range, a word, piped input, clipboard content, or a git change.
_Avoid_: Target, selection, query, input

**Excerpt**:
The exact code a Reference resolves to, together with its **label**: the name shown to the model and the user for where it came from (for example `src/auth.ts:40-60`).
_Avoid_: Snippet, selection, chunk

**Context**:
The material gathered around an Excerpt to make it understandable: nearby lines, imports, and the enclosing block.
_Avoid_: Surroundings, background, scope

**Enclosing block**:
The smallest function, method, or class that contains an Excerpt.
_Avoid_: Parent, container, scope

**Context report**:
The statement shown to the user of exactly what was sent to the model: which files, which lines, which method found the Enclosing block, and what was dropped to fit the budget.
_Avoid_: Manifest, log, summary

**Project root**:
The directory learn treats as "the project": the git root above the current directory, else the current directory itself, or the `--root` directory when given. Files must resolve (after symlinks) inside it, and labels are written relative to it. With no repo and no `--root`, a file elsewhere is outside the root and refused.
_Avoid_: Workspace, base directory

**Session**:
One conversation: the first explanation of a Reference plus its follow-up questions.
_Avoid_: Chat, thread, conversation

**Level**:
How much background the learner is assumed to have: beginner, intermediate, or expert.
_Avoid_: Mode, difficulty, skill

**Exit code**:
The number `learn` ends with, promised to script users: 0 success, 1 runtime or provider error, 2 usage or config error, 3 refused (a Sensitive file, a file that fails the reading rules, a file outside the Project root, or an Excerpt over budget).
_Avoid_: Status code, return code

**Sensitive file**:
A file whose content must not be sent to a model without explicit consent, because it likely holds secrets.
_Avoid_: Secret file, protected file, private file
