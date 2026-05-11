# ⛓ pi-chain

Sequential subagent chain executor for [pi](https://github.com/earendil-works/pi). Build ordered pipelines of specialized subagents that execute one after another — each receiving the previous agent's output and the original requirement.

```
scout → planner → worker → reviewer
(analyze) (plan)  (execute) (review)
```

---

## Table of Contents

- [Installation](#installation)
- [Prerequisites — Creating Subagents](#prerequisites--creating-subagents)
- [Quick Start](#quick-start)
- [Features](#features)
  - [Create Chain](#1-create-chain)
  - [Run Chain](#2-run-chain)
  - [List Chain](#3-list-chain)
  - [Delete Chain](#4-delete-chain)
  - [Settings](#5-settings)
  - [Chain Abort](#chain-abort)
- [How It Works](#how-it-works)
  - [Execution Flow](#execution-flow)
  - [Context Management](#context-management)
  - [Multi-Turn Conversations](#multi-turn-conversations)
  - [Task Distribution](#task-distribution)
  - [Summarization](#summarization)
  - [Watchdog & Timeout](#watchdog--timeout)
- [File Storage](#file-storage)
- [Configuration](#configuration)
- [Use Cases](#use-cases)
- [Tips](#tips)
- [Development](#development)

---

## Installation

### Git (recommended — simplest)

```bash
# Push your code to GitHub, then:
pi install git:github.com/seung-seop-ahn/pi-chain

# With version tag
pi install git:github.com/seung-seop-ahn/pi-chain@v1.0.0

# Project-local install (only for current project)
pi install -l git:github.com/seung-seop-ahn/pi-chain
```

### npm

```bash
pi install npm:pi-chain
```

### Local (development)

```bash
# Symlink for live development
ln -s "$(pwd)" ~/.pi/agent/extensions/pi-chain

# Or copy
cp -r . ~/.pi/agent/extensions/pi-chain
```

### Verify

```bash
pi list
# → pi-chain  git:github.com/seung-seop-ahn/pi-chain
```

Restart pi and type `/chain` — you should see the main menu.

---

## Prerequisites — Creating Subagents

pi-chain runs **your own subagents**. Create them as Markdown files with YAML frontmatter:

### Agent File Format

```markdown
---
name: scout
description: Analyzes codebase structure and finds relevant files (read-only)
tools: read, grep, find, ls, bash
model: claude-haiku-4-5
---

You are a scout. Quickly investigate a codebase and return structured findings.
Focus on finding the files and code sections relevant to the task at hand.
```

| Field | Description | Required |
|-------|-------------|----------|
| `name` | Unique agent name (used in chain building) | ✅ Yes |
| `description` | What this agent does (shown in chain builder) | ✅ Yes |
| `tools` | Allowed tools, comma-separated (`read, grep, find, ls, bash, write, edit`) | No |
| `model` | Default model (`provider/model-id` or just `model-id`) | No |
| Body | System prompt — defines agent behavior | No |

### Storage Locations

| Path | Scope | Override Priority |
|------|-------|-------------------|
| `~/.pi/agent/agents/*.md` | Global (all projects) | Lower |
| `.pi/agents/*.md` | Project-local | Higher (same name wins) |

### Example Agent Set

Create these four agents for a complete code-review pipeline:

**`~/.pi/agent/agents/scout.md`**
```markdown
---
name: scout
description: Analyzes codebase structure and discovers relevant files
tools: read, grep, find, ls, bash
---
You are a scout. Your job is to investigate the codebase and find everything
relevant to the task. Report file paths, structures, dependencies — do NOT modify any code.
```

**`~/.pi/agent/agents/planner.md`**
```markdown
---
name: planner
description: Creates implementation plans from scout's analysis
tools: read
---
You are a planner. Review the scout's findings and create a step-by-step
implementation plan. Be specific about which files to modify and what changes to make.
```

**`~/.pi/agent/agents/worker.md`**
```markdown
---
name: worker
description: Executes the plan — writes and modifies code
tools: read, write, edit, bash
---
You are a worker. Follow the planner's instructions and implement the changes.
Write clean, well-tested code. Report what you did and any issues you encountered.
```

**`~/.pi/agent/agents/reviewer.md`**
```markdown
---
name: reviewer
description: Reviews changes for quality, correctness, and completeness
tools: read, grep, bash
---
You are a reviewer. Examine the worker's changes carefully.
Check for bugs, style issues, missing error handling, and test coverage.
Report issues clearly and suggest fixes if needed.
```

---

## Quick Start

```bash
# 1. Create the 4 agents above in ~/.pi/agent/agents/
# 2. Install pi-chain
pi install git:github.com/seung-seop-ahn/pi-chain

# 3. In pi, type /chain
/chain

# 4. Create Chain → select agents in order → configure models → name it
# 5. Run Chain → pick your chain → type a requirement → execute
```

30 seconds from install to first chain run.

---

## Features

Type `/chain` in pi to open the main menu overlay:

```
┌─────────────────────────────────────┐
│ ⛓  pi-chain                        │
│ Sequential subagent chain executor  │
│                                     │
│   Create chain                      │
│   Run chain                         │
│   List chain                        │
│   Delete chain                      │
│   Settings                          │
└─────────────────────────────────────┘
```

The menu reappears after each operation. Press `Esc` to close it.

### 1. Create Chain

A 3-step wizard for building a new chain.

#### Step 1 — Select Subagents

```
┌──────────────────────────────────────────────┐
│ Chain Preview:                               │
│  scout → planner → worker → reviewer        │
│                                              │
│ Select Subagents:                            │
│ Space to select • order = execution order    │
│                                              │
│ >  #1 scout   [user]                         │
│       Analyzes codebase structure            │
│    #2 planner [user]                         │
│       Creates implementation plans           │
│      worker   [user]                         │
│       Writes and modifies code               │
│      reviewer [user]                         │
│       Reviews changes for quality            │
└──────────────────────────────────────────────┘
```

**Controls:**
- `↑` `↓` — navigate the agent list
- `Space` — select / deselect an agent (order = `#1`, `#2`, `#3`, ...)
- `Enter` — confirm and advance
- `Esc` — cancel

The **chain preview** at the top updates live as you select. Deselecting an agent re-numbers the remaining ones.

#### Step 2 — Configure Model & Effort

For each subagent in the chain, choose a model and thinking effort level:

```
┌──────────────────────────────────────────┐
│ Configure Model & Effort                 │
│ Select an agent to configure, or Done    │
│                                          │
│ >  ✓ 1. scout [anthropic/claude-haiku]   │
│    ✓ 2. planner [anthropic/claude-sonnet]│
│      3. worker                           │
│      4. reviewer                         │
│                                          │
│   Done                                   │
└──────────────────────────────────────────┘
```

Press `Enter` on an agent to configure it:

```
┌──────────────────────────────────────────┐
│ Step 1/4: scout                          │
│ Tools: read, grep, find, ls, bash        │
│ Default model: claude-haiku-4-5          │
│                                          │
│ Configuration:                           │
│ > Model: claude-haiku-4-5                │
│   Effort: off                            │
│   Back to list                           │
└──────────────────────────────────────────┘
```

**Model picker** (type to search):
```
┌──────────────────────────────────────────┐
│ Step 1/4: scout — Model                  │
│                                          │
│ > sonnet_                                │  ← typing filters in real-time
│                                          │
│   claude-sonnet-4-5                      │
│    anthropic/claude-sonnet-4-5 R         │
└──────────────────────────────────────────┘
```

Only models from your **registered providers** appear. The `R` marker indicates reasoning support.

**Effort** cycles on each `Enter` press:
```
off → minimal → low → medium → high → xhigh → off → ...
```

All agents must show `✓` before "Done" becomes available. Press `Esc` to return to the agent list (changes are saved).

#### Step 3 — Name the Chain

```
Chain name: code-review-pipeline
```

- Invalid characters rejected: `< > : " / \ | ? *`
- Existing name → overwrite confirmation
- Chains persist across pi sessions (stored in `~/.pi/agent/pi-chain/chains.json`)

---

### 2. Run Chain

#### Step 1 — Select Chain & Input Requirement

```
┌──────────────────────────────────────────┐
│ Select Chain                             │
│                                          │
│   code-review-pipeline                   │
│    4 steps: scout → planner → worker → ..│
│   bug-fix-pipeline                       │
│    3 steps: scout → worker → reviewer    │
└──────────────────────────────────────────┘
```

After selecting a chain, enter your requirement with `@` file references:

```
┌──────────────────────────────────────────┐
│ Requirement for "code-review-pipeline":   │
│ Type @ to reference files                │
│                                          │
│  @src/api.ts improve error handling       │
└──────────────────────────────────────────┘
```

**`@` file reference system:**

Type `@` followed by a partial filename to trigger the file picker:

```
┌──────────────────────────────────────────┐
│  @src/                                   │
│                                          │
│ Matching files (@src/):                  │
│ > src/api.ts                             │
│   src/index.ts                           │
│   src/utils/helpers.ts                   │
│   ... and 5 more                         │
└──────────────────────────────────────────┘
```

- `↑` `↓` — navigate results
- `Enter` — insert the selected file reference
- `Esc` — dismiss the picker
- Search is debounced (200ms) and respects `.gitignore`

**Important:** Referenced files are **NOT read** during task distribution — only the intent is analyzed. Files are read during actual execution by the subagents.

Finally, choose whether to clean up generated files:
```
Cleanup: Clean up generated files after chain execution? [Yes/No]
```

#### Step 2 — Task Distribution

A dedicated **Task Distribution model** (configurable in Settings) analyzes your requirement and assigns specific tasks to each subagent:

```
Requirement: "Improve error handling in @src/api.ts"
         ↓
┌─────────────────────────────────────────────────────┐
│ Task Distribution Model analyzes the intent         │
│                                                     │
│ scout   → "Analyze the structure of src/api.ts     │
│            and find related files"                  │
│ planner → "Create an improvement plan based on     │
│            scout's analysis"                        │
│ worker  → "Implement the error handling code       │
│            according to the plan"                   │
│ reviewer→ "Review changes and verify quality"      │
└─────────────────────────────────────────────────────┘
```

If distribution fails, you can fall back to passing the raw requirement to every agent.

#### Step 3 — Review & Modify Tasks

```
┌──────────────────────────────────────────┐
│ Task Review: code-review-pipeline        │
│ Step 1/4                                 │
│                                          │
│ Agent: scout                             │
│ Model: claude-haiku-4-5                  │
│ Effort: low                              │
│                                          │
│ Task:                                    │
│  Analyze the structure of src/api.ts and │
│  find files with related dependencies    │
│                                          │
│   <- Previous                            │
│ > Edit task                              │
│   Next ->                                │
│   Confirm & Execute                      │
└──────────────────────────────────────────┘
```

- `<- Previous` / `Next ->` — browse other steps
- `Edit task` — opens pi's built-in editor to modify the task
- `Confirm & Execute` — starts the chain
- `Esc` — cancel execution

#### Step 4 — Chain Execution

The modal closes and the chain runs **in your main chat session**. Each subagent executes sequentially:

```
⛓ Chain: code-review-pipeline — 4 steps: scout → planner → worker → reviewer

─────────────────────────────────────────────────────────

[pi-chain: code-review-pipeline — Step 1/4: scout]

Analyze the structure of src/api.ts and find files
with related imports and dependencies

## Original Requirement
Improve error handling in @src/api.ts

## Your Role & Instructions
You are a scout. Your job is to investigate the codebase...
```

After each subagent completes, you see a summary:

```
✓ scout (Step 1/4) completed.

File structure analysis:
- src/api.ts (245 lines) — 3 endpoints, error handling uses only try-catch
- src/middleware/error.ts (new file needed)
- src/types/api.ts (error types need updating)
```

Then the next subagent starts automatically with the previous output as context.

#### Step 5 — Completion Summary

When all subagents finish, you get a synthesized summary:

```
🎉 Chain "code-review-pipeline" Complete!

Error handling in src/api.ts has been improved across all 4 steps.
Scout identified 4 related files, planner created a 3-stage refactoring plan.
Worker implemented a shared error handler, and reviewer verified all changes
and confirmed tests pass.

## Steps Executed
- scout: Analyze the structure of src/api.ts and related files
- planner: Create an improvement plan based on scout's analysis
- worker: Implement the error handling code according to the plan
- reviewer: Review changes and verify quality
```

---

### 3. List Chain

```
┌──────────────────────────────────────────┐
│ Chains (3)                               │
│                                          │
│   code-review-pipeline                   │
│    4 steps: scout → planner → worker → ..│
│   bug-fix-pipeline                       │
│    3 steps: scout → worker → reviewer    │
│   doc-generator                          │
│    2 steps: researcher → writer          │
└──────────────────────────────────────────┘
```

Press `Enter` or `Esc` to return to the menu. If no chains exist, shows "No chains exist."

---

### 4. Delete Chain

Select a chain → confirm deletion:

```
Confirm Deletion
Are you sure you want to delete the chain "old-pipeline"?
This cannot be undone.
```

Deleted chains cannot be recovered.

---

### 5. Settings

Configure the models used for task distribution and summarization:

```
┌──────────────────────────────────────────┐
│ pi-chain Settings                        │
│                                          │
│ > Task Distribution Model: claude-haiku  │
│   Task Distribution Effort: low          │
│   Summarization Model: claude-haiku      │
│   Summarization Effort: off              │
└──────────────────────────────────────────┘
```

| Setting | Description | Recommendation |
|---------|-------------|----------------|
| Task Distribution Model | Analyzes requirements and assigns tasks to agents | Fast model (haiku) |
| Task Distribution Effort | Quality of task breakdown | `low`–`medium` |
| Summarization Model | Summarizes each agent's output (<1,000 chars) | Fast model (haiku) |
| Summarization Effort | Quality of summaries | `off`–`low` |

`Enter` to change a setting, `Esc` to go back.

---

### Chain Abort

Stop a running chain anytime with `/chain-abort`:

```
> /chain-abort

Abort "code-review-pipeline" at step 2/4? [Yes/No]
→ Yes

⛔ Chain "code-review-pipeline" aborted
Aborted by user. 1/4 steps completed (stopped at "planner").
```

- Original model, tools, and effort are restored
- If cleanup was enabled, temporary files are deleted

---

## How It Works

### Execution Flow

```
                 ┌─────────────┐
                 │  User types │
                 │  /chain     │
                 └──────┬──────┘
                        ↓
              ┌─────────────────┐
              │   Main Menu     │
              │  (overlay modal) │
              └───┬───┬───┬─────┘
                  │   │   │
          Create  Run  List  Delete  Settings
            │      │
            │      ├─ Select Chain
            │      ├─ Input Requirement (@ files)
            │      ├─ Task Distribution (LLM)
            │      ├─ Review & Modify Tasks
            │      └─ Execute in Main Session
            │           │
            │     ┌─────▼──────┐
            │     │  Step 1    │  scout
            │     │  (agent)   │
            │     └─────┬──────┘
            │           ↓ output (inline or file-based)
            │     ┌─────▼──────┐
            │     │  Step 2    │  planner
            │     │  (agent)   │
            │     └─────┬──────┘
            │           ↓
            │     ┌─────▼──────┐
            │     │  Step 3    │  worker
            │     │  (agent)   │  ← can ask user questions
            │     └─────┬──────┘
            │           ↓
            │     ┌─────▼──────┐
            │     │  Step 4    │  reviewer
            │     │  (agent)   │
            │     └─────┬──────┘
            │           ↓
            │     🎉 Completion Summary
            │
            └─ 3-step wizard
                ├─ Select agents (order = execution order)
                ├─ Configure model & effort per agent
                └─ Name the chain
```

Each step receives:
1. **The distributed task** (specific to that agent)
2. **The previous agent's output** (summary + file reference if large)
3. **The original user requirement** (always included for context)
4. **The agent's system prompt** (from its Markdown file)

### Context Management

| Output Size | Mode | What the Next Agent Gets |
|-------------|------|--------------------------|
| **< 1,000 chars** | Inline | Full output text directly |
| **≥ 1,000 chars** | File-based | 970-char summary + file path ("read this file if you need more details") |

This prevents context window overload from large outputs while preserving access to full details.

**File-based example:**

```
[Previous agent's output passed to current agent:]

## Previous Step Output (scout)
File structure analysis:
- src/api.ts (245 lines) — 3 endpoints
- src/middleware/error.ts (new)
- src/types/api.ts (needs update)

The full output is saved at: .pi-chain/20260511-143052-a3f1/scout.md
Read this file if you need more details.
```

### Multi-Turn Conversations

Subagents run in your main session, so they can **ask you questions** mid-execution:

```
⏳ worker (Step 3/4) is waiting for your response. Reply in chat to continue.

[worker asked: "Should error responses use JSON format or keep the existing HTML format?"]

> Use JSON format

[worker continues with the answer...]
```

The chain pauses until you respond. Multiple question-answer rounds are supported.

### Task Distribution

A dedicated LLM (configurable model) receives:
- Your requirement text (without file contents — intent only)
- The chain structure (agent names in order)

It outputs a JSON array of tasks, one per agent. You review and can edit each task before execution.

**Fallback behavior:** If distribution fails, you're offered the option to pass the raw requirement to every agent. Each agent still receives the previous output as context.

### Summarization

Two summarization stages:

1. **Per-step summary** — After each agent finishes, its output is summarized to <1,000 characters. This summary is what gets passed to the next agent (file-based mode) and shown to you.

2. **Completion summary** — After all agents finish, a final synthesis of all results is generated and displayed.

Both use the **Summarization Model** configured in Settings. If no model is set, simple character truncation is used as fallback.

### Watchdog & Timeout

Default **30-minute timeout** per step. If a subagent takes longer without producing output:

```
⚠ Step "worker" timed out after 1800s. Advancing to next step.
```

The chain auto-advances to the next agent. To disable, set environment variable:

```bash
CHAIN_STEP_WATCHDOG_MS=0 pi
```

---

## File Storage

### Chain Configuration

Chains and settings persist across sessions:

```
~/.pi/agent/pi-chain/chains.json
```

```json
{
  "version": 1,
  "chains": [
    {
      "name": "code-review-pipeline",
      "steps": [
        { "agentName": "scout", "model": { "provider": "anthropic", "id": "claude-haiku-4-5" }, "effort": "low" },
        { "agentName": "planner", "model": { "provider": "anthropic", "id": "claude-sonnet-4-5" }, "effort": "medium" },
        { "agentName": "worker" },
        { "agentName": "reviewer", "effort": "high" }
      ],
      "createdAt": 1715432400000,
      "updatedAt": 1715432400000
    }
  ],
  "settings": {
    "taskDistributionModel": { "provider": "anthropic", "id": "claude-haiku-4-5" },
    "taskDistributionEffort": "low",
    "summarizationModel": { "provider": "anthropic", "id": "claude-haiku-4-5" },
    "summarizationEffort": "off"
  }
}
```

Schema versioning (`version: 1`) ensures forward compatibility.

### Execution Output

During execution, intermediate files are stored in your project directory:

```
your-project/
├── .pi-chain/                          ← add to .gitignore!
│   └── 20260511-143052-a3f1/           ← timestamp + random suffix
│       ├── scout.md                    ← raw output (only if ≥ 1,000 chars)
│       ├── scout.summary.md            ← 970-char summary (always)
│       ├── planner.md
│       ├── planner.summary.md
│       ├── worker.md
│       ├── worker.summary.md
│       ├── reviewer.md
│       └── reviewer.summary.md
└── src/
```

Add to your project's `.gitignore`:

```gitignore
.pi-chain/
```

If **cleanup** is enabled (chosen before running), the entire timestamp directory is deleted after the chain completes. Otherwise, files are kept for later reference.

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PI_CHAIN_DEBUG` | `0` | Set to `1` for debug logging |
| `CHAIN_STEP_WATCHDOG_MS` | (from code) | Override the step watchdog timeout |

### Settings (persisted)

All settings are editable via the `/chain` → Settings menu and stored in `chains.json`:

| Setting | Default | Description |
|---------|---------|-------------|
| Task Distribution Model | None (uses current model) | Model for analyzing requirements and distributing tasks |
| Task Distribution Effort | `off` | Thinking level for task distribution |
| Summarization Model | None (uses truncation) | Model for summarizing agent outputs |
| Summarization Effort | `off` | Thinking level for summarization |

---

## Use Cases

### 1. Code Review Pipeline

```
scout → planner → worker → reviewer
```

```
Requirement: "Review and fix security vulnerabilities in @src/api.ts"

scout:    Analyzes file structure, identifies 5 related files
planner:  Prioritizes vulnerabilities, creates 3-stage fix plan
worker:   Implements fixes (input validation, SQL injection prevention, etc.)
reviewer: Reviews changes, suggests additional edge case handling
```

### 2. Bug Fix Pipeline

```
scout → worker → reviewer
```

```
Requirement: "Login returns 500 error. Check @src/auth.ts"

scout:    Traces related code (auth.ts → middleware → DB query)
worker:   Fixes bug (adds null check, improves error handling)
reviewer: Reviews fix, tests edge cases
```

### 3. Feature Development

```
planner → worker → reviewer
```

```
Requirement: "Add pagination to @src/users.ts"

planner:  Plans DB query changes, API parameters, response format
worker:   Implements code (limit/offset, cursor-based pagination)
reviewer: Reviews code quality, verifies with large dataset tests
```

### 4. Documentation Generator

```
researcher → writer
```

```
Requirement: "Generate API documentation for the entire @src/ codebase"

researcher: Collects all endpoints, types, and interfaces
writer:    Creates OpenAPI specification document
```

### 5. Refactoring Pipeline

```
scout → planner → worker → tester → reviewer
```

```
Requirement: "Remove duplicate code in @src/components/ and extract shared components"

scout:    Identifies duplicate patterns (7 similar components found)
planner:  Designs shared abstractions (props interfaces, component structure)
worker:   Executes refactoring (7→3 components consolidated)
tester:   Tests all usages of modified components
reviewer: Final review and documentation
```

---

## Tips

### Agent Design

- **Keep agents focused** — one agent = one clear responsibility. If an agent does "everything," the chain loses its value.
- **Read-only agents first** — use `scout` or `researcher` at the start to gather context before any modifications.
- **Always end with a reviewer** — catches mistakes the earlier agents missed.
- **Match model cost to task** — use `haiku` for analysis/summarization, `sonnet` for complex code generation.

### Chain Design

- **Start simple** — 2-3 agents is often enough. Add more only when you consistently need the extra steps.
- **Give clear requirements** — the more specific your requirement, the better the task distribution.
- **Use `@` references** — helps agents find the right files without guessing.
- **Review tasks before executing** — the Task Distribution model makes good guesses, but you know your codebase better.

### Performance

- **Fast models for distribution/summarization** — set these to `haiku` or similar in Settings. They run on every chain execution.
- **Disable summarization effort** — `effort: off` is usually sufficient for summaries under 1,000 characters.
- **Cleanup by default** — keeps your project directory clean unless you specifically need to inspect intermediate outputs.

### Debugging

```bash
# Enable debug logging to see internal chain state
PI_CHAIN_DEBUG=1 pi

# Inspect intermediate files (disable cleanup first)
# Files are in .pi-chain/<timestamp>/
cat .pi-chain/20260511-*/scout.md
cat .pi-chain/20260511-*/scout.summary.md
```

---

## Development

```bash
# Clone and symlink for development
git clone https://github.com/seung-seop-ahn/pi-chain
ln -s "$(pwd)/pi-chain" ~/.pi/agent/extensions/pi-chain

# Enable debug logging
PI_CHAIN_DEBUG=1 pi
```

### Project Structure

```
pi-chain/
├── index.ts          # Extension entry point, command registration, event handlers
├── ui.ts             # All TUI dialogs, menus, input forms
├── execution.ts      # Chain lifecycle: start, step, advance, complete, abort
├── utils.ts          # Subprocess execution, summarization, file search, JSON parsing
├── types.ts          # Type definitions, constants, message types
├── storage.ts        # Chain/settings persistence (chains.json)
├── agents.ts         # Agent discovery from .md files
└── package.json      # pi package manifest
```

### Build

```bash
npm run build    # TypeScript compilation (for npm publish)
```

Git installs use TypeScript source directly — no build step needed for development.

---

## License

MIT
