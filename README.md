# Estimation Task — Procedure Time Estimation

A Prolific task that asks participants to estimate how long the Green Zone Vehicle Access Permit procedure would take, using an interactive 3-level process map.

## Quick Start

```bash
cd "estimation task"
npm install
npm start
# → Task: http://localhost:3001
# → Dashboard: http://localhost:3001/dashboard?key=research2025
# → CSV Export: http://localhost:3001/api/export/csv?key=research2025
```

## How it works

Participants see an interactive process map of the permit procedure broken into three levels of detail:

1. **Global Map** (5 phases) — strategic overview from the citizen's perspective
2. **Procedural Map** (23 steps) — formal steps as documented in the official procedure
3. **Action Map** (101 actions, 71 hidden) — every actual action including hidden work, cognitive load, and emotional burden

Participants navigate phase by phase, expanding steps to see hidden actions, then enter time estimates for **7 estimation blocks** at the procedural level:

| Block | What it covers | Typical range |
|-------|---------------|---------------|
| Understanding requirements | Reading about the permit and document requirements | 2–20 min |
| Gathering documents | Finding all 6 required documents | 5–60 min |
| Personal details | Filling in name, DOB, national ID | 2–15 min |
| Eligibility assessment | Reading rules and assessing eligibility | 3–25 min |
| Uploading documents | Selecting and uploading supporting docs | 1–10 min |
| Vehicle information | Entering all vehicle details (4 form pages) | 3–20 min |
| Declaration & submission | Reading declaration and submitting | 1–10 min |

Each estimate includes an optional confidence rating (Low/Medium/High).

## Prolific setup

```
http://YOUR_SERVER/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}
```

Set the Prolific completion URL in `public/js/app.js` → `getProlificUrl()`.

## Data collected

The CSV export (`/api/export/csv?key=research2025`) includes one row per participant with:

- Session metadata (Prolific PID, study ID, timestamps)
- Per-block estimates in minutes + confidence
- Total estimated time
- Demographics (admin experience, vehicle permit experience, overall confidence)
- Interaction data (phases explored, actions viewed, time on task)

## Relationship to main experiment

This estimation task is a companion to the main sludge experiment (in the parent folder). The main experiment has participants *actually complete* the permit procedure while tracking their behavior. This task has *different* participants estimate the time based on the process map — the comparison between estimated and actual times is part of the sludge audit methodology.
