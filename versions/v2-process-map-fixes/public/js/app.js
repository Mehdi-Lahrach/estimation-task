/**
 * ESTIMATION TASK — Application Logic
 *
 * Two conditions:
 *   ?CONDITION=detailed  →  Phase-by-phase estimation with interactive process map,
 *                           step drill-down, hidden actions, minutes+seconds per block
 *   ?CONDITION=simple    →  Static SVG process map + text summary + ONE overall estimate
 *
 * Both share: consent, intro (adjusted), demographics, completion pages.
 *
 * Key design decisions:
 * - NO anchoring (no suggested ranges)
 * - Minutes + seconds dual input for precision
 * - Emphasis on accuracy ("provide the most precise estimate you can")
 * - Rich phase headers (detailed description of what participants experienced)
 * - Steps carry action type tags directly; hidden sub-actions only where important
 * - Reframed context: Prolific experiment, not a real government procedure
 */

(function () {
  'use strict';

  // ============================================================
  // STATE
  // ============================================================

  const state = {
    sessionId: null,
    condition: 'detailed',    // 'detailed' or 'simple'
    currentPage: 'consent',
    currentPhaseIndex: 0,
    estimates: {},             // { blockId: { minutes: N, seconds: N, confidence: 'low'|'medium'|'high' } }
    interactions: {
      phasesExpanded: [],
      stepsExpanded: [],
      timeOnTaskMs: 0,
    },
    demographics: {},
    startTime: Date.now(),
    expandedSteps: new Set(),
  };

  // ============================================================
  // URL PARAMS (Prolific integration)
  // ============================================================

  const params = new URLSearchParams(window.location.search);
  const prolificPid = params.get('PROLIFIC_PID') || null;
  const studyId = params.get('STUDY_ID') || null;
  const sessionIdParam = params.get('SESSION_ID') || null;

  // Condition from URL (if forced for preview) — otherwise server randomizes
  const conditionParam = (params.get('CONDITION') || '').toLowerCase();
  if (conditionParam === 'simple' || conditionParam === 'detailed') {
    state.condition = conditionParam;
  } else {
    state.condition = null; // will be assigned by server
  }

  // ============================================================
  // SESSION MANAGEMENT
  // ============================================================

  async function createSession() {
    try {
      const resp = await fetch('/api/session/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prolific_pid: prolificPid,
          study_id: studyId,
          session_id: sessionIdParam,
          condition: state.condition,
          device: {
            screenWidth: screen.width,
            screenHeight: screen.height,
            userAgent: navigator.userAgent,
            language: navigator.language,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        }),
      });
      const data = await resp.json();
      if (data.already_complete) {
        showAlreadyComplete();
        return false;
      }
      state.sessionId = data.session_id;
      // Use server-assigned condition (handles randomization)
      if (data.condition) {
        state.condition = data.condition;
      }
      return true;
    } catch (e) {
      console.error('Session creation failed:', e);
      return false;
    }
  }

  function showAlreadyComplete() {
    document.getElementById('task-pages').innerHTML = `
      <div class="page-card fade-in" style="text-align:center; padding:60px 32px;">
        <h1>Study already completed</h1>
        <p>Our records show you have already completed this task. Each participant may only participate once.</p>
        <div class="btn-group" style="justify-content:center; margin-top:24px;">
          <a href="${getProlificUrl()}" class="btn btn-primary">Return to Prolific</a>
        </div>
      </div>
    `;
  }

  function getProlificUrl() {
    return 'https://app.prolific.com/submissions/complete?cc=XXXXXXX';
  }

  // ============================================================
  // PAGE NAVIGATION
  // ============================================================

  function showPage(pageId) {
    document.querySelectorAll('.task-page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById('page-' + pageId);
    if (target) {
      target.classList.add('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    state.currentPage = pageId;
  }

  // ============================================================
  // PAGE 1: CONSENT
  // ============================================================

  function initConsent() {
    const cb = document.getElementById('consent-checkbox');
    const btn = document.getElementById('consent-continue');
    cb.addEventListener('change', () => { btn.disabled = !cb.checked; });
    btn.addEventListener('click', () => {
      if (cb.checked) showPage('intro');
    });
  }

  // ============================================================
  // PAGE 2: INTRODUCTION
  // ============================================================

  function initIntro() {
    // Fill in process stats
    const statsEl = document.getElementById('process-stats');
    if (statsEl) {
      statsEl.innerHTML = `The procedure had <strong>${PROCESS_STATS.totalPhases} sections</strong>, <strong>${PROCESS_STATS.totalSteps} steps</strong>, and <strong>${PROCESS_STATS.totalHiddenActions} hidden sub-actions</strong> that were not obvious from the instructions.`;
    }

    // Render experiment context
    const ctxEl = document.getElementById('experiment-context');
    if (ctxEl) {
      const ctx = PROCESS_MAP.experimentContext;
      ctxEl.innerHTML = `
        <div class="context-grid">
          <div class="context-item"><strong>Setting:</strong> ${ctx.setting}</div>
          <div class="context-item"><strong>Role-play:</strong> ${ctx.rolePlay}</div>
          <div class="context-item"><strong>Documents:</strong> ${ctx.documents}</div>
          <div class="context-item"><strong>Interaction:</strong> ${ctx.interaction}</div>
          <div class="context-item"><strong>Validation:</strong> ${ctx.validation}</div>
          <div class="context-item"><strong>Completion:</strong> ${ctx.completion}</div>
        </div>
      `;
    }

    // Render overview process map
    renderOverviewMap();

    // Render SVG flowchart on intro page
    if (typeof ProcessMapSVG !== 'undefined') {
      ProcessMapSVG.render('intro-svg-map');
    }

    // Intro continue button
    document.getElementById('intro-continue').addEventListener('click', () => {
      if (state.condition === 'simple') {
        showPage('simple-estimation');
        renderSimpleCondition();
      } else {
        showPage('estimation');
        renderPhase(0);
      }
    });
  }

  function renderOverviewMap() {
    const container = document.getElementById('overview-map');
    if (!container) return;
    let html = '';
    PROCESS_MAP.phases.forEach((phase) => {
      const stepCount = phase.steps.length;
      const hiddenCount = phase.steps.reduce((s, st) => s + st.hiddenActions.length, 0);
      const hasErrors = phase.steps.some(s => s.errorLoop);
      const hasDecision = phase.steps.some(s => s.isDecisionPoint);

      html += `
        <div class="overview-phase" style="border-left-color: ${phase.color};">
          <div class="overview-phase__num" style="background: ${phase.color};">${phase.icon}</div>
          <div class="overview-phase__info">
            <div class="overview-phase__name">${phase.name}</div>
            <div class="overview-phase__desc">${phase.description}</div>
          </div>
          <div class="overview-phase__meta">
            ${stepCount} steps
            ${hiddenCount > 0 ? `<br><span class="overview-phase__hidden">${hiddenCount} hidden</span>` : ''}
            ${hasErrors ? '<br><span class="overview-phase__error">⟳ validation</span>' : ''}
            ${hasDecision ? '<br><span class="overview-phase__decision">◇ decision</span>' : ''}
          </div>
        </div>
      `;
    });
    container.innerHTML = html;
  }

  // ============================================================
  // CONDITION A: DETAILED (phase-by-phase estimation)
  // ============================================================

  function renderPhase(phaseIndex) {
    state.currentPhaseIndex = phaseIndex;
    const phase = PROCESS_MAP.phases[phaseIndex];

    // Track interaction
    if (!state.interactions.phasesExpanded.includes(phase.id)) {
      state.interactions.phasesExpanded.push(phase.id);
    }

    renderPhaseNav(phaseIndex);
    renderProgressBar(phaseIndex);

    const content = document.getElementById('phase-content');
    let html = '';

    // Rich phase header
    html += `
      <div class="phase-header" style="background: ${phase.color};">
        <div class="phase-header__top">
          <span class="phase-header__number">Phase ${phase.icon}</span>
          <span class="phase-header__badge">${phase.steps.length} steps</span>
        </div>
        <h2 class="phase-header__title">${phase.name}</h2>
        <p class="phase-header__short">${phase.description}</p>
      </div>
      <div class="phase-rich-description">
        <div class="phase-rich-description__label">What participants experienced in this section</div>
        <p>${phase.richDescription}</p>
      </div>
      <div class="phase-body fade-in">
    `;

    // Accuracy reminder
    html += `
      <div class="accuracy-reminder">
        <span class="accuracy-reminder__icon">🎯</span>
        <span>Please provide the most precise estimate you can. Use both <strong>minutes and seconds</strong> for accuracy.</span>
      </div>
    `;

    // Render steps grouped by estimation blocks
    phase.estimationBlocks.forEach((block) => {
      const blockSteps = phase.steps.filter(s => block.stepsIncluded.includes(s.id));

      // Steps
      blockSteps.forEach(step => {
        html += renderStep(step, phase);
      });

      // Estimation input
      html += renderEstimationBlock(block, phase);
    });

    // Navigation buttons
    html += `
      <div class="phase-nav-buttons">
        ${phaseIndex > 0
          ? '<button class="btn btn-secondary" id="prev-phase">&#8592; Previous section</button>'
          : '<div></div>'
        }
        ${phaseIndex < PROCESS_MAP.phases.length - 1
          ? '<button class="btn btn-primary" id="next-phase">Next section &#8594;</button>'
          : '<button class="btn btn-primary" id="go-summary">Review estimates &#8594;</button>'
        }
      </div>
    `;

    html += '</div>';
    content.innerHTML = html;

    // Wire up step expansion
    wireStepExpansion(content);

    // Wire up confidence buttons
    wireConfidenceButtons(content);

    // Wire up estimation inputs (minutes + seconds)
    wireEstimationInputs(content);

    // Wire up navigation
    const prevBtn = document.getElementById('prev-phase');
    const nextBtn = document.getElementById('next-phase');
    const summaryBtn = document.getElementById('go-summary');

    if (prevBtn) prevBtn.addEventListener('click', () => renderPhase(phaseIndex - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => {
      if (validatePhaseEstimates(phaseIndex)) renderPhase(phaseIndex + 1);
    });
    if (summaryBtn) summaryBtn.addEventListener('click', () => {
      if (validatePhaseEstimates(phaseIndex)) {
        showPage('summary');
        renderSummary();
      }
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderStep(step, phase) {
    const hasHidden = step.hiddenActions.length > 0;
    const hasErrorLoop = !!step.errorLoop;
    const isDecision = !!step.isDecisionPoint;
    const isExpanded = state.expandedSteps.has(step.id);

    let html = `
      <div class="step ${isExpanded ? 'expanded' : ''} ${isDecision ? 'step--decision' : ''} ${hasErrorLoop ? 'step--error-loop' : ''}" data-step-id="${step.id}">
        <div class="step__header" ${hasHidden ? '' : 'style="cursor:default;"'}>
          <span class="step__number" style="color: ${phase.color};">${step.id}</span>
          <span class="step__name">${step.name}</span>
          <span class="step__tags">
    `;

    // Action type badges directly on the step
    step.actionTypes.forEach(type => {
      const colors = ACTION_TYPE_COLORS[type] || { bg: '#f5f5f5', text: '#666' };
      const shortLabel = type.split(': ')[1] || type;
      html += `<span class="step__type-badge" style="background:${colors.bg}; color:${colors.text};">${shortLabel}</span>`;
    });

    // Error loop indicator
    if (hasErrorLoop) {
      html += '<span class="step__type-badge step__type-badge--error">⟳ Validation</span>';
    }

    // Decision indicator
    if (isDecision) {
      html += '<span class="step__type-badge step__type-badge--decision">◇ Decision</span>';
    }

    html += '</span>';

    // Hidden actions expand indicator
    if (hasHidden) {
      html += `<span class="step__hidden-count">${step.hiddenActions.length} hidden</span>`;
      html += '<span class="step__expand-icon">&#9656;</span>';
    }

    html += '</div>';

    // Expandable hidden actions panel
    if (hasHidden) {
      html += '<div class="step__hidden-panel">';
      html += '<div class="step__hidden-title">Hidden sub-actions (not obvious from the step name)</div>';

      step.hiddenActions.forEach(action => {
        const colors = ACTION_TYPE_COLORS[action.type] || { bg: '#f5f5f5', text: '#666' };
        const shortType = action.type.split(': ')[1] || action.type;
        html += `
          <div class="hidden-action">
            <span class="hidden-action__dot"></span>
            <span class="hidden-action__desc">${action.description}</span>
            <span class="hidden-action__type" style="background:${colors.bg}; color:${colors.text};">${shortType}</span>
          </div>
        `;
      });

      // Error loop detail
      if (hasErrorLoop) {
        html += `
          <div class="hidden-action hidden-action--error">
            <span class="hidden-action__dot" style="background: #C92A2A;"></span>
            <span class="hidden-action__desc"><strong>Possible error loop:</strong> ${step.errorLoop.condition} → participant must correct and retry</span>
            <span class="hidden-action__type" style="background:#fce4ec; color:#c62828;">Error loop</span>
          </div>
        `;
      }

      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  function renderEstimationBlock(block, phase) {
    const saved = state.estimates[block.id] || {};
    return `
      <div class="estimation-block" style="border-color: ${phase.color}; background: ${phase.color}08;">
        <div class="estimation-block__header">
          <span class="estimation-block__icon">⏱</span>
          <span class="estimation-block__label">Your estimate: ${block.label}</span>
        </div>
        <div class="estimation-block__prompt">${block.prompt}</div>
        <div class="estimation-block__input-row">
          <div class="estimation-block__input-group">
            <input type="number" class="estimation-block__input estimation-block__input--min"
              data-block-id="${block.id}" data-unit="minutes"
              min="0" max="999" step="1" placeholder="—"
              value="${saved.minutes !== undefined && saved.minutes !== null ? saved.minutes : ''}"
              aria-label="Minutes">
            <span class="estimation-block__unit">min</span>
          </div>
          <div class="estimation-block__input-group">
            <input type="number" class="estimation-block__input estimation-block__input--sec"
              data-block-id="${block.id}" data-unit="seconds"
              min="0" max="59" step="1" placeholder="—"
              value="${saved.seconds !== undefined && saved.seconds !== null ? saved.seconds : ''}"
              aria-label="Seconds">
            <span class="estimation-block__unit">sec</span>
          </div>
        </div>
        <div class="estimation-block__confidence">
          <span class="estimation-block__confidence-label">Your confidence in this estimate:</span>
          <button class="confidence-btn ${saved.confidence === 'low' ? 'selected' : ''}" data-block-id="${block.id}" data-level="low">Low</button>
          <button class="confidence-btn ${saved.confidence === 'medium' ? 'selected' : ''}" data-block-id="${block.id}" data-level="medium">Medium</button>
          <button class="confidence-btn ${saved.confidence === 'high' ? 'selected' : ''}" data-block-id="${block.id}" data-level="high">High</button>
        </div>
      </div>
    `;
  }

  // ── Wiring helpers ──────────────────────────────────────────

  function wireStepExpansion(container) {
    container.querySelectorAll('.step__header').forEach(header => {
      const step = header.parentElement;
      const hasHidden = step.querySelector('.step__hidden-panel');
      if (!hasHidden) return; // no expand if no hidden actions

      header.addEventListener('click', () => {
        const stepId = step.dataset.stepId;
        step.classList.toggle('expanded');
        if (step.classList.contains('expanded')) {
          state.expandedSteps.add(stepId);
          if (!state.interactions.stepsExpanded.includes(stepId)) {
            state.interactions.stepsExpanded.push(stepId);
          }
        } else {
          state.expandedSteps.delete(stepId);
        }
      });
    });
  }

  function wireConfidenceButtons(container) {
    container.querySelectorAll('.confidence-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const blockId = btn.dataset.blockId;
        const level = btn.dataset.level;
        btn.parentElement.querySelectorAll('.confidence-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        btn.parentElement.classList.remove('confidence-missing');
        if (!state.estimates[blockId]) state.estimates[blockId] = {};
        state.estimates[blockId].confidence = level;
      });
    });
  }

  function wireEstimationInputs(container) {
    container.querySelectorAll('.estimation-block__input').forEach(input => {
      const blockId = input.dataset.blockId;
      const unit = input.dataset.unit; // 'minutes' or 'seconds'

      // Restore saved value
      if (state.estimates[blockId] && state.estimates[blockId][unit] !== undefined) {
        input.value = state.estimates[blockId][unit];
      }

      input.addEventListener('input', () => {
        const val = parseInt(input.value);
        if (!state.estimates[blockId]) state.estimates[blockId] = {};
        state.estimates[blockId][unit] = isNaN(val) ? null : val;

        // Clear error styling on input
        input.style.borderColor = '';
      });
    });
  }

  // ── Phase navigation ──────────────────────────────────────────

  function renderPhaseNav(activeIndex) {
    const nav = document.getElementById('phase-nav');
    let html = '';
    PROCESS_MAP.phases.forEach((phase, i) => {
      if (i > 0) html += '<div class="phase-nav__arrow">→</div>';

      const isActive = i === activeIndex;
      const isCompleted = phaseHasEstimates(i) && i !== activeIndex;
      const classes = ['phase-nav__item'];
      if (isActive) classes.push('active');
      if (isCompleted) classes.push('completed');

      html += `
        <div class="${classes.join(' ')}" style="color: ${phase.color};" data-phase="${i}">
          <div class="phase-nav__number" style="background: ${phase.color};">${phase.icon}</div>
          <span class="phase-nav__name">${phase.shortName}</span>
        </div>
      `;
    });
    nav.innerHTML = html;

    nav.querySelectorAll('.phase-nav__item').forEach(item => {
      item.addEventListener('click', () => {
        renderPhase(parseInt(item.dataset.phase));
      });
    });
  }

  function renderProgressBar(activeIndex) {
    const bar = document.getElementById('progress-bar');
    let html = '';
    PROCESS_MAP.phases.forEach((_, i) => {
      let cls = 'progress-bar__segment';
      if (i < activeIndex || phaseHasEstimates(i)) cls += ' done';
      else if (i === activeIndex) cls += ' current';
      html += `<div class="${cls}"></div>`;
    });
    bar.innerHTML = html;
  }

  function phaseHasEstimates(phaseIndex) {
    const phase = PROCESS_MAP.phases[phaseIndex];
    return phase.estimationBlocks.every(block => {
      const est = state.estimates[block.id];
      if (!est) return false;
      // Either minutes or seconds must be provided (not both null)
      return (est.minutes !== null && est.minutes !== undefined) ||
             (est.seconds !== null && est.seconds !== undefined);
    });
  }

  function validatePhaseEstimates(phaseIndex) {
    const phase = PROCESS_MAP.phases[phaseIndex];
    let valid = true;
    let firstError = null;

    phase.estimationBlocks.forEach(block => {
      const est = state.estimates[block.id];

      // Check time estimate
      const hasMin = est && est.minutes !== null && est.minutes !== undefined;
      const hasSec = est && est.seconds !== null && est.seconds !== undefined;
      if (!hasMin && !hasSec) {
        valid = false;
        const inputs = document.querySelectorAll(`.estimation-block__input[data-block-id="${block.id}"]`);
        inputs.forEach(input => { input.style.borderColor = 'var(--red)'; });
        if (!firstError && inputs.length > 0) firstError = inputs[0];
      }

      // Check confidence (compulsory)
      if (!est || !est.confidence) {
        valid = false;
        const confRow = document.querySelector(`.estimation-block__confidence:has(.confidence-btn[data-block-id="${block.id}"])`);
        if (confRow) confRow.classList.add('confidence-missing');
        if (!firstError && confRow) firstError = confRow;
      }
    });

    if (!valid && firstError) {
      firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (firstError.focus) firstError.focus();
    }
    return valid;
  }

  // ============================================================
  // CONDITION B: SIMPLE (process map + text + one overall estimate)
  // ============================================================

  function renderSimpleCondition() {
    const container = document.getElementById('simple-content');
    if (!container) return;

    let html = '';

    // SVG process map
    html += `
      <div class="simple-section">
        <h2>Visual process map</h2>
        <p class="simple-section__desc">This flowchart shows all the steps that participants had to complete, grouped by section. Steps with a yellow badge had hidden sub-actions that weren't obvious from the instructions. Dashed red arrows indicate potential validation error loops.</p>
        <div id="svg-process-map" class="svg-map-container"></div>
      </div>
    `;

    // Text summary
    html += `
      <div class="simple-section">
        <h2>Summary of the procedure</h2>
        <div class="simple-summary">
          <p>${PROCESS_MAP.description}</p>
          <div class="simple-phases">
    `;

    PROCESS_MAP.phases.forEach(phase => {
      html += `
        <div class="simple-phase-item" style="border-left-color: ${phase.color};">
          <strong style="color: ${phase.color};">Phase ${phase.icon}: ${phase.name}</strong>
          <span>${phase.description}</span>
        </div>
      `;
    });

    html += `
          </div>
          <div class="simple-stats">
            <span><strong>${PROCESS_STATS.totalSteps}</strong> steps total</span>
            <span><strong>${PROCESS_STATS.totalHiddenActions}</strong> hidden sub-actions</span>
            <span><strong>${PROCESS_STATS.stepsWithErrorLoops}</strong> steps with validation error loops</span>
            <span><strong>${PROCESS_STATS.decisionPoints}</strong> decision point${PROCESS_STATS.decisionPoints !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>
    `;

    // Single overall estimation
    html += `
      <div class="simple-section">
        <h2>Your estimate</h2>
        <div class="accuracy-reminder">
          <span class="accuracy-reminder__icon">🎯</span>
          <span>Please provide the most precise estimate you can. Use both <strong>minutes and seconds</strong> for accuracy.</span>
        </div>

        <div class="estimation-block estimation-block--overall">
          <div class="estimation-block__header">
            <span class="estimation-block__icon">⏱</span>
            <span class="estimation-block__label">Overall time estimate</span>
          </div>
          <div class="estimation-block__prompt">
            How long do you think it took participants, on average, to complete the <strong>entire procedure</strong> — from the first form page to clicking "Submit application"?
            <br><small>This includes entering personal details, assessing eligibility, entering vehicle information across 4 form pages, and submitting the application. It does NOT include time spent reading the consent form or task instructions beforehand.</small>
          </div>
          <div class="estimation-block__input-row">
            <div class="estimation-block__input-group">
              <input type="number" class="estimation-block__input estimation-block__input--min"
                data-block-id="overall" data-unit="minutes"
                min="0" max="999" step="1" placeholder="—" aria-label="Minutes">
              <span class="estimation-block__unit">min</span>
            </div>
            <div class="estimation-block__input-group">
              <input type="number" class="estimation-block__input estimation-block__input--sec"
                data-block-id="overall" data-unit="seconds"
                min="0" max="59" step="1" placeholder="—" aria-label="Seconds">
              <span class="estimation-block__unit">sec</span>
            </div>
          </div>
          <div class="estimation-block__confidence">
            <span class="estimation-block__confidence-label">Your confidence in this estimate:</span>
            <button class="confidence-btn" data-block-id="overall" data-level="low">Low</button>
            <button class="confidence-btn" data-block-id="overall" data-level="medium">Medium</button>
            <button class="confidence-btn" data-block-id="overall" data-level="high">High</button>
          </div>
        </div>

        <div class="btn-group" style="justify-content: flex-end; margin-top: 24px;">
          <button class="btn btn-primary" id="simple-submit">Continue &#8594;</button>
        </div>
      </div>
    `;

    container.innerHTML = html;

    // Render SVG process map
    if (typeof ProcessMapSVG !== 'undefined') {
      ProcessMapSVG.render('svg-process-map');
    }

    // Wire up simple estimation inputs + confidence
    wireEstimationInputs(container);
    wireConfidenceButtons(container);

    // Submit button
    document.getElementById('simple-submit').addEventListener('click', () => {
      let valid = true;
      const est = state.estimates['overall'];

      // Check time estimate
      if (!est || (est.minutes === null && est.seconds === null) ||
          (est.minutes === undefined && est.seconds === undefined)) {
        document.querySelectorAll('.estimation-block__input[data-block-id="overall"]').forEach(inp => {
          inp.style.borderColor = 'var(--red)';
        });
        valid = false;
      }

      // Check confidence (compulsory)
      if (!est || !est.confidence) {
        const confRow = document.querySelector('.estimation-block__confidence:has(.confidence-btn[data-block-id="overall"])');
        if (confRow) confRow.classList.add('confidence-missing');
        valid = false;
      }

      if (!valid) return;
      showPage('demographics');
    });
  }

  // ============================================================
  // SUMMARY PAGE (detailed condition only)
  // ============================================================

  function renderSummary() {
    const container = document.getElementById('summary-content');
    let totalSeconds = 0;
    let tableRows = '';

    PROCESS_MAP.phases.forEach(phase => {
      phase.estimationBlocks.forEach(block => {
        const est = state.estimates[block.id] || {};
        const mins = est.minutes || 0;
        const secs = est.seconds || 0;
        const blockTotalSec = mins * 60 + secs;
        totalSeconds += blockTotalSec;
        const conf = est.confidence || '—';

        tableRows += `
          <tr>
            <td><span class="summary-phase-dot" style="background: ${phase.color};"></span> Phase ${phase.icon}</td>
            <td>${block.label}</td>
            <td>${conf}</td>
            <td class="summary-time">${formatTime(mins, secs)}</td>
          </tr>
        `;
      });
    });

    const totalMin = Math.floor(totalSeconds / 60);
    const totalSec = totalSeconds % 60;

    container.innerHTML = `
      <div class="summary-total">
        <span>Your total estimated time for the entire procedure</span>
        <div class="summary-total__time">${formatTime(totalMin, totalSec)}</div>
      </div>

      <table class="summary-table">
        <thead>
          <tr><th>Section</th><th>Estimation block</th><th>Confidence</th><th>Estimate</th></tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>

      <p style="margin: 16px 0; color: var(--text-muted); font-size: 14px;">
        You can go back to adjust any estimate before continuing. Once you proceed, your estimates will be recorded.
      </p>

      <div class="btn-group" style="justify-content: space-between;">
        <button class="btn btn-secondary" id="summary-back">&#8592; Adjust estimates</button>
        <button class="btn btn-primary" id="summary-continue">Continue &#8594;</button>
      </div>
    `;

    document.getElementById('summary-back').addEventListener('click', () => {
      showPage('estimation');
      renderPhase(PROCESS_MAP.phases.length - 1);
    });

    document.getElementById('summary-continue').addEventListener('click', () => {
      showPage('demographics');
    });
  }

  function formatTime(mins, secs) {
    if ((!mins && mins !== 0) && (!secs && secs !== 0)) return '—';
    const m = mins || 0;
    const s = secs || 0;
    if (s === 0) return `${m} min`;
    if (m === 0) return `${s} sec`;
    return `${m} min ${s} sec`;
  }

  // ============================================================
  // DEMOGRAPHICS & SUBMISSION
  // ============================================================

  function initDemographics() {
    document.getElementById('demo-submit').addEventListener('click', async () => {
      // Collect demographics
      const form = document.getElementById('demographics-form');
      const radios = form.querySelectorAll('input[type="radio"]:checked');
      const textInputs = form.querySelectorAll('input[type="text"], textarea');

      // Validate required
      const requiredNames = ['admin_experience', 'vehicle_permit_exp', 'overall_confidence'];
      const missing = requiredNames.filter(name => !form.querySelector(`input[name="${name}"]:checked`));
      if (missing.length > 0) {
        missing.forEach(name => {
          const group = form.querySelector(`input[name="${name}"]`).closest('.form-group');
          if (group) group.style.borderLeft = '3px solid var(--red)';
        });
        return;
      }

      radios.forEach(r => { state.demographics[r.name] = r.value; });
      textInputs.forEach(t => { if (t.value.trim()) state.demographics[t.name] = t.value.trim(); });

      // Calculate total in seconds
      let totalSeconds = 0;
      Object.values(state.estimates).forEach(e => {
        totalSeconds += (e.minutes || 0) * 60 + (e.seconds || 0);
      });

      // Compute time on task
      state.interactions.timeOnTaskMs = Date.now() - state.startTime;

      // Submit
      try {
        await fetch('/api/estimation/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: state.sessionId,
            condition: state.condition,
            estimates: state.estimates,
            totalEstimateSeconds: totalSeconds,
            totalEstimateMinutes: Math.round(totalSeconds / 60 * 100) / 100,
            interactions: state.interactions,
            demographics: state.demographics,
          }),
        });
      } catch (e) {
        console.error('Submission failed:', e);
      }

      showPage('complete');
    });
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  async function init() {
    const ok = await createSession();
    if (!ok) return;

    // Apply condition-specific visibility
    document.body.dataset.condition = state.condition;

    // Show condition indicator in header
    const condLabel = document.getElementById('condition-label');
    if (condLabel) condLabel.textContent = state.condition === 'simple' ? 'Simple' : 'Detailed';

    initConsent();
    initIntro();
    initDemographics();

    // Set Prolific redirect link
    const redirectLink = document.getElementById('prolific-redirect');
    if (redirectLink) redirectLink.href = getProlificUrl();

    showPage('consent');
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
