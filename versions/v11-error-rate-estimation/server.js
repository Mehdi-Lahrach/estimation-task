const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;
const EXPORT_KEY = process.env.EXPORT_KEY || 'research2025';

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function appendJsonl(filename, data) {
  const filepath = path.join(DATA_DIR, filename);
  const line = JSON.stringify({ ...data, _written_at: new Date().toISOString() }) + '\n';
  fs.appendFileSync(filepath, line, 'utf8');
}

function readJsonl(filename) {
  const filepath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filepath)) return [];
  const content = fs.readFileSync(filepath, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

// ============================================================
// BLOCK RANDOMIZATION (CONSORT-compliant)
// ============================================================
// Uses permuted blocks of size 4 (2 detailed + 2 simple, shuffled).
// Guarantees perfect balance at every 4th participant.
// Within each block, order is random → unpredictable.
// Falls back to balanced coin-flip when between blocks.

const BLOCK_SIZE = 4; // must be even
const CONDITIONS = ['detailed', 'simple'];

function blockRandomize(existingSessions) {
  // Only count non-forced assignments (researcher previews don't affect balancing)
  const assigned = existingSessions
    .filter(s => !s.condition_forced && s.condition)
    .map(s => s.condition);

  const total = assigned.length;
  const posInBlock = total % BLOCK_SIZE;

  if (posInBlock === 0) {
    // Starting a new block — generate a fresh permuted block and return first element
    // Block = [BLOCK_SIZE/2 of each condition], shuffled
    const block = [];
    for (const c of CONDITIONS) {
      for (let i = 0; i < BLOCK_SIZE / 2; i++) block.push(c);
    }
    // Fisher-Yates shuffle
    for (let i = block.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [block[i], block[j]] = [block[j], block[i]];
    }
    // Store the block for subsequent assignments within this block
    blockRandomize._currentBlock = block;
    return block[0];
  }

  // Mid-block: use the stored block if available and consistent
  if (blockRandomize._currentBlock && blockRandomize._currentBlock.length === BLOCK_SIZE) {
    const expected = blockRandomize._currentBlock.slice(0, posInBlock);
    const actual = assigned.slice(-posInBlock);
    // Verify the block is still consistent with what was assigned
    const consistent = expected.every((c, i) => c === actual[i]);
    if (consistent) {
      return blockRandomize._currentBlock[posInBlock];
    }
  }

  // Fallback: server restarted mid-block or block got out of sync.
  // Use balanced assignment (assign to smaller group, random tie-break).
  const detailedCount = assigned.filter(c => c === 'detailed').length;
  const simpleCount = assigned.filter(c => c === 'simple').length;
  if (detailedCount < simpleCount) return 'detailed';
  if (simpleCount < detailedCount) return 'simple';
  return Math.random() < 0.5 ? 'detailed' : 'simple';
}
blockRandomize._currentBlock = null;

// ============================================================
// SESSION MANAGEMENT
// ============================================================

app.post('/api/session/create', (req, res) => {
  const { prolific_pid, study_id, session_id: prolific_session_id } = req.body;
  let { condition } = req.body;

  // Check for duplicate
  const existing = readJsonl('sessions.jsonl');
  const dup = existing.find(s => s.prolific_pid && s.prolific_pid === prolific_pid && s.completed);
  if (dup) {
    return res.json({ success: true, session_id: dup.session_id, condition: dup.condition, already_complete: true });
  }

  // Resume existing incomplete session (preserve their assigned condition)
  const incomplete = existing.find(s => s.prolific_pid && s.prolific_pid === prolific_pid && !s.completed);
  if (incomplete) {
    return res.json({ success: true, session_id: incomplete.session_id, condition: incomplete.condition, resumed: true });
  }

  // Randomize condition if not forced via URL param
  // condition will be null/undefined when no ?CONDITION= was set
  if (!condition || !['detailed', 'simple'].includes(condition)) {
    condition = blockRandomize(existing);
  }

  const session_id = uuidv4();
  appendJsonl('sessions.jsonl', {
    session_id,
    prolific_pid: prolific_pid || null,
    study_id: study_id || null,
    prolific_session_id: prolific_session_id || null,
    condition,
    condition_forced: req.body.condition === condition, // true if researcher forced it via URL
    started_at: new Date().toISOString(),
    completed: false,
    device: req.body.device || null,
  });

  res.json({ success: true, session_id, condition });
});

// ============================================================
// SUBMIT ESTIMATIONS
// ============================================================

app.post('/api/estimation/submit', (req, res) => {
  const { session_id, condition, estimates, errorRateEstimate, interactions,
          totalEstimateSeconds, totalEstimateMinutes, demographics } = req.body;

  if (!session_id) return res.status(400).json({ error: 'session_id required' });

  appendJsonl('estimations.jsonl', {
    session_id,
    condition: condition || null,
    estimates,
    errorRateEstimate: errorRateEstimate || null,
    totalEstimateSeconds: totalEstimateSeconds || null,
    totalEstimateMinutes: totalEstimateMinutes || null,
    interactions,
    demographics,
    submitted_at: new Date().toISOString(),
  });

  // Mark session as completed
  const sessions = readJsonl('sessions.jsonl');
  const updated = sessions.map(s => {
    if (s.session_id === session_id) return { ...s, completed: true, completed_at: new Date().toISOString() };
    return s;
  });
  const filepath = path.join(DATA_DIR, 'sessions.jsonl');
  fs.writeFileSync(filepath, updated.map(s => JSON.stringify(s)).join('\n') + '\n', 'utf8');

  res.json({ success: true });
});

// ============================================================
// DATA EXPORT (protected by key)
// ============================================================

function requireKey(req, res, next) {
  if (req.query.key !== EXPORT_KEY) return res.status(403).json({ error: 'Invalid key' });
  next();
}

app.get('/api/export/csv', requireKey, (req, res) => {
  const sessions = readJsonl('sessions.jsonl');
  const estimations = readJsonl('estimations.jsonl');

  // Merge sessions with estimations
  const estMap = {};
  estimations.forEach(e => { estMap[e.session_id] = e; });

  const rows = sessions.map(s => {
    const est = estMap[s.session_id] || {};
    const row = {
      session_id: s.session_id,
      prolific_pid: s.prolific_pid || '',
      study_id: s.study_id || '',
      condition: s.condition || est.condition || '',
      started_at: s.started_at || '',
      completed: s.completed ? 'true' : 'false',
      completed_at: s.completed_at || '',
      total_estimate_seconds: est.totalEstimateSeconds || '',
      total_estimate_minutes: est.totalEstimateMinutes || '',
    };

    // Add individual estimates (minutes, seconds, confidence per block)
    if (est.estimates) {
      Object.entries(est.estimates).forEach(([blockId, data]) => {
        row[`est_${blockId}_minutes`] = data.minutes !== undefined && data.minutes !== null ? data.minutes : '';
        row[`est_${blockId}_seconds`] = data.seconds !== undefined && data.seconds !== null ? data.seconds : '';
        row[`est_${blockId}_total_sec`] = (data.minutes || 0) * 60 + (data.seconds || 0);
        row[`est_${blockId}_confidence`] = data.confidence || '';
      });
    }

    // Add demographics
    if (est.demographics) {
      Object.entries(est.demographics).forEach(([key, val]) => {
        row[`demo_${key}`] = val || '';
      });
    }

    // Add error rate estimate
    if (est.errorRateEstimate) {
      row['error_rate_percentage'] = est.errorRateEstimate.percentage !== null && est.errorRateEstimate.percentage !== undefined ? est.errorRateEstimate.percentage : '';
      row['error_rate_confidence'] = est.errorRateEstimate.confidence || '';
    }

    // Add interactions
    if (est.interactions) {
      row['phases_explored'] = (est.interactions.phasesExpanded || []).length;
      row['steps_expanded'] = (est.interactions.stepsExpanded || []).length;
      row['time_on_task_ms'] = est.interactions.timeOnTaskMs || '';
    }

    return row;
  });

  if (rows.length === 0) return res.send('No data');

  // Collect all unique keys across all rows
  const headers = [];
  rows.forEach(r => Object.keys(r).forEach(k => { if (!headers.includes(k)) headers.push(k); }));

  const csvLines = [headers.join(',')];
  rows.forEach(r => {
    csvLines.push(headers.map(h => {
      const val = r[h] !== undefined ? String(r[h]) : '';
      return val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
    }).join(','));
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=estimation_data.csv');
  res.send(csvLines.join('\n'));
});

app.get('/api/export/json', requireKey, (req, res) => {
  res.json({
    sessions: readJsonl('sessions.jsonl'),
    estimations: readJsonl('estimations.jsonl'),
  });
});

// ============================================================
// DASHBOARD
// ============================================================

app.get('/dashboard', requireKey, (req, res) => {
  const sessions = readJsonl('sessions.jsonl');
  const estimations = readJsonl('estimations.jsonl');
  const estMap = {};
  estimations.forEach(e => { estMap[e.session_id] = e; });

  const total = sessions.length;
  const completed = sessions.filter(s => s.completed).length;
  const detailedCount = sessions.filter(s => s.condition === 'detailed').length;
  const simpleCount = sessions.filter(s => s.condition === 'simple').length;

  // Compute averages per estimation block (in seconds)
  const blockTotals = {};
  const blockCounts = {};
  estimations.forEach(e => {
    if (e.estimates) {
      Object.entries(e.estimates).forEach(([blockId, data]) => {
        const totalSec = (data.minutes || 0) * 60 + (data.seconds || 0);
        if (totalSec > 0) {
          blockTotals[blockId] = (blockTotals[blockId] || 0) + totalSec;
          blockCounts[blockId] = (blockCounts[blockId] || 0) + 1;
        }
      });
    }
  });

  let blockRows = '';
  Object.entries(blockTotals).forEach(([blockId, total]) => {
    const avgSec = total / blockCounts[blockId];
    const avgMin = Math.floor(avgSec / 60);
    const avgRemSec = Math.round(avgSec % 60);
    const display = avgRemSec > 0 ? `${avgMin} min ${avgRemSec} sec` : `${avgMin} min`;
    blockRows += `<tr><td>${blockId.replace(/_/g, ' ')}</td><td>${display}</td><td>${blockCounts[blockId]}</td></tr>`;
  });

  const avgTotalSec = estimations.length > 0
    ? estimations.reduce((sum, e) => sum + (e.totalEstimateSeconds || 0), 0) / estimations.length
    : 0;
  const avgTotalMin = Math.floor(avgTotalSec / 60);
  const avgTotalRemSec = Math.round(avgTotalSec % 60);
  const avgDisplay = avgTotalSec > 0
    ? (avgTotalRemSec > 0 ? `${avgTotalMin} min ${avgTotalRemSec} sec` : `${avgTotalMin} min`)
    : '—';

  res.send(`<!DOCTYPE html><html><head><title>Estimation Task Dashboard</title>
<style>body{font-family:Arial,sans-serif;max-width:900px;margin:40px auto;padding:0 20px}
.cards{display:flex;gap:16px;margin:20px 0;flex-wrap:wrap}.card{flex:1;min-width:140px;padding:18px;border-radius:8px;text-align:center}
.card h3{margin:0 0 6px;font-size:12px;text-transform:uppercase;opacity:0.7;letter-spacing:0.5px}.card .val{font-size:28px;font-weight:bold}
.card.blue{background:#e8f4f8;color:#1864ab}.card.green{background:#e8f5e9;color:#2b8a3e}
.card.amber{background:#fff8e1;color:#e67700}.card.purple{background:#f3e5f5;color:#862e9c}
table{width:100%;border-collapse:collapse;margin:20px 0}th,td{padding:10px 14px;text-align:left;border-bottom:1px solid #ddd}
th{background:#f5f5f5;font-weight:600;font-size:13px;text-transform:uppercase}</style></head><body>
<h1>Estimation Task — Dashboard</h1>
<div class="cards">
  <div class="card blue"><h3>Total Sessions</h3><div class="val">${total}</div></div>
  <div class="card green"><h3>Completed</h3><div class="val">${completed}</div></div>
  <div class="card amber"><h3>Avg Total Estimate</h3><div class="val">${avgDisplay}</div></div>
  <div class="card purple"><h3>Detailed / Simple</h3><div class="val">${detailedCount} / ${simpleCount}</div></div>
</div>
<h2>Average Estimates by Block</h2>
<table><tr><th>Estimation Block</th><th>Avg Estimate</th><th>N</th></tr>${blockRows || '<tr><td colspan="3">No data yet</td></tr>'}</table>
</body></html>`);
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
  console.log(`\nEstimation task running on http://localhost:${PORT}\n`);
  console.log(`  Researcher preview (forced condition):`);
  console.log(`    Detailed:  http://localhost:${PORT}/?CONDITION=detailed`);
  console.log(`    Simple:    http://localhost:${PORT}/?CONDITION=simple\n`);
  console.log(`  Participant URL (server-randomized 50/50):`);
  console.log(`    http://localhost:${PORT}/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}\n`);
  console.log(`  Dashboard:   http://localhost:${PORT}/dashboard?key=${EXPORT_KEY}`);
  console.log(`  CSV Export:  http://localhost:${PORT}/api/export/csv?key=${EXPORT_KEY}\n`);
});
