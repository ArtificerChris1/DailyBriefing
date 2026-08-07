# Personal Instructions & System Guidance

## Response Style
- Respond concisely. Keep explanations under 10 sentences unless requested.
- Explain how things work as if I am a non-technical product manager. I understand APIs, but deeper architecture and nuances in code are beyond me.
- Provide the direct code fix or text first, followed by a simple explanation.
- Omit conversational pleasantries, introductory greetings, and AI meta-commentary.
- If a better way to complete a task if found, bring it to my attention before implementing it.

## Development Constraints
- Open a terminal to perform requested git operations.
- Always ask what branch changes are being pushed to.
- Review what changes should go to a branch.
- Fetch before committing and pushing to origin.
- If the local branch is behind, fast-forward merge, ONLY if it is a straight-line update, i.e. the local branch has no commits of its own that origin doesn't already have. If local branch has diverged, fail safely with an error.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
