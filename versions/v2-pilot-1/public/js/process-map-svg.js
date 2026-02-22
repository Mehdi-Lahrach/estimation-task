/**
 * PROCESS MAP SVG RENDERER (v3)
 *
 * Renders a BPMN-style SVG flowchart from the PROCESS_MAP data.
 *
 * v3 changes:
 * - Inline expansion: clicking a step pushes subsequent content down to reveal
 *   hidden sub-actions. Click again to collapse. No floating overlays.
 * - Full text wrapping with dynamic box heights (no truncation)
 * - Proper decision label spacing
 * - Horizontal error loop labels
 * - Stakeholder-ready framework
 *
 * Usage:
 *   ProcessMapSVG.render('container-id')
 *   ProcessMapSVG.render('container-id', { onPhaseClick: fn })
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
    loopOffX:        46,
    loopR:           14,
    badgeH:          18,
    badgeR:          9,
    badgePadX:       7,
    badgeFontSz:     9,
    stepFontSz:      12,
    phaseFontSz:     13,
    // Expansion area
    expPadTop:       10,
    expPadBottom:    10,
    expLabelH:       16,
    expLabelGap:     6,
    expActionLineH:  15,
    expActionGap:    4,
    expActionFontSz: 11,
    expErrorH:       18,
    expBulletR:      2.5,
    // Colors
    lineCol:  '#bdbdbd',
    lineW:    1.4,
    arrowCol: '#757575',
    errCol:   '#C92A2A',
    expBg:    '#fffbf0',
    expBorder:'#f0e6cc',
  };

  const PHASE_INNER_W = CFG.stepW + CFG.phasePadX * 2;
  const BAND_EXTRA    = CFG.loopOffX + 30;
  const FULL_W        = PHASE_INNER_W + CFG.canvasPad * 2 + BAND_EXTRA;
  const ZONE_W        = 54;   // extra width for estimation zone brackets

  // ── State ─────────────────────────────────────────────────────
  const expandedSteps = new Set();
  let currentContainerId = null;
  let currentOptions = {};
  let idPrefix = 'pm';        // unique prefix per SVG to avoid ID clashes
  let blockCounter = 0;       // counter for renderBlock SVGs
  let lastLayout = null;      // stored after render for external position queries

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

  // ── Step dimension helpers ────────────────────────────────────

  function stepDims(step) {
    const idW = approxW(step.id, 10) + 14;
    const hasExp = step.hiddenActions.length > 0 || step.errorLoop;
    const indicatorW = hasExp ? 40 : 0;
    const nameW = CFG.stepW - idW - indicatorW - 32;
    const lines = wrap(step.name, nameW, CFG.stepFontSz);
    const nameH = lines.length * CFG.stepNameLineH;
    const h = CFG.stepPadTop + nameH + CFG.stepNameBadgeGap
            + CFG.stepBadgeRowH + CFG.stepPadBottom;
    return { lines, nameH, idW, h: Math.max(h, CFG.stepMinH) };
  }

  function expansionH(step) {
    if (step.hiddenActions.length === 0 && !step.errorLoop) return 0;
    let h = CFG.expPadTop;
    if (step.hiddenActions.length > 0) {
      h += CFG.expLabelH + CFG.expLabelGap;
      for (const a of step.hiddenActions) {
        const lines = wrap(a.description, CFG.stepW - 50, CFG.expActionFontSz);
        h += lines.length * CFG.expActionLineH + CFG.expActionGap;
      }
    }
    if (step.errorLoop) {
      h += 4 + CFG.expErrorH;
    }
    h += CFG.expPadBottom;
    return h;
  }

  // ── Layout computation ────────────────────────────────────────

  function computeLayout() {
    const elems = [];
    let y = CFG.canvasPad;
    const cx = CFG.canvasPad + CFG.phasePadX + CFG.stepW / 2;

    elems.push({ type: 'start', x: cx, y: y + CFG.circleR, r: CFG.circleR });
    y += CFG.circleR * 2 + 18;

    for (const phase of PROCESS_MAP.phases) {
      const py0 = y;
      y += CFG.phaseLabelH + CFG.phasePadY;

      for (const step of phase.steps) {
        if (step.isDecisionPoint) {
          const lblLines = wrap(step.name, CFG.stepW * 0.65, 10);
          const lblH = step.decisionOutcome ? (2 * 13 + 4) : (lblLines.length * 13 + 4);
          elems.push({
            type: 'decision', step, phase,
            x: cx, y: y + CFG.decisionSize / 2,
            size: CFG.decisionSize, lblLines,
          });
          y += CFG.decisionSize + lblH + 10;
        } else {
          const dims = stepDims(step);
          const isExpanded = expandedSteps.has(step.id);
          const expH = isExpanded ? expansionH(step) : 0;

          elems.push({
            type: 'task', step, phase, dims,
            x: cx - CFG.stepW / 2, y,
            w: CFG.stepW, h: dims.h,
            isExpanded, expH,
          });
          y += dims.h + expH + CFG.stepGap;
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

    elems.push({ type: 'end', x: cx, y: y + CFG.circleR, r: CFG.circleR });
    y += CFG.circleR * 2 + CFG.canvasPad;

    return { elems, w: FULL_W, h: y, cx };
  }

  // ── Zone height adjustment for estimation cards ─────────────

  function adjustLayoutForZoneMinHeights(layout, zones, minHeights) {
    if (!zones || !minHeights) return;

    for (let idx = 0; idx < zones.length; idx++) {
      const zone = zones[idx];
      const reqMin = minHeights[idx];
      if (!reqMin || reqMin <= 0) continue;

      // Find step elements belonging to this zone
      const stepElems = layout.elems.filter(e =>
        (e.type === 'task' || e.type === 'decision') &&
        zone.stepIds.includes(e.step.id)
      );
      if (stepElems.length === 0) continue;

      stepElems.sort((a, b) => topY(a) - topY(b));

      const yMin = topY(stepElems[0]);
      const yMax = bottomY(stepElems[stepElems.length - 1]);
      const currentH = yMax - yMin;

      if (currentH >= reqMin) continue;

      const delta = reqMin - currentH;
      const n = stepElems.length;

      // Build shift boundaries: distribute delta evenly among gaps between
      // consecutive zone steps, so the extra space is spread within the zone
      // instead of being concentrated below the last step.
      const boundaries = [];
      if (n > 1) {
        const gapExtra = delta / (n - 1);
        for (let i = 0; i < n - 1; i++) {
          boundaries.push({
            y: bottomY(stepElems[i]),
            cumulShift: (i + 1) * gapExtra,
          });
        }
      }
      // Everything below the zone shifts by the full delta
      boundaries.push({ y: yMax, cumulShift: delta });
      boundaries.sort((a, b) => a.y - b.y);

      for (const e of layout.elems) {
        if (e.type === 'band') {
          // Band shift = shift at its top edge; expansion = shift at bottom − top
          let topShift = 0, botShift = 0;
          for (const b of boundaries) {
            if (e.y > b.y) topShift = Math.max(topShift, b.cumulShift);
            if (e.y + e.h > b.y) botShift = Math.max(botShift, b.cumulShift);
          }
          e.y += topShift;
          e.h += (botShift - topShift);
        } else {
          let shift = 0;
          const ey = topY(e);
          for (const b of boundaries) {
            if (ey > b.y) shift = Math.max(shift, b.cumulShift);
          }
          if (shift > 0) e.y += shift;
        }
      }
      layout.h += delta;
    }
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
    if (e.type === 'task') return e.y + e.h + (e.expH || 0);
    if (e.type === 'decision') return e.y + e.size / 2;
    return e.y;
  }

  function drawContent(layout) {
    let svg = '';

    svg += `<defs>
      <marker id="${idPrefix}-arr" viewBox="0 0 10 10" refX="10" refY="5"
        markerWidth="${CFG.arrowSz}" markerHeight="${CFG.arrowSz}" orient="auto-start-reverse">
        <path d="M0 0L10 5L0 10z" fill="${CFG.arrowCol}"/>
      </marker>
      <marker id="${idPrefix}-arr-err" viewBox="0 0 10 10" refX="10" refY="5"
        markerWidth="${CFG.arrowSz}" markerHeight="${CFG.arrowSz}" orient="auto-start-reverse">
        <path d="M0 0L10 5L0 10z" fill="${CFG.errCol}"/>
      </marker>
      <filter id="${idPrefix}-shd" x="-4%" y="-4%" width="108%" height="112%">
        <feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.1"/>
      </filter>
    </defs>`;

    const bands = layout.elems.filter(e => e.type === 'band');
    const flow  = layout.elems.filter(e =>
      ['start', 'end', 'task', 'decision'].includes(e.type));

    for (const b of bands) svg += drawBand(b);

    for (let i = 0; i < flow.length - 1; i++) {
      svg += tag('line', {
        x1: layout.cx, y1: bottomY(flow[i]),
        x2: layout.cx, y2: topY(flow[i + 1]),
        stroke: CFG.lineCol, 'stroke-width': CFG.lineW,
        'marker-end': `url(#${idPrefix}-arr)`,
      });
    }

    for (const e of flow) {
      if (e.type === 'start')         svg += drawCircle(e, '#2B8A3E', 'Start', false);
      else if (e.type === 'end')      svg += drawCircle(e, '#C92A2A', 'End', true);
      else if (e.type === 'task')     svg += drawTask(e);
      else if (e.type === 'decision') svg += drawDecision(e);
    }

    return svg;
  }

  function wrapSvg(content, w, h) {
    return `<svg xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 ${w} ${h}"
      width="100%" style="max-width:${w}px;display:block;margin:0 auto">
      <style>
        .pm-task{cursor:pointer}
        .pm-task:hover>rect:first-child{filter:brightness(.96)}
        .pm-badge text{font-family:system-ui,-apple-system,sans-serif}
      </style>
      ${content}
    </svg>`;
  }

  function drawZones(layout, zones) {
    let s = '';
    const letters = 'ABCDEFGHIJ';
    const zx = FULL_W + 4;

    zones.forEach((zone, idx) => {
      const stepElems = layout.elems.filter(e =>
        (e.type === 'task' || e.type === 'decision') &&
        zone.stepIds.includes(e.step.id)
      );
      if (stepElems.length === 0) return;

      const yMin = Math.min(...stepElems.map(e => topY(e)));
      const yMax = Math.max(...stepElems.map(e => bottomY(e)));
      const yCenter = (yMin + yMax) / 2;
      const letter = letters[idx] || String(idx + 1);
      const color = zone.color;

      // Vertical bracket line
      s += tag('line', {
        x1: zx + 4, y1: yMin + 2, x2: zx + 4, y2: yMax - 2,
        stroke: color, 'stroke-width': 2.5, 'stroke-linecap': 'round', opacity: 0.7,
      });
      // Top cap
      s += tag('line', {
        x1: zx, y1: yMin + 2, x2: zx + 4, y2: yMin + 2,
        stroke: color, 'stroke-width': 2.5, 'stroke-linecap': 'round', opacity: 0.7,
      });
      // Bottom cap
      s += tag('line', {
        x1: zx, y1: yMax - 2, x2: zx + 4, y2: yMax - 2,
        stroke: color, 'stroke-width': 2.5, 'stroke-linecap': 'round', opacity: 0.7,
      });
      // Letter circle badge
      s += tag('circle', { cx: zx + 28, cy: yCenter, r: 16, fill: color });
      s += tag('text', {
        x: zx + 28, y: yCenter + 1,
        fill: '#fff', 'font-size': 14, 'font-weight': 700,
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-family': 'system-ui,sans-serif',
      }, letter);

      // Store positions for external use
      zone._yMin = yMin;
      zone._yMax = yMax;
      zone._yCenter = yCenter;
    });

    return s;
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
    s += tag('rect', {
      x: b.x, y: b.y, width: b.w, height: b.h,
      rx: 10, fill: c + '08', stroke: c + '30', 'stroke-width': 1.5,
    });
    s += tag('rect', {
      x: b.x, y: b.y, width: b.w, height: CFG.phaseLabelH, rx: 10, fill: c,
    });
    s += tag('rect', {
      x: b.x, y: b.y + CFG.phaseLabelH - 10, width: b.w, height: 10, fill: c,
    });
    s += tag('text', {
      x: b.x + 16, y: b.y + CFG.phaseLabelH / 2 + 4,
      fill: '#fff', 'font-size': CFG.phaseFontSz, 'font-weight': 700,
      'font-family': 'system-ui,sans-serif', 'dominant-baseline': 'middle',
    }, E.t(`Phase ${b.phase.icon}: ${b.phase.name}`));
    return s;
  }

  function drawTask(e) {
    const { step, phase, dims, isExpanded } = e;
    const hasExpandable = step.hiddenActions.length > 0 || step.errorLoop;

    let s = `<g class="pm-task" data-step-id="${step.id}" data-phase-id="${phase.id}">`;

    // Main box
    s += tag('rect', {
      x: e.x, y: e.y, width: e.w, height: e.h,
      rx: CFG.stepR, fill: '#fff', stroke: phase.color,
      'stroke-width': isExpanded ? 2 : 1.5, filter: `url(#${idPrefix}-shd)`,
    });

    // ID badge
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

    // Step name — multi-line
    const nx = e.x + 10 + dims.idW + 10;
    const ny0 = e.y + CFG.stepPadTop + CFG.stepNameLineH * 0.75;
    let nameEl = `<text fill="#212529" font-size="${CFG.stepFontSz}" font-weight="500" font-family="system-ui,sans-serif">`;
    dims.lines.forEach((line, i) => {
      nameEl += `<tspan x="${nx}" y="${ny0 + i * CFG.stepNameLineH}">${E.t(line)}</tspan>`;
    });
    nameEl += '</text>';
    s += nameEl;

    // Action type badges
    const by = e.y + CFG.stepPadTop + dims.nameH + CFG.stepNameBadgeGap;
    let bx = e.x + 10;
    for (const type of step.actionTypes) {
      const colors = (typeof ACTION_TYPE_COLORS !== 'undefined'
        ? ACTION_TYPE_COLORS[type] : null) || { bg: '#f5f5f5', text: '#666' };
      const label = type.split(': ')[1] || type;
      const bw = approxW(label, CFG.badgeFontSz) + CFG.badgePadX * 2;
      s += tag('rect', { x: bx, y: by, width: bw, height: CFG.badgeH, rx: CFG.badgeR, fill: colors.bg });
      s += tag('text', {
        x: bx + bw / 2, y: by + CFG.badgeH / 2 + 1,
        fill: colors.text, 'font-size': CFG.badgeFontSz, 'font-weight': 600,
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-family': 'system-ui,sans-serif',
      }, E.t(label));
      bx += bw + 4;
    }

    // Expand/collapse indicator (top-right) — only for expandable steps
    if (hasExpandable) {
      const hx = e.x + e.w - 46;
      const hy = e.y + 10;
      const indicator = isExpanded ? '\u25BC' : `+${step.hiddenActions.length}`;
      const bgColor = isExpanded ? phase.color + '18' : '#fff3e0';
      const textColor = isExpanded ? phase.color : '#E67700';
      const strokeColor = isExpanded ? phase.color : '#E67700';
      s += tag('rect', {
        x: hx, y: hy, width: 36, height: 20, rx: 4,
        fill: bgColor, stroke: strokeColor, 'stroke-width': 0.75,
      });
      s += tag('text', {
        x: hx + 18, y: hy + 12,
        fill: textColor, 'font-size': 9, 'font-weight': 700,
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-family': 'system-ui,sans-serif',
      }, E.t(indicator));
    }

    // Error loop arrow
    if (step.errorLoop) s += drawErrorLoop(e);

    // Expansion area (inline, pushes content down)
    if (isExpanded) {
      s += drawExpansion(e);
    }

    s += '</g>';
    return s;
  }

  function drawExpansion(e) {
    const { step, phase } = e;
    const ey = e.y + e.h; // expansion starts at bottom of step box
    let s = '';

    // Background — connected to step box
    s += tag('rect', {
      x: e.x + 1, y: ey - 1,
      width: e.w - 2, height: e.expH + 1,
      fill: CFG.expBg, stroke: CFG.expBorder, 'stroke-width': 1,
    });
    // Round bottom corners
    s += tag('rect', {
      x: e.x + 1, y: ey + e.expH - 9,
      width: e.w - 2, height: 10, rx: 8,
      fill: CFG.expBg,
    });
    // Left accent
    s += tag('rect', {
      x: e.x + 1, y: ey,
      width: 3, height: e.expH - 1,
      fill: phase.color + '60',
    });

    let cy = ey + CFG.expPadTop;

    // Label
    if (step.hiddenActions.length > 0) {
      s += tag('text', {
        x: e.x + 16, y: cy + 10,
        fill: '#E67700', 'font-size': 10, 'font-weight': 700,
        'font-family': 'system-ui,sans-serif',
        'letter-spacing': '0.3',
      }, E.t('HIDDEN SUB-ACTIONS'));
      cy += CFG.expLabelH + CFG.expLabelGap;

      for (const action of step.hiddenActions) {
        // Bullet
        s += tag('circle', {
          cx: e.x + 22, cy: cy + 6, r: CFG.expBulletR,
          fill: '#E67700',
        });

        // Description text (wrapped)
        const descLines = wrap(action.description, e.w - 52, CFG.expActionFontSz);
        let textEl = `<text fill="#495057" font-size="${CFG.expActionFontSz}" font-family="system-ui,sans-serif">`;
        descLines.forEach((line, i) => {
          textEl += `<tspan x="${e.x + 32}" y="${cy + 10 + i * CFG.expActionLineH}">${E.t(line)}</tspan>`;
        });
        textEl += '</text>';
        s += textEl;

        cy += descLines.length * CFG.expActionLineH + CFG.expActionGap;
      }
    }

    // Error loop
    if (step.errorLoop) {
      cy += 4;
      s += tag('text', {
        x: e.x + 16, y: cy + 10,
        fill: CFG.errCol, 'font-size': 11, 'font-weight': 500,
        'font-family': 'system-ui,sans-serif',
      }, E.t('\u21BB Error loop: ' + step.errorLoop.condition));
    }

    return s;
  }

  function drawDecision(e) {
    const { step, phase, lblLines } = e;
    const cx = e.x, cy = e.y, half = e.size / 2;
    const resolved = !!step.decisionOutcome;
    const strokeCol = resolved ? '#2B8A3E' : phase.color;
    const iconCol = resolved ? '#2B8A3E' : phase.color;

    let s = `<g class="pm-decision" data-step-id="${step.id}" data-phase-id="${phase.id}">`;
    s += tag('polygon', {
      points: `${cx},${cy - half} ${cx + half},${cy} ${cx},${cy + half} ${cx - half},${cy}`,
      fill: resolved ? '#ebfbee' : '#fff', stroke: strokeCol,
      'stroke-width': 2, filter: `url(#${idPrefix}-shd)`,
    });
    s += tag('text', {
      x: cx, y: cy + 1,
      fill: iconCol, 'font-size': resolved ? 20 : 18, 'font-weight': 700,
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-family': 'system-ui,sans-serif',
    }, resolved ? '\u2713' : '?');

    if (resolved) {
      // Show resolved outcome label
      const outLine1 = 'Participants selected:';
      const outLine2 = `\u201C${step.decisionOutcome}\u201D`;
      s += tag('text', {
        x: cx, y: cy + half + 14,
        fill: '#2B8A3E', 'font-size': 10, 'font-weight': 600,
        'text-anchor': 'middle', 'font-family': 'system-ui,sans-serif',
      }, E.t(outLine1));
      s += tag('text', {
        x: cx, y: cy + half + 27,
        fill: '#2B8A3E', 'font-size': 10, 'font-weight': 700,
        'text-anchor': 'middle', 'font-style': 'italic',
        'font-family': 'system-ui,sans-serif',
      }, E.t(outLine2));
    } else {
      let labelEl = '<text text-anchor="middle" font-size="10" fill="#424242"'
        + ' font-style="italic" font-family="system-ui,sans-serif">';
      lblLines.forEach((line, i) => {
        labelEl += `<tspan x="${cx}" y="${cy + half + 14 + i * 13}">${E.t(line)}</tspan>`;
      });
      labelEl += '</text>';
      s += labelEl;
    }

    s += '</g>';
    return s;
  }

  function drawErrorLoop(e) {
    let s = '';
    const rx = e.x + e.w;
    const yMid = e.y + e.h / 2;
    const lx = rx + CFG.loopOffX;
    const r = CFG.loopR;
    const topLoop = e.y - 8;

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
      'stroke-dasharray': '4,3', 'marker-end': `url(#${idPrefix}-arr-err)`,
    });

    s += tag('text', {
      x: lx + 6, y: topLoop + 4,
      fill: CFG.errCol, 'font-size': 9, 'font-weight': 600,
      'font-family': 'system-ui,sans-serif',
      'dominant-baseline': 'middle',
    }, E.t('\u21BB Retry'));

    return s;
  }

  // ── Render + interactivity ────────────────────────────────────

  function internalRender() {
    const container = document.getElementById(currentContainerId);
    if (!container) return;

    // Preserve scroll position
    const scrollParent = container.closest('.svg-map-container') || container;
    const scrollTop = scrollParent.scrollTop;

    const layout = computeLayout();

    // Adjust zone spacing so estimation cards don't overflow into adjacent zones
    if (currentOptions.zoneMinHeights && currentOptions.estimationZones) {
      adjustLayoutForZoneMinHeights(layout, currentOptions.estimationZones, currentOptions.zoneMinHeights);
    }

    lastLayout = layout;

    let svgContent = drawContent(layout);
    let totalW = layout.w;

    if (currentOptions.estimationZones) {
      svgContent += drawZones(layout, currentOptions.estimationZones);
      totalW += ZONE_W;
    }

    container.innerHTML = wrapSvg(svgContent, totalW, layout.h);

    // Restore scroll
    scrollParent.scrollTop = scrollTop;

    // Wire step clicks → toggle expansion
    container.querySelectorAll('.pm-task').forEach(g => {
      const sid = g.dataset.stepId;
      const pid = g.dataset.phaseId;

      // Find step data to check if expandable
      let stepData = null;
      for (const p of PROCESS_MAP.phases) {
        for (const st of p.steps) {
          if (st.id === sid) { stepData = st; break; }
        }
        if (stepData) break;
      }

      const hasExpandable = stepData &&
        (stepData.hiddenActions.length > 0 || stepData.errorLoop);

      if (hasExpandable) {
        g.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (expandedSteps.has(sid)) {
            expandedSteps.delete(sid);
          } else {
            expandedSteps.add(sid);
          }
          internalRender();
        });
      } else {
        g.style.cursor = 'default';
      }
    });

    // Phase click callback
    if (currentOptions.onPhaseClick) {
      container.querySelectorAll('[data-phase-id]').forEach(el => {
        if (!el.classList.contains('pm-task') && !el.classList.contains('pm-decision')) {
          el.style.cursor = 'pointer';
          el.addEventListener('click', () => {
            currentOptions.onPhaseClick(el.dataset.phaseId);
          });
        }
      });
    }

    // Fire rerender callback (for repositioning estimation cards etc.)
    if (currentOptions.onRerender) {
      requestAnimationFrame(() => currentOptions.onRerender());
    }
  }

  function render(containerId, options = {}) {
    currentContainerId = containerId;
    currentOptions = options;
    idPrefix = 'pm'; // main map uses default prefix
    internalRender();
  }

  // ── Block renderer (mini SVG for a subset of steps) ─────────

  function renderBlock(containerId, stepIds, phaseData) {
    const bid = 'blk' + (blockCounter++);
    const savedPrefix = idPrefix;
    idPrefix = bid;

    const container = document.getElementById(containerId);
    if (!container) { idPrefix = savedPrefix; return; }

    const steps = phaseData.steps.filter(s => stepIds.includes(s.id));
    if (steps.length === 0) { idPrefix = savedPrefix; return; }

    // Compact layout — no start/end circles, no phase bands
    const PAD = 14;
    const leftPad = PAD + 8;
    let y = PAD;
    const cx = leftPad + CFG.stepW / 2;
    const elems = [];

    for (const step of steps) {
      if (step.isDecisionPoint) {
        const lblLines = wrap(step.name, CFG.stepW * 0.65, 10);
        const lblH = lblLines.length * 13 + 4;
        elems.push({
          type: 'decision', step, phase: phaseData,
          x: cx, y: y + CFG.decisionSize / 2,
          size: CFG.decisionSize, lblLines,
        });
        y += CFG.decisionSize + lblH + 10;
      } else {
        const dims = stepDims(step);
        const isExp = expandedSteps.has(step.id);
        const expH = isExp ? expansionH(step) : 0;
        elems.push({
          type: 'task', step, phase: phaseData, dims,
          x: cx - CFG.stepW / 2, y,
          w: CFG.stepW, h: dims.h,
          isExpanded: isExp, expH,
        });
        y += dims.h + expH + CFG.stepGap;
      }
    }
    y += PAD;

    const totalW = CFG.stepW + leftPad * 2 + CFG.loopOffX + 30;

    // Build SVG content
    let svg = '';
    svg += `<defs>
      <marker id="${bid}-arr" viewBox="0 0 10 10" refX="10" refY="5"
        markerWidth="${CFG.arrowSz}" markerHeight="${CFG.arrowSz}" orient="auto-start-reverse">
        <path d="M0 0L10 5L0 10z" fill="${CFG.arrowCol}"/>
      </marker>
      <marker id="${bid}-arr-err" viewBox="0 0 10 10" refX="10" refY="5"
        markerWidth="${CFG.arrowSz}" markerHeight="${CFG.arrowSz}" orient="auto-start-reverse">
        <path d="M0 0L10 5L0 10z" fill="${CFG.errCol}"/>
      </marker>
      <filter id="${bid}-shd" x="-4%" y="-4%" width="108%" height="112%">
        <feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.1"/>
      </filter>
    </defs>`;

    // Connecting arrows
    for (let i = 0; i < elems.length - 1; i++) {
      svg += tag('line', {
        x1: cx, y1: bottomY(elems[i]),
        x2: cx, y2: topY(elems[i + 1]),
        stroke: CFG.lineCol, 'stroke-width': CFG.lineW,
        'marker-end': `url(#${bid}-arr)`,
      });
    }

    // Draw elements
    for (const e of elems) {
      if (e.type === 'task')          svg += drawTask(e);
      else if (e.type === 'decision') svg += drawDecision(e);
    }

    container.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 ${totalW} ${y}"
      width="100%" style="max-width:${totalW}px;display:block;margin:0 auto">
      <style>
        .pm-task{cursor:pointer}
        .pm-task:hover>rect:first-child{filter:brightness(.96)}
      </style>
      ${svg}
    </svg>`;

    // Restore prefix before wiring (drawTask already used the bid prefix)
    idPrefix = savedPrefix;

    // Wire step click → expand/collapse
    container.querySelectorAll('.pm-task').forEach(g => {
      const sid = g.dataset.stepId;
      const stepData = steps.find(s => s.id === sid);
      const hasExpandable = stepData &&
        (stepData.hiddenActions.length > 0 || stepData.errorLoop);
      if (hasExpandable) {
        g.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (expandedSteps.has(sid)) expandedSteps.delete(sid);
          else expandedSteps.add(sid);
          renderBlock(containerId, stepIds, phaseData);
        });
      } else {
        g.style.cursor = 'default';
      }
    });
  }

  return { render, renderBlock, getLastLayout: function() { return lastLayout; } };
})();
