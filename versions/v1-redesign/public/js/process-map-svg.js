/**
 * PROCESS MAP SVG RENDERER
 *
 * Generates a BPMN-style SVG flowchart from the PROCESS_MAP data.
 * Features:
 * - Task boxes (rounded rectangles) for each step
 * - Decision diamonds for decision points (eligibility yes/no)
 * - Error loop arrows for validation failure loops
 * - Phase colour bands grouping steps
 * - Start/end circles
 * - Arrow connectors between all elements
 * - Action type badges on each box
 * - Hidden action indicators (icon when hiddenActions exist)
 *
 * Usage:
 *   renderProcessMapSVG(containerId, { interactive: true })
 *   - interactive: if true, clicking a phase scrolls/highlights the estimation block
 */

const ProcessMapSVG = (() => {
  'use strict';

  // ── Layout constants ──────────────────────────────────────────
  const CFG = {
    canvasPadding: 30,
    phaseGap: 32,           // vertical gap between phases
    phasePadX: 20,          // padding inside phase band
    phasePadY: 14,
    phaseLabelH: 32,        // height of the phase header label
    stepW: 420,             // width of task boxes
    stepH: 56,              // height of task boxes
    stepGap: 14,            // vertical gap between steps
    stepR: 8,               // corner radius
    decisionSize: 48,       // diamond size (side)
    circleR: 16,            // start/end circle radius
    arrowSize: 6,           // arrowhead size
    errorLoopOffsetX: 44,   // how far error loop arrow goes right
    errorLoopR: 14,         // curve radius for error loop
    badgeH: 18,
    badgeR: 9,
    badgePadX: 8,
    badgeFontSize: 9,
    hiddenIconSize: 16,
    fontSize: 12,
    stepFontSize: 11.5,
    phaseFontSize: 13,
    lineColor: '#9e9e9e',
    lineWidth: 1.5,
    arrowColor: '#616161',
    errorLoopColor: '#C92A2A',
  };

  // ── SVG helpers ───────────────────────────────────────────────

  function svgEl(tag, attrs = {}, children = '') {
    const a = Object.entries(attrs)
      .map(([k, v]) => `${k}="${escAttr(v)}"`)
      .join(' ');
    return `<${tag} ${a}>${children}</${tag}>`;
  }

  function escAttr(val) {
    return String(val).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escText(val) {
    return String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Truncate long text
  function truncate(str, maxLen) {
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen - 1) + '…';
  }

  // Measure approximate text width (rough: 6px per char at 12px font)
  function textWidth(str, fontSize = 12) {
    return str.length * fontSize * 0.55;
  }

  // ── Main render function ──────────────────────────────────────

  function render(containerId, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const interactive = options.interactive || false;
    const compact = options.compact || false; // for simple condition (smaller)

    // Build element positions
    const layout = computeLayout(compact);
    const svgContent = drawSVG(layout, interactive, compact);

    container.innerHTML = svgContent;

    // Wire up interactivity
    if (interactive && options.onPhaseClick) {
      container.querySelectorAll('[data-phase-id]').forEach(el => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => {
          options.onPhaseClick(el.dataset.phaseId);
        });
      });
    }
  }

  // ── Compute layout positions ──────────────────────────────────

  function computeLayout(compact) {
    const elements = [];
    let y = CFG.canvasPadding;
    const centerX = CFG.canvasPadding + CFG.phasePadX + CFG.stepW / 2;
    const phaseX = CFG.canvasPadding;

    // Start circle
    elements.push({ type: 'start', x: centerX, y: y + CFG.circleR, r: CFG.circleR });
    y += CFG.circleR * 2 + 20;

    // For each phase
    PROCESS_MAP.phases.forEach((phase, pi) => {
      const phaseStartY = y;

      // Phase label
      y += CFG.phaseLabelH + CFG.phasePadY;

      // Steps within phase
      phase.steps.forEach((step, si) => {
        if (step.isDecisionPoint) {
          // Decision diamond
          const dSize = CFG.decisionSize;
          elements.push({
            type: 'decision',
            step,
            phase,
            x: centerX,
            y: y + dSize / 2,
            size: dSize,
          });
          y += dSize + CFG.stepGap;
        } else {
          // Task box
          elements.push({
            type: 'task',
            step,
            phase,
            x: centerX - CFG.stepW / 2,
            y,
            w: CFG.stepW,
            h: CFG.stepH,
          });
          y += CFG.stepH + CFG.stepGap;
        }
      });

      y += CFG.phasePadY;
      const phaseEndY = y;

      // Phase band
      elements.push({
        type: 'phaseBand',
        phase,
        x: phaseX,
        y: phaseStartY,
        w: CFG.stepW + CFG.phasePadX * 2 + CFG.errorLoopOffsetX + 30,
        h: phaseEndY - phaseStartY,
        labelY: phaseStartY + CFG.phaseLabelH / 2 + 4,
      });

      y += CFG.phaseGap;
    });

    // End circle
    elements.push({ type: 'end', x: centerX, y: y + CFG.circleR, r: CFG.circleR });
    y += CFG.circleR * 2 + CFG.canvasPadding;

    return {
      elements,
      width: CFG.stepW + CFG.phasePadX * 2 + CFG.canvasPadding * 2 + CFG.errorLoopOffsetX + 30,
      height: y,
      centerX,
    };
  }

  // ── Draw SVG ──────────────────────────────────────────────────

  function drawSVG(layout, interactive, compact) {
    let svg = '';

    // Defs (arrowheads, filters)
    svg += `<defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5"
        markerWidth="${CFG.arrowSize}" markerHeight="${CFG.arrowSize}" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="${CFG.arrowColor}" />
      </marker>
      <marker id="arrow-error" viewBox="0 0 10 10" refX="10" refY="5"
        markerWidth="${CFG.arrowSize}" markerHeight="${CFG.arrowSize}" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="${CFG.errorLoopColor}" />
      </marker>
      <filter id="shadow" x="-5%" y="-5%" width="110%" height="115%">
        <feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.1" />
      </filter>
    </defs>`;

    // Sort: phase bands first (background), then others
    const bands = layout.elements.filter(e => e.type === 'phaseBand');
    const others = layout.elements.filter(e => e.type !== 'phaseBand');

    // Draw phase bands
    bands.forEach(band => {
      svg += svgEl('rect', {
        x: band.x,
        y: band.y,
        width: band.w,
        height: band.h,
        rx: 10,
        ry: 10,
        fill: band.phase.color + '08',
        stroke: band.phase.color + '30',
        'stroke-width': 1.5,
        'data-phase-id': band.phase.id,
      });

      // Phase label
      svg += svgEl('rect', {
        x: band.x,
        y: band.y,
        width: band.w,
        height: CFG.phaseLabelH,
        rx: 10,
        ry: 10,
        fill: band.phase.color,
      });
      // Bottom-round patch
      svg += svgEl('rect', {
        x: band.x,
        y: band.y + CFG.phaseLabelH - 10,
        width: band.w,
        height: 10,
        fill: band.phase.color,
      });

      svg += svgEl('text', {
        x: band.x + 16,
        y: band.labelY,
        fill: '#ffffff',
        'font-size': CFG.phaseFontSize,
        'font-weight': 700,
        'font-family': 'system-ui, sans-serif',
        'dominant-baseline': 'middle',
      }, escText(`Phase ${band.phase.icon}: ${band.phase.name}`));
    });

    // Draw connectors (arrows between consecutive elements)
    const flowElements = others.filter(e => ['start', 'end', 'task', 'decision'].includes(e.type));
    for (let i = 0; i < flowElements.length - 1; i++) {
      const from = flowElements[i];
      const to = flowElements[i + 1];
      const fromY = getBottomY(from);
      const toY = getTopY(to);

      svg += svgEl('line', {
        x1: layout.centerX,
        y1: fromY,
        x2: layout.centerX,
        y2: toY,
        stroke: CFG.lineColor,
        'stroke-width': CFG.lineWidth,
        'marker-end': 'url(#arrow)',
      });
    }

    // Draw elements
    others.forEach(el => {
      if (el.type === 'start') {
        svg += drawCircle(el, '#2B8A3E', 'Start');
      } else if (el.type === 'end') {
        svg += drawCircle(el, '#C92A2A', 'End', true);
      } else if (el.type === 'task') {
        svg += drawTask(el, interactive);
      } else if (el.type === 'decision') {
        svg += drawDecision(el);
      }
    });

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}"
      width="100%" style="max-width:${layout.width}px; display:block; margin:0 auto;">
      <style>
        .pm-task:hover rect { filter: brightness(0.97); }
        .pm-task { transition: opacity 0.2s; }
        .pm-badge text { font-family: system-ui, -apple-system, sans-serif; }
      </style>
      ${svg}
    </svg>`;
  }

  // ── Draw helpers ──────────────────────────────────────────────

  function getBottomY(el) {
    if (el.type === 'start' || el.type === 'end') return el.y + el.r;
    if (el.type === 'task') return el.y + el.h;
    if (el.type === 'decision') return el.y + el.size / 2;
    return el.y;
  }

  function getTopY(el) {
    if (el.type === 'start' || el.type === 'end') return el.y - el.r;
    if (el.type === 'task') return el.y;
    if (el.type === 'decision') return el.y - el.size / 2;
    return el.y;
  }

  function drawCircle(el, color, label, filled = false) {
    let s = '';
    s += svgEl('circle', {
      cx: el.x,
      cy: el.y,
      r: el.r,
      fill: filled ? color : '#ffffff',
      stroke: color,
      'stroke-width': 2.5,
    });
    if (filled) {
      // Inner circle for end
      s += svgEl('circle', {
        cx: el.x,
        cy: el.y,
        r: el.r - 4,
        fill: '#ffffff',
        stroke: color,
        'stroke-width': 1.5,
      });
    }
    s += svgEl('text', {
      x: el.x,
      y: el.y + el.r + 14,
      fill: '#9e9e9e',
      'font-size': 10,
      'text-anchor': 'middle',
      'font-family': 'system-ui, sans-serif',
    }, label);
    return s;
  }

  function drawTask(el, interactive) {
    const step = el.step;
    const phase = el.phase;
    let s = '';

    // Group
    s += `<g class="pm-task" data-phase-id="${phase.id}" data-step-id="${step.id}">`;

    // Box
    s += svgEl('rect', {
      x: el.x,
      y: el.y,
      width: el.w,
      height: el.h,
      rx: CFG.stepR,
      ry: CFG.stepR,
      fill: '#ffffff',
      stroke: phase.color,
      'stroke-width': 1.5,
      filter: 'url(#shadow)',
    });

    // Step ID badge (left)
    const idBadgeW = textWidth(step.id, 10) + 12;
    s += svgEl('rect', {
      x: el.x + 8,
      y: el.y + 8,
      width: idBadgeW,
      height: 18,
      rx: 3,
      fill: phase.color + '18',
    });
    s += svgEl('text', {
      x: el.x + 8 + idBadgeW / 2,
      y: el.y + 19,
      fill: phase.color,
      'font-size': 10,
      'font-weight': 700,
      'text-anchor': 'middle',
      'font-family': 'system-ui, sans-serif',
    }, escText(step.id));

    // Step name
    const nameX = el.x + 8 + idBadgeW + 8;
    const nameMaxW = el.w - idBadgeW - 50;
    const nameText = truncate(step.name, Math.floor(nameMaxW / 6));
    s += svgEl('text', {
      x: nameX,
      y: el.y + 20,
      fill: '#212529',
      'font-size': CFG.stepFontSize,
      'font-weight': 500,
      'font-family': 'system-ui, sans-serif',
    }, escText(nameText));

    // Action type badges (bottom row)
    let badgeX = el.x + 8;
    const badgeY = el.y + 32;
    step.actionTypes.forEach(type => {
      const colors = ACTION_TYPE_COLORS[type] || { bg: '#f5f5f5', text: '#666' };
      const shortLabel = type.split(': ')[1] || type;
      const bw = textWidth(shortLabel, CFG.badgeFontSize) + CFG.badgePadX * 2;
      s += `<g class="pm-badge">`;
      s += svgEl('rect', {
        x: badgeX,
        y: badgeY,
        width: bw,
        height: CFG.badgeH,
        rx: CFG.badgeR,
        fill: colors.bg,
      });
      s += svgEl('text', {
        x: badgeX + bw / 2,
        y: badgeY + CFG.badgeH / 2 + 1,
        fill: colors.text,
        'font-size': CFG.badgeFontSize,
        'font-weight': 600,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
      }, escText(shortLabel));
      s += '</g>';
      badgeX += bw + 4;
    });

    // Hidden action indicator (right side)
    if (step.hiddenActions.length > 0) {
      const hx = el.x + el.w - 28;
      const hy = el.y + 8;
      s += svgEl('rect', {
        x: hx,
        y: hy,
        width: 20,
        height: 16,
        rx: 3,
        fill: '#fff3e0',
        stroke: '#E67700',
        'stroke-width': 0.75,
      });
      s += svgEl('text', {
        x: hx + 10,
        y: hy + 10,
        fill: '#E67700',
        'font-size': 9,
        'font-weight': 700,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        'font-family': 'system-ui, sans-serif',
      }, escText(String(step.hiddenActions.length)));
    }

    // Error loop arrow
    if (step.errorLoop) {
      s += drawErrorLoop(el);
    }

    s += '</g>';
    return s;
  }

  function drawDecision(el) {
    const step = el.step;
    const phase = el.phase;
    let s = '';

    const cx = el.x;
    const cy = el.y;
    const half = el.size / 2;

    // Diamond
    const points = `${cx},${cy - half} ${cx + half},${cy} ${cx},${cy + half} ${cx - half},${cy}`;
    s += svgEl('polygon', {
      points,
      fill: '#ffffff',
      stroke: phase.color,
      'stroke-width': 2,
      filter: 'url(#shadow)',
    });

    // Question mark in center
    s += svgEl('text', {
      x: cx,
      y: cy + 1,
      fill: phase.color,
      'font-size': 18,
      'font-weight': 700,
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      'font-family': 'system-ui, sans-serif',
    }, '?');

    // Label below diamond
    const labelText = truncate(step.name, 60);
    s += svgEl('text', {
      x: cx,
      y: cy + half + 16,
      fill: '#424242',
      'font-size': 10,
      'text-anchor': 'middle',
      'font-family': 'system-ui, sans-serif',
      'font-style': 'italic',
    }, escText(labelText));

    return s;
  }

  function drawErrorLoop(el) {
    let s = '';
    const x = el.x + el.w;
    const yMid = el.y + el.h / 2;
    const loopX = x + CFG.errorLoopOffsetX;
    const r = CFG.errorLoopR;

    // Path: right from box → up → curve back → down to box (with arrow)
    const pathD = `
      M ${x} ${yMid}
      L ${loopX - r} ${yMid}
      A ${r} ${r} 0 0 0 ${loopX} ${yMid - r}
      L ${loopX} ${el.y - 4 + r}
      A ${r} ${r} 0 0 0 ${loopX - r} ${el.y - 4}
      L ${x + 10} ${el.y - 4}
    `;

    s += svgEl('path', {
      d: pathD,
      fill: 'none',
      stroke: CFG.errorLoopColor,
      'stroke-width': 1.5,
      'stroke-dasharray': '4,3',
      'marker-end': 'url(#arrow-error)',
    });

    // Error label
    if (el.step.errorLoop.condition) {
      const labelText = truncate(el.step.errorLoop.condition, 28);
      s += svgEl('text', {
        x: loopX + 4,
        y: yMid - 6,
        fill: CFG.errorLoopColor,
        'font-size': 8,
        'font-family': 'system-ui, sans-serif',
        'font-style': 'italic',
        transform: `rotate(-90, ${loopX + 4}, ${yMid - 6})`,
      }, escText(labelText));
    }

    return s;
  }

  // ── Public API ────────────────────────────────────────────────

  return { render };
})();
