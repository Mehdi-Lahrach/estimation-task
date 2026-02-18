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
    estimates: {},             // { blockId: { minutes: N, seconds: N, confidence: 1-5 } }
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

    // Adjust container width for side-by-side estimation layout
    const taskContainer = document.querySelector('.task-container');
    if (pageId === 'estimation' && state.condition === 'detailed') {
      taskContainer.style.maxWidth = '1400px';
    } else {
      taskContainer.style.maxWidth = '';
    }
  }

  // ============================================================
  // PAGE 1: CONSENT
  // ============================================================

  function initConsent() {
    const cb = document.getElementById('consent-checkbox');
    const btn = document.getElementById('consent-continue');
    cb.addEventListener('change', () => { btn.disabled = !cb.checked; });
    btn.addEventListener('click', () => {
      if (cb.checked) {
        showPage('intro');
      }
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

    // Render overview process map (text summary)
    renderOverviewMap();

    // Wire the "Begin estimation" button for both conditions
    const introBtn = document.getElementById('intro-continue');
    if (introBtn) {
      introBtn.addEventListener('click', () => {
        if (state.condition === 'simple') {
          showPage('simple-estimation');
          renderSimpleEstimation();
        } else {
          showPage('estimation');
          requestAnimationFrame(() => renderDetailedEstimation());
        }
      });
    }
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
  // CONDITION A: DETAILED (side-by-side — full SVG map + estimation cards)
  // ============================================================

  function renderDetailedEstimation() {
    const content = document.getElementById('phase-content');
    if (!content) return;

    // Hide the phase nav and progress bar (not used in side-by-side mode)
    const phaseNav = document.getElementById('phase-nav');
    const progressBar = document.getElementById('progress-bar');
    if (phaseNav) phaseNav.style.display = 'none';
    if (progressBar) progressBar.style.display = 'none';

    // Add wrapper class for side-by-side layout
    content.classList.add('detailed-sidebyside-wrapper');

    // Track all phases as explored
    PROCESS_MAP.phases.forEach(p => {
      if (!state.interactions.phasesExpanded.includes(p.id)) {
        state.interactions.phasesExpanded.push(p.id);
      }
    });

    // Build estimation zones for the SVG bracket markers
    const blockLetters = 'ABCDEFGHIJ';
    const zones = [];
    let blockIdx = 0;
    PROCESS_MAP.phases.forEach(phase => {
      phase.estimationBlocks.forEach(block => {
        zones.push({
          stepIds: block.stepsIncluded,
          color: phase.color,
          letter: blockLetters[blockIdx] || String(blockIdx + 1),
          blockId: block.id,
        });
        blockIdx++;
      });
    });

    // Build estimation cards HTML (will be absolutely positioned after render)
    let cardsHtml = '';
    blockIdx = 0;
    PROCESS_MAP.phases.forEach(phase => {
      phase.estimationBlocks.forEach(block => {
        const letter = blockLetters[blockIdx] || String(blockIdx + 1);
        cardsHtml += `
          <div class="est-card" id="est-card-${blockIdx}" style="border-left: 4px solid ${phase.color};">
            <div class="est-card__header">
              <span class="est-card__letter" style="background: ${phase.color};">${letter}</span>
              <div class="est-card__info">
                <div class="est-card__phase">${phase.name}</div>
                <div class="est-card__steps">Steps ${block.stepsIncluded.join(', ')}</div>
              </div>
            </div>
            ${renderEstimationBlock(block, phase)}
          </div>
        `;
        blockIdx++;
      });
    });

    // Build estimation page HTML with contextual reminder
    let html = `
      <div class="page-card fade-in" style="max-width: 960px; margin-bottom: 20px;">
        <p style="margin: 0 0 8px; font-size: 14px; color: var(--text-muted);">
          <strong>Reminder:</strong> You are estimating how long it took participants to complete each section of the
          <em>Municipal Green Zone Vehicle Access Permit</em> application — from the first form page to clicking "Submit application".
        </p>
        <p style="font-size: 14px; color: var(--text-muted); margin-bottom: 6px;">
          The process map below shows all <strong style="color:var(--text)">steps</strong> (the main actions participants performed) grouped into phases. Each lettered zone
          (<strong style="color:var(--text)">A</strong>, <strong style="color:var(--text)">B</strong>, <strong style="color:var(--text)">C</strong>…)
          has an estimation card on the right.
        </p>
        <p style="font-size: 14px; color: var(--text-muted); margin-bottom: 12px; padding: 8px 12px; background: #f0f4f8; border-radius: 6px; border-left: 3px solid var(--primary);">
          💡 <strong style="color:var(--text)">Tip:</strong> Each step may involve hidden <strong style="color:var(--text)">sub-actions</strong> — smaller, less visible actions that participants also had to perform (e.g., reading instructions, mentally calculating, scrolling).
          <strong style="color:var(--text)">Click on any step</strong> in the process map to reveal its sub-actions. Click again to hide them.
        </p>
        <div class="accuracy-reminder">
          <span class="accuracy-reminder__icon">🎯</span>
          <span>Please provide the most precise estimate you can. Use both <strong>minutes and seconds</strong> for accuracy.</span>
        </div>
      </div>

      <div class="estimation-sidebyside">
        <div class="estimation-sidebyside__map">
          <div id="estimation-svg-map" class="svg-map-container"></div>
        </div>
        ${cardsHtml}
      </div>

      <div class="btn-group" style="justify-content: flex-end; padding: 16px 0;">
        <button class="btn btn-primary" id="detailed-submit">Review estimates &#8594;</button>
      </div>
    `;

    content.innerHTML = html;

    // ── Card positioning: align each card to its SVG zone ──────
    let hasAdjustedZones = false;
    function positionCards() {
      const svgEl = document.querySelector('#estimation-svg-map svg');
      if (!svgEl) return;

      const parent = document.querySelector('.estimation-sidebyside');
      const parentRect = parent.getBoundingClientRect();
      const svgRect = svgEl.getBoundingClientRect();
      if (svgRect.height === 0) return; // page not visible yet

      const vb = svgEl.getAttribute('viewBox').split(' ').map(Number);
      const scale = svgRect.height / vb[3];
      const svgTopOffset = svgRect.top - parentRect.top;
      const cardLeft = svgRect.right - parentRect.left + 16;

      // Expand SVG zone spacing if any card is taller than its zone
      if (!hasAdjustedZones) {
        const zoneMinHeights = [];
        let needsAdjustment = false;
        const PAD_SVG = 16; // SVG-unit padding above+below card

        zones.forEach((zone, idx) => {
          const card = document.getElementById('est-card-' + idx);
          if (!card || zone._yMin === undefined) {
            zoneMinHeights.push(0);
            return;
          }
          const cardH = card.offsetHeight / scale; // card height in SVG units
          const zoneH = zone._yMax - zone._yMin;

          if (cardH + PAD_SVG > zoneH) {
            zoneMinHeights.push(cardH + PAD_SVG);
            needsAdjustment = true;
          } else {
            zoneMinHeights.push(0);
          }
        });

        if (needsAdjustment) {
          hasAdjustedZones = true;
          ProcessMapSVG.render('estimation-svg-map', {
            estimationZones: zones,
            zoneMinHeights: zoneMinHeights,
            onRerender: positionCards,
          });
          return; // positionCards will be called again after re-render
        }
      }

      let lastBottom = 0;
      zones.forEach((zone, idx) => {
        const card = document.getElementById('est-card-' + idx);
        if (!card || zone._yCenter === undefined) return;

        const targetY = svgTopOffset + zone._yCenter * scale;
        let top = targetY - card.offsetHeight / 2;

        // Prevent overlap with previous card
        if (top < lastBottom + 12) top = lastBottom + 12;

        card.style.top = top + 'px';
        card.style.left = cardLeft + 'px';
        lastBottom = top + card.offsetHeight;
      });

      // Ensure parent is tall enough for all cards
      if (lastBottom > parent.offsetHeight) {
        parent.style.minHeight = (lastBottom + 24) + 'px';
      }
    }
    // Store reference for reuse (e.g., returning from summary)
    window._positionEstCards = positionCards;

    // Render full SVG with estimation zone markers + reposition callback
    if (typeof ProcessMapSVG !== 'undefined') {
      ProcessMapSVG.render('estimation-svg-map', {
        estimationZones: zones,
        onRerender: positionCards,
      });
    }

    // Initial card positioning (after browser paints SVG)
    requestAnimationFrame(() => {
      positionCards();
      // Second frame to ensure dimensions are stable
      requestAnimationFrame(positionCards);
    });

    // Reposition on window resize
    let resizeTimer;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(positionCards, 80);
    };
    window.removeEventListener('resize', window._estResizeHandler);
    window._estResizeHandler = onResize;
    window.addEventListener('resize', onResize);

    // Wire estimation inputs + confidence
    wireEstimationInputs(content);
    wireConfidenceButtons(content);

    // Submit button → validate then go to summary
    document.getElementById('detailed-submit').addEventListener('click', () => {
      if (validateAllEstimates()) {
        showPage('summary');
        renderSummary();
      }
    });
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
        <div class="estimation-block__confidence" data-block-id="${block.id}">
          <span class="estimation-block__confidence-label">Your confidence in this estimate:</span>
          <div class="likert-scale">
            <span class="likert-anchor likert-anchor--low">Not at all<br>confident</span>
            ${[1,2,3,4,5].map(n => `<button class="likert-btn ${saved.confidence === n ? 'selected' : ''}" data-block-id="${block.id}" data-level="${n}">${n}</button>`).join('')}
            <span class="likert-anchor likert-anchor--high">Extremely<br>confident</span>
          </div>
        </div>
      </div>
    `;
  }

  function wireConfidenceButtons(container) {
    container.querySelectorAll('.likert-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const blockId = btn.dataset.blockId;
        const level = parseInt(btn.dataset.level);
        // Deselect siblings
        btn.closest('.likert-scale').querySelectorAll('.likert-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        // Clear error state on parent confidence row
        btn.closest('.estimation-block__confidence').classList.remove('confidence-missing');
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

  // ── Validation ───────────────────────────────────────────────

  function validateAllEstimates() {
    let valid = true;
    let firstError = null;

    PROCESS_MAP.phases.forEach(phase => {
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

        // Check confidence (compulsory — must be 1-5)
        if (!est || !est.confidence) {
          valid = false;
          const confRow = document.querySelector(`.estimation-block__confidence[data-block-id="${block.id}"]`);
          if (confRow) confRow.classList.add('confidence-missing');
          if (!firstError && confRow) firstError = confRow;
        }
      });
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

  function renderSimpleEstimation() {
    // Renders estimation on a dedicated page with SVG process map + overall estimate
    const container = document.getElementById('simple-content');
    if (!container) return;

    const saved = state.estimates['overall'] || {};

    let html = `
      <div class="page-card fade-in" style="max-width: 960px;">
        <p style="margin: 0 0 12px; font-size: 14px; color: var(--text-muted);">
          <strong>Reminder:</strong> You are estimating how long it took participants to complete the
          <em>Municipal Green Zone Vehicle Access Permit</em> application — from the first form page to clicking "Submit application".
        </p>

        <h2 style="margin-top: 0;">Process map</h2>
        <p style="font-size: 14px; color: var(--text-muted); margin-bottom: 6px;">
          This map shows all the <strong style="color:var(--text)">steps</strong> (main actions) participants went through during the application.
        </p>
        <p style="font-size: 14px; color: var(--text-muted); margin-bottom: 16px; padding: 8px 12px; background: #f0f4f8; border-radius: 6px; border-left: 3px solid var(--primary);">
          💡 <strong style="color:var(--text)">Tip:</strong> Each step may involve hidden <strong style="color:var(--text)">sub-actions</strong> — smaller, less visible actions that participants also had to perform (e.g., reading instructions, mentally calculating, scrolling).
          <strong style="color:var(--text)">Click on any step</strong> in the process map to reveal its sub-actions. Click again to hide them.
        </p>
        <div id="simple-svg-map" class="svg-map-container" style="margin-bottom: 32px;"></div>

        <hr style="margin: 32px 0; border: none; border-top: 2px solid var(--border);">

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
                min="0" max="999" step="1" placeholder="—" aria-label="Minutes"
                value="${saved.minutes !== undefined && saved.minutes !== null ? saved.minutes : ''}">
              <span class="estimation-block__unit">min</span>
            </div>
            <div class="estimation-block__input-group">
              <input type="number" class="estimation-block__input estimation-block__input--sec"
                data-block-id="overall" data-unit="seconds"
                min="0" max="59" step="1" placeholder="—" aria-label="Seconds"
                value="${saved.seconds !== undefined && saved.seconds !== null ? saved.seconds : ''}">
              <span class="estimation-block__unit">sec</span>
            </div>
          </div>
          <div class="estimation-block__confidence" data-block-id="overall">
            <span class="estimation-block__confidence-label">Your confidence in this estimate:</span>
            <div class="likert-scale">
              <span class="likert-anchor likert-anchor--low">Not at all<br>confident</span>
              ${[1,2,3,4,5].map(n => `<button class="likert-btn ${saved.confidence === n ? 'selected' : ''}" data-block-id="overall" data-level="${n}">${n}</button>`).join('')}
              <span class="likert-anchor likert-anchor--high">Extremely<br>confident</span>
            </div>
          </div>
        </div>

        <div class="btn-group" style="justify-content: flex-end; margin-top: 24px;">
          <button class="btn btn-primary" id="simple-submit">Continue &#8594;</button>
        </div>
      </div>
    `;

    container.innerHTML = html;

    // Render SVG process map (no estimation zones — simple condition)
    if (typeof ProcessMapSVG !== 'undefined') {
      ProcessMapSVG.render('simple-svg-map', { idPrefix: 'simple-' });
    }

    // Wire up inputs + confidence
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

      // Check confidence (compulsory — must be 1-5)
      if (!est || !est.confidence) {
        const confRow = document.querySelector('.estimation-block__confidence[data-block-id="overall"]');
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
        const confVal = est.confidence;
        const confLabels = { 1: '1 — Not at all', 2: '2', 3: '3', 4: '4', 5: '5 — Extremely' };
        const conf = confVal ? (confLabels[confVal] || confVal) : '—';

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
      // Return to estimation page and re-position cards
      showPage('estimation');
      requestAnimationFrame(() => {
        if (window._positionEstCards) window._positionEstCards();
      });
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
