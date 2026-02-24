# Estimation Task — Administrative Procedure Study

A Prolific task that asks participants to estimate how long the Green Zone Vehicle Access Permit procedure would take, and what proportion of applicants would make rejection-worthy errors. Uses an interactive BPMN-style process map with two experimental conditions.

## Quick Start

```bash
cd "estimation task"
npm install
npm start
# → Task: http://localhost:3002
# → Dashboard: http://localhost:3002/dashboard?key=research2025
# → CSV Export: http://localhost:3002/api/export/csv?key=research2025
```

Requires **Node.js 18+**.

## How it works

### Two conditions (block-randomized)

Participants are randomly assigned to one of two conditions using CONSORT-compliant block randomization (permuted blocks of size 4, guaranteeing perfect balance at every 4th participant):

**Detailed condition**: Participants see a full interactive SVG process map divided into 5 estimation zones (A–E), each with a side-by-side estimation card. They estimate the time for each zone separately (minutes + seconds) with a 5-point confidence scale. Steps are clickable to reveal hidden sub-actions.

**Simple condition**: Participants see the same interactive SVG process map but provide a single overall time estimate (minutes + seconds) with a 5-point confidence scale. Steps are also clickable to reveal sub-actions.

Both conditions share the same two-page structure: an instructions page (context about the experiment, what participants experienced, their task) followed by the estimation page with the interactive process map.

### The process map

The SVG process map shows the permit procedure as a BPMN-style flow with:

1. **5 phases** (colored zones) — Preparation, Application, Eligibility, Vehicle, Finalization
2. **Steps** within each phase — formal procedural steps (clickable to expand)
3. **Hidden sub-actions** — smaller actions not visible at first glance (cognitive load, waiting, re-reading, etc.)

A tip box on the estimation page explains that participants can click on steps to reveal sub-actions, with definitions of what "steps" and "sub-actions" are.

### Error rate estimation

After providing time estimates, both conditions see a separate page asking them to estimate **what percentage of submitted applications contained at least one error serious enough to cause rejection** (wrong personal details, wrong eligibility decision, incorrect vehicle info — not formatting mistakes). This is accompanied by a 5-point confidence scale.

### Flow

| Condition | Page flow |
|-----------|-----------|
| **Detailed** | Consent → Instructions → Estimation (5 zone cards) → Error rate → Summary/Review → Demographics → Completion |
| **Simple** | Consent → Instructions → Estimation (1 overall) → Error rate → Demographics → Completion |

The page title and header show "Administrative Procedure Study" (neutral, to avoid priming participants about time estimation). Participants do not see which condition they are in.

## Prolific setup

```
http://YOUR_SERVER/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}
```

To force a specific condition for testing, add `&CONDITION=detailed` or `&CONDITION=simple`. Forced conditions are excluded from the block randomization count.

Set the Prolific completion URL in `public/js/app.js` → `getProlificUrl()`.

### Recommended Prolific settings

- **Estimated completion time**: 5–10 minutes (test this yourself first)
- **Device**: Desktop only (the process map doesn't work well on mobile)
- **Allowed to return**: No

## Data collected

The CSV export (`/api/export/csv?key=research2025`) includes one row per participant with:

- **Session metadata**: `session_id`, `prolific_pid`, `study_id`, `condition` (`detailed`/`simple`), `condition_forced` (boolean), timestamps
- **Time estimates**: Per-block estimates in minutes + seconds + confidence (detailed), or single overall estimate (simple), plus total estimated time in seconds
- **Error rate estimate**: `error_rate_percentage` (0–100), `error_rate_confidence` (1–5)
- **Demographics**: age, gender, education, admin experience, vehicle permit experience
- **Interaction data**: phases explored, steps expanded (unique step IDs), full step toggle log (every expand/collapse with timestamp), time on task
- **Step toggle CSV columns**: `steps_expanded_list` (semicolon-separated step IDs), `step_toggle_count`, `step_expand_count`, `step_collapse_count`

## Block randomization

The server uses timeout-based balanced assignment:

- Two conditions: `detailed` and `simple`
- Sessions older than 30 minutes that are neither complete nor submitted are ignored (their condition slot is released)
- Assigns whichever condition has fewer active sessions; ties broken randomly
- Researcher-forced conditions (`?CONDITION=detailed`) are excluded from the balancing count
- Self-correcting: dropout participants' slots are naturally reclaimed

## Deployment

The platform is a standard Node.js app. Deploy to any server that supports Node (Railway, Render, a VPS, etc.).

Set the `EXPORT_KEY` environment variable to something secure before going live:
```bash
EXPORT_KEY=your_secret_key npm start
```

All data is stored in the `/data/` folder as `.jsonl` files. **Back up this folder** — it's your raw data.

## Architecture

```
estimation task/
├── public/
│   ├── index.html           # Single-page app with all task pages
│   ├── css/style.css        # Task styling
│   └── js/
│       └── app.js           # All client logic: conditions, process map, estimation, submission
├── src/
│   └── server.js            # Express backend: sessions, randomization, CSV export, dashboard
├── data/                    # Auto-created — JSONL data files
├── versions/                # Saved snapshots of previous versions
│   └── CHANGELOG.txt
└── package.json
```

## Dashboard features

The researcher dashboard (`/dashboard?key=research2025`) includes:

- **Data quality**: Session counts, completion/dropout rates, condition balance, median task time
- **Ground truth**: Auto-fetches actual procedure times from the procedure task server
- **Estimation accuracy**: Overall and per-condition estimates vs. actual (mean, median, bias, Cohen's d)
- **Estimation distribution chart**: SVG strip/dot plot showing individual estimates (blue = detailed, purple = simple), condition means as diamonds, and ground truth as green dashed vertical line
- **Error rate estimation**: Mean predicted rejection rate vs. actual, by condition
- **Confidence analysis**: Mean confidence by condition, per-block confidence breakdown
- **Behavioral engagement**: Phases explored, steps expanded, time on task by condition
- **Demographics**: Admin experience, vehicle permit experience, overall confidence
- **Participant data table**: Interactive table showing all sessions with checkboxes to toggle exclusion. Tick rows to exclude participants from all calculations; stats reload in real time. Also supports manual PID entry. Exclusion persists in URL for bookmarking/sharing

## Accuracy bonus

The intro page shows a £0.20 bonus notice: the top 50% of participants whose total time estimate is closest to the actual mean completion time receive a bonus payment. This motivates careful engagement with the process map (analogous to practitioner accountability when auditing procedures).

## Relationship to main experiment

This estimation task is a companion to the main sludge experiment (in the `procedure task` folder). The main experiment has participants *actually complete* the permit procedure while tracking their behavior. This task has *different* participants estimate the time and error rate based on the process map — the comparison between estimated and actual outcomes is part of the sludge audit methodology.
