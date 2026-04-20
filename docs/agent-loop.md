# Agent Loop

This project is a good fit for a small multi-agent delivery loop because the next six tasks are sequential at the product level but still benefit from specialized review.

## Current task set

1. Add real filter state in React for disease, geography detail, year, age group, and sex.
2. Add DuckDB-Wasm query helpers that open the remote `ruks_hovedresultater_long.parquet`.
3. Wire the filters to data-driven query helpers.
4. Define the geography join contract for municipality and region boundaries.
5. Add the first actual map layer, ideally starting with regions.
6. Join filtered rates to polygons and color by `Antal personer pr. 100.000 borgere`.

## Recommended baseline loop

Use four agents:

- `Orchestrator`
  Owns backlog order, task decomposition, handoff quality, and done criteria.
- `Frontend/Data Worker`
  Owns React state, DuckDB query helpers, typed adapters, and UI wiring.
- `Mapping/Spatial Worker`
  Owns boundary format choice, join contract, map rendering, and choropleth behavior.
- `QA Expert`
  Owns acceptance verification, regression checks, edge-case review, and release-readiness judgment.

## Role definitions

### Orchestrator

Responsibilities:

- choose the next highest-value task
- split work into small implementation slices
- decide when a new subtask is needed
- keep the task list aligned with `docs/roadmap.md`, `docs/dashboard-spec.md`, and `docs/spatial-data.md`
- block merges that skip required contracts or verification

Good prompts:

- "Review project status, select the next smallest meaningful slice, and write clear done criteria."
- "If implementation reveals a missing prerequisite, create a new task and reorder the queue."

### Frontend/Data Worker

Responsibilities:

- implement filter state
- add DuckDB-Wasm loading and query helpers in `src/lib/`
- keep typed helpers out of components when practical
- drive UI options from actual data domains instead of hardcoded arrays

Good prompts:

- "Implement the next approved slice without redesigning the app shell."
- "Prefer typed helpers and small patches. If blocked by geography assumptions, stop at the contract boundary."

### Mapping/Spatial Worker

Responsibilities:

- document and implement the join contract between RUKS data and DAGI boundaries
- start with `region` if municipality joins are not yet stable
- add the first real choropleth rendering path
- keep disease data and geometry as separate artifacts

Good prompts:

- "Implement the smallest production path to a real choropleth, preserving the current architecture."
- "Do not invent geography fields. Use explicit join keys and document assumptions."

### QA Expert

Responsibilities:

- verify task completion against explicit done criteria
- test happy path, empty state, loading state, and failure state
- check whether new code matches repo guardrails
- reject partial implementations that look finished but are not actually connected end to end

Required review questions:

- "Does the feature work with real data rather than placeholders?"
- "Are filters actually interactive and reflected in results?"
- "Is the map real, and is the metric coming from the dataset?"
- "Are assumptions documented where geography joins are fragile?"

## Loop setup options

## Setup A: Conservative sequential loop

Best when the repo is still early and architecture certainty matters more than speed.

Flow:

1. `Orchestrator` selects one task slice.
2. `Frontend/Data Worker` or `Mapping/Spatial Worker` implements it.
3. `QA Expert` verifies the slice.
4. `Orchestrator` either marks it done, reopens it, or creates a prerequisite follow-up task.

Use this when:

- data contracts are still changing
- map integration is not yet stable
- you want minimal merge conflict risk

Recommended first slices:

1. Real filter state
2. DuckDB distinct-value and filtered-row helpers
3. Filter wiring to query results
4. Geography join contract
5. Region map
6. Choropleth join and coloring

## Setup B: Dual-track loop with shared QA

Best when you want more throughput without too much coordination overhead.

Flow:

1. `Orchestrator` maintains two active tracks:
   - Track 1: UI/data
   - Track 2: spatial/map
2. `Frontend/Data Worker` handles tasks 1 to 3.
3. `Mapping/Spatial Worker` handles tasks 4 to 6, but can begin with a mocked join interface while waiting for final filter wiring.
4. `QA Expert` verifies each track separately, then does an integration pass.

Use this when:

- one person or agent can work on `src/lib/ruks.ts` and filter state
- another can work on map plumbing and geography contracts
- you want earlier visibility into map risks

Main risk:

- the join contract can drift unless the `Orchestrator` treats it as a formal interface

## Setup C: Spec-first loop with hard QA gates

Best when correctness matters more than raw speed and you want to avoid "almost done" outcomes.

Flow:

1. `Orchestrator` writes or updates done criteria before every implementation task.
2. Worker implements only after criteria exist.
3. `QA Expert` checks the implementation against those criteria, not against vibes.
4. If QA finds a contract gap, the `Orchestrator` creates a new prerequisite task instead of waving it through.

Use this when:

- you expect geography joins to be tricky
- you want stronger discipline around documentation and typed contracts
- multiple people may join the project later

## Suggested done criteria per task

### Task 1: Filter state

- all five filter groups are interactive
- state is stored in React
- selected values visibly update
- no hardcoded "always first chip active" behavior remains

### Task 2: DuckDB helpers

- Parquet loads from the selected release asset
- helper functions live in `src/lib/`
- app can query distinct filter values and filtered metric rows
- errors surface cleanly in the UI

### Task 3: Filter wiring

- filter options come from data where practical
- changing a filter changes the queried result set
- UI loading and empty states are handled

### Task 4: Geography contract

- region and municipality join fields are explicitly documented
- assumptions are written down
- no invented upstream fields are introduced

### Task 5: First map

- the placeholder panel is replaced with a real map
- region mode works even if municipality mode is deferred
- boundary loading is separated from disease data loading

### Task 6: Choropleth join

- polygons are colored by `Antal personer pr. 100.000 borgere`
- filter changes update the map
- missing joins are visible and debuggable

## Best-fit recommendation for this repo

Use `Setup B` with a `Setup C` discipline layer.

That means:

- one orchestrator agent manages task order and creates follow-up tasks
- one implementation worker focuses on data plus filters
- one implementation worker focuses on spatial plus map
- one QA expert validates each slice and then validates the integrated app

This fits the current repo because the data/filter work and the map/join work are related but separable. It also keeps QA independent, which is especially useful here because the current UI already looks more complete than its actual behavior.

## Example implementation loop

1. `Orchestrator`: define the next slice and acceptance criteria.
2. `Frontend/Data Worker`: implement filter state plus one DuckDB query helper.
3. `QA Expert`: verify filter interactivity, loading states, and typed boundaries.
4. `Orchestrator`: create a follow-up task if the worker exposed a missing data contract.
5. `Mapping/Spatial Worker`: implement region join contract and first region map.
6. `QA Expert`: verify choropleth correctness and regressions.
7. `Orchestrator`: decide whether municipality mode is ready or should remain a separate next task.

## Practical caution

Do not let the orchestrator also be the QA authority. Keeping QA independent is the simplest way to catch the exact kind of gap this repo currently has: a polished shell that can be mistaken for a completed feature.

## Execution board

Use this as the default loop order unless the orchestrator creates a prerequisite task.

| ID | Task | Primary agent | QA focus | Status |
| --- | --- | --- | --- | --- |
| T1 | Implement real React filter state | `Frontend/Data Worker` | selections persist and visibly change | `todo` |
| T2 | Add DuckDB-Wasm query helpers for remote Parquet | `Frontend/Data Worker` | real data loads, errors handled | `todo` |
| T3 | Drive filter options and result queries from data | `Frontend/Data Worker` | filters affect results end to end | `todo` |
| T4 | Define and document geography join contract | `Mapping/Spatial Worker` | no invented fields, assumptions explicit | `todo` |
| T5 | Replace placeholder with first real region map | `Mapping/Spatial Worker` | map is real, not decorative | `todo` |
| T6 | Join filtered metric to polygons and color map | `Mapping/Spatial Worker` | choropleth updates from filters | `todo` |
| T7 | Final integration pass | `QA Expert` | all six tasks verified together | `todo` |

## Default prompts

### Orchestrator prompt

"Review `docs/agent-loop.md`, `docs/roadmap.md`, `docs/dashboard-spec.md`, and `docs/spatial-data.md`. Pick the next smallest meaningful task, restate done criteria, assign the right worker, and create a follow-up task if a prerequisite is missing."

### Frontend/Data Worker prompt

"Implement the assigned task with small patches. Keep data logic in `src/lib/` and UI logic in `src/app/`. Do not redesign the shell. If blocked by an unresolved geography contract, stop and return the blocker clearly."

### Mapping/Spatial Worker prompt

"Implement the assigned map or geography task with explicit join assumptions. Keep geometry separate from disease data. Prefer a region-first path if municipality joins are not yet stable."

### QA Expert prompt

"Review the latest code or config change against the task done criteria. Report pass or fail, note any gaps, and provide 1 to 5 human tests with expected outcomes and exact feedback-routing instructions."

## QA handoff rule

Any time code or configuration changes, the `QA Expert` must include:

1. a pass or fail judgment against the task criteria
2. 1 to 5 human tests worth running
3. the expected outcome for each test
4. how the human feedback should re-enter the loop

## Human test template

Keep it short and structured like this:

- `Test`: short action a person should take
- `Expected`: what should happen if the system is working
- `If it fails`: which agent should receive the feedback next

Example:

- `Test`: Change disease and year filters.
- `Expected`: selected chips update and the result set changes.
- `If it fails`: send the repro to `Frontend/Data Worker`; if the issue shows a missing task boundary, `Orchestrator` creates a follow-up task.

## Feedback routing

Use this rule after every human test cycle:

- UI state, loading, error, or filter issues go to `Frontend/Data Worker`.
- join-key, boundary, or map-render issues go to `Mapping/Spatial Worker`.
- unclear ownership or newly discovered prerequisites go to `Orchestrator`.
- repeated failures, ambiguous acceptance, or release-readiness concerns go to `QA Expert` for a tighter regression checklist.

The orchestrator should then do one of three things:

1. reopen the current task
2. create a new prerequisite task
3. mark the task done and advance the queue
