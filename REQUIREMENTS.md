# pi-chain

> All code and comments must be written in **English**.

## Purpose

Implement a **pi extension** that allows users to sequentially select self-created subagents and execute them in a single, ordered chain flow tailored to the user's requirements.

---

## Main Feature

When the user executes `/chain` in pi, a **modal appears in the center** of the screen with the following menu:

- **Create chain**
- **Run chain**
- **List chain**
- **Delete chain**
- **Settings**

---

## Create Chain

Created chains must be **usable across all sessions**.

### Flow

#### Step 1 — Subagent Selection & Chain Order Screen

- Displays the list of **currently available subagents** in pi.
- **Arrow keys** move through the list; **spacebar** selects a subagent.
- Selected subagents are **numbered** in the order of selection (e.g., `#1`, `#2`, `#3`).
- The order of selection determines the **execution order** of the chain.
- At the top of the screen, the selected subagents are displayed **connected by arrows** so the user can clearly see the chain being built (e.g., `scout → planner → worker → reviewer`).
- Once selection is complete, press **Enter** to advance to the next screen.

#### Step 2 — Model & Effort Assignment per Subagent

- Displays the selected subagents **in the chosen order**.
- **Arrow keys** navigate between subagents; press **Enter** to configure the Model & Effort for a given subagent.
- Only **models from the user's registered providers** (i.e., models currently usable in pi) are available. Model search is supported.
- After Model & Effort are configured for every subagent, advance to the next screen.

#### Step 3 — Chain Naming Screen

- The user provides a **name** for the chain.
- Upon saving, the modal returns to the **main menu**.

---

## Run Chain

### Step 1 — Chain Selection & Requirement Input

- Choose a chain from the list of previously created chains.
- **If no chains exist**, the user cannot proceed to the next screen.
- The user enters their requirement in a **chat-like input** — identical to pi's main chat:
  - Supports `@` keyword to reference files (shows a matching file list below the input for selection).
- The user can also choose whether to perform **cleanup** of files generated during the chain process.

### Step 2 — Task Distribution

- A dedicated **Task Distribution model** analyzes the user's requirement.
- **Referenced files are NOT read** at this stage. The analysis focuses solely on the **intent** of the requirement, not the file contents.
  - Example: `"@test.ts 파일을 수정해주세요"` → The model focuses on "modify work" without reading `test.ts`.
- The model organizes and refines the requirement so that LLMs can better understand it, then **distributes tasks to each subagent** in the chain according to the requirement.
- (See **Settings** for configuring the Task Distribution model.)

### Step 3 — Task Review & Modification

- After distribution is complete, the user can **review** how tasks were assigned to each subagent.
- The user may **modify** task assignments before execution begins.

### Step 4 — Chain Execution in Main Session

- The modal closes, and the chain executes in the **main chat window / session**.
- Subagents run **sequentially**, each receiving:
  - The **work results** from the previous subagent.
  - The **user's original requirement** (refined by Task Distribution).
- Execution happens in the **main session** because:
  - Subagents may need **user approval** for certain actions.
  - Subagents may need to **ask the user questions**.

### Context Management Between Subagents

To prevent context overload from large outputs, inter-agent communication is split into two modes:

| Mode           | Condition                        | Behavior                                                                                                                                            |
| -------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inline**     | Output is **< 1,000 characters** | Pass the full content directly to the next subagent.                                                                                                |
| **File-based** | Output is **≥ 1,000 characters** | Save the content to a file; the next subagent receives a summary plus a file reference and is instructed to read the file if more detail is needed. |

#### File Storage Structure

When operating in **file-based mode**, inter-agent communication files are stored as follows:

1. A `.pi-chain` directory is created under the **directory where pi is currently running** (the working directory).
2. Inside `.pi-chain`, a **timestamp-based subdirectory** is created for each chain execution (e.g., `.pi-chain/20260508-142530/`).
3. Within that timestamp directory, each subagent's output is saved as a file named after the **subagent name** (e.g., `.pi-chain/20260508-142530/planner.md`, `.pi-chain/20260508-142530/worker.md`).

```
. (pi working directory)
└── .pi-chain/
    └── 20260508-142530/
        ├── planner.md        # Output from the "planner" subagent
        ├── worker.md          # Output from the "worker" subagent
        └── reviewer.md        # Output from the "reviewer" subagent
```

#### Cleanup

If the user enables the **cleanup option** before running a chain, the **entire timestamp directory** (e.g., `.pi-chain/20260508-142530/`) is **deleted** after the chain completes. This prevents accumulation of temporary files across executions.

### User-Facing Summaries

- After **each subagent** finishes, its work is summarized into **< 1,000 characters** (key points only) and shown to the user so they understand what that subagent did.
- In **file-based mode**, this summary (not the full output) is what gets passed to the next subagent, along with the file reference.

### Step 5 — Completion Summary

- When **all subagents** in the chain have finished their work, the **entire chain output is summarized** and displayed to the user in the **main screen**.

---

## List Chain

- Displays a list of all chains the user has created.
- If **no chains exist**, shows a "no chains" message.
- The user can return to the **modal menu**.

---

## Delete Chain

- Displays a list of chains available for deletion.
- After deletion is confirmed, returns to the **modal menu**.
- If **no chains exist**, shows a "no chains" message.
- The user can return to the **modal menu**.

---

## Settings

| Setting               | Description                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Task Distribution** | Configure the **Model & Effort** used for analyzing the user's requirement and distributing tasks among subagents. |
| **Summarization**     | Configure the **Model & Effort** used for summarizing each subagent's results.                                     |

---

## Full Chain Workflow Summary

### Create chain

1. Choose subagents sequentially (arrow keys + spacebar; top bar shows `scout → planner → worker → ...`).
2. Assign Model & Effort per subagent (only user-accessible models; searchable).
3. Name the chain.
4. Save. Returns to modal menu.

### Run chain

1. Select a chain; input requirements with `@` file references; optionally enable cleanup.
2. Task Distribution model analyzes the requirement (without reading referenced files) and distributes tasks.
3. User reviews and optionally modifies task assignments.
4. Modal closes; chain executes in the main session:
   - Each subagent runs in order, receiving the previous subagent's output and the original requirement.
   - User can interact with subagents (approvals, questions).
   - Progress is visible in the main screen.
   - Inter-agent handoff uses inline (< 1,000 chars) or file-based (≥ 1,000 chars) mode.
5. Upon completion, all work is summarized and displayed in the main screen.

### List chain

- View all created chains. "No chains" message if empty. Return to modal menu.

### Delete chain

- Delete a chain from the list. "No chains" message if empty. Return to modal menu.

### Settings

- Configure Task Distribution model & effort.
- Configure Summarization model & effort.

---

- MUST consider LLM timeout & user cancellation actions
