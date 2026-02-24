const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3002;
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
// STATS API — comprehensive analysis endpoint
// ============================================================

// Estimation block names for display
const BLOCK_NAMES = {
  entering_personal_details: 'A — Entering personal details',
  reading_eligibility: 'B — Reading eligibility rules',
  selecting_documents: 'C — Selecting documents',
  entering_vehicle_info: 'D — Entering vehicle info',
  declaration_submit: 'E — Declaration & submit',
  overall: 'Overall estimate',
};
const blockName = id => BLOCK_NAMES[id] || id.replace(/_/g, ' ');

// Map estimation blocks to procedure task page groups (for ground truth matching)
const BLOCK_TO_PROCEDURE_PAGES = {
  entering_personal_details: ['applicant_details'],
  reading_eligibility: ['eligibility_rules'],
  selecting_documents: ['doc_upload_eligibility', 'doc_upload_residence'],
  entering_vehicle_info: ['vehicle_info', 'vehicle_category', 'vehicle_fuel', 'vehicle_env_class'],
  declaration_submit: ['application_review'],
};

// Procedure task ground truth — configurable
// Set PROCEDURE_STATS_URL env var to auto-fetch, or edit these defaults after collecting data
let PROCEDURE_GROUND_TRUTH = {
  configured: false,
  totalMeanSec: null,
  totalMedianSec: null,
  actualRejectionRate: null,
  byBlock: {},  // { blockId: { meanSec, medianSec } }
};

// Try to fetch procedure task ground truth
const PROCEDURE_STATS_URL = process.env.PROCEDURE_STATS_URL || 'http://localhost:3001/api/stats?key=research2025';

async function fetchProcedureGroundTruth() {
  try {
    const resp = await fetch(PROCEDURE_STATS_URL);
    if (!resp.ok) return;
    const stats = await resp.json();
    if (!stats.page_stats || stats.page_stats.length === 0) return;

    // Build page timing map
    const pageMap = {};
    stats.page_stats.forEach(p => { pageMap[p.pageId] = p.avgTimeMs; });

    // Compute per-block ground truth (sum of page times)
    const byBlock = {};
    for (const [blockId, pages] of Object.entries(BLOCK_TO_PROCEDURE_PAGES)) {
      const totalMs = pages.reduce((sum, pid) => sum + (pageMap[pid] || 0), 0);
      if (totalMs > 0) {
        byBlock[blockId] = { meanSec: Math.round(totalMs / 1000) };
      }
    }

    // Total procedure time (application pages only)
    const appPages = Object.values(BLOCK_TO_PROCEDURE_PAGES).flat();
    const totalAppMs = appPages.reduce((sum, pid) => sum + (pageMap[pid] || 0), 0);

    PROCEDURE_GROUND_TRUTH = {
      configured: true,
      totalMeanSec: totalAppMs > 0 ? Math.round(totalAppMs / 1000) : null,
      totalMedianSec: null, // median not available from stats endpoint — mean only
      actualRejectionRate: stats.quality_rejection_rate || null,
      byBlock,
    };
    console.log('  Ground truth loaded from procedure task');
  } catch (e) {
    // Procedure task not running — ground truth will show as unconfigured
  }
}

// Helper stats functions
function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

function cohenD(arr1, arr2) {
  if (arr1.length < 2 || arr2.length < 2) return null;
  const m1 = mean(arr1), m2 = mean(arr2);
  const sd1 = stdDev(arr1), sd2 = stdDev(arr2);
  const pooledSd = Math.sqrt(((arr1.length - 1) * sd1 ** 2 + (arr2.length - 1) * sd2 ** 2) / (arr1.length + arr2.length - 2));
  return pooledSd > 0 ? (m1 - m2) / pooledSd : null;
}

function fmtSec(sec) {
  if (!sec && sec !== 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m === 0) return `${s}s`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

app.get('/api/stats', requireKey, async (req, res) => {
  try {
    // Refresh ground truth on each stats call
    await fetchProcedureGroundTruth();

    const sessions = readJsonl('sessions.jsonl');
    const estimations = readJsonl('estimations.jsonl');
    const estMap = {};
    estimations.forEach(e => { estMap[e.session_id] = e; });

    // Parse exclusion list (comma-separated Prolific PIDs)
    const excludeParam = (req.query.exclude || '').trim();
    const excludePids = excludeParam ? excludeParam.split(',').map(p => p.trim()).filter(Boolean) : [];

    // Merge sessions with their estimation data, then apply exclusions
    const mergedAll = sessions.map(s => ({ ...s, estimation: estMap[s.session_id] || null }));
    const merged = mergedAll.filter(s => !excludePids.includes(s.prolific_pid));
    const excludedCount = mergedAll.length - merged.length;

    const total = merged.length;
    const completed = merged.filter(s => s.completed);
    const dropped = merged.filter(s => !s.completed);
    const completedDetailed = completed.filter(s => s.condition === 'detailed');
    const completedSimple = completed.filter(s => s.condition === 'simple');
    const detailedAll = merged.filter(s => s.condition === 'detailed');
    const simpleAll = merged.filter(s => s.condition === 'simple');

    // Time on task (estimation task completion time)
    const taskTimes = completed.map(s => s.estimation?.interactions?.timeOnTaskMs || 0).filter(t => t > 0);
    const medianTaskTimeMs = median(taskTimes);

    // Per-condition total estimates (in seconds)
    function getTotalEstSec(s) {
      return s.estimation?.totalEstimateSeconds || 0;
    }
    const detailedEstimates = completedDetailed.map(getTotalEstSec).filter(v => v > 0);
    const simpleEstimates = completedSimple.map(getTotalEstSec).filter(v => v > 0);
    const allEstimates = [...detailedEstimates, ...simpleEstimates];

    // Per-block estimates (detailed condition only has individual blocks)
    const blockIds = ['entering_personal_details', 'reading_eligibility', 'selecting_documents', 'entering_vehicle_info', 'declaration_submit'];
    const blockStats = {};
    blockIds.forEach(bid => {
      const vals = [];
      const confs = [];
      completedDetailed.forEach(s => {
        const est = s.estimation?.estimates?.[bid];
        if (est) {
          const sec = (est.minutes || 0) * 60 + (est.seconds || 0);
          if (sec > 0) vals.push(sec);
          if (est.confidence) confs.push(est.confidence);
        }
      });
      const gt = PROCEDURE_GROUND_TRUTH.byBlock[bid];
      const meanVal = mean(vals);
      const bias = gt && gt.meanSec && meanVal ? ((meanVal - gt.meanSec) / gt.meanSec * 100) : null;
      blockStats[bid] = {
        n: vals.length,
        meanSec: meanVal,
        medianSec: median(vals),
        sdSec: stdDev(vals),
        meanConf: mean(confs),
        groundTruthSec: gt?.meanSec || null,
        biasPercent: bias,
      };
    });

    // Overall estimate block (simple condition)
    const overallConfs = [];
    completedSimple.forEach(s => {
      const est = s.estimation?.estimates?.overall;
      if (est?.confidence) overallConfs.push(est.confidence);
    });

    // Error rate estimates
    const detailedErrRates = completedDetailed.map(s => s.estimation?.errorRateEstimate?.percentage).filter(v => v !== null && v !== undefined);
    const simpleErrRates = completedSimple.map(s => s.estimation?.errorRateEstimate?.percentage).filter(v => v !== null && v !== undefined);
    const allErrRates = [...detailedErrRates, ...simpleErrRates];
    const errRateConfs = completed.map(s => s.estimation?.errorRateEstimate?.confidence).filter(v => v);

    // Confidence analysis
    const detailedConfs = [];
    completedDetailed.forEach(s => {
      if (s.estimation?.estimates) {
        Object.values(s.estimation.estimates).forEach(e => { if (e.confidence) detailedConfs.push(e.confidence); });
      }
    });

    // Behavioral engagement
    const detailedPhases = completedDetailed.map(s => (s.estimation?.interactions?.phasesExpanded || []).length);
    const simplePhases = completedSimple.map(s => (s.estimation?.interactions?.phasesExpanded || []).length);
    const detailedSteps = completedDetailed.map(s => (s.estimation?.interactions?.stepsExpanded || []).length);
    const simpleSteps = completedSimple.map(s => (s.estimation?.interactions?.stepsExpanded || []).length);
    const detailedTaskTimes = completedDetailed.map(s => s.estimation?.interactions?.timeOnTaskMs || 0).filter(t => t > 0);
    const simpleTaskTimes = completedSimple.map(s => s.estimation?.interactions?.timeOnTaskMs || 0).filter(t => t > 0);

    // Demographics breakdown
    const demoBreakdown = {};
    ['admin_experience', 'vehicle_permit_exp', 'overall_confidence'].forEach(field => {
      const counts = {};
      completed.forEach(s => {
        const val = s.estimation?.demographics?.[field];
        if (val) counts[val] = (counts[val] || 0) + 1;
      });
      demoBreakdown[field] = counts;
    });

    // Condition comparison — effect size
    const conditionD = cohenD(detailedEstimates, simpleEstimates);

    // Overall estimation bias
    const overallMeanEst = mean(allEstimates);
    const overallBias = PROCEDURE_GROUND_TRUTH.totalMeanSec && overallMeanEst
      ? ((overallMeanEst - PROCEDURE_GROUND_TRUTH.totalMeanSec) / PROCEDURE_GROUND_TRUTH.totalMeanSec * 100)
      : null;

    res.json({
      // Section 1: Data quality
      total_sessions: total,
      completed_sessions: completed.length,
      dropped_sessions: dropped.length,
      dropout_rate: total > 0 ? Math.round(dropped.length / total * 100) : 0,
      detailed_completed: completedDetailed.length,
      simple_completed: completedSimple.length,
      detailed_total: detailedAll.length,
      simple_total: simpleAll.length,
      median_task_time_ms: medianTaskTimeMs,
      median_task_time_formatted: fmtSec(medianTaskTimeMs / 1000),

      // Section 2: Ground truth
      ground_truth: PROCEDURE_GROUND_TRUTH,

      // Section 3: Estimation accuracy
      overall_mean_estimate_sec: mean(allEstimates),
      overall_median_estimate_sec: median(allEstimates),
      detailed_mean_estimate_sec: mean(detailedEstimates),
      detailed_median_estimate_sec: median(detailedEstimates),
      simple_mean_estimate_sec: mean(simpleEstimates),
      simple_median_estimate_sec: median(simpleEstimates),
      detailed_sd_sec: stdDev(detailedEstimates),
      simple_sd_sec: stdDev(simpleEstimates),
      condition_cohen_d: conditionD,
      overall_bias_percent: overallBias,
      block_stats: blockStats,

      // Raw estimate distributions (for charts)
      detailed_estimates_sec: detailedEstimates,
      simple_estimates_sec: simpleEstimates,

      // Error rate estimates
      error_rate_mean_all: mean(allErrRates),
      error_rate_mean_detailed: mean(detailedErrRates),
      error_rate_mean_simple: mean(simpleErrRates),
      error_rate_n_all: allErrRates.length,
      actual_rejection_rate: PROCEDURE_GROUND_TRUTH.actualRejectionRate,
      error_rate_mean_confidence: mean(errRateConfs),

      // Section 4: Confidence
      detailed_mean_confidence: mean(detailedConfs),
      simple_mean_confidence: mean(overallConfs),
      block_confidence: Object.fromEntries(blockIds.map(bid => [bid, blockStats[bid].meanConf])),

      // Section 5: Engagement
      detailed_mean_phases: mean(detailedPhases),
      simple_mean_phases: mean(simplePhases),
      detailed_mean_steps: mean(detailedSteps),
      simple_mean_steps: mean(simpleSteps),
      detailed_mean_task_time_ms: mean(detailedTaskTimes),
      simple_mean_task_time_ms: mean(simpleTaskTimes),

      // Section 6: Demographics
      demographics: demoBreakdown,
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Delete all data (piloting) ---
app.post('/api/delete-all-data', requireKey, (req, res) => {
  try {
    const { confirmation } = req.body;
    if (confirmation !== 'i want to delete the data') {
      return res.status(400).json({ error: 'Invalid confirmation text. You must type exactly: i want to delete the data' });
    }
    const files = fs.readdirSync(DATA_DIR);
    let deleted = 0;
    files.forEach(f => {
      if (f.endsWith('.jsonl') || f.endsWith('.json')) {
        fs.unlinkSync(path.join(DATA_DIR, f));
        deleted++;
      }
    });
    console.log(`  [DELETE] All data erased (${deleted} files) by researcher`);
    res.json({ success: true, filesDeleted: deleted });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// DASHBOARD — Full analysis (client-side rendered from /api/stats)
// ============================================================

app.get('/dashboard', requireKey, (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Estimation Task — Analysis Dashboard</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:1100px;margin:40px auto;padding:0 20px;color:#333;background:#fafafa}
h1{color:#1864ab;margin-bottom:5px}
.subtitle{color:#666;font-size:14px;margin-bottom:25px}
h2{color:#1864ab;border-bottom:2px solid #1864ab;padding-bottom:8px;margin-top:35px}
h3{color:#333;margin-top:22px;margin-bottom:10px}
.stats-grid{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}
.stat{background:white;border:1px solid #e0e0e0;padding:14px 20px;border-radius:8px;min-width:120px}
.stat-value{font-size:24px;font-weight:700;color:#1864ab}
.stat-label{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.3px}
.stat--green .stat-value{color:#2b8a3e}
.stat--blue .stat-value{color:#1864ab}
.stat--amber .stat-value{color:#e67700}
.stat--red .stat-value{color:#c92a2a}
.stat--purple .stat-value{color:#862e9c}
table{width:100%;border-collapse:collapse;margin:10px 0;font-size:14px}
th{background:#1864ab;color:white;padding:8px 12px;text-align:left;white-space:nowrap;font-size:12px}
td{padding:6px 12px;border-bottom:1px solid #e0e0e0}
tr:nth-child(even){background:#f8f8f8}
td.num{text-align:right;font-variant-numeric:tabular-nums}
.bar{height:16px;border-radius:2px;display:inline-block;vertical-align:middle;min-width:2px}
.bar--blue{background:#1864ab}.bar--green{background:#2b8a3e}.bar--amber{background:#e67700}.bar--red{background:#c92a2a}.bar--purple{background:#862e9c}
.help{font-size:13px;color:#666;margin-top:3px;line-height:1.5}
.legend{background:white;border:1px solid #e0e0e0;border-radius:6px;padding:12px 16px;margin:10px 0;font-size:13px;line-height:1.6}
.config-box{background:#fff8e1;border:1px solid #ffe082;border-radius:6px;padding:12px 16px;margin:10px 0;font-size:13px}
.export{background:white;border:1px solid #e0e0e0;padding:20px;border-radius:8px;margin:20px 0}
pre{background:#f5f5f5;padding:12px;border-radius:6px;font-size:12px;overflow-x:auto}
a{color:#1864ab}
.bias-pos{color:#c92a2a;font-weight:600}
.bias-neg{color:#2b8a3e;font-weight:600}
.bias-neutral{color:#666}
.dual-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:700px){.dual-col{grid-template-columns:1fr}}
.cond-tag{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;letter-spacing:0.3px}
.cond-tag--detailed{background:#e8f4f8;color:#1864ab}
.cond-tag--simple{background:#f3e5f5;color:#862e9c}
</style></head>
<body>
<h1>Estimation Task — Analysis Dashboard</h1>
<p class="subtitle">Descriptive statistics and analysis overview. Inferential tests should be run in R/Python.</p>

<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
  <label style="font-size:14px;font-weight:600;color:#856404;">Exclude participants (Prolific PIDs, comma-separated):</label><br>
  <input id="exclude-input" type="text" placeholder="e.g. 5cf101ea..., 65b901e6..." style="width:70%;padding:6px 10px;margin-top:6px;border:1px solid #ccc;border-radius:4px;font-size:13px;font-family:monospace">
  <button id="exclude-btn" style="padding:6px 16px;margin-left:8px;background:#1864ab;color:white;border:none;border-radius:4px;cursor:pointer;font-size:13px">Apply</button>
  <button id="exclude-clear" style="padding:6px 12px;margin-left:4px;background:#f3f2f1;border:1px solid #ccc;border-radius:4px;cursor:pointer;font-size:13px">Clear</button>
  <span id="exclude-status" style="margin-left:12px;font-size:12px;color:#666"></span>
</div>

<h2>1. Data Quality &amp; Collection Status</h2>
<div id="s1-cards" class="stats-grid"></div>
<div id="s1-balance" class="legend"></div>

<h2>2. Ground Truth from Procedure Task</h2>
<p class="help">Actual completion times from the procedure task, used as benchmark for estimation accuracy. Fetched live from <code>${PROCEDURE_STATS_URL.replace(/key=.*/, 'key=***')}</code>.</p>
<div id="s2-status"></div>
<div id="s2-cards" class="stats-grid"></div>
<table id="s2-table"><thead><tr><th>Block</th><th>Actual Mean</th></tr></thead><tbody></tbody></table>

<h2>3. Estimation Accuracy</h2>
<p class="help">Comparing participants' estimates to actual procedure times. Bias = (estimated − actual) / actual.</p>

<h3>3a. Overall estimates vs. actual</h3>
<div id="s3-overview" class="stats-grid"></div>

<h3>3a-bis. Distribution of total time estimates</h3>
<p class="help">Each dot is one participant's total estimate. The dashed line shows the actual mean procedure time (ground truth).</p>
<div id="s3-distribution" style="position:relative;height:280px;background:white;border:1px solid #e0e0e0;border-radius:8px;margin:12px 0;padding:0;overflow:hidden;"></div>
<div id="s3-dist-legend" style="font-size:12px;color:#666;margin:6px 0 16px;display:flex;gap:20px;align-items:center;"></div>

<h3>3b. Condition comparison (main hypothesis)</h3>
<p class="help">Do detailed (summed per-block) estimates differ from simple (single overall) estimates?</p>
<div id="s3-condition" class="stats-grid"></div>
<div id="s3-effect" class="legend"></div>

<h3>3c. Per-block accuracy (detailed condition)</h3>
<table id="s3-block-table"><thead><tr><th>Block</th><th>Mean Estimate</th><th>Actual</th><th>Bias</th><th>SD</th><th>N</th><th></th></tr></thead><tbody></tbody></table>

<h3>3d. Error rate estimation</h3>
<p class="help">Participants estimated what % of applications would be rejected due to substantive errors.</p>
<div id="s3-error" class="stats-grid"></div>

<h2>4. Confidence Analysis</h2>
<div id="s4-overview" class="stats-grid"></div>
<table id="s4-block-table"><thead><tr><th>Block</th><th>Mean Confidence</th><th></th></tr></thead><tbody></tbody></table>

<h2>5. Behavioral Engagement</h2>
<p class="help">How participants interacted with the process map during the estimation task.</p>
<table id="s5-table"><thead><tr><th>Metric</th><th><span class="cond-tag cond-tag--detailed">Detailed</span></th><th><span class="cond-tag cond-tag--simple">Simple</span></th></tr></thead><tbody></tbody></table>

<h2>6. Demographics</h2>
<div id="s6-tables" class="dual-col"></div>

<div class="export">
<h2 style="border:none;margin-top:0">Export Data</h2>
<p><a href="/api/export/csv?key=${EXPORT_KEY}"><strong>Download CSV</strong></a> — one row per participant, includes per-block estimates, confidence, error rate, demographics, interactions</p>
<p><a href="/api/export/json?key=${EXPORT_KEY}"><strong>All data (JSON)</strong></a> &nbsp;|&nbsp; <a href="/api/stats?key=${EXPORT_KEY}"><strong>Stats API (JSON)</strong></a></p>
</div>

<div class="export" style="border:2px solid #c92a2a;background:#fff5f5">
<h2 style="border:none;margin-top:0;color:#c92a2a">Erase All Data</h2>
<p style="color:#666;font-size:13px">Delete all collected session data. Use this during piloting to start fresh. <strong>This cannot be undone.</strong></p>
<div id="delete-section">
  <button id="delete-btn-1" style="background:#c92a2a;color:white;border:none;padding:10px 24px;border-radius:5px;cursor:pointer;font-size:14px;font-weight:600">Delete all data</button>
</div>
<div id="delete-step2" style="display:none;margin-top:12px">
  <p style="color:#c92a2a;font-weight:600;margin-bottom:8px">Are you sure? Type <code>i want to delete the data</code> below to confirm:</p>
  <input id="delete-confirm-input" type="text" placeholder="Type confirmation here..." style="padding:8px 12px;border:1px solid #c92a2a;border-radius:4px;width:300px;font-size:14px">
  <button id="delete-btn-2" style="background:#c92a2a;color:white;border:none;padding:8px 20px;border-radius:5px;cursor:pointer;font-size:14px;margin-left:8px;font-weight:600">Confirm &amp; Delete</button>
  <button id="delete-cancel" style="background:#f3f2f1;color:#333;border:1px solid #ccc;padding:8px 20px;border-radius:5px;cursor:pointer;font-size:14px;margin-left:4px">Cancel</button>
  <p id="delete-error" style="color:#c92a2a;font-size:13px;margin-top:6px;display:none"></p>
</div>
<div id="delete-success" style="display:none;margin-top:12px;color:#2b8a3e;font-weight:600"></div>
</div>

<h3>Import into R</h3>
<pre>df &lt;- read.csv("http://YOUR_SERVER:3002/api/export/csv?key=${EXPORT_KEY}")
completed &lt;- df[df$$completed == "true", ]
detailed &lt;- completed[completed$$condition == "detailed", ]
simple   &lt;- completed[completed$$condition == "simple", ]

# Main hypothesis test:
t.test(detailed$$total_estimate_seconds, simple$$total_estimate_seconds)
wilcox.test(detailed$$total_estimate_seconds, simple$$total_estimate_seconds)</pre>

<h3>Import into Python</h3>
<pre>import pandas as pd
from scipy import stats

df = pd.read_csv("http://YOUR_SERVER:3002/api/export/csv?key=${EXPORT_KEY}")
completed = df[df.completed == "true"]
detailed = completed[completed.condition == "detailed"]
simple   = completed[completed.condition == "simple"]

# Main hypothesis test:
stats.ttest_ind(detailed.total_estimate_seconds, simple.total_estimate_seconds)
stats.mannwhitneyu(detailed.total_estimate_seconds, simple.total_estimate_seconds)</pre>

<script>
const K = '${EXPORT_KEY}';
const BLOCK_NAMES = {
  entering_personal_details: 'A — Entering personal details',
  reading_eligibility: 'B — Reading eligibility rules',
  selecting_documents: 'C — Selecting documents',
  entering_vehicle_info: 'D — Entering vehicle info',
  declaration_submit: 'E — Declaration & submit',
  overall: 'Overall estimate',
};
const blockName = id => BLOCK_NAMES[id] || id.replace(/_/g, ' ');
const fmt = sec => {
  if (!sec && sec !== 0) return '—';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  if (m === 0) return s + 's';
  return s > 0 ? m + 'm ' + s + 's' : m + 'm';
};
const pct = v => v !== null && v !== undefined ? v.toFixed(1) + '%' : '—';
const dec = (v, d) => v !== null && v !== undefined ? v.toFixed(d) : '—';
const card = (label, val, color) => '<div class="stat' + (color ? ' stat--' + color : '') + '"><div class="stat-value">' + val + '</div><div class="stat-label">' + label + '</div></div>';
const biasHtml = b => {
  if (b === null || b === undefined) return '<span class="bias-neutral">—</span>';
  const sign = b > 0 ? '+' : '';
  const cls = b > 5 ? 'bias-pos' : b < -5 ? 'bias-neg' : 'bias-neutral';
  return '<span class="' + cls + '">' + sign + b.toFixed(1) + '%</span>';
};

// Exclusion management
const urlParams = new URLSearchParams(window.location.search);
const excludeInput = document.getElementById('exclude-input');
const excludeStatus = document.getElementById('exclude-status');
if (urlParams.get('exclude')) excludeInput.value = urlParams.get('exclude');
function getExcludeParam() { return excludeInput.value.trim(); }
function loadDashboard() {
  const exclude = getExcludeParam();
  const excludeQ = exclude ? '&exclude=' + encodeURIComponent(exclude) : '';
  fetchStats(excludeQ);
  if (exclude) {
    const url = new URL(window.location);
    url.searchParams.set('exclude', exclude);
    window.history.replaceState({}, '', url);
    excludeStatus.textContent = 'Excluding ' + exclude.split(',').filter(Boolean).length + ' participant(s)';
    excludeStatus.style.color = '#c92a2a';
  } else {
    const url = new URL(window.location);
    url.searchParams.delete('exclude');
    window.history.replaceState({}, '', url);
    excludeStatus.textContent = '';
  }
}
document.getElementById('exclude-btn').onclick = loadDashboard;
document.getElementById('exclude-clear').onclick = function() { excludeInput.value = ''; loadDashboard(); };
excludeInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') loadDashboard(); });

function fetchStats(excludeQ) {
fetch('/api/stats?key=' + K + (excludeQ||'')).then(r => r.json()).then(s => {
  // ── Section 1: Data Quality ──
  const dropRate = s.dropout_rate || 0;
  document.getElementById('s1-cards').innerHTML = [
    card('Total Sessions', s.total_sessions, ''),
    card('Completed', s.completed_sessions, 'green'),
    card('Dropped', s.dropped_sessions, s.dropped_sessions > 0 ? 'red' : ''),
    card('Dropout Rate', dropRate + '%', dropRate > 20 ? 'red' : dropRate > 10 ? 'amber' : 'green'),
    card('Median Task Time', s.median_task_time_formatted, ''),
  ].join('');

  const dComp = s.detailed_completed || 0;
  const sComp = s.simple_completed || 0;
  const dTot = s.detailed_total || 0;
  const sTot = s.simple_total || 0;
  document.getElementById('s1-balance').innerHTML =
    '<strong>Condition balance:</strong> ' +
    '<span class="cond-tag cond-tag--detailed">Detailed</span> ' + dComp + ' completed / ' + dTot + ' total &nbsp;&nbsp; ' +
    '<span class="cond-tag cond-tag--simple">Simple</span> ' + sComp + ' completed / ' + sTot + ' total' +
    (Math.abs(dComp - sComp) > 2 ? ' &nbsp;<span style="color:#e67700">⚠ Imbalanced</span>' : ' &nbsp;<span style="color:#2b8a3e">✓ Balanced</span>');

  // ── Section 2: Ground Truth ──
  const gt = s.ground_truth || {};
  if (!gt.configured) {
    document.getElementById('s2-status').innerHTML = '<div class="config-box">⚠ Ground truth not available. Make sure the procedure task server is running on port 3001 with data collected. The dashboard will auto-fetch when available.</div>';
  } else {
    document.getElementById('s2-status').innerHTML = '<div class="legend" style="border-left:3px solid #2b8a3e">✓ Ground truth loaded from procedure task.</div>';
    document.getElementById('s2-cards').innerHTML = [
      card('Actual Mean Total', fmt(gt.totalMeanSec), 'green'),
      card('Actual Rejection Rate', gt.actualRejectionRate !== null ? gt.actualRejectionRate + '%' : '—', gt.actualRejectionRate > 20 ? 'red' : 'amber'),
    ].join('');

    const blockRows = Object.entries(gt.byBlock || {}).map(([bid, d]) =>
      '<tr><td>' + blockName(bid) + '</td><td class="num">' + fmt(d.meanSec) + '</td></tr>'
    ).join('');
    document.querySelector('#s2-table tbody').innerHTML = blockRows || '<tr><td colspan="2">No block data</td></tr>';
  }

  // ── Section 3: Estimation Accuracy ──
  const overallBias = s.overall_bias_percent;
  document.getElementById('s3-overview').innerHTML = [
    card('Mean Estimate (all)', fmt(s.overall_mean_estimate_sec), 'blue'),
    card('Median Estimate (all)', fmt(s.overall_median_estimate_sec), ''),
    card('Actual Mean', gt.configured ? fmt(gt.totalMeanSec) : '—', 'green'),
    card('Overall Bias', biasHtml(overallBias), ''),
  ].join('');

  // Distribution chart (strip/dot plot with both conditions)
  (function() {
    const container = document.getElementById('s3-distribution');
    const detailed = (s.detailed_estimates_sec || []).slice();
    const simple = (s.simple_estimates_sec || []).slice();
    const allPts = [...detailed, ...simple];
    const gtSec = gt.configured ? gt.totalMeanSec : null;
    if (allPts.length === 0) {
      container.innerHTML = '<p style="padding:20px;color:#666">No estimates yet.</p>';
    } else {
      const PAD_L = 50, PAD_R = 30, PAD_T = 30, PAD_B = 50;
      const W = container.offsetWidth || 800;
      const H = 280;
      const maxSec = Math.max(...allPts, gtSec || 0) * 1.1;
      const minSec = 0;
      const xScale = sec => PAD_L + (sec - minSec) / (maxSec - minSec) * (W - PAD_L - PAD_R);
      let svg = '<svg width="'+W+'" height="'+H+'" style="display:block">';
      // X-axis ticks (every minute)
      const tickStep = maxSec > 1200 ? 300 : maxSec > 600 ? 120 : 60;
      for (let t = 0; t <= maxSec; t += tickStep) {
        const x = xScale(t);
        svg += '<line x1="'+x+'" y1="'+PAD_T+'" x2="'+x+'" y2="'+(H-PAD_B)+'" stroke="#e0e0e0" stroke-width="1"/>';
        svg += '<text x="'+x+'" y="'+(H-PAD_B+18)+'" text-anchor="middle" font-size="11" fill="#666">'+(t>=60?Math.floor(t/60)+'m'+(t%60>0?' '+t%60+'s':''):t+'s')+'</text>';
      }
      // Ground truth line
      if (gtSec) {
        const gx = xScale(gtSec);
        svg += '<line x1="'+gx+'" y1="'+(PAD_T-5)+'" x2="'+gx+'" y2="'+(H-PAD_B)+'" stroke="#2b8a3e" stroke-width="2" stroke-dasharray="6,4"/>';
        svg += '<text x="'+gx+'" y="'+(PAD_T-10)+'" text-anchor="middle" font-size="11" fill="#2b8a3e" font-weight="600">Actual: '+fmt(gtSec)+'</text>';
      }
      // Detailed dots (row 1)
      const yDetailed = PAD_T + (H - PAD_T - PAD_B) * 0.35;
      const ySimple = PAD_T + (H - PAD_T - PAD_B) * 0.65;
      svg += '<text x="'+(PAD_L-8)+'" y="'+(yDetailed+4)+'" text-anchor="end" font-size="11" fill="#1864ab" font-weight="600">Detailed</text>';
      svg += '<text x="'+(PAD_L-8)+'" y="'+(ySimple+4)+'" text-anchor="end" font-size="11" fill="#862e9c" font-weight="600">Simple</text>';
      // Jitter helper
      function jitter(vals, baseY) {
        var dots = '';
        var sorted = vals.slice().sort(function(a,b){return a-b;});
        sorted.forEach(function(v, i) {
          var x = xScale(v);
          var yOff = (i % 2 === 0 ? -1 : 1) * (Math.floor(i/2) % 3) * 6;
          dots += '<circle cx="'+x+'" cy="'+(baseY+yOff)+'" r="6" opacity="0.7" stroke="white" stroke-width="1"><title>'+fmt(v)+'</title></circle>';
        });
        return dots;
      }
      svg += '<g fill="#1864ab">'+jitter(detailed, yDetailed)+'</g>';
      svg += '<g fill="#862e9c">'+jitter(simple, ySimple)+'</g>';
      // Means as diamonds
      if (detailed.length > 0) {
        var dm = detailed.reduce(function(a,b){return a+b;},0)/detailed.length;
        var dx = xScale(dm);
        svg += '<polygon points="'+(dx)+','+(yDetailed-9)+' '+(dx+6)+','+(yDetailed)+' '+(dx)+','+(yDetailed+9)+' '+(dx-6)+','+(yDetailed)+'" fill="#1864ab" stroke="white" stroke-width="1.5"><title>Detailed mean: '+fmt(dm)+'</title></polygon>';
      }
      if (simple.length > 0) {
        var sm = simple.reduce(function(a,b){return a+b;},0)/simple.length;
        var sx = xScale(sm);
        svg += '<polygon points="'+(sx)+','+(ySimple-9)+' '+(sx+6)+','+(ySimple)+' '+(sx)+','+(ySimple+9)+' '+(sx-6)+','+(ySimple)+'" fill="#862e9c" stroke="white" stroke-width="1.5"><title>Simple mean: '+fmt(sm)+'</title></polygon>';
      }
      svg += '</svg>';
      container.innerHTML = svg;
    }
    document.getElementById('s3-dist-legend').innerHTML =
      '<span><svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="#1864ab" opacity="0.7"/></svg> Detailed (n='+detailed.length+')</span>'+
      '<span><svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="#862e9c" opacity="0.7"/></svg> Simple (n='+simple.length+')</span>'+
      '<span><svg width="14" height="14"><polygon points="7,1 13,7 7,13 1,7" fill="#1864ab"/></svg> / <svg width="14" height="14"><polygon points="7,1 13,7 7,13 1,7" fill="#862e9c"/></svg> Condition means</span>'+
      (gtSec ? '<span><svg width="20" height="14"><line x1="2" y1="7" x2="18" y2="7" stroke="#2b8a3e" stroke-width="2" stroke-dasharray="4,3"/></svg> Ground truth</span>' : '');
  })();

  // Condition comparison
  document.getElementById('s3-condition').innerHTML = [
    card('Detailed Mean', fmt(s.detailed_mean_estimate_sec), 'blue'),
    card('Detailed SD', fmt(s.detailed_sd_sec), ''),
    card('Simple Mean', fmt(s.simple_mean_estimate_sec), 'purple'),
    card('Simple SD', fmt(s.simple_sd_sec), ''),
  ].join('');

  const dVal = s.condition_cohen_d;
  document.getElementById('s3-effect').innerHTML =
    "<strong>Cohen's d:</strong> " + (dVal !== null ? dVal.toFixed(3) : '—') + ' (detailed − simple)' +
    (dVal !== null ? ' &mdash; ' + (Math.abs(dVal) < 0.2 ? 'negligible' : Math.abs(dVal) < 0.5 ? 'small' : Math.abs(dVal) < 0.8 ? 'medium' : 'large') + ' effect' : '') +
    '<br><span style="font-size:12px;color:#666">Run t-test / Mann-Whitney in R or Python for p-values and confidence intervals.</span>';

  // Per-block table
  const blockIds = ['entering_personal_details', 'reading_eligibility', 'selecting_documents', 'entering_vehicle_info', 'declaration_submit'];
  const bs = s.block_stats || {};
  const maxBlockSec = Math.max(...blockIds.map(bid => bs[bid]?.meanSec || 0), 1);
  document.querySelector('#s3-block-table tbody').innerHTML = blockIds.map(bid => {
    const b = bs[bid] || {};
    const barW = b.meanSec ? Math.round(b.meanSec / maxBlockSec * 100) : 0;
    return '<tr><td>' + blockName(bid) + '</td>' +
      '<td class="num">' + fmt(b.meanSec) + '</td>' +
      '<td class="num">' + (b.groundTruthSec ? fmt(b.groundTruthSec) : '—') + '</td>' +
      '<td class="num">' + biasHtml(b.biasPercent) + '</td>' +
      '<td class="num">' + fmt(b.sdSec) + '</td>' +
      '<td class="num">' + (b.n || 0) + '</td>' +
      '<td><span class="bar bar--blue" style="width:' + barW + '%">&nbsp;</span></td></tr>';
  }).join('') || '<tr><td colspan="7">No data</td></tr>';

  // Error rate
  document.getElementById('s3-error').innerHTML = [
    card('Mean Est. (all)', pct(s.error_rate_mean_all), ''),
    card('Detailed', pct(s.error_rate_mean_detailed), 'blue'),
    card('Simple', pct(s.error_rate_mean_simple), 'purple'),
    card('Actual Rejection', s.actual_rejection_rate !== null ? s.actual_rejection_rate + '%' : '—', 'green'),
    card('Mean Confidence', dec(s.error_rate_mean_confidence, 1), ''),
  ].join('');

  // ── Section 4: Confidence ──
  document.getElementById('s4-overview').innerHTML = [
    card('Detailed Avg Conf.', dec(s.detailed_mean_confidence, 2), 'blue'),
    card('Simple Avg Conf.', dec(s.simple_mean_confidence, 2), 'purple'),
  ].join('');

  const blockConf = s.block_confidence || {};
  const maxConf = 5;
  document.querySelector('#s4-block-table tbody').innerHTML = blockIds.map(bid => {
    const c = blockConf[bid] || 0;
    const barW = Math.round(c / maxConf * 100);
    return '<tr><td>' + blockName(bid) + '</td><td class="num">' + dec(c, 2) + ' / 5</td>' +
      '<td><span class="bar bar--amber" style="width:' + barW + '%">&nbsp;</span></td></tr>';
  }).join('') || '<tr><td colspan="3">No data</td></tr>';

  // ── Section 5: Engagement ──
  document.querySelector('#s5-table tbody').innerHTML = [
    ['Phases explored (mean)', dec(s.detailed_mean_phases, 1), dec(s.simple_mean_phases, 1)],
    ['Steps expanded (mean)', dec(s.detailed_mean_steps, 1), dec(s.simple_mean_steps, 1)],
    ['Time on task (mean)', fmt(s.detailed_mean_task_time_ms / 1000), fmt(s.simple_mean_task_time_ms / 1000)],
  ].map(([m, d, si]) => '<tr><td>' + m + '</td><td class="num">' + d + '</td><td class="num">' + si + '</td></tr>').join('');

  // ── Section 6: Demographics ──
  const demos = s.demographics || {};
  const demoLabels = {
    admin_experience: 'Admin procedure experience',
    vehicle_permit_exp: 'Vehicle permit experience',
    overall_confidence: 'Overall confidence in estimates',
  };
  let demoHtml = '';
  Object.entries(demoLabels).forEach(([field, label]) => {
    const counts = demos[field] || {};
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const maxCount = Math.max(...entries.map(e => e[1]), 1);
    let rows = entries.map(([val, count]) => {
      const barW = Math.round(count / maxCount * 100);
      return '<tr><td>' + val.replace(/_/g, ' ') + '</td><td class="num">' + count + '</td><td><span class="bar bar--blue" style="width:' + barW + '%">&nbsp;</span></td></tr>';
    }).join('');
    demoHtml += '<div><h3>' + label + '</h3><table><thead><tr><th>Response</th><th>N</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="3">No data</td></tr>') + '</tbody></table></div>';
  });
  document.getElementById('s6-tables').innerHTML = demoHtml;
});
} // end fetchStats

// Initial load
loadDashboard();

// Delete data flow
document.getElementById('delete-btn-1').onclick = function() {
  document.getElementById('delete-btn-1').style.display = 'none';
  document.getElementById('delete-step2').style.display = 'block';
  document.getElementById('delete-confirm-input').focus();
};
document.getElementById('delete-cancel').onclick = function() {
  document.getElementById('delete-step2').style.display = 'none';
  document.getElementById('delete-btn-1').style.display = '';
  document.getElementById('delete-confirm-input').value = '';
  document.getElementById('delete-error').style.display = 'none';
};
document.getElementById('delete-btn-2').onclick = function() {
  const val = document.getElementById('delete-confirm-input').value.trim().toLowerCase();
  const errEl = document.getElementById('delete-error');
  if (val !== 'i want to delete the data') {
    errEl.textContent = 'Confirmation text does not match. Please type exactly: i want to delete the data';
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';
  fetch('/api/delete-all-data?key='+K, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ confirmation: val })
  }).then(r=>r.json()).then(d => {
    if (d.success) {
      document.getElementById('delete-step2').style.display = 'none';
      document.getElementById('delete-success').style.display = 'block';
      document.getElementById('delete-success').textContent = 'All data deleted ('+d.filesDeleted+' files). Refresh the page to see empty dashboard.';
    } else {
      errEl.textContent = d.error || 'Deletion failed';
      errEl.style.display = 'block';
    }
  }).catch(e => { errEl.textContent = 'Request failed: '+e.message; errEl.style.display = 'block'; });
};
</script>
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
  console.log(`  Participant URL (block-randomized, balanced):`);
  console.log(`    http://localhost:${PORT}/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}\n`);
  console.log(`  Dashboard:   http://localhost:${PORT}/dashboard?key=${EXPORT_KEY}`);
  console.log(`  CSV Export:  http://localhost:${PORT}/api/export/csv?key=${EXPORT_KEY}\n`);
});
