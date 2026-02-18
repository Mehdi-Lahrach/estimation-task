/**
 * PROCESS MAP SVG RENDERER (v2)
 *
 * Renders a BPMN-style SVG flowchart from the PROCESS_MAP data.
 *
 * Key improvements over v1:
 * - Full text display: step names wrap to multiple lines (no truncation)
 * - Dynamic box heights based on content
 * - Proper decision label spacing (no overlap with next elements)
 * - Horizontal error loop labels (compact, readable)
 * - Click-to-expand substep overlay showing hidden actions
 * - Stakeholder-ready: data model supports multiple stakeholders (swim lanes later)
 *
 * Usage:
 *   ProcessMapSVG.render('container-id')
 *   ProcessMapSVG.render('container-id', { onPhaseClick: fn })
 *   - All process maps are interactive: click any step to see details
 */

const ProcessMapSVG = (() => {
  'use strict';

  // ── Configuration ─────────────────────────────────────────────
  const CFG = {
    canvasPad:       36,
    phaseGap:        28,
    phasePadX:       22,
    phasePadY:       14,
    phaseLabelH:     34,
    stepW:           480,
    stepMinH:        56,
    stepPadTop:      12,
    stepPadBottom:   10,
    stepNameLineH:   17,
    stepBadgeRowH:   22,
    stepNameBadgeGap: 6,
    stepGap:         14,
    stepR:           8,
    decisionSize:    50,
    circleR:         16,
    arrowSz:         6,
    loopOffX:        46,   // how far error loop extends right of box
    loopR:           14,   // curve radius for error loop
    badgeH:          18,
    badgeR:          9,
    badgePadX:       7,
    badgeFontSz:     9,
    stepFontSz:      12,
    phaseFontSz:     13,
    lineCol:         '#bdbdbd',
    lineW:           1.4,
    arrowCol:        '#757575',
    errCol:          '#C92A2A',
  };

  // Derived widths
  const PHASE_INNER_W = CFG.stepW + CFG.phasePadX * 2;
  const BAND_EXTRA    = CFG.loopOffX + 30; // extra width for error loops + label
  const FULL_W        = PHASE_INNER_W + CFG.canvasPad * 2 + BAND_EXTRA;

  // ── SVG helpers ───────────────────────────────────────────────

  const E = {
    a: v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
                      .replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    t: v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                      .replace(/>/g, '&gt;'),
  };

  function tag(name, attrs = {}, inner = '') {
    const a = Object.entries(attrs).map(([k, v]) => `${k}="${E.a(v)}"`).join(' ');
    return `<${name} ${a}>${inner}</${name}>`;
  }

  function approxW(str, fontSize) {
    return str.length * fontSize * 0.57;
  }

  // Word-wrap text into lines that fit within maxPx
  function wrap(str, maxPx, fontSize) {
    const maxChars = Math.floor(maxPx / (fontSize * 0.57));
    if (str.length <= maxChars) return [str];
    const words = str.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (test.length > maxChars && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // ── Step dimension pre-computation ────────────────────────────

  function stepDims(step) {
    const idW = approxW(step.id, 10) + 14;
    const hiddenW = step.hiddenActions.length > 0 ? 40 : 0;
    const nameW = CFG.stepW - idW - hiddenW - 32;
    const lines = wrap(step.name, nameW, CFG.stepFontSz);
    const nameH = lines.length * CFG.stepNameLineH;
    const h = CFG.stepPadTop + nameH + CFG.stepNameBadgeGap
            + CFG.stepBadgeRowH + CFG.stepPadBottom;
    return { lines, nameH, idW, h: Math.max(h, CFG.stepMinH) };
  }

  // ── Layout computation ────────────────────────────────────────

  function computeLayout() {
    const elems = [];
    let y = CFG.canvasPad;
    const cx = CFG.canvasPad + CFG.phasePadX + CFG.stepW / 2;

    // Start circle
    elems.push({ type: 'start', x: cx, y: y + CFG.circleR, r: CFG.circleR });
    y += CFG.circleR * 2 + 18;

    for (const phase of PROCESS_MAP.phases) {
      const py0 = y;
      y += CFG.phaseLabelH + CFG.phasePadY;

      for (const step of phase.steps) {
        if (step.isDecisionPoint) {
          // Decision diamond — compute label lines for spacing
          const lblLines = wrap(step.name, CFG.stepW * 0.65, 10);
          const lblH = lblLines.length * 13 + 4;

          elems.push({
            type: 'decision', step, phase,
            x: cx, y: y + CFG.decisionSize / 2,
            size: CFG.decisionSize, lblLines,
          });
          y += CFG.decisionSize + lblH + 10;
        } else {
          // Task box — dynamic height
          const dims = stepDims(step);
          elems.push({
            type: 'task', step, phase, dims,
            x: cx - CFG.stepW / 2, y,
            w: CFG.stepW, h: dims.h,
          });
          y += dims.h + CFG.stepGap;
        }
      }

      y += CFG.phasePadY;
      elems.push({
        type: 'band', phase,
        x: CFG.canvasPad, y: py0,
        w: PHASE_INNER_W + BAND_EXTRA,
        h: y - py0,
      });
      y += CFG.phaseGap;
    }

    // End circle
    elems.push({ type: 'end', x: cx, y: y + CFG.circleR, r: CFG.circleR });
    y += CFG.circleR * 2 + CFG.canvasPad;

    return { elems, w: FULL_W, h: y, cx };
  }

  // ── Drawing ───────────────────────────────────────────────────

  function topY(e) {
    if (e.type === 'start' || e.type === 'end') return e.y - e.r;
    if (e.type === 'task') return e.y;
    if (e.type === 'decision') return e.y - e.size / 2;
    return e.y;
  }

  function bottomY(e) {
    if (e.type === 'start' || e.type === 'end') return e.y + e.r;
    if (e.type === 'task') return e.y + e.h;
    if (e.type === 'decision') return e.y + e.size / 2;
    return e.y;
  }

  function draw(layout) {
    let svg = '';

    // Defs
    svg += `<defs>
      <marker id="pm-arr" viewBox="0 0 10 10" refX="10" refY="5"
        markerWidth="${CFG.arrowSz}" markerHeight="${CFG.arrowSz}" orient="auto-start-reverse">
        <path d="M0 0L10 5L0 10z" fill="${CFG.arrowCol}"/>
      </marker>
      <marker id="pm-arr-err" viewBox="0 0 10 10" refX="10" refY="5"
        markerWidth="${CFG.arrowSz}" markerHeight="${CFG.arrowSz}" orient="auto-start-reverse">
        <path d="M0 0L10 5L0 10z" fill="${CFG.errCol}"/>
      </marker>
      <filter id="pm-shd" x="-4%" y="-4%" width="108%" height="112%">
        <feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.1"/>
      </filter>
    </defs>`;

    const bands = layout.elems.filter(e => e.type === 'band');
    const flow  = layout.elems.filter(e =>
      ['start', 'end', 'task', 'decision'].includes(e.type));

    // Phase bands (background)
    for (const b of bands) svg += drawBand(b);

    // Connector arrows between consecutive flow elements
    for (let i = 0; i < flow.length - 1; i++) {
      svg += tag('line', {
        x1: layout.cx, y1: bottomY(flow[i]),
        x2: layout.cx, y2: topY(flow[i + 1]),
        stroke: CFG.lineCol, 'stroke-width': CFG.lineW,
        'marker-end': 'url(#pm-arr)',
      });
    }

    // Flow elements
    for (const e of flow) {
      if (e.type === 'start')        svg += drawCircle(e, '#2B8A3E', 'Start', false);
      else if (e.type === 'end')     svg += drawCircle(e, '#C92A2A', 'End', true);
      else if (e.type === 'task')    svg += drawTask(e);
      else if (e.type === 'decision') svg += drawDecision(e);
    }

    return `<svg xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 ${layout.w} ${layout.h}"
      width="100%" style="max-width:${layout.w}px;display:block;margin:0 auto">
      <style>
        .pm-task{transition:opacity .2s;cursor:pointer}
        .pm-task:hover>rect:first-child{filter:brightness(.96)}
        .pm-badge text{font-family:system-ui,-apple-system,sans-serif}
      </style>
      ${svg}
    </svg>`;
  }

  // ── Draw helpers ──────────────────────────────────────────────

  function drawCircle(e, color, label, filled) {
    let s = '';
    s += tag('circle', {
      cx: e.x, cy: e.y, r: e.r,
      fill: filled ? color : '#fff', stroke: color, 'stroke-width': 2.5,
    });
    if (filled) {
      s += tag('circle', {
        cx: e.x, cy: e.y, r: e.r - 4,
        fill: '#fff', stroke: color, 'stroke-width': 1.5,
      });
    }
    s += tag('text', {
      x: e.x, y: e.y + e.r + 14,
      fill: '#9e9e9e', 'font-size': 10,
      'text-anchor': 'middle', 'font-family': 'system-ui,sans-serif',
    }, label);
    return s;
  }

  function drawBand(b) {
    let s = '';
    const c = b.phase.color;

    // Background
    s += tag('rect', {
      x: b.x, y: b.y, width: b.w, height: b.h,
      rx: 10, fill: c + '08', stroke: c + '30', 'stroke-width': 1.5,
    });

    // Header bar
    s += tag('rect', {
      x: b.x, y: b.y, width: b.w, height: CFG.phaseLabelH, rx: 10, fill: c,
    });
    // Square-off bottom of header
    s += tag('rect', {
      x: b.x, y: b.y + CFG.phaseLabelH - 10, width: b.w, height: 10, fill: c,
    });

    // Label text
    s += tag('text', {
      x: b.x + 16, y: b.y + CFG.phaseLabelH / 2 + 4,
      fill: '#fff', 'font-size': CFG.phaseFontSz, 'font-weight': 700,
      'font-family': 'system-ui,sans-serif', 'dominant-baseline': 'middle',
    }, E.t(`Phase ${b.phase.icon}: ${b.phase.name}`));

    return s;
  }

  function drawTask(e) {
    const { step, phase, dims } = e;
    let s = `<g class="pm-task" data-step-id="${step.id}" data-phase-id="${phase.id}">`;

    // Box background
    s += tag('rect', {
      x: e.x, y: e.y, width: e.w, height: e.h,
      rx: CFG.stepR, fill: '#fff', stroke: phase.color,
      'stroke-width': 1.5, filter: 'url(#pm-shd)',
    });

    // Step ID badge
    s += tag('rect', {
      x: e.x + 10, y: e.y + 10,
      width: dims.idW, height: 20, rx: 4,
      fill: phase.color + '18',
    });
    s += tag('text', {
      x: e.x + 10 + dims.idW / 2, y: e.y + 22,
      fill: phase.color, 'font-size': 10, 'font-weight': 700,
      'text-anchor': 'middle', 'font-family': 'system-ui,sans-serif',
    }, E.t(step.id));

    // Step name — multi-line via <tspan>
    const nx = e.x + 10 + dims.idW + 10;
    const ny0 = e.y + CFG.stepPadTop + CFG.stepNameLineH * 0.75;
    let nameEl = `<text fill="#212529" font-size="${CFG.stepFontSz}" font-weight="500" font-family="system-ui,sans-serif">`;
    dims.lines.forEach((line, i) => {
      nameEl += `<tspan x="${nx}" y="${ny0 + i * CFG.stepNameLineH}">${E.t(line)}</tspan>`;
    });
    nameEl += '</text>';
    s += nameEl;

    // Action type badges (below the name text)
    const by = e.y + CFG.stepPadTop + dims.nameH + CFG.stepNameBadgeGap;
    let bx = e.x + 10;
    for (const type of step.actionTypes) {
      const colors = (typeof ACTION_TYPE_COLORS !== 'undefined'
        ? ACTION_TYPE_COLORS[type] : null) || { bg: '#f5f5f5', text: '#666' };
      const label = type.split(': ')[1] || type;
      const bw = approxW(label, CFG.badgeFontSz) + CFG.badgePadX * 2;
      s += tag('rect', {
        x: bx, y: by, width: bw, height: CFG.badgeH, rx: CFG.badgeR, fill: colors.bg,
      });
      s += tag('text', {
        x: bx + bw / 2, y: by + CFG.badgeH / 2 + 1,
        fill: colors.text, 'font-size': CFG.badgeFontSz, 'font-weight': 600,
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-family': 'system-ui,sans-serif',
      }, E.t(label));
      bx += bw + 4;
    }

    // Hidden actions indicator (top-right)
    if (step.hiddenActions.length > 0) {
      const hx = e.x + e.w - 46;
      const hy = e.y + 10;
      s += tag('rect', {
        x: hx, y: hy, width: 36, height: 20, rx: 4,
        fill: '#fff3e0', stroke: '#E67700', 'stroke-width': 0.75,
      });
      s += tag('text', {
        x: hx + 18, y: hy + 12,
        fill: '#E67700', 'font-size': 9, 'font-weight': 700,
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-family': 'system-ui,sans-serif',
      }, E.t(`+${step.hiddenActions.length}`));
    }

    // Error loop arrow
    if (step.errorLoop) s += drawErrorLoop(e);

    s += '</g>';
    return s;
  }

  function drawDecision(e) {
    const { step, phase, lblLines } = e;
    const cx = e.x, cy = e.y, half = e.size / 2;

    let s = `<g class="pm-decision" data-step-id="${step.id}" data-phase-id="${phase.id}">`;

    // Diamond shape
    s += tag('polygon', {
      points: `${cx},${cy - half} ${cx + half},${cy} ${cx},${cy + half} ${cx - half},${cy}`,
      fill: '#fff', stroke: phase.color, 'stroke-width': 2, filter: 'url(#pm-shd)',
    });

    // "?" in center
    s += tag('text', {
      x: cx, y: cy + 1,
      fill: phase.color, 'font-size': 18, 'font-weight': 700,
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-family': 'system-ui,sans-serif',
    }, '?');

    // Label below diamond — multi-line, properly spaced
    let labelEl = '<text text-anchor="middle" font-size="10" fill="#424242"'
      + ' font-style="italic" font-family="system-ui,sans-serif">';
    lblLines.forEach((line, i) => {
      labelEl += `<tspan x="${cx}" y="${cy + half + 14 + i * 13}">${E.t(line)}</tspan>`;
    });
    labelEl += '</text>';
    s += labelEl;

    s += '</g>';
    return s;
  }

  function drawErrorLoop(e) {
    let s = '';
    const rx = e.x + e.w;          // right edge of task box
    const yMid = e.y + e.h / 2;    // vertical center
    const lx = rx + CFG.loopOffX;   // rightmost point of loop
    const r = CFG.loopR;
    const topLoop = e.y - 8;        // loop returns above step (with clearance)

    // Path: right → curve up → vertical up → curve left → horizontal left (arrow)
    s += tag('path', {
      d: [
        `M${rx} ${yMid}`,
        `L${lx - r} ${yMid}`,
        `A${r} ${r} 0 0 0 ${lx} ${yMid - r}`,
        `L${lx} ${topLoop + r}`,
        `A${r} ${r} 0 0 0 ${lx - r} ${topLoop}`,
        `L${rx + 10} ${topLoop}`,
      ].join(' '),
      fill: 'none', stroke: CFG.errCol, 'stroke-width': 1.5,
      'stroke-dasharray': '4,3', 'marker-end': 'url(#pm-arr-err)',
    });

    // Compact horizontal label at the top of the loop
    s += tag('text', {
      x: lx + 6, y: topLoop + 4,
      fill: CFG.errCol, 'font-size': 9, 'font-weight': 600,
      'font-family': 'system-ui,sans-serif',
      'dominant-baseline': 'middle',
    }, E.t('\u21BB Retry'));

    return s;
  }

  // ── Substep overlay (HTML popup on click) ─────────────────────

  let activeOverlay = null;
  let clickHandler = null;

  function showOverlay(container, taskGroup, step, phase) {
    closeOverlay();

    const rect = taskGroup.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    const panel = document.createElement('div');
    panel.className = 'pm-overlay';

    let html = '';

    // Header
    html += `<div class="pm-overlay__head" style="border-left-color:${phase.color}">`;
    html += `<span class="pm-overlay__id" style="color:${phase.color}">${E.t(step.id)}</span>`;
    html += `<span class="pm-overlay__name">${E.t(step.name)}</span>`;
    html += `<button class="pm-overlay__x">\u00d7</button>`;
    html += '</div>';

    // Hidden actions list
    if (step.hiddenActions.length > 0) {
      html += '<div class="pm-overlay__body">';
      html += '<div class="pm-overlay__label">Hidden sub-actions</div>';
      for (const a of step.hiddenActions) {
        const c = (typeof ACTION_TYPE_COLORS !== 'undefined'
          ? ACTION_TYPE_COLORS[a.type] : null) || { bg: '#f5f5f5', text: '#666' };
        const short = a.type.split(': ')[1] || a.type;
        html += '<div class="pm-overlay__row">';
        html += '<span class="pm-overlay__dot"></span>';
        html += `<span class="pm-overlay__desc">${E.t(a.description)}</span>`;
        html += `<span class="pm-overlay__tag" style="background:${c.bg};color:${c.text}">${E.t(short)}</span>`;
        html += '</div>';
      }
      html += '</div>';
    }

    // Error loop info
    if (step.errorLoop) {
      html += '<div class="pm-overlay__err">';
      html += `\u21BB <strong>Error loop:</strong> ${E.t(step.errorLoop.condition)}`;
      html += '</div>';
    }

    // Empty state
    if (step.hiddenActions.length === 0 && !step.errorLoop) {
      html += '<div class="pm-overlay__body">';
      html += '<div class="pm-overlay__empty">No hidden sub-actions for this step.</div>';
      html += '</div>';
    }

    // Stakeholder info (shown when multiple stakeholders defined)
    if (typeof PROCESS_MAP.stakeholders !== 'undefined'
        && Object.keys(PROCESS_MAP.stakeholders).length > 1) {
      const shKey = step.stakeholder || phase.stakeholder
                 || PROCESS_MAP.defaultStakeholder;
      const sh = PROCESS_MAP.stakeholders[shKey];
      if (sh) {
        html += '<div class="pm-overlay__stakeholder">';
        html += `<span class="pm-overlay__sh-label">Performed by:</span> ${E.t(sh.label)}`;
        html += '</div>';
      }
    }

    panel.innerHTML = html;
    document.body.appendChild(panel);

    // Position: fixed, below the step
    const panelW = Math.min(Math.max(rect.width, 340), 500);
    panel.style.position = 'fixed';
    panel.style.width = panelW + 'px';
    panel.style.left = Math.max(8, Math.min(rect.left, vw - panelW - 8)) + 'px';
    panel.style.top = (rect.bottom + 6) + 'px';
    panel.style.zIndex = '10000';

    // Flip above if overflowing viewport bottom
    requestAnimationFrame(() => {
      const pRect = panel.getBoundingClientRect();
      if (pRect.bottom > vh - 8) {
        panel.style.top = (rect.top - pRect.height - 6) + 'px';
      }
    });

    activeOverlay = panel;

    // Close button
    panel.querySelector('.pm-overlay__x').addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeOverlay();
    });

    // Close on outside click (delayed to avoid immediate trigger)
    clickHandler = (ev) => {
      if (activeOverlay && !activeOverlay.contains(ev.target)
          && !taskGroup.contains(ev.target)) {
        closeOverlay();
      }
    };
    setTimeout(() => document.addEventListener('click', clickHandler), 10);

    // Close on scroll
    const scrollHandler = () => {
      closeOverlay();
      window.removeEventListener('scroll', scrollHandler, true);
    };
    window.addEventListener('scroll', scrollHandler, true);
  }

  function closeOverlay() {
    if (activeOverlay) {
      activeOverlay.remove();
      activeOverlay = null;
    }
    if (clickHandler) {
      document.removeEventListener('click', clickHandler);
      clickHandler = null;
    }
  }

  // ── Main render ───────────────────────────────────────────────

  function render(containerId, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const layout = computeLayout();
    container.innerHTML = draw(layout);

    // Wire step clicks → substep overlay
    container.querySelectorAll('.pm-task').forEach(g => {
      g.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const sid = g.dataset.stepId;
        const pid = g.dataset.phaseId;
        let stepData = null, phaseData = null;
        for (const p of PROCESS_MAP.phases) {
          if (p.id === pid) phaseData = p;
          for (const st of p.steps) {
            if (st.id === sid) stepData = st;
          }
        }
        if (stepData && phaseData) {
          showOverlay(container, g, stepData, phaseData);
        }
      });
    });

    // Optional: phase click callback (for estimation page navigation)
    if (options.onPhaseClick) {
      container.querySelectorAll('[data-phase-id]').forEach(el => {
        if (!el.classList.contains('pm-task') && !el.classList.contains('pm-decision')) {
          el.style.cursor = 'pointer';
          el.addEventListener('click', () => {
            options.onPhaseClick(el.dataset.phaseId);
          });
        }
      });
    }
  }

  // ── Public API ────────────────────────────────────────────────
  return { render };
})();
