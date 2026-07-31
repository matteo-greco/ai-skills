---
name: backfill-note
description: Fill empty sections in a specified note using context from related notes in the same vault.
disable-model-invocation: true
user-invocable: true
argument-hint: "<note-path>"
---

# Backfill note

Fill empty sections in the specified note. If the note cannot be found or is not in a note vault, stop and ask for clarification.

## Process

1. Read the entire note.
2. Search the vault for related notes. Use similar notes as style and structure references.
3. Fill only sections with no content or placeholders such as `TODO` or `TBD`. Preserve all other content, including frontmatter.
4. Re-read the note and inspect the diff to ensure no existing content was replaced.

Summarize what you filled and note any sections left empty. Suggest a better title or filename and ask the user if they want it applied. Never apply without consent.
