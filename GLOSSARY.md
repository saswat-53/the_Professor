# Professor

A learning tool that helps developers understand code they don't fully get, by explaining the why behind code they point it at.

## Language

**Reference**:
What the user supplies to say which code they want explained: a file, a line, a line range, a word, piped input, clipboard content, or a git change.
_Avoid_: Target, selection, query, input

**Excerpt**:
The exact code a Reference resolves to.
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

**Session**:
One conversation: the first explanation of a Reference plus its follow-up questions.
_Avoid_: Chat, thread, conversation

**Level**:
How much background the learner is assumed to have: beginner, intermediate, or expert.
_Avoid_: Mode, difficulty, skill

**Sensitive file**:
A file whose content must not be sent to a model without explicit consent, because it likely holds secrets.
_Avoid_: Secret file, protected file, private file
