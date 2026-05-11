# pi-chain

A pi extension that allows users to sequentially select self-created subagents
and execute them in a single, ordered chain flow.

## Installation

Place this directory in `~/.pi/agent/extensions/` (global, all projects) or
`.pi/extensions/` (project-local):

```bash
# Global installation
cp -r .pi/extensions/pi-chain ~/.pi/agent/extensions/

# Or symlink for development
ln -s "$(pwd)/.pi/extensions/pi-chain" ~/.pi/agent/extensions/pi-chain
```

## Usage

Type `/chain` in pi to open the main menu overlay. After each operation,
the menu reappears automatically.

### Create Chain

1. **Select Subagents** - Arrow keys to navigate, Space to select. Selected
   agents are numbered in order. The chain preview at the top shows the flow
   (e.g., `scout → planner → worker`). Press Enter to continue.

2. **Configure Model & Effort** - For each subagent, configure:
   - **Model**: Search with live filtering from your registered providers
   - **Effort**: Cycle through thinking levels (off → minimal → low → medium → high → xhigh)

3. **Name the Chain** - Give it a unique name. Chains persist across sessions.

### Run Chain

1. **Select Chain** - Choose from previously created chains.

2. **Input Requirement** - Type your requirement. Use `@` to reference files:
   - Type `@` followed by a partial filename
   - A file picker appears below with matching files
   - Arrow keys + Enter to insert the file reference
   - Press Enter to submit the requirement

3. **Task Distribution** - A dedicated model analyzes your requirement and
   distributes tasks to each subagent in the chain. Files referenced with `@`
   are NOT read at this stage — only the intent is analyzed.

4. **Review Tasks** - Review and optionally edit each assigned task.

5. **Execute** - The chain runs in the main chat session. Each subagent
   receives the previous output and the original requirement. You can interact
   with subagents (approvals, questions).

### List / Delete / Settings

- **List**: View all created chains
- **Delete**: Remove a chain
- **Settings**: Configure Task Distribution and Summarization models & effort

## Subagents

Subagents are defined as markdown files with YAML frontmatter:

- `~/.pi/agent/agents/*.md` (user-level)
- `.pi/agents/*.md` (project-level)

Example (`~/.pi/agent/agents/scout.md`):

```markdown
---
name: scout
description: Analyzes codebase structure (read-only)
tools: read, grep, find, ls, bash
model: claude-haiku-4-5
---

You are a scout. Quickly investigate a codebase and return structured findings.
```

## Inter-Agent Communication

Outputs < 1,000 characters are passed inline. Outputs ≥ 1,000 characters
are saved to `.pi-chain/<timestamp>/<agent>.md`; the next agent receives a
summary plus the file path.

### File Storage Structure

```
. (pi working directory)
└── .pi-chain/
    └── 20260508-142530/
        ├── planner.md
        ├── worker.md
        └── reviewer.md
```

### Cleanup

If cleanup is enabled before running a chain, the entire timestamp directory
is deleted after completion. Note that even with cleanup disabled, you should
add `.pi-chain/` to your `.gitignore` to avoid accidentally committing
intermediate outputs.

## Storage

Chains and settings are stored in `~/.pi/agent/pi-chain/chains.json`.

Chain execution output files are stored in `.pi-chain/<timestamp>/` under
your project's working directory. Add `.pi-chain/` to your project's
`.gitignore` to prevent temporary execution files from being committed:

```gitignore
.pi-chain/
```
