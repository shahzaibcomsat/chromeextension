/**
 * ShahzaibSEO — Premium PDF Report Engine  (v5)
 * --------------------------------------------------------------
 * Zero-dependency PDF writer with a real vector toolkit:
 *   rounded cards · ring gauges · gradient bands · severity badges
 *   accurate Helvetica metrics (true center/right alignment + tracking)
 *
 * Public surface kept backwards compatible with the extension:
 *   const pdf = new SorankPDF();
 *   pdf.buildAuditReport(payload);     // <- one call builds everything
 *   pdf.download('report.pdf');        // browser
 *   pdf.save('/path/report.pdf');      // node (harness/testing)
 *
 * Coordinate model: every high-level call uses a TOP-LEFT origin
 * (y grows downward). The renderer flips Y once at emit time, so all
 * geometry math (arcs, beziers, corners) stays in intuitive screen space.
 */

(function (root) {
  'use strict';

  // ---- Helvetica advance widths (units / 1000 em) --------------------------
  const W_REG = {
    ' ':278,'!':278,'"':355,'#':556,'$':556,'%':889,'&':667,"'":191,'(':333,')':333,'*':389,'+':584,
    ',':278,'-':333,'.':278,'/':278,'0':556,'1':556,'2':556,'3':556,'4':556,'5':556,'6':556,'7':556,
    '8':556,'9':556,':':278,';':278,'<':584,'=':584,'>':584,'?':556,'@':1015,'A':667,'B':667,'C':722,
    'D':722,'E':667,'F':611,'G':778,'H':722,'I':278,'J':500,'K':667,'L':556,'M':833,'N':722,'O':778,
    'P':667,'Q':778,'R':722,'S':667,'T':611,'U':722,'V':667,'W':944,'X':667,'Y':667,'Z':611,'[':278,
    '\\':278,']':278,'^':469,'_':556,'`':333,'a':556,'b':556,'c':500,'d':556,'e':556,'f':278,'g':556,
    'h':556,'i':222,'j':222,'k':500,'l':222,'m':833,'n':556,'o':556,'p':556,'q':556,'r':333,'s':500,
    't':278,'u':556,'v':500,'w':722,'x':500,'y':500,'z':500,'{':334,'|':260,'}':334,'~':584,
    '\u2022':350,'\u2013':556,'\u2014':1000,'\u2192':1000
  };
  const W_BOLD = {
    ' ':278,'!':333,'"':474,'#':556,'$':556,'%':889,'&':722,"'":238,'(':333,')':333,'*':389,'+':584,
    ',':278,'-':333,'.':278,'/':278,'0':556,'1':556,'2':556,'3':556,'4':556,'5':556,'6':556,'7':556,
    '8':556,'9':556,':':333,';':333,'<':584,'=':584,'>':584,'?':611,'@':975,'A':722,'B':722,'C':722,
    'D':722,'E':667,'F':611,'G':778,'H':722,'I':278,'J':556,'K':722,'L':611,'M':833,'N':722,'O':778,
    'P':667,'Q':778,'R':722,'S':667,'T':611,'U':722,'V':667,'W':944,'X':667,'Y':667,'Z':611,'[':333,
    '\\':278,']':333,'^':584,'_':556,'`':333,'a':556,'b':611,'c':556,'d':611,'e':556,'f':333,'g':611,
    'h':611,'i':278,'j':278,'k':556,'l':278,'m':889,'n':611,'o':611,'p':611,'q':611,'r':389,'s':556,
    't':333,'u':611,'v':556,'w':778,'x':556,'y':556,'z':500,'{':389,'|':280,'}':389,'~':584,
    '\u2022':350,'\u2013':556,'\u2014':1000,'\u2192':1000
  };

  const KAPPA = 0.5522847498;
  const D2R = Math.PI / 180;
  const f3 = (n) => (Math.round(n * 1000) / 1000).toString();

  class SorankPDF {
    constructor(opts = {}) {
      this.pageWidth  = 595.28;          // A4 portrait, points
      this.pageHeight = 841.89;
      this.margin     = 48;
      this.pages      = [];
      this.currentPage = null;
      this.currentY   = this.margin;
      this.coverPages = new Set();       // pages that skip header/footer chrome
      this._toc = [];                    // {title, page}
      this.brand = opts.brand || 'ShahzaibSEO';
      this.meta  = { url: '', date: '' };

      // ---- design tokens -------------------------------------------------
      this.c = {
        ink:        [15, 23, 41],
        slate:      [71, 85, 105],
        muted:      [148, 163, 184],
        faint:      [203, 213, 225],
        hair:       [229, 231, 235],
        surface:    [247, 247, 251],
        surface2:   [241, 242, 248],
        paper:      [255, 255, 255],
        white:      [255, 255, 255],

        violet:     [109, 40, 217],
        violetDeep: [76, 29, 149],
        violetSoft: [237, 233, 254],
        violetBright:[139, 92, 246],

        teal:       [13, 148, 136],      // GEO / AI accent
        tealSoft:   [204, 251, 241],

        green:      [21, 163, 74],
        greenSoft:  [220, 252, 231],
        amber:      [217, 119, 6],
        amberSoft:  [254, 243, 199],
        red:        [220, 38, 38],
        redSoft:    [254, 226, 226],
        blue:       [37, 99, 235],
        blueSoft:   [219, 234, 254]
      };
    }

    // ====================================================================
    // PAGE PLUMBING
    // ====================================================================
    addPage(isCover = false) {
      this.currentPage = { ops: [], annots: [], number: this.pages.length + 1, _isCover: !!isCover };
      this.pages.push(this.currentPage);
      if (isCover) this.coverPages.add(this.currentPage.number);
      this.currentY = isCover ? 0 : this.contentTop();
      return this.currentPage;
    }
    // Register a clickable URI link on the current page.
    // x,y = top-left; x2,y2 = bottom-right (screen/top-left coords).
    _linkAnnot(page, x, y, x2, y2, uri) {
      if (!page) return;
      const llx = f3(x),  lly = f3(this.pageHeight - y2);
      const urx = f3(x2), ury = f3(this.pageHeight - y);
      page.annots.push(
        `<< /Type /Annot /Subtype /Link /Rect [${llx} ${lly} ${urx} ${ury}] /Border [0 0 0] /A << /Type /Action /S /URI /URI (${uri}) >> >>`
      );
    }
    ensurePage() { if (!this.currentPage) this.addPage(); }
    contentTop() { return 64; }                 // below running header
    contentBottom() { return this.pageHeight - 54; }
    cw() { return this.pageWidth - this.margin * 2; }
    _op(s) { this.ensurePage(); this.currentPage.ops.push(s); }
    flip(y) { return this.pageHeight - y; }

    need(h) {
      this.ensurePage();
      if (this.currentY + h > this.contentBottom()) { this.addPage(); return true; }
      return false;
    }
    /** Add page only if needed — never leave a blank page behind */
    ensureSpace(h) {
      this.ensurePage();
      // Already near top of a fresh page → nothing to do
      if (this.currentY <= this.contentTop() + 8) return false;
      if (this.currentY + h > this.contentBottom()) {
        this.addPage();
        return true;
      }
      return false;
    }
    space(h = 10) { this.currentY += h; }

    // ====================================================================
    // LOW-LEVEL VECTOR PRIMITIVES   (top-left coords; flipped at emit)
    // ====================================================================
    _rgb(c) { return `${f3(c[0]/255)} ${f3(c[1]/255)} ${f3(c[2]/255)}`; }

    measure(str, size, bold) {
      const t = bold ? W_BOLD : W_REG; let w = 0;
      str = String(str);
      for (const ch of str) w += (t[ch] || 556);
      return (w / 1000) * size;
    }

    // text with alignment + optional letter tracking (Tc, in points)
    text(x, y, str, o = {}) {
      str = String(str == null ? '' : str);
      if (!str.length) return;
      const size = o.size || 10, bold = !!o.bold, col = o.color || this.c.ink;
      const tracking = o.tracking || 0;
      let w = this.measure(str, size, bold);
      if (tracking) w += tracking * Math.max(0, str.length - 1);
      let tx = x;
      if (o.align === 'center') tx = x - w / 2;
      else if (o.align === 'right') tx = x - w;
      const font = bold ? '/F2' : '/F1';
      const tc = tracking ? ` ${f3(tracking)} Tc` : '';
      this._op(`BT ${font} ${size} Tf${tc} ${this._rgb(col)} rg ${f3(tx)} ${f3(this.flip(y))} Td (${esc(str)}) Tj ET${tracking ? ' BT 0 Tc ET' : ''}`);
      return w;
    }

    // raw path from segments [['m',x,y],['l',x,y],['c',x1,y1,x2,y2,x,y],['h']]
    _emitPath(segs, paint) {
      let s = '';
      for (const seg of segs) {
        const op = seg[0];
        if (op === 'm' || op === 'l') s += `${f3(seg[1])} ${f3(this.flip(seg[2]))} ${op} `;
        else if (op === 'c') s += `${f3(seg[1])} ${f3(this.flip(seg[2]))} ${f3(seg[3])} ${f3(this.flip(seg[4]))} ${f3(seg[5])} ${f3(this.flip(seg[6]))} c `;
        else if (op === 'h') s += 'h ';
      }
      this._op(s + paint);
    }

    rect(x, y, w, h, o = {}) {
      const r = o.r || 0;
      const hasFill = !!o.fill, hasStroke = !!o.stroke;
      let pre = '';
      if (hasFill)   pre += `${this._rgb(o.fill)} rg `;
      if (hasStroke) pre += `${this._rgb(o.stroke)} RG ${f3(o.lw || 1)} w `;
      const paint = hasFill && hasStroke ? 'B' : hasFill ? 'f' : 'S';
      if (!r) {
        this._op(`${pre}${f3(x)} ${f3(this.flip(y + h))} ${f3(w)} ${f3(h)} re ${paint}`);
        return;
      }
      const rr = Math.min(r, w / 2, h / 2), k = rr * KAPPA;
      const x2 = x + w, y2 = y + h;
      const segs = [
        ['m', x + rr, y],
        ['l', x2 - rr, y],
        ['c', x2 - rr + k, y, x2, y + rr - k, x2, y + rr],
        ['l', x2, y2 - rr],
        ['c', x2, y2 - rr + k, x2 - rr + k, y2, x2 - rr, y2],
        ['l', x + rr, y2],
        ['c', x + rr - k, y2, x, y2 - rr + k, x, y2 - rr],
        ['l', x, y + rr],
        ['c', x, y + rr - k, x + rr - k, y, x + rr, y],
        ['h']
      ];
      this._op(pre.trim());
      this._emitPath(segs, paint);
    }

    line(x1, y1, x2, y2, o = {}) {
      const col = o.color || this.c.hair, lw = o.lw || 0.6;
      const dash = o.dash ? `[${o.dash}] 0 d ` : '';
      this._op(`${this._rgb(col)} RG ${f3(lw)} w ${dash}${f3(x1)} ${f3(this.flip(y1))} m ${f3(x2)} ${f3(this.flip(y2))} l S${o.dash ? ' [] 0 d' : ''}`);
    }

    circle(cx, cy, r, o = {}) {
      const k = r * KAPPA;
      const segs = [
        ['m', cx, cy - r],
        ['c', cx + k, cy - r, cx + r, cy - k, cx + r, cy],
        ['c', cx + r, cy + k, cx + k, cy + r, cx, cy + r],
        ['c', cx - k, cy + r, cx - r, cy + k, cx - r, cy],
        ['c', cx - r, cy - k, cx - k, cy - r, cx, cy - r],
        ['h']
      ];
      let pre = '';
      if (o.fill)   pre += `${this._rgb(o.fill)} rg `;
      if (o.stroke) pre += `${this._rgb(o.stroke)} RG ${f3(o.lw || 1)} w `;
      const paint = o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S';
      this._op(pre.trim());
      this._emitPath(segs, paint);
    }

    // arc stroke, angles in degrees, 0 = top (12 o'clock), clockwise
    arc(cx, cy, r, a0, a1, o = {}) {
      const col = o.color || this.c.ink, lw = o.lw || 6;
      const cap = o.cap === 'round' ? 1 : 0;
      const pt = (deg) => { const t = deg * D2R; return [cx + r * Math.sin(t), cy - r * Math.cos(t)]; };
      let start = a0, total = a1 - a0;
      if (Math.abs(total) < 0.01) return;
      const dir = total > 0 ? 1 : -1, n = Math.ceil(Math.abs(total) / 90);
      const step = total / n;
      const segs = [];
      let p0 = pt(start);
      segs.push(['m', p0[0], p0[1]]);
      for (let i = 0; i < n; i++) {
        const t0 = (start + step * i) * D2R, t1 = (start + step * (i + 1)) * D2R;
        const dt = (step) * D2R;
        const k = (4 / 3) * Math.tan(dt / 4) * r;
        const P0 = [cx + r * Math.sin(t0), cy - r * Math.cos(t0)];
        const P1 = [cx + r * Math.sin(t1), cy - r * Math.cos(t1)];
        const C1 = [P0[0] + k * Math.cos(t0), P0[1] + k * Math.sin(t0)];
        const C2 = [P1[0] - k * Math.cos(t1), P1[1] - k * Math.sin(t1)];
        segs.push(['c', C1[0], C1[1], C2[0], C2[1], P1[0], P1[1]]);
      }
      this._op(`${this._rgb(col)} RG ${f3(lw)} w ${cap} J`);
      this._emitPath(segs, 'S');
      this._op('0 J');
    }

    ringGauge(cx, cy, r, thick, pct, o = {}) {
      pct = Math.max(0, Math.min(1, pct));
      const track = o.track || this.c.surface2, color = o.color || this.c.violet;
      this.arc(cx, cy, r, 0, 359.999, { color: track, lw: thick, cap: 'butt' });
      if (pct > 0) this.arc(cx, cy, r, 0, pct * 360, { color, lw: thick, cap: 'round' });
    }

    // vertical gradient using stepped bands (smooth + dependency-free)
    gradientV(x, y, w, h, c1, c2, steps = 60) {
      steps = Math.max(2, steps);
      const bh = h / steps;
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const col = [
          Math.round(c1[0] + (c2[0] - c1[0]) * t),
          Math.round(c1[1] + (c2[1] - c1[1]) * t),
          Math.round(c1[2] + (c2[2] - c1[2]) * t)
        ];
        this.rect(x, y + i * bh, w, bh + 0.6, { fill: col });
      }
    }
    gradientH(x, y, w, h, c1, c2, steps = 60) {
      steps = Math.max(2, steps);
      const bw = w / steps;
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const col = [
          Math.round(c1[0] + (c2[0] - c1[0]) * t),
          Math.round(c1[1] + (c2[1] - c1[1]) * t),
          Math.round(c1[2] + (c2[2] - c1[2]) * t)
        ];
        this.rect(x + i * bw, y, bw + 0.6, h, { fill: col });
      }
    }

    // small vector glyphs (avoids non-WinAnsi font glyphs)
    iconCheck(cx, cy, s, col) {
      this._op(`${this._rgb(col)} RG ${f3(s * 0.18)} w 1 J 1 j`);
      this._emitPath([
        ['m', cx - s * 0.34, cy + s * 0.02],
        ['l', cx - s * 0.08, cy + s * 0.28],
        ['l', cx + s * 0.38, cy - s * 0.30]
      ], 'S');
      this._op('0 J 0 j');
    }
    iconCross(cx, cy, s, col) {
      this._op(`${this._rgb(col)} RG ${f3(s * 0.18)} w 1 J`);
      this._emitPath([['m', cx - s * 0.3, cy - s * 0.3], ['l', cx + s * 0.3, cy + s * 0.3]], 'S');
      this._emitPath([['m', cx + s * 0.3, cy - s * 0.3], ['l', cx - s * 0.3, cy + s * 0.3]], 'S');
      this._op('0 J');
    }
    iconArrow(cx, cy, s, col) { // right-pointing triangle
      this._emitPath([
        ['m', cx - s * 0.3, cy - s * 0.4],
        ['l', cx + s * 0.4, cy],
        ['l', cx - s * 0.3, cy + s * 0.4],
        ['h']
      ], '');
      this._op(`${this._rgb(col)} rg`);
      this._emitPath([
        ['m', cx - s * 0.3, cy - s * 0.4],
        ['l', cx + s * 0.4, cy],
        ['l', cx - s * 0.3, cy + s * 0.4],
        ['h']
      ], 'f');
    }

    // pill badge; returns its width
    badge(x, y, label, o = {}) {
      const size = o.size || 7.5;
      const padX = o.padX || 7, h = o.h || 15;
      const w = this.measure(label.toUpperCase(), size, true) + (o.tracking || 0.4) * (label.length - 1) + padX * 2;
      this.rect(x, y, w, h, { fill: o.bg || this.c.violetSoft, r: h / 2 });
      this.text(x + w / 2, y + h / 2 + size * 0.36, label.toUpperCase(),
        { size, bold: true, color: o.fg || this.c.violet, align: 'center', tracking: o.tracking || 0.4 });
      return w;
    }

    // ====================================================================
    // TEXT FLOW
    // ====================================================================
    wrap(str, width, size, bold) {
      const words = String(str).replace(/\s+/g, ' ').trim().split(' ');
      const lines = []; let line = '';
      for (const w of words) {
        const test = line ? line + ' ' + w : w;
        if (this.measure(test, size, bold) > width && line) { lines.push(line); line = w; }
        else line = test;
      }
      if (line) lines.push(line);
      return lines;
    }
    paragraph(x, y, width, str, o = {}) {
      const size = o.size || 9.5, bold = !!o.bold, col = o.color || this.c.slate;
      const lh = o.lh || size * 1.45;
      const lines = this.wrap(str, width, size, bold);
      lines.forEach((ln, i) => this.text(x, y + i * lh + size * 0.85, ln, { size, bold, color: col }));
      return y + lines.length * lh;
    }

    // ====================================================================
    // COMPONENTS
    // ====================================================================
    gradeFor(s) { return s >= 90 ? 'A+' : s >= 80 ? 'A' : s >= 70 ? 'B' : s >= 60 ? 'C' : s >= 45 ? 'D' : 'F'; }
    toneFor(s) { return s >= 75 ? this.c.green : s >= 50 ? this.c.amber : this.c.red; }
    toneSoft(s) { return s >= 75 ? this.c.greenSoft : s >= 50 ? this.c.amberSoft : this.c.redSoft; }

    // numbered section header with left accent rail
    section(title, opts = {}) {
      this.need(58);
      this._secNo = (this._secNo || 0) + 1;
      const x = this.margin, y = this.currentY;
      const accent = opts.accent || this.c.violet;
      this._toc.push({ no: this._secNo, title, page: this.currentPage.number });
      // accent rail + number chip
      this.rect(x, y + 2, 3.5, 30, { fill: accent, r: 1.75 });
      this.text(x + 14, y + 12, String(this._secNo).padStart(2, '0'),
        { size: 9, bold: true, color: accent, tracking: 0.5 });
      this.text(x + 14, y + 28, title, { size: 15.5, bold: true, color: this.c.ink });
      if (opts.sub) this.text(this.pageWidth - this.margin, y + 28, opts.sub,
        { size: 9, color: this.c.muted, align: 'right' });
      this.line(x, y + 40, this.pageWidth - this.margin, y + 40, { color: this.c.hair, lw: 0.8 });
      this.currentY = y + 54;
    }

    eyebrow(x, y, label, col) {
      this.text(x, y, label.toUpperCase(), { size: 7.6, bold: true, color: col || this.c.muted, tracking: 1.4 });
    }

    // KPI tile
    kpiTile(x, y, w, h, label, value, sub, col) {
      this.rect(x, y, w, h, { fill: this.c.paper, stroke: this.c.hair, lw: 0.8, r: 9 });
      this.rect(x, y, 3, h, { fill: col || this.c.violet, r: 1.5 });
      this.eyebrow(x + 12, y + 16, label, this.c.muted);
      this.text(x + 12, y + 39, String(value), { size: 19, bold: true, color: col || this.c.ink });
      if (sub) this.text(x + 12, y + h - 11, sub, { size: 7.8, color: this.c.muted });
    }

    // labelled progress bar with value
    bar(x, y, w, label, pct, valueTxt, col) {
      const lh = 13, barH = 7;
      this.text(x, y + 9, label, { size: 9, color: this.c.slate });
      this.text(x + w, y + 9, valueTxt, { size: 9, bold: true, color: col, align: 'right' });
      const by = y + lh + 2;
      this.rect(x, by, w, barH, { fill: this.c.surface2, r: barH / 2 });
      const fillW = Math.max(barH, w * Math.max(0, Math.min(1, pct)));
      this.rect(x, by, fillW, barH, { fill: col, r: barH / 2 });
      return by + barH + 9;
    }

    // a clean data table with zebra + header band, wrapping last col optional
    table(cols, rows, o = {}) {
      const x = this.margin, w = this.cw();
      const widths = o.widths || cols.map(() => w / cols.length);
      const headH = 22, padX = 8;
      const rowH = o.rowH || 19;
      const headerFill = o.headerFill || this.c.ink;

      const drawHead = () => {
        this.rect(x, this.currentY, w, headH, { fill: headerFill, r: o.r != null ? o.r : 7 });
        this.rect(x, this.currentY + headH - 8, w, 8, { fill: headerFill });
        let cx = x;
        cols.forEach((c, i) => {
          const align = (o.align && o.align[i]) || 'left';
          const tx = align === 'right' ? cx + widths[i] - padX : align === 'center' ? cx + widths[i] / 2 : cx + padX;
          this.text(tx, this.currentY + 14.5, c, { size: 8, bold: true, color: this.c.white, align, tracking: 0.3 });
          cx += widths[i];
        });
        this.currentY += headH;
      };

      // Ensure room for header + at least 3 rows; otherwise start on next page
      const minBlock = headH + rowH * 3 + 8;
      this.ensureSpace(minBlock);
      drawHead();

      rows.forEach((row, ri) => {
        // Leave space for footer band — break early (no double blank pages)
        if (this.currentY + rowH + 8 > this.contentBottom()) {
          this.ensureSpace(headH + rowH * 2);
          drawHead();
        }
        if (ri % 2 === 1) this.rect(x, this.currentY, w, rowH, { fill: this.c.surface });
        let cx = x;
        row.forEach((cell, i) => {
          const align = (o.align && o.align[i]) || 'left';
          const tx = align === 'right' ? cx + widths[i] - padX : align === 'center' ? cx + widths[i] / 2 : cx + padX;
          let txt = String(cell == null ? '' : cell);
          const maxw = widths[i] - padX * 2;
          while (this.measure(txt, 8.4, false) > maxw && txt.length > 4) txt = txt.slice(0, -2);
          if (txt !== String(cell == null ? '' : cell)) txt = txt.replace(/\s*$/, '') + '\u2026';
          const colr = (o.cellColor && o.cellColor(ri, i, cell)) || this.c.slate;
          const bold = !!(o.cellBold && o.cellBold(ri, i));
          this.text(tx, this.currentY + rowH / 2 + 3, txt, { size: 8.4, color: colr, align, bold });
          cx += widths[i];
        });
        this.currentY += rowH;
      });
      this.line(x, this.currentY, x + w, this.currentY, { color: this.c.hair });
      this.currentY += 14;
    }

    // check / cross status row used in checklists
    checkRow(x, y, w, label, ok, note) {
      const okCol = ok ? this.c.green : this.c.red;
      this.circle(x + 8, y + 8, 7.5, { fill: ok ? this.c.greenSoft : this.c.redSoft });
      if (ok) this.iconCheck(x + 8, y + 8.5, 13, okCol); else this.iconCross(x + 8, y + 8, 11, okCol);
      this.text(x + 24, y + 11.5, label, { size: 9, color: this.c.ink });
      if (note) this.text(x + w, y + 11.5, note, { size: 8.4, color: ok ? this.c.green : this.c.muted, align: 'right', bold: ok });
      return y + 22;
    }

    // ====================================================================
    // RUNNING HEADER / FOOTER (added at generate time, skipped on cover)
    // ====================================================================
    _chrome(page) {
      if (this.coverPages.has(page.number)) return '';
      const m = this.margin, save = this.currentPage, ops = [];
      this.currentPage = { ops };
      // header
      this.circle(m + 5, 34, 5, { fill: this.c.violet });
      this.rect(m + 2.6, 31.4, 1.6, 5.2, { fill: this.c.white });
      this.rect(m + 5.2, 33.4, 4, 1.6, { fill: this.c.white });
      this.text(m + 16, 37, this.brand, { size: 9.5, bold: true, color: this.c.ink });
      const sub = this.meta.reportType || 'SEO + GEO Audit';
      this.text(m + 16 + this.measure(this.brand, 9.5, true) + 6, 37, sub,
        { size: 8, color: this.c.muted });
      this.text(this.pageWidth - m, 37, this.meta.url || '', { size: 8, color: this.c.muted, align: 'right' });
      this.line(m, 46, this.pageWidth - m, 46, { color: this.c.hair, lw: 0.7 });
      // footer — two lines to fit watermark info
      const fy = this.pageHeight - 38;
      this.line(m, fy - 8, this.pageWidth - m, fy - 8, { color: this.c.hair, lw: 0.7 });
      // footer row 1
      this.text(m, fy + 2, this.meta.date || '', { size: 8, color: this.c.muted });
      // --- ShahzaibSEO link ---
      const wShahzaibSEO = this.measure('ShahzaibSEO  \u2022  mubashirhassan.com/rankseo.html', 7.5, true);
      const fRow1Y = fy + 2;
      const fRow1X = this.pageWidth / 2 - wShahzaibSEO / 2;
      this.text(this.pageWidth / 2, fRow1Y, 'ShahzaibSEO  \u2022  mubashirhassan.com/rankseo.html', { size: 7.5, bold: true, color: this.c.violet, align: 'center' });
      // clickable rect for full row-1 text (top = fy-4, bottom = fy+10)
      this._linkAnnot(page, fRow1X, fRow1Y - 9, fRow1X + wShahzaibSEO, fRow1Y + 3, 'https://www.mubashirhassan.com/rankseo.html');
      this.text(this.pageWidth - m, fRow1Y, `Page ${page.number} of ${this.pages.length}`,
        { size: 8, color: this.c.muted, align: 'right' });
      // footer row 2 — Developer + WhatsApp + Email
      const devLine = 'Developer: Mubashir Hassan  \u2022  WA +92 322 2047786  \u2022  hello@mubashirhassan.com';
      const wDev = this.measure(devLine, 6.5, false);
      const fRow2Y = fy + 13;
      const fRow2X = this.pageWidth / 2 - wDev / 2;
      this.text(this.pageWidth / 2, fRow2Y, devLine, { size: 6.5, color: this.c.muted, align: 'center' });
      this._linkAnnot(page, fRow2X, fRow2Y - 9, fRow2X + wDev * 0.35, fRow2Y + 3, 'https://www.mubashirhassan.com');
      this._linkAnnot(page, fRow2X + wDev * 0.35, fRow2Y - 9, fRow2X + wDev * 0.72, fRow2Y + 3, 'https://wa.me/923222047786?text=Hi%20Mubashir%2C%20I%20found%20you%20via%20ShahzaibSEO%20extension.');
      this._linkAnnot(page, fRow2X + wDev * 0.72, fRow2Y - 9, fRow2X + wDev, fRow2Y + 3, 'mailto:hello@mubashirhassan.com');
      this.currentPage = save;
      return ops.join('\n');
    }

    // ====================================================================
    // REPORT BUILDER
    // ====================================================================
    buildAuditReport(p) {
      const d = p.d || {};
      const vit = p.vitals || null;
      const auth = p.authority || null;
      const bots = p.aiBots || null;
      const ex = p.extras || {};
      this.meta.url = p.url || d.meta?.url || '';
      this.meta.date = p.date || '';
      const host = (() => { try { return new URL(this.meta.url).hostname.replace(/^www\./, ''); } catch { return this.meta.url; } })();

      const seo = d.seo?.score || 0;
      const geo = d.geo?.geoScore || 0;
      const read = d.readability?.score || 0;
      const cro = d.cro?.score || 0;
      const kw = d.keywords?.score || 0;
      const psi = vit?.score != null ? vit.score : (vit?.mobile?.score ?? 0);

      this._coverPage(d, { seo, geo, read, cro, kw, psi }, host, auth);
      this._tocPlaceholderIndex = this.pages.length; // toc built last, but we render here
      this._executiveSummary(d, { seo, geo, read, cro, kw, psi }, auth, bots);
      this._scoreBreakdown({ seo, geo, read, cro, kw, psi });
      this._rankingDiagnosis(d, { seo, geo, read, cro, kw, psi }, vit);
      this._actionPlan(d);
      this._issuesAndFixes(d);
      this._onPageSeo(d);
      this._contentKeywords(d);
      this._technical(d, vit, ex);
      this._technicalDeepDive(d, ex);
      this._domainNetwork(d, ex, host);
      this._geoAeo(d, bots, ex);
      this._geoDeepDive(d, ex);
      this._imagesLinks(d, ex);
      if (ex.traffic) this._traffic(ex.traffic);
      if (auth) this._authority(auth, d);
      this._methodology();
      return this;
    }

    // ---- COVER ----------------------------------------------------------
    _coverPage(d, sc, host, auth) {
      this.addPage(true);
      const W = this.pageWidth, m = this.margin;

      // top gradient band
      const bandH = 250;
      this.gradientV(0, 0, W, bandH, this.c.violetDeep, this.c.violet, 80);
      // subtle deeper overlay arc motif (concentric rings, low contrast)
      this.arc(W - 40, 60, 120, 40, 200, { color: [255, 255, 255], lw: 1 });
      this.arc(W - 40, 60, 150, 30, 210, { color: [255, 255, 255], lw: 0.8 });
      this.arc(W - 40, 60, 180, 20, 220, { color: [255, 255, 255], lw: 0.6 });

      // brand lockup
      this.circle(m + 9, 56, 9, { fill: this.c.white });
      this.rect(m + 5.2, 51.2, 2.6, 9, { fill: this.c.violet });
      this.rect(m + 9.4, 55, 6.4, 2.6, { fill: this.c.violet });
      this.text(m + 26, 60, 'ShahzaibSEO', { size: 21, bold: true, color: this.c.white });
      this.eyebrow(m + 26, 73, 'AEO + GEO Expert', [216, 205, 255]);

      // title
      this.text(m, 128, 'SEO & Generative Engine', { size: 30, bold: true, color: this.c.white });
      this.text(m, 162, 'Optimization Audit', { size: 30, bold: true, color: this.c.white });
      this.text(m, 188, host || 'Website report', { size: 12, color: [221, 214, 254] });
      this.text(m, 203, this.meta.date || '', { size: 9.5, color: [196, 181, 253] });

      // overlapping hero card with the two headline gauges
      const cardY = 216, cardH = 188, cardW = W - m * 2;
      this.rect(m, cardY, cardW, cardH, { fill: this.c.paper, stroke: this.c.hair, lw: 1, r: 16 });

      // gauges
      const gy = cardY + 86;
      const drawGauge = (cx, score, label, accent) => {
        this.ringGauge(cx, gy, 40, 9, score / 100, { color: accent, track: this.c.surface2 });
        this.text(cx, gy + 7, String(score), { size: 28, bold: true, color: accent, align: 'center' });
        this.text(cx, gy + 22, '/100', { size: 8, color: this.c.muted, align: 'center' });
        this.text(cx, gy + 64, label, { size: 10, bold: true, color: this.c.ink, align: 'center' });
      };
      drawGauge(m + cardW * 0.27, sc.seo, 'SEO Score', this.toneFor(sc.seo));
      // divider
      this.line(m + cardW * 0.5, cardY + 30, m + cardW * 0.5, cardY + cardH - 30, { color: this.c.hair });
      drawGauge(m + cardW * 0.73, sc.geo, 'GEO Score', this.c.teal);

      // grade chip centred top of card
      const grade = d.seo?.grade || this.gradeFor(sc.seo);
      const gw = 54;
      this.rect(m + cardW / 2 - gw / 2, cardY + 18, gw, 26, { fill: this.toneSoft(sc.seo), r: 13 });
      this.text(m + cardW / 2, cardY + 36, 'Grade ' + grade, { size: 11, bold: true, color: this.toneFor(sc.seo), align: 'center' });

      // KPI strip below hero
      const stripY = cardY + cardH + 20;
      const tiles = [
        ['Readability', sc.read + '/100', this.toneFor(sc.read)],
        ['Conversion', sc.cro + '/100', this.toneFor(sc.cro)],
        ['Keywords', sc.kw + '/100', this.toneFor(sc.kw)],
        ['PageSpeed', sc.psi + '/100', this.toneFor(sc.psi)]
      ];
      const tw = (this.cw() - 3 * 12) / 4;
      tiles.forEach((t, i) => this.kpiTile(m + i * (tw + 12), stripY, tw, 62, t[0], t[1], '', t[2]));

      // headline counters
      const cY = stripY + 80;
      const issues = (d.seo?.issues || []).length;
      const words = d.readability?.wordCount || d.keywords?.totalWords || 0;
      const facts = [
        ['Issues found', String(issues)],
        ['Words analysed', words ? fmtNum(words) : '\u2014'],
        ['Schema blocks', String((d.geo?.structured?.schemas || []).length)],
        ['Authority DA / DR', auth ? `${auth.da != null ? auth.da : '\u2014'} / ${auth.dr != null ? auth.dr : '\u2014'}` : '\u2014']
      ];
      const fw = this.cw() / 4;
      facts.forEach((f, i) => {
        const fx = m + i * fw;
        this.text(fx, cY + 16, f[1], { size: 16, bold: true, color: this.c.ink });
        this.eyebrow(fx, cY + 30, f[0], this.c.muted);
        if (i) this.line(fx - 8, cY, fx - 8, cY + 34, { color: this.c.hair });
      });

      // contents list — fills the lower third, orients the reader
      const inX = m, inY = cY + 62;
      this.eyebrow(inX, inY, 'Inside this report', this.c.muted);
      const contents = [
        'Executive summary', 'Score breakdown', 'Why you rank where you do',
        'Priority action plan', 'Issues & fixes', 'On-page SEO', 'Content & keywords',
        'Technical SEO', 'Technical deep dive', 'Domain & network',
        'Generative engine optimization', 'GEO deep dive',
        'Images & links', 'Traffic overview', 'Domain authority', 'Methodology & next steps'
      ];
      const colGap = this.cw() / 2;
      contents.forEach((it, i) => {
        const col = Math.floor(i / 8), row = i % 8;
        const x = inX + col * colGap, y = inY + 20 + row * 17;
        this.circle(x + 3, y - 3, 2, { fill: this.c.violetBright });
        this.text(x + 12, y, it, { size: 8.6, color: this.c.slate });
      });

      // footer note on cover
      this.text(m, this.pageHeight - 40, 'Generated by ShahzaibSEO  \u2022  AEO + GEO Expert  \u2022  Automated technical, content & AI-visibility analysis',
        { size: 8, color: this.c.muted });
    }

    // ---- EXECUTIVE SUMMARY ---------------------------------------------
    _executiveSummary(d, sc, auth, bots) {
      this.addPage();
      this.section('Executive Summary', { accent: this.c.violet, sub: 'At-a-glance health' });

      const verdict = this._verdict(sc);
      // verdict banner
      const y = this.currentY, h = 70, w = this.cw();
      this.rect(this.margin, y, w, h, { fill: verdict.soft, r: 12 });
      this.rect(this.margin, y, 4, h, { fill: verdict.tone, r: 2 });
      this.ringGauge(this.margin + 42, y + h / 2, 24, 6, sc.seo / 100, { color: verdict.tone, track: this.c.paper });
      this.text(this.margin + 42, y + h / 2 + 5, String(sc.seo), { size: 16, bold: true, color: verdict.tone, align: 'center' });
      this.text(this.margin + 84, y + 26, verdict.headline, { size: 13, bold: true, color: this.c.ink });
      this.paragraph(this.margin + 84, y + 32, w - 96, verdict.line, { size: 9, color: this.c.slate, lh: 12.5 });
      this.currentY = y + h + 18;

      // two-column: strengths / priorities
      const colW = (w - 16) / 2, cy = this.currentY;
      const { strengths, priorities } = this._strengthsPriorities(d, sc);
      this._listCard(this.margin, cy, colW, 'What is working', strengths, this.c.green, true);
      this._listCard(this.margin + colW + 16, cy, colW, 'Fix these first', priorities, this.c.red, false);
      this.currentY = Math.max(this._lastCardBottomA, this._lastCardBottomB) + 16;

      // snapshot table
      this.need(120);
      this.eyebrow(this.margin, this.currentY, 'Scorecard snapshot', this.c.muted);
      this.currentY += 12;
      const rows = [
        ['SEO health', sc.seo + ' / 100', this._lbl(sc.seo)],
        ['GEO / AI visibility', sc.geo + ' / 100', this._lbl(sc.geo)],
        ['Readability', sc.read + ' / 100', this._lbl(sc.read)],
        ['Conversion (CRO)', sc.cro + ' / 100', this._lbl(sc.cro)],
        ['Keyword optimisation', sc.kw + ' / 100', this._lbl(sc.kw)],
        ['PageSpeed (mobile)', sc.psi + ' / 100', this._lbl(sc.psi)]
      ];
      this.table(['Dimension', 'Score', 'Status'], rows, {
        widths: [this.cw() * 0.5, this.cw() * 0.25, this.cw() * 0.25],
        align: ['left', 'left', 'right'],
        cellBold: (r, c) => c === 1,
        cellColor: (r, c, v) => {
          if (c === 2) { const n = parseInt(rows[r][1]); return this.toneFor(n); }
          return c === 1 ? this.c.ink : this.c.slate;
        }
      });
    }

    _listCard(x, y, w, title, items, accent, positive) {
      const lh = 30;
      const h = 30 + items.length * lh + 8;
      this.rect(x, y, w, h, { fill: this.c.paper, stroke: this.c.hair, lw: 0.8, r: 11 });
      this.rect(x, y, w, 26, { fill: positive ? this.c.greenSoft : this.c.redSoft, r: 11 });
      this.rect(x, y + 15, w, 11, { fill: positive ? this.c.greenSoft : this.c.redSoft });
      this.text(x + 12, y + 17, title, { size: 9.5, bold: true, color: accent });
      let iy = y + 26 + 4;
      items.forEach((it) => {
        if (positive) { this.circle(x + 16, iy + 11, 2.4, { fill: accent }); }
        else { this.text(x + 12, iy + 14, '!', { size: 11, bold: true, color: accent }); }
        const endY = this.paragraph(x + 24, iy + 4, w - 36, it, { size: 8.6, color: this.c.slate, lh: 11.5 });
        iy = Math.max(iy + lh, endY + 8);
      });
      if (positive) this._lastCardBottomA = y + h; else this._lastCardBottomB = y + h;
    }

    // ---- SCORE BREAKDOWN ------------------------------------------------
    _scoreBreakdown(sc) {
      this.addPage();
      this.section('Score Breakdown', { accent: this.c.violet, sub: 'Six dimensions of search performance' });
      const defs = [
        ['SEO', sc.seo, this.toneFor(sc.seo), 'Crawlability, metadata, structure and on-page signals.'],
        ['GEO / AEO', sc.geo, this.c.teal, 'Visibility & citability inside AI answer engines.'],
        ['Readability', sc.read, this.toneFor(sc.read), 'Sentence complexity and scannability of the copy.'],
        ['Conversion', sc.cro, this.toneFor(sc.cro), 'Calls-to-action, trust signals and above-the-fold clarity.'],
        ['Keywords', sc.kw, this.toneFor(sc.kw), 'Topical coverage, density and keyword placement.'],
        ['PageSpeed', sc.psi, this.toneFor(sc.psi), 'Mobile Core Web Vitals and load performance.']
      ];
      const w = this.cw(), colW = (w - 18) / 2, cardH = 96;
      defs.forEach((dz, i) => {
        const col = i % 2, rowi = Math.floor(i / 2);
        if (col === 0) this.need(cardH + 14);
        const x = this.margin + col * (colW + 18);
        const y = this.currentY;
        this.rect(x, y, colW, cardH, { fill: this.c.paper, stroke: this.c.hair, lw: 0.8, r: 12 });
        this.ringGauge(x + 42, y + 44, 27, 7, dz[1] / 100, { color: dz[2], track: this.c.surface2 });
        this.text(x + 42, y + 49, String(dz[1]), { size: 17, bold: true, color: dz[2], align: 'center' });
        this.text(x + 80, y + 28, dz[0], { size: 12, bold: true, color: this.c.ink });
        this.badge(x + 80, y + 34, this._lbl(dz[1]), { bg: this.toneSoft(dz[1]), fg: this.toneFor(dz[1]) });
        this.paragraph(x + 80, y + 56, colW - 92, dz[3], { size: 8, color: this.c.slate, lh: 10.5 });
        if (col === 1) this.currentY = y + cardH + 16;
      });
      if (defs.length % 2 === 1) this.currentY += cardH + 16;
    }

    // ---- RANKING DIAGNOSIS (why high / why low / how to climb) ----------
    _rankingDiagnosis(d, sc, vit) {
      this.addPage();
      this.section('Why You Rank Where You Do', { accent: this.c.violet, sub: 'Diagnosis & path to page one' });

      const drivers = this._rankingDrivers(d, sc, vit);
      // positive drivers
      this.eyebrow(this.margin, this.currentY, 'Ranking tailwinds  \u2014  what lifts you', this.c.green);
      this.currentY += 14;
      drivers.up.forEach((t) => { this.currentY = this._diagRow(t, true); });
      this.space(8);
      // negative drivers
      this.need(40);
      this.eyebrow(this.margin, this.currentY, 'Ranking headwinds  \u2014  what holds you back', this.c.red);
      this.currentY += 14;
      drivers.down.forEach((t) => { this.currentY = this._diagRow(t, false); });

      // how to climb
      this.space(6);
      this.need(60);
      this.eyebrow(this.margin, this.currentY, 'How to climb the rankings', this.c.violet);
      this.currentY += 14;
      drivers.climb.forEach((t, i) => {
        this.need(34);
        const x = this.margin, y = this.currentY;
        this.circle(x + 9, y + 9, 9, { fill: this.c.violetSoft });
        this.text(x + 9, y + 12.5, String(i + 1), { size: 9, bold: true, color: this.c.violet, align: 'center' });
        this.text(x + 26, y + 7, t.title, { size: 9.5, bold: true, color: this.c.ink });
        const endY = this.paragraph(x + 26, y + 11, this.cw() - 30, t.body, { size: 8.6, color: this.c.slate, lh: 11.5 });
        this.currentY = Math.max(y + 26, endY + 9);
      });
    }

    _diagRow(t, positive) {
      this.need(30);
      const x = this.margin, y = this.currentY, w = this.cw();
      const tone = positive ? this.c.green : this.c.red;
      this.circle(x + 8, y + 9, 7.5, { fill: positive ? this.c.greenSoft : this.c.redSoft });
      if (positive) this.iconCheck(x + 8, y + 9.5, 12, tone); else this.text(x + 8, y + 12.5, '!', { size: 11, bold: true, color: tone, align: 'center' });
      this.text(x + 24, y + 6, t.title, { size: 9.4, bold: true, color: this.c.ink });
      const endY = this.paragraph(x + 24, y + 10, w - 28, t.body, { size: 8.6, color: this.c.slate, lh: 11.3 });
      return Math.max(y + 24, endY + 8);
    }

    // ---- ACTION PLAN ----------------------------------------------------
    _actionPlan(d) {
      this.addPage();
      this.section('Priority Action Plan', { accent: this.c.violet, sub: 'Ranked by impact vs. effort' });
      const issues = (d.seo?.issues || []).slice();
      const rank = { error: 0, warning: 1, info: 2 };
      issues.sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3));

      const quick = issues.filter(i => i.severity === 'error').slice(0, 6);
      const medium = issues.filter(i => i.severity === 'warning').slice(0, 6);
      const longer = issues.filter(i => i.severity === 'info').slice(0, 6);

      const group = (title, list, tone, soft, eff) => {
        if (!list.length) return;
        this.need(40);
        this.rect(this.margin, this.currentY, this.cw(), 24, { fill: soft, r: 7 });
        this.text(this.margin + 12, this.currentY + 16, title, { size: 10, bold: true, color: tone });
        this.text(this.pageWidth - this.margin - 12, this.currentY + 16, eff, { size: 8, color: tone, align: 'right', bold: true });
        this.currentY += 32;
        list.forEach((it) => {
          this.need(26);
          const x = this.margin, y = this.currentY;
          this.rect(x + 2, y + 3, 5, 5, { fill: tone, r: 1 });
          this.text(x + 16, y + 7, it.msg, { size: 9.2, bold: true, color: this.c.ink });
          if (it.desc) this.currentY = this.paragraph(x + 16, y + 11, this.cw() - 20, it.desc, { size: 8.3, color: this.c.slate, lh: 10.8 }) + 8;
          else this.currentY = y + 18;
        });
        this.space(6);
      };
      group('Do now  \u2014  critical fixes', quick, this.c.red, this.c.redSoft, 'High impact');
      group('Next  \u2014  important improvements', medium, this.c.amber, this.c.amberSoft, 'Medium impact');
      group('Later  \u2014  polish & growth', longer, this.c.blue, this.c.blueSoft, 'Compounding gains');
      if (!issues.length) this.paragraph(this.margin, this.currentY, this.cw(), 'No blocking issues detected. Focus on content depth and authority building to push rankings higher.', { color: this.c.slate });
    }

    // ---- ISSUES & FIXES (full) -----------------------------------------
    _issuesAndFixes(d) {
      this.addPage();
      const issues = d.seo?.issues || [];
      this.section(`Issues & Fixes (${issues.length})`, { accent: this.c.violet, sub: 'Every finding with a recommended fix' });
      if (!issues.length) { this.paragraph(this.margin, this.currentY, this.cw(), 'No issues found in this audit pass.', { color: this.c.slate }); return; }

      const sevMap = {
        error: ['Critical', this.c.red, this.c.redSoft],
        warning: ['Warning', this.c.amber, this.c.amberSoft],
        info: ['Opportunity', this.c.blue, this.c.blueSoft]
      };
      issues.forEach((it) => {
        const sev = sevMap[it.severity] || sevMap.info;
        // measure card height
        const descLines = it.desc ? this.wrap(it.desc, this.cw() - 60, 8.6, false).length : 0;
        const cardH = 30 + (descLines ? descLines * 12 + 6 : 0) + 4;
        this.need(cardH + 10);
        const x = this.margin, y = this.currentY, w = this.cw();
        this.rect(x, y, w, cardH, { fill: this.c.paper, stroke: this.c.hair, lw: 0.8, r: 10 });
        this.rect(x, y, 4, cardH, { fill: sev[1], r: 2 });
        this.text(x + 16, y + 19, it.msg, { size: 9.6, bold: true, color: this.c.ink });
        this.badge(x + w - 78, y + 9, sev[0], { bg: sev[2], fg: sev[1] });
        if (it.cat) this.text(x + w - 84, y + 19, it.cat, { size: 7.4, color: this.c.muted, align: 'right' });
        if (it.desc) this.paragraph(x + 16, y + 26, w - 60, it.desc, { size: 8.6, color: this.c.slate, lh: 12 });
        this.currentY = y + cardH + 9;
      });
    }

    // ---- ON-PAGE SEO ----------------------------------------------------
    _onPageSeo(d) {
      this.addPage();
      this.section('On-Page SEO', { accent: this.c.violet, sub: 'Metadata, social tags & heading structure' });
      const m = d.meta || {};
      const tlen = (m.title || '').length, dlen = (m.desc || '').length;
      const lenTag = (n, lo, hi) => n === 0 ? 'Missing' : n < lo ? 'Too short' : n > hi ? 'Too long' : 'Optimal';

      this.eyebrow(this.margin, this.currentY, 'Core metadata', this.c.muted); this.currentY += 12;
      this.table(['Field', 'Value', 'Length', 'Status'], [
        ['Title', m.title || '\u2014', `${tlen}/60`, lenTag(tlen, 30, 60)],
        ['Description', m.desc || '\u2014', `${dlen}/160`, lenTag(dlen, 70, 160)],
        ['Canonical', m.canonical || 'Not set', '\u2014', m.canonical ? 'Set' : 'Missing'],
        ['Language', m.lang || 'Not set', '\u2014', m.lang ? 'Set' : 'Missing'],
        ['Robots', m.robots || 'Not set', '\u2014', (m.robots || '').includes('noindex') ? 'Noindex!' : 'Indexable'],
        ['Viewport', m.viewport ? 'Set' : 'Missing', '\u2014', m.viewport ? 'OK' : 'Missing']
      ], {
        widths: [this.cw() * 0.18, this.cw() * 0.5, this.cw() * 0.14, this.cw() * 0.18],
        align: ['left', 'left', 'center', 'right'],
        cellColor: (r, c, v) => c === 3 ? (/(Optimal|Set|OK|Indexable)/.test(String(v)) ? this.c.green : /Missing|short|long|Noindex/.test(String(v)) ? this.c.amber : this.c.slate) : this.c.slate,
        cellBold: (r, c) => c === 3
      });

      // social tags checklist (2 cols)
      this.need(120);
      this.eyebrow(this.margin, this.currentY, 'Social & sharing tags', this.c.muted); this.currentY += 14;
      const og = m.og || {}, tw = m.twitter || {};
      const colW = (this.cw() - 20) / 2;
      let ya = this.currentY, yb = this.currentY;
      ya = this.checkRow(this.margin, ya, colW, 'og:title', !!og.title);
      ya = this.checkRow(this.margin, ya, colW, 'og:description', !!og.description);
      ya = this.checkRow(this.margin, ya, colW, 'og:image', !!og.image);
      ya = this.checkRow(this.margin, ya, colW, 'og:type', !!og.type);
      const x2 = this.margin + colW + 20;
      yb = this.checkRow(x2, yb, colW, 'twitter:card', !!tw.card);
      yb = this.checkRow(x2, yb, colW, 'twitter:title', !!tw.title);
      yb = this.checkRow(x2, yb, colW, 'twitter:image', !!tw.image);
      yb = this.checkRow(x2, yb, colW, 'twitter:site', !!tw.site);
      this.currentY = Math.max(ya, yb) + 12;

      // heading structure
      const hc = d.headings?.counts || {};
      this.need(90);
      this.eyebrow(this.margin, this.currentY, 'Heading distribution', this.c.muted); this.currentY += 14;
      const order = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
      const maxc = Math.max(1, ...order.map(k => hc[k] || 0));
      const bw = (this.cw() - 5 * 10) / 6;
      const baseY = this.currentY;
      order.forEach((k, i) => {
        const v = hc[k] || 0, x = this.margin + i * (bw + 10);
        const bh = 40 * (v / maxc);
        this.rect(x, baseY + 4 + (40 - bh), bw, bh || 1.5, { fill: i === 0 ? this.c.violet : this.c.violetBright, r: 3 });
        this.text(x + bw / 2, baseY + 58, k.toUpperCase(), { size: 8, bold: true, color: this.c.slate, align: 'center' });
        this.text(x + bw / 2, baseY + 70, String(v), { size: 9, bold: true, color: this.c.ink, align: 'center' });
      });
      this.currentY = baseY + 80;
      (d.headings?.issues || []).forEach(iss => {
        this.text(this.margin, this.currentY + 8, '!  ' + iss.msg, { size: 8.6, color: this.c.amber, bold: true });
        this.currentY += 14;
      });
      this.space(6);

      // Full heading outline (all levels, empty + hierarchy notes — KWScanner style)
      const hs = d.headings?.headings || [];
      if (hs.length) {
        this.need(60);
        const emptyN = hs.filter(h => h.isEmpty || !(h.text || '').trim()).length;
        this.eyebrow(this.margin, this.currentY,
          'Heading outline (all ' + hs.length + (emptyN ? ', ' + emptyN + ' empty' : '') + ')',
          this.c.muted);
        this.currentY += 12;
        let prevLevel = 0;
        const rows = hs.map((h, i) => {
          const lvl = Number(h.level) || 0;
          const empty = h.isEmpty || !(h.text || '').trim();
          let note = '';
          if (empty) note = 'empty';
          else if (i === 0 && lvl !== 1) note = 'should be H1';
          else if (prevLevel > 0 && lvl > prevLevel + 1) note = 'skipped H' + (prevLevel + 1);
          if (!empty) prevLevel = lvl;
          else if (prevLevel === 0) prevLevel = lvl;
          return [
            'H' + lvl,
            empty ? '(no text)' : String(h.text).trim().slice(0, 90),
            note || ''
          ];
        });
        this.table(['Level', 'Heading', 'Note'], rows, {
          widths: [this.cw() * 0.12, this.cw() * 0.68, this.cw() * 0.2],
          align: ['center', 'left', 'left'],
          cellColor: (r, c, v) => {
            if (c === 2 && v) return this.c.amber;
            if (c === 1 && String(v) === '(no text)') return this.c.amber;
            return this.c.slate;
          }
        });
      } else {
        this.need(30);
        this.paragraph(this.margin, this.currentY, this.cw(),
          'No heading tags (H1–H6) found on this page.',
          { color: this.c.amber, lh: 12 });
      }
    }

    // ---- CONTENT & KEYWORDS --------------------------------------------
    _contentKeywords(d) {
      this.addPage();
      this.section('Content & Keywords', { accent: this.c.violet, sub: 'Topical signals & readability' });
      const k = d.keywords || {}, r = d.readability || {};

      // readability stat tiles
      const tiles = [
        ['Words', fmtNum(r.wordCount || k.totalWords || 0), this.c.violet],
        ['Readability', (r.score || 0) + '/100', this.toneFor(r.score || 0)],
        ['Avg. sentence', (r.avgLength || 0) + ' w', (r.avgLength || 0) <= 20 ? this.c.green : this.c.amber],
        ['Passive voice', (r.passiveRate || 0) + '%', (r.passiveRate || 0) <= 10 ? this.c.green : this.c.amber]
      ];
      const tw = (this.cw() - 3 * 12) / 4;
      tiles.forEach((t, i) => this.kpiTile(this.margin + i * (tw + 12), this.currentY, tw, 58, t[0], t[1], '', t[2]));
      this.currentY += 76;

      // 1-gram keywords with Title / Description / Headings presence (KWScanner style)
      const unis = (k.keywords || []).filter(x => x.ngram === 1).slice(0, 30);
      if (unis.length) {
        this.eyebrow(this.margin, this.currentY, 'Keywords — 1-gram', this.c.muted); this.currentY += 12;
        this.table(['Keyword', 'Title', 'Description', 'Headings', 'Count', 'Density'],
          unis.map(x => [
            x.word,
            x.inTitle ? 'Yes' : '\u2014',
            x.inMeta ? 'Yes' : '\u2014',
            x.inH1 ? 'Yes' : '\u2014',
            String(x.count),
            x.density + '%'
          ]), {
          widths: [this.cw() * 0.28, this.cw() * 0.12, this.cw() * 0.16, this.cw() * 0.14, this.cw() * 0.14, this.cw() * 0.16],
          align: ['left', 'center', 'center', 'center', 'center', 'center'],
          cellColor: (ri, c, v) => (c >= 1 && c <= 3 && v === 'Yes') ? this.c.green : this.c.slate
        });
      }
      // 2-gram
      const bigrams = (k.keywords || []).filter(x => x.ngram === 2).slice(0, 20);
      if (bigrams.length) {
        this.need(60);
        this.eyebrow(this.margin, this.currentY, 'Keywords — 2-gram', this.c.muted); this.currentY += 12;
        this.table(['Keyword', 'Title', 'Description', 'Headings', 'Count', 'Density'],
          bigrams.map(x => [
            x.word,
            x.inTitle ? 'Yes' : '\u2014',
            x.inMeta ? 'Yes' : '\u2014',
            x.inH1 ? 'Yes' : '\u2014',
            String(x.count),
            x.density + '%'
          ]), {
          widths: [this.cw() * 0.28, this.cw() * 0.12, this.cw() * 0.16, this.cw() * 0.14, this.cw() * 0.14, this.cw() * 0.16],
          align: ['left', 'center', 'center', 'center', 'center', 'center'],
          cellColor: (ri, c, v) => (c >= 1 && c <= 3 && v === 'Yes') ? this.c.green : this.c.slate
        });
      }
      // 3-gram
      const trigrams = (k.keywords || []).filter(x => x.ngram === 3).slice(0, 15);
      if (trigrams.length) {
        this.need(60);
        this.eyebrow(this.margin, this.currentY, 'Keywords — 3-gram', this.c.muted); this.currentY += 12;
        this.table(['Keyword', 'Title', 'Description', 'Headings', 'Count', 'Density'],
          trigrams.map(x => [
            x.word,
            x.inTitle ? 'Yes' : '\u2014',
            x.inMeta ? 'Yes' : '\u2014',
            x.inH1 ? 'Yes' : '\u2014',
            String(x.count),
            x.density + '%'
          ]), {
          widths: [this.cw() * 0.28, this.cw() * 0.12, this.cw() * 0.16, this.cw() * 0.14, this.cw() * 0.14, this.cw() * 0.16],
          align: ['left', 'center', 'center', 'center', 'center', 'center'],
          cellColor: (ri, c, v) => (c >= 1 && c <= 3 && v === 'Yes') ? this.c.green : this.c.slate
        });
      }
      // stuffing alerts
      if ((k.stuffing || []).length) {
        this.need(30);
        this.text(this.margin, this.currentY + 6, '!  Possible keyword stuffing: ' + k.stuffing.map(s => s.word).filter(Boolean).join(', '),
          { size: 8.6, color: this.c.amber, bold: true });
        this.currentY += 18;
      }
    }

    // ---- TECHNICAL + CWV ------------------------------------------------
    _technical(d, vit, ex = {}) {
      this.addPage();
      this.section('Technical SEO', { accent: this.c.violet, sub: 'Infrastructure, crawl & performance' });
      const t = d.tech || {};
      // checklist grid — mirrors the 8-item Technical tab grid
      const urlLen = t.urlLength || (d.meta?.url || '').length;
      const checks = [
        ['HTTPS secure', t.isHttps],
        ['Indexable', t.isIndexable],
        ['Canonical set', !!d.meta?.canonical],
        ['Hreflang tags', (t.hreflangCount || 0) > 0, (t.hreflangCount || 0) > 0 ? `${t.hreflangCount} tag(s)` : null],
        ['URL length OK', urlLen <= 100, urlLen + ' chars'],
        ['Viewport set', !!d.meta?.viewport],
        ['Charset declared', !!d.meta?.charset],
        ['HTML size OK', (t.htmlSize || 0) <= 1048576, fmtBytes(t.htmlSize)]
      ];
      const colW = (this.cw() - 20) / 2;
      let ya = this.currentY, yb = this.currentY;
      checks.forEach((c, i) => {
        if (i % 2 === 0) ya = this.checkRow(this.margin, ya, colW, c[0], c[1], c[2]);
        else yb = this.checkRow(this.margin + colW + 20, yb, colW, c[0], c[1], c[2]);
      });
      this.currentY = Math.max(ya, yb) + 12;

      // Extended checks — Open Graph, Twitter Card, Favicon, JSON-LD, Sitemap, WordPress, AMP
      this.eyebrow(this.margin, this.currentY, 'Markup & platform signals', this.c.muted); this.currentY += 12;
      const ext = [
        ['Open Graph tags', !!t.ogTitle],
        ['Twitter Card', !!t.twitterCard],
        ['Favicon set', !!t.favicon],
        ['JSON-LD schema', (t.jsonLdCount || 0) > 0, (t.jsonLdCount || 0) > 0 ? `${t.jsonLdCount} block(s)` : null],
        ['Sitemap referenced', !!(ex.sitemap?.ok || t.sitemapInRobots)],
        ['WordPress detected', !!t.isWordPress, t.isWordPress ? (t.cms || 'WordPress') : null],
        ['AMP version', !!t.isAmp]
      ];
      const colW2 = (this.cw() - 20) / 2;
      let xa = this.currentY, xb = this.currentY;
      ext.forEach((c, i) => {
        if (i % 2 === 0) xa = this.checkRow(this.margin, xa, colW2, c[0], c[1], c[2]);
        else xb = this.checkRow(this.margin + colW2 + 20, xb, colW2, c[0], c[1], c[2]);
      });
      this.currentY = Math.max(xa, xb) + 12;

      // infra table
      this.need(140);
      this.eyebrow(this.margin, this.currentY, 'Infrastructure', this.c.muted); this.currentY += 12;
      this.table(['Property', 'Value'], [
        ['HTML size', fmtBytes(t.htmlSize)],
        ['DOM elements', t.domElements ? fmtNum(t.domElements) : '\u2014'],
        ['DOM depth', t.domDepth || '\u2014'],
        ['CMS / framework', t.cms || t.framework || '\u2014'],
        ['Scripts (total / blocking)', `${t.scripts?.total || 0} / ${t.scripts?.blocking || 0}`],
        ['Stylesheets', String(t.styles?.total || 0)],
        ['Tech stack', (t.techStack || []).slice(0, 6).join(', ') || '\u2014'],
        ['Tracking detected', (t.trackingSignals || []).join(', ') || 'None detected']
      ], { widths: [this.cw() * 0.34, this.cw() * 0.66], align: ['left', 'left'] });

      // CSS Analysis + JavaScript Coverage
      this.need(110);
      const s = t.styles || {}, sc = t.scripts || {};
      this.eyebrow(this.margin, this.currentY, 'CSS analysis & JavaScript coverage', this.c.muted); this.currentY += 12;
      this.table(['Resource', 'Inline', 'External', 'Blocking'], [
        ['Stylesheets', String(s.inline || 0), String(s.external || 0), '\u2014'],
        ['Scripts', String(sc.inline || 0), String(sc.external || 0), String(sc.blocking || 0)]
      ], {
        widths: [this.cw() * 0.3, this.cw() * 0.23, this.cw() * 0.23, this.cw() * 0.24], align: ['left', 'center', 'center', 'center'],
        cellColor: (r, c, v) => (c === 3 && r === 1 && (sc.blocking || 0) > 0) ? this.c.amber : this.c.slate
      });

      // Resource Hints
      if ((t.hints || []).length) {
        this.need(70);
        this.eyebrow(this.margin, this.currentY, 'Resource hints', this.c.muted); this.currentY += 12;
        const grouped = {};
        t.hints.forEach(h => { (grouped[h.rel] = grouped[h.rel] || []).push(h.href); });
        const hintRows = Object.entries(grouped).map(([rel, hrefs]) => [rel, `${hrefs.length} domain(s)`]);
        this.table(['Hint type', 'Count'], hintRows, { widths: [this.cw() * 0.5, this.cw() * 0.5], align: ['left', 'left'] });
      }

    }

    // ---- TECHNICAL DEEP DIVE: security, a11y, errors, fonts, weight, freshness, files
    _technicalDeepDive(d, ex = {}) {
      const t = d.tech || {};
      this.addPage();
      this.section('Technical Deep Dive', { accent: this.c.violet, sub: 'Security, accessibility & file-level diagnostics' });

      // ---- Security -------------------------------------------------------
      this.eyebrow(this.margin, this.currentY, 'Security', this.c.muted); this.currentY += 12;
      const secChecks = t.security?.checks || [];
      if (secChecks.length) {
        const colW = (this.cw() - 20) / 2;
        let sa = this.currentY, sb = this.currentY;
        secChecks.forEach((c, i) => {
          const ok = !!c.passed;
          if (i % 2 === 0) sa = this.checkRow(this.margin, sa, colW, c.label, ok, c.detail && c.detail.length < 34 ? c.detail : null);
          else sb = this.checkRow(this.margin + colW + 20, sb, colW, c.label, ok, c.detail && c.detail.length < 34 ? c.detail : null);
        });
        this.currentY = Math.max(sa, sb) + 6;
      } else {
        this.currentY = this.paragraph(this.margin, this.currentY, this.cw(), 'Mixed content: none detected. CSP and Referrer-Policy meta tags were not found (may still be set via HTTP headers \u2014 see Domain & Network).', { size: 8.8, color: this.c.slate }) + 8;
      }

      // ---- Accessibility ----------------------------------------------------
      this.need(60);
      this.eyebrow(this.margin, this.currentY, 'Accessibility', this.c.muted); this.currentY += 12;
      const a11yChecks = t.accessibility?.checks || [];
      if (a11yChecks.length) {
        const colW = (this.cw() - 20) / 2;
        let aa = this.currentY, ab = this.currentY;
        a11yChecks.forEach((c, i) => {
          const ok = !!c.passed;
          if (i % 2 === 0) aa = this.checkRow(this.margin, aa, colW, c.label, ok, c.detail && c.detail.length < 34 ? c.detail : null);
          else ab = this.checkRow(this.margin + colW + 20, ab, colW, c.label, ok, c.detail && c.detail.length < 34 ? c.detail : null);
        });
        this.currentY = Math.max(aa, ab) + 6;
      } else {
        this.currentY = this.paragraph(this.margin, this.currentY, this.cw(), 'Accessibility data not available for this run.', { size: 8.8, color: this.c.slate }) + 8;
      }

      // ---- Errors & Broken Resources -----------------------------------------
      this.need(70);
      this.eyebrow(this.margin, this.currentY, 'Errors & broken resources', this.c.muted); this.currentY += 12;
      const errRows = [];
      (t.jsErrors?.issues || []).forEach(i => errRows.push([i.message, i.severity || 'info']));
      if ((d.links?.empty || 0) > 0) errRows.push([`${d.links.empty} empty/placeholder link(s)`, 'error']);
      if ((d.images?.missingAlt || 0) > 0) errRows.push([`${d.images.missingAlt} image(s) without alt text`, 'warning']);
      if ((d.headings?.counts?.h1 || 0) === 0) errRows.push(['No H1 tag found', 'error']);
      if ((d.headings?.counts?.h1 || 0) > 1) errRows.push([`Multiple H1 tags (${d.headings.counts.h1})`, 'warning']);
      if ((t.accessibility?.buttons?.withoutLabel || 0) > 0) errRows.push([`${t.accessibility.buttons.withoutLabel} button(s) without accessible name`, 'error']);
      if ((t.accessibility?.forms?.inputsWithoutLabel || 0) > 0) errRows.push([`${t.accessibility.forms.inputsWithoutLabel} form input(s) without label`, 'error']);
      if (!errRows.length) {
        this.currentY = this.paragraph(this.margin, this.currentY, this.cw(), '\u2713 No errors or broken resources detected.', { size: 9, color: this.c.green, bold: true }) + 8;
      } else {
        this.table(['Issue', 'Severity'], errRows.slice(0, 10), {
          widths: [this.cw() * 0.78, this.cw() * 0.22], align: ['left', 'center'],
          cellColor: (r, c, v) => c === 1 ? (v === 'error' ? this.c.red : v === 'warning' ? this.c.amber : this.c.muted) : this.c.slate,
          cellBold: (r, c) => c === 1
        });
      }

      // ---- Fonts & Page Weight side by side --------------------------------
      this.need(140);
      const fp = t.fontsPerf || {};
      const pw = t.pageWeight || {};
      this.eyebrow(this.margin, this.currentY, 'Fonts & CSS', this.c.muted); this.currentY += 12;
      this.table(['Metric', 'Value'], [
        ['Font families', String(fp.uniqueFontCount ?? '\u2014')],
        ['font-display: swap', `${fp.withSwap ?? 0}/${fp.fontFaceCount ?? 0}`],
        ['Preloaded fonts', String(fp.preloadedFonts ?? 0)],
        ['CSS files', String(fp.cssFiles ?? t.styles?.external ?? 0)],
        ['Inline styles', String(fp.inlineStyles ?? t.styles?.inline ?? 0)],
        ['Critical CSS', fp.hasCriticalCss ? 'Present' : 'Not detected']
      ], { widths: [this.cw() * 0.5, this.cw() * 0.5], align: ['left', 'left'] });

      this.need(140);
      this.eyebrow(this.margin, this.currentY, 'Page weight breakdown', this.c.muted); this.currentY += 12;
      const counts = pw.counts || {};
      this.table(['Resource', 'Size / Count'], [
        ['HTML', pw.html?.formatted || fmtBytes(t.htmlSize)],
        ['Inline CSS', pw.inlineCss?.formatted || '\u2014'],
        ['Inline JS', pw.inlineJs?.formatted || '\u2014'],
        ['CSS files', String(counts.extCss ?? t.styles?.external ?? 0)],
        ['JS files', String(counts.extJs ?? t.scripts?.external ?? 0)],
        ['Fonts', String(counts.fonts ?? 0)],
        ['Third-party resources', String(counts.thirdParty ?? 0)],
        ['Total resources', String(pw.totalResources ?? ((counts.extCss || 0) + (counts.extJs || 0) + (counts.images || 0) + (counts.fonts || 0)))]
      ], {
        widths: [this.cw() * 0.5, this.cw() * 0.5], align: ['left', 'left'],
        cellColor: (r, c, v) => (r === 6 && c === 1 && (counts.thirdParty || 0) > 10) ? this.c.amber : this.c.slate
      });

      // ---- Rendering & DOM + Content Freshness -----------------------------
      this.need(110);
      const advTech = t.advancedTechnical || {};
      const renderingType = advTech.rendering?.type || 'static';
      const renderLabel = renderingType === 'static' ? 'Static HTML' : renderingType === 'ssr' ? 'Server-Side Rendered' : 'Client-Side Rendered';
      this.eyebrow(this.margin, this.currentY, 'Rendering & DOM', this.c.muted); this.currentY += 12;
      let ra = this.currentY;
      ra = this.checkRow(this.margin, ra, this.cw(), 'Rendering type', true, renderLabel);
      ra = this.checkRow(this.margin, ra, this.cw(), 'DOM elements', (t.domElements || 0) <= 1500, fmtNum(t.domElements || 0));
      ra = this.checkRow(this.margin, ra, this.cw(), 'DOM depth', (t.domDepth || 0) <= 20, (t.domDepth || '\u2014') + ' levels');
      this.currentY = ra + 6;

      this.need(60);
      const cf = advTech.contentFreshness || {};
      this.eyebrow(this.margin, this.currentY, 'Content freshness', this.c.muted); this.currentY += 12;
      if (cf.publishDate || cf.modifiedDate) {
        this.currentY = this.checkRow(this.margin, this.currentY, this.cw(), 'Content date found', true, cf.publishDate || cf.modifiedDate) + 4;
      } else if ((cf.staleContentWarnings || []).length) {
        cf.staleContentWarnings.slice(0, 3).forEach(w => { this.currentY = this.checkRow(this.margin, this.currentY, this.cw(), w, false); });
      } else {
        this.currentY = this.checkRow(this.margin, this.currentY, this.cw(), 'No publication or modification date found', false) + 4;
      }

      // ---- Tracking & Analytics --------------------------------------------
      this.need(50);
      this.eyebrow(this.margin, this.currentY, 'Tracking & analytics', this.c.muted); this.currentY += 12;
      if ((t.trackingSignals || []).length) {
        let bx = this.margin, by = this.currentY;
        t.trackingSignals.forEach(sig => {
          const bw = this.badge(bx, by, sig, { bg: this.c.surface2, fg: this.c.slate, size: 7.6 });
          bx += bw + 6;
          if (bx > this.pageWidth - this.margin - 80) { bx = this.margin; by += 20; }
        });
        this.currentY = by + 24;
      } else {
        this.currentY = this.paragraph(this.margin, this.currentY, this.cw(), 'No tracking scripts detected.', { size: 8.8, color: this.c.slate }) + 8;
      }

      // ---- robots.txt / .htaccess / sitemap.xml snippets --------
      this._fileSnippet('robots.txt', ex.robotsTxt, true);
      this._fileSnippet('.htaccess', ex.htaccess?.text, ex.htaccess?.ok, ex.htaccess?.protected ? 'Protected (403) \u2014 good practice' : null);
      this._fileSnippet('sitemap.xml', ex.sitemap?.text, ex.sitemap?.ok);
    }

    // Renders a bordered "first ~50 lines" code-style snippet card for a text file.
    _fileSnippet(filename, text, found, note) {
      this.need(70);
      this.eyebrow(this.margin, this.currentY, filename, this.c.muted);
      const statusLabel = found ? 'Found' : 'Not found';
      const statusCol = found ? this.c.green : this.c.muted;
      this.text(this.pageWidth - this.margin, this.currentY, statusLabel, { size: 8, bold: true, color: statusCol, align: 'right' });
      this.currentY += 12;
      if (note) { this.text(this.margin, this.currentY, note, { size: 8, color: this.c.muted }); this.currentY += 12; }
      if (!found || !text) {
        this.rect(this.margin, this.currentY, this.cw(), 28, { fill: this.c.surface, stroke: this.c.hair, lw: 0.8, r: 8 });
        this.text(this.margin + 12, this.currentY + 17, `No ${filename} detected at site root.`, { size: 8.4, color: this.c.muted });
        this.currentY += 38;
        return;
      }
      const lines = String(text).split('\n').slice(0, 50);
      const lh = 10.5, padY = 10, padX = 10;
      const boxH = Math.min(220, lines.length * lh + padY * 2);
      this.need(boxH + 14);
      const by = this.currentY;
      this.rect(this.margin, by, this.cw(), boxH, { fill: [25, 28, 38], r: 8 });
      let ly = by + padY + 8;
      const maxLines = Math.floor((boxH - padY * 2) / lh);
      for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
        let ln = lines[i].replace(/\t/g, '  ');
        const maxw = this.cw() - padX * 2;
        while (this.measure(ln, 7.2, false) > maxw && ln.length > 4) ln = ln.slice(0, -2);
        this.text(this.margin + padX, ly, ln || ' ', { size: 7.2, color: [196, 204, 224] });
        ly += lh;
      }
      if (lines.length > maxLines) {
        this.text(this.margin + padX, by + boxH - 6, `\u2026 ${lines.length - maxLines} more line(s) truncated`, { size: 7, color: [148, 163, 184] });
      }
      this.currentY = by + boxH + 14;
    }

    // ---- DOMAIN & NETWORK: RDAP, IP/host, DNS, HTTP headers, SSL certs ----
    _domainNetwork(d, ex = {}, host) {
      this.addPage();
      this.section('Domain & Network', { accent: this.c.violet, sub: 'Registration, hosting & transport security' });

      // ---- Domain information (RDAP) ---------------------------------------
      const info = ex.domainInfo;
      this.eyebrow(this.margin, this.currentY, 'Domain information', this.c.muted); this.currentY += 12;
      if (info && info.ok !== false) {
        const rows = [['Domain', (host || '').toUpperCase()]];
        if (info.registrar) rows.push(['Registrar', info.registrar]);
        if (info.createdDate) {
          const created = new Date(info.createdDate);
          const diffMonths = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
          const ageY = Math.floor(diffMonths / 12), ageM = Math.floor(diffMonths % 12);
          rows.push(['Age', ageY >= 1 ? `${ageY} year(s) ${ageM} month(s)` : `${Math.floor(diffMonths)} month(s)`]);
          rows.push(['Created', created.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })]);
        }
        if (info.expirationDate) {
          const exp = new Date(info.expirationDate);
          const dLeft = Math.round((exp - Date.now()) / 86400000);
          rows.push(['Expires', exp.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) + (dLeft < 90 ? ` (${dLeft}d left)` : '')]);
        }
        if (info.updatedDate) rows.push(['Updated', new Date(info.updatedDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })]);
        if (info.cdnHint) rows.push(['DNS provider', info.cdnHint]);
        if (info.nameservers?.length) rows.push(['Nameservers', info.nameservers.map(n => n.toUpperCase()).join(', ')]);
        this.table(['Property', 'Value'], rows, { widths: [this.cw() * 0.3, this.cw() * 0.7], align: ['left', 'left'] });
      } else {
        this.currentY = this.paragraph(this.margin, this.currentY, this.cw(), 'Domain registration data was not available for this run.', { size: 8.8, color: this.c.slate }) + 8;
      }

      // ---- IP & hosting info -------------------------------------------------
      this.need(100);
      const ip = ex.ipGeo;
      this.eyebrow(this.margin, this.currentY, 'IP & hosting info', this.c.muted); this.currentY += 12;
      if (ip && ip.ok !== false) {
        const rows = [
          ['IP address', ip.ip], ['Country', ip.country], ['Region', ip.region], ['City', ip.city],
          ['ISP', ip.isp], ['Organization', ip.org], ['ASN', ip.asn], ['Timezone', ip.timezone]
        ].filter(([, v]) => v);
        this.table(['Property', 'Value'], rows, { widths: [this.cw() * 0.3, this.cw() * 0.7], align: ['left', 'left'] });
      } else {
        this.currentY = this.paragraph(this.margin, this.currentY, this.cw(), 'IP geolocation data was not available for this run.', { size: 8.8, color: this.c.slate }) + 8;
      }

      // ---- DNS records --------------------------------------------------------
      this.need(110);
      this.eyebrow(this.margin, this.currentY, 'DNS records', this.c.muted); this.currentY += 12;
      const dns = ex.dns;
      if (dns) {
        const order = ['A', 'MX', 'TXT', 'NS', 'CNAME'];
        const rows = [];
        order.forEach(type => {
          const recs = dns[type] || [];
          recs.slice(0, 4).forEach(r => rows.push([type, r.name || '\u2014', (r.data || '').length > 46 ? r.data.slice(0, 44) + '\u2026' : (r.data || '')]));
        });
        if (rows.length) {
          this.table(['Type', 'Name', 'Value'], rows.slice(0, 16), {
            widths: [this.cw() * 0.12, this.cw() * 0.3, this.cw() * 0.58], align: ['left', 'left', 'left']
          });
        } else {
          this.currentY = this.paragraph(this.margin, this.currentY, this.cw(), 'No DNS records returned.', { size: 8.8, color: this.c.slate }) + 8;
        }
      } else {
        this.currentY = this.paragraph(this.margin, this.currentY, this.cw(), 'DNS lookup data was not available for this run.', { size: 8.8, color: this.c.slate }) + 8;
      }

      // ---- HTTP headers & security ---------------------------------------
      this.need(120);
      this.eyebrow(this.margin, this.currentY, 'HTTP headers & security', this.c.muted); this.currentY += 12;
      const hdr = ex.httpHeaders;
      if (hdr && (hdr.security || []).length) {
        const sec = hdr.security;
        const present = sec.filter(s => s.present).length;
        this.text(this.margin, this.currentY, `Security headers score: ${Math.round((present / sec.length) * 100)}% (${present}/${sec.length} present)`, { size: 8.6, color: this.c.slate });
        this.currentY += 14;
        const colW = (this.cw() - 20) / 2;
        let ha = this.currentY, hb = this.currentY;
        sec.forEach((s, i) => {
          if (i % 2 === 0) ha = this.checkRow(this.margin, ha, colW, s.header, !!s.present);
          else hb = this.checkRow(this.margin + colW + 20, hb, colW, s.header, !!s.present);
        });
        this.currentY = Math.max(ha, hb) + 6;
      } else {
        this.currentY = this.paragraph(this.margin, this.currentY, this.cw(), 'HTTP header data was not available for this run.', { size: 8.8, color: this.c.slate }) + 8;
      }

      // ---- SSL certificate transparency --------------------------------------
      this.need(90);
      this.eyebrow(this.margin, this.currentY, 'SSL certificate transparency', this.c.muted); this.currentY += 12;
      const cert = ex.cert;
      const certEntries = cert?.certificates || cert?.entries || (Array.isArray(cert) ? cert : null);
      if (certEntries && certEntries.length) {
        const rows = certEntries.slice(0, 6).map(c => [
          c.issuer_name || c.issuer || '\u2014',
          c.name_value || c.common_name || '\u2014',
          (c.not_after || c.expiry || '').toString().slice(0, 10)
        ]);
        this.table(['Issuer', 'Name', 'Expires'], rows, {
          widths: [this.cw() * 0.3, this.cw() * 0.46, this.cw() * 0.24], align: ['left', 'left', 'left']
        });
        if (certEntries.length > 6) {
          this.text(this.margin, this.currentY, `+ ${certEntries.length - 6} more certificate(s) on record`, { size: 8, color: this.c.muted });
          this.currentY += 16;
        }
      } else {
        this.currentY = this.paragraph(this.margin, this.currentY, this.cw(), 'Certificate transparency data was not available for this run.', { size: 8.8, color: this.c.slate }) + 8;
      }
    }

    // ---- GEO / AEO ------------------------------------------------------
    _geoAeo(d, bots, ex = {}) {
      this.addPage();
      this.section('Generative Engine Optimization (GEO / AEO)', { accent: this.c.teal, sub: 'Getting cited by AI answer engines' });
      const g = d.geo || {};
      // intro
      this.currentY = this.paragraph(this.margin, this.currentY, this.cw(),
        'GEO measures how likely AI engines \u2014 ChatGPT, Gemini, Perplexity, Claude and AI Overviews \u2014 are to surface and cite this page. It rewards extractable facts, clear structure, machine-readable schema, and demonstrable expertise (E-E-A-T).',
        { size: 9, color: this.c.slate, lh: 12.5 }) + 16;

      // overall + pillars
      const py = this.currentY;
      this.ringGauge(this.margin + 40, py + 44, 36, 9, (g.geoScore || 0) / 100, { color: this.c.teal, track: this.c.surface2 });
      this.text(this.margin + 40, py + 49, String(g.geoScore || 0), { size: 22, bold: true, color: this.c.teal, align: 'center' });
      this.text(this.margin + 40, py + 64, 'GEO', { size: 8, bold: true, color: this.c.muted, align: 'center' });

      const pillars = g.pillars || {};
      const pl = [
        ['Citability', pillars.citability || 0],
        ['E-E-A-T', pillars.eeat || 0],
        ['Structured data', pillars.structured || 0],
        ['Technical AI access', pillars.techAI || 0],
        ['Multi-modal', pillars.multiModal || 0]
      ];
      const barX = this.margin + 100, barW = this.cw() - 100;
      let by = py + 6;
      pl.forEach(p => { by = this.bar(barX, by, barW, p[0], (p[1] || 0) / 100, (p[1] || 0) + '/100', this.c.teal); });
      this.currentY = Math.max(py + 100, by) + 8;

      // Page type detection
      if (g.pageType) {
        this.need(40);
        const x = this.margin, y = this.currentY;
        this.rect(x, y, this.cw(), 30, { fill: this.c.tealSoft, r: 8 });
        this.text(x + 14, y + 19, 'Detected page type:', { size: 8.6, color: this.c.slate });
        this.text(x + 130, y + 19, g.pageType, { size: 9.4, bold: true, color: this.c.teal });
        this.currentY += 42;
      }

      // E-E-A-T checklist
      this.need(90);
      this.eyebrow(this.margin, this.currentY, 'E-E-A-T signals', this.c.muted); this.currentY += 14;
      const e = g.eeat || {};
      const colW = (this.cw() - 20) / 2;
      let ya = this.currentY, yb = this.currentY;
      ya = this.checkRow(this.margin, ya, colW, 'Author / byline present', !!e.hasAuthor);
      ya = this.checkRow(this.margin, ya, colW, 'Published / updated date', !!e.hasDate);
      ya = this.checkRow(this.margin, ya, colW, 'Served over HTTPS', !!e.hasHttps);
      const x2 = this.margin + colW + 20;
      yb = this.checkRow(x2, yb, colW, 'Citations / sources', !!e.hasCite);
      yb = this.checkRow(x2, yb, colW, 'External references', (e.hasExternalRefs || 0) > 0, (e.hasExternalRefs || 0) + ' links');
      yb = this.checkRow(x2, yb, colW, 'Schema markup present', (g.structured?.schemas || []).length > 0, (g.structured?.schemas || []).length + ' blocks');
      this.currentY = Math.max(ya, yb) + 12;

      // schema list
      const schemas = g.structured?.schemas || [];
      this.eyebrow(this.margin, this.currentY, 'Structured data detected', this.c.muted); this.currentY += 12;
      if (schemas.length) {
        const types = {};
        schemas.forEach(s => { const t = s.type || 'Unknown'; types[t] = (types[t] || 0) + 1; });
        let bx = this.margin, by2 = this.currentY;
        Object.entries(types).forEach(([t, n]) => {
          const label = n > 1 ? `${t} \u00d7${n}` : t;
          const bw = this.badge(bx, by2, label, { bg: this.c.tealSoft, fg: this.c.teal, size: 8 });
          bx += bw + 8;
          if (bx > this.pageWidth - this.margin - 80) { bx = this.margin; by2 += 22; }
        });
        this.currentY = by2 + 26;
      } else {
        this.text(this.margin, this.currentY + 8, 'No schema.org structured data found \u2014 a major GEO gap.', { size: 8.8, color: this.c.amber, bold: true });
        this.currentY += 22;
      }

      // Schema coverage suggestions (recommended types missing for this page type)
      const sc = ex.schemaCoverage;
      if (sc && (sc.mustMissing.length || sc.niceMissing.length)) {
        this.need(60);
        this.eyebrow(this.margin, this.currentY, `Schema coverage suggestions \u2014 for ${sc.pageType} pages`, this.c.muted); this.currentY += 12;
        sc.mustMissing.forEach(ty => { this.currentY = this.checkRow(this.margin, this.currentY, this.cw(), ty + ' schema', false, 'Must-have'); });
        sc.niceMissing.forEach(ty => { this.currentY = this.checkRow(this.margin, this.currentY, this.cw(), ty + ' schema', false, 'Nice-to-have'); });
        this.currentY += 4;
      } else if (sc) {
        this.need(26);
        this.currentY = this.paragraph(this.margin, this.currentY, this.cw(), `\u2713 All recommended schema types for ${sc.pageType} pages are present.`, { size: 8.8, color: this.c.green, bold: true }) + 10;
      }

      // AI crawler access
      if (bots) {
        this.need(60);
        this.eyebrow(this.margin, this.currentY, 'AI crawler access (robots.txt)', this.c.muted); this.currentY += 12;
        const tw = (this.cw() - 2 * 12) / 3;
        const cells = [
          ['Allowed', bots.allowed ?? 0, this.c.green, this.c.greenSoft],
          ['Partial', bots.partial ?? 0, this.c.amber, this.c.amberSoft],
          ['Blocked', bots.blocked ?? 0, this.c.red, this.c.redSoft]
        ];
        cells.forEach((c, i) => {
          const x = this.margin + i * (tw + 12), y = this.currentY;
          this.rect(x, y, tw, 50, { fill: c[3], r: 10 });
          this.text(x + 14, y + 30, String(c[1]), { size: 20, bold: true, color: c[2] });
          this.eyebrow(x + 14, y + 42, c[0] + ' bots', c[2]);
        });
        this.currentY += 64;
      }

      // AI crawler permissions — per-bot table with directive
      if ((ex.crawlerPerms || []).length) {
        this.need(80);
        this.eyebrow(this.margin, this.currentY, 'AI crawler permissions (per-bot)', this.c.muted); this.currentY += 12;
        const rows = ex.crawlerPerms.map(b => [b.name, b.status.label]);
        this.table(['Crawler', 'Status'], rows, {
          widths: [this.cw() * 0.65, this.cw() * 0.35], align: ['left', 'center'],
          cellColor: (r, c, v) => c === 1 ? (v === 'Allowed' ? this.c.green : v === 'Blocked' ? this.c.red : this.c.amber) : this.c.slate,
          cellBold: (r, c) => c === 1
        });
      }

      // sitemap status
      this.need(60);
      this.eyebrow(this.margin, this.currentY, 'Sitemap status', this.c.muted); this.currentY += 12;
      let la = this.currentY;
      la = this.checkRow(this.margin, la, this.cw(), 'sitemap.xml present', !!ex.sitemap?.ok, ex.sitemap?.ok ? 'Found' : 'Not found');
      this.currentY = la + 6;

      // AI Overview / SGE likelihood
      const aio = ex.aiOverview;
      if (aio) {
        this.need(110);
        this.eyebrow(this.margin, this.currentY, 'AI Overview / SGE likelihood', this.c.muted); this.currentY += 14;
        const lvlCol = aio.pct >= 75 ? this.c.green : aio.pct >= 50 ? this.c.amber : this.c.red;
        this.text(this.margin, this.currentY, `${aio.level} likelihood`, { size: 11, bold: true, color: lvlCol });
        this.text(this.pageWidth - this.margin, this.currentY, `${aio.pct}%`, { size: 11, bold: true, color: lvlCol, align: 'right' });
        this.currentY += 8;
        this.rect(this.margin, this.currentY, this.cw(), 8, { fill: this.c.surface2, r: 4 });
        this.rect(this.margin, this.currentY, this.cw() * Math.max(0, Math.min(1, aio.pct / 100)), 8, { fill: lvlCol, r: 4 });
        this.currentY += 20;
        const colWa = (this.cw() - 20) / 2;
        let pa = this.currentY, pb = this.currentY;
        aio.signals.forEach((s, i) => {
          if (i % 2 === 0) pa = this.checkRow(this.margin, pa, colWa, s.label, s.met, '+' + s.pts);
          else pb = this.checkRow(this.margin + colWa + 20, pb, colWa, s.label, s.met, '+' + s.pts);
        });
        this.currentY = Math.max(pa, pb) + 8;
      }

      // GEO recommendations
      this.need(70);
      this.eyebrow(this.margin, this.currentY, 'How to win AI citations', this.c.teal); this.currentY += 14;
      const recs = this._geoRecs(d);
      recs.forEach((t, i) => {
        this.need(30);
        const x = this.margin, y = this.currentY;
        this.circle(x + 9, y + 9, 9, { fill: this.c.tealSoft });
        this.text(x + 9, y + 12.5, String(i + 1), { size: 9, bold: true, color: this.c.teal, align: 'center' });
        this.text(x + 26, y + 7, t.title, { size: 9.4, bold: true, color: this.c.ink });
        this.currentY = this.paragraph(x + 26, y + 11, this.cw() - 30, t.body, { size: 8.6, color: this.c.slate, lh: 11.3 }) + 8;
      });
    }

    // ---- GEO DEEP DIVE: entities, AI crawler view, citability deep dive, ---
    // ---- content gaps, indexation, topical depth, AI memo -----------------
    _geoDeepDive(d, ex = {}) {
      const g = d.geo || {};
      this.addPage();
      this.section('GEO Deep Dive', { accent: this.c.teal, sub: 'Entities, crawler visibility & AI-readiness signals' });

      // ---- Entities ---------------------------------------------------------
      const ent = g.entities?.entities || [];
      this.eyebrow(this.margin, this.currentY, 'Entities detected', this.c.muted); this.currentY += 12;
      if (ent.length) {
        let bx = this.margin, by = this.currentY;
        ent.slice(0, 16).forEach(e => {
          const label = e.mentions ? `${e.name} \u00d7${e.mentions}` : e.name;
          const bw = this.badge(bx, by, label, { bg: this.c.surface2, fg: this.c.slate, size: 7.6 });
          bx += bw + 6;
          if (bx > this.pageWidth - this.margin - 80) { bx = this.margin; by += 20; }
        });
        this.currentY = by + 26;
      } else {
        this.currentY = this.paragraph(this.margin, this.currentY, this.cw(), 'No named entities (people, organizations, products) were detected.', { size: 8.8, color: this.c.slate }) + 8;
      }

      // ---- Citability details: structural signal counts ---------------------
      const cd = g.citabilityDetails || {};
      this.need(100);
      this.eyebrow(this.margin, this.currentY, 'Citability structure', this.c.muted); this.currentY += 12;
      this.table(['Signal', 'Count'], [
        ['H2 headings', String(cd.h2Count || 0)],
        ['H3 headings', String(cd.h3Count || 0)],
        ['Lists', String(cd.listsCount || 0)],
        ['Tables', String(cd.tablesCount || 0)],
        ['Statistics cited', String(cd.statsCount || 0)],
        ['Definitions', String(cd.definitionsCount || 0)],
        ['Q&A patterns', String(cd.questionsCount || 0)],
        ['Short, snippable paragraphs', String(cd.shortParagraphs || 0)]
      ], { widths: [this.cw() * 0.65, this.cw() * 0.35], align: ['left', 'center'] });

      // ---- AI Citability Signals Deep Dive (full signal breakdown) ----------
      const full = g.citabilityFull;
      if (full && full.available) {
        this.need(90);
        const score = full.score || 0;
        this.eyebrow(this.margin, this.currentY, `Citability signals deep dive \u2014 ${score}/100`, this.c.muted); this.currentY += 14;
        (full.signals || []).slice(0, 10).forEach(s => {
          this.need(22);
          const extra = s.count != null ? ` (${s.count}${s.attributed != null ? `, ${s.attributed} attributed` : ''})` : '';
          this.currentY = this.checkRow(this.margin, this.currentY, this.cw(), s.label + extra, s.points >= 8, '+' + s.points);
        });
        this.currentY += 6;
      }

      // ---- Passage Snippet Optimizer -----------------------------------------
      const pl = cd.passageLength;
      if (pl && pl.total) {
        this.need(80);
        this.eyebrow(this.margin, this.currentY, 'Passage snippet optimizer', this.c.muted); this.currentY += 12;
        this.table(['Metric', 'Value'], [
          ['H2 sections', String(pl.total || 0)],
          ['Ideal length (100\u2013450w)', String(pl.ideal || 0)],
          ['Too long', String(pl.long || 0)],
          ['Too short', String(pl.short || 0)]
        ], { widths: [this.cw() * 0.6, this.cw() * 0.4], align: ['left', 'center'] });
        if ((pl.flagged || []).length) {
          this.need(40);
          pl.flagged.slice(0, 5).forEach(f => {
            this.currentY = this.checkRow(this.margin, this.currentY, this.cw(), (f.text || '(untitled section)').slice(0, 60), false, `${f.type === 'short' ? 'Too short' : 'Too long'} \u2014 ${f.words}w`);
          });
          this.currentY += 4;
        }
      }

      // ---- Answer-first opening ------------------------------------------
      const af = cd.answerFirst;
      if (af) {
        this.need(50);
        this.eyebrow(this.margin, this.currentY, 'Answer-first opening', this.c.muted); this.currentY += 12;
        this.currentY = this.checkRow(this.margin, this.currentY, this.cw(), 'Opens with a direct 15\u201355 word answer', !!af.hasAnswerFirstOpening, af.words ? `${af.words}w / ${af.sentences}s` : null) + 6;
        if (af.preview) {
          this.currentY = this.paragraph(this.margin, this.currentY, this.cw(), '\u201c' + af.preview.slice(0, 200) + (af.preview.length > 200 ? '\u2026' : '') + '\u201d', { size: 8.2, color: this.c.muted, lh: 11 }) + 10;
        }
      }

      // ---- Topical Authority Depth -------------------------------------------
      const td = ex.topicalDepth;
      if (td) {
        this.need(110);
        this.eyebrow(this.margin, this.currentY, `Topical authority depth \u2014 ${td.depthScore}/100`, this.c.muted); this.currentY += 12;
        this.table(['Dimension', 'Score', 'Detail'], [
          ['Heading coverage', td.headingScore + '/100', `${td.h2Count} H2 + ${td.h3Count} H3 / ${td.wordCount}w`],
          ['Entity density', td.entityScore + '/100', `${td.entityCount} entities (${td.linkedCount} linked to schema)`]
        ], {
          widths: [this.cw() * 0.32, this.cw() * 0.18, this.cw() * 0.5], align: ['left', 'center', 'left'],
          cellColor: (r, c, v) => c === 1 ? this.toneFor(parseInt(v)) : this.c.slate, cellBold: (r, c) => c === 1
        });
        if (ex.topKeywords?.length) {
          this.need(30);
          this.text(this.margin, this.currentY, 'Top keywords: ', { size: 8.4, bold: true, color: this.c.slate });
          this.text(this.margin + 68, this.currentY, ex.topKeywords.slice(0, 8).join(', '), { size: 8.4, color: this.c.slate });
          this.currentY += 18;
        }
      }

      // ---- AI Crawler Deep View (hidden content) -----------------------------
      const cv = g.aiCrawlerView;
      if (cv && cv.available) {
        this.need(100);
        this.eyebrow(this.margin, this.currentY, `AI crawler deep view \u2014 ${cv.visibleRatio}% visible`, this.c.muted); this.currentY += 12;
        this.table(['Signal', 'Value'], [
          ['Visible words', fmtNum(cv.visibleWordCount || 0)],
          ['Hidden blocks', String(cv.hiddenElements || 0)],
          ['Lazy images', String(cv.lazyImages || 0)],
          ['Iframes', String(cv.iframeCount || 0)],
          ['Shadow DOM elements', String(cv.shadowDomCount || 0)],
          ['JS-only content blocks', String(cv.jsOnlyContent || 0)]
        ], { widths: [this.cw() * 0.6, this.cw() * 0.4], align: ['left', 'center'] });
        if ((cv.hiddenSelectors || []).length) {
          this.need(40);
          this.currentY = this.paragraph(this.margin, this.currentY, this.cw(), `${cv.hiddenSelectors.length} hidden content sample(s) detected (e.g. accordions, tabs, lazy panels) \u2014 review in the extension for full details and "find on page".`, { size: 8, color: this.c.amber, lh: 11 }) + 8;
        }
      }

      // ---- Content Gap Detector -----------------------------------------------
      const gaps = g.contentGaps;
      if (gaps) {
        this.need(70);
        const gapList = gaps.gaps || [];
        this.eyebrow(this.margin, this.currentY, gapList.length ? `Content gaps \u2014 ${gapList.length} found` : 'Content gaps', this.c.muted); this.currentY += 12;
        if (gapList.length) {
          gapList.slice(0, 10).forEach(gp => {
            this.currentY = this.checkRow(this.margin, this.currentY, this.cw(), gp.section, false, gp.detail ? gp.detail.slice(0, 28) : null);
          });
          this.currentY += 4;
        } else {
          this.currentY = this.paragraph(this.margin, this.currentY, this.cw(), '\u2713 No obvious content gaps detected for this page type.', { size: 8.8, color: this.c.green, bold: true }) + 8;
        }
      }

      // ---- Indexation & Snippet Control ---------------------------------------
      const idx = g.indexationHints;
      if (idx) {
        this.need(70);
        const issues = idx.issues || [];
        this.eyebrow(this.margin, this.currentY, issues.length ? `Indexation & snippet control \u2014 ${issues.length} issue(s)` : 'Indexation & snippet control', this.c.muted); this.currentY += 12;
        if (issues.length) {
          issues.slice(0, 8).forEach(i => {
            this.currentY = this.checkRow(this.margin, this.currentY, this.cw(), i.message, false, i.severity);
          });
          this.currentY += 4;
        } else {
          this.currentY = this.paragraph(this.margin, this.currentY, this.cw(), '\u2713 No canonical, noindex or nosnippet conflicts detected.', { size: 8.8, color: this.c.green, bold: true }) + 8;
        }
      }

      // ---- AI Keyword Gap -----------------------------------------------------
      if ((ex.keywordGap || []).length) {
        this.need(60);
        const found = ex.keywordGap.filter(k => k.hit).length;
        this.eyebrow(this.margin, this.currentY, `AI keyword gap \u2014 ${found}/${ex.keywordGap.length}`, this.c.muted); this.currentY += 12;
        let bx = this.margin, by3 = this.currentY;
        ex.keywordGap.forEach(k => {
          const bw = this.badge(bx, by3, k.kw, { bg: k.hit ? this.c.greenSoft : this.c.redSoft, fg: k.hit ? this.c.green : this.c.red, size: 7.4 });
          bx += bw + 6;
          if (bx > this.pageWidth - this.margin - 80) { bx = this.margin; by3 += 20; }
        });
        this.currentY = by3 + 26;
      }

      // ---- AI Page Memo / Brief -----------------------------------------------
      const memo = ex.aiMemo;
      if (memo) {
        this.need(140);
        this.eyebrow(this.margin, this.currentY, 'AI page memo / brief', this.c.muted); this.currentY += 12;
        const lines = [
          `Page: ${memo.title}`,
          memo.url ? `URL: ${memo.url}` : null,
          `Type: ${memo.pageType} | ~${memo.wordCount} words`,
          `H1: ${memo.h1}`,
          memo.topKeywords?.length ? `Top topics: ${memo.topKeywords.join(', ')}` : null,
          memo.entities?.length ? `Key entities: ${memo.entities.join(', ')}` : null,
          memo.schemas?.length ? `Structured data: ${memo.schemas.join(', ')}` : null,
          `E-E-A-T: Author ${memo.hasAuthor ? '\u2713' : '\u2717'} | Date ${memo.hasDate ? '\u2713' : '\u2717'} | HTTPS ${memo.hasHttps ? '\u2713' : '\u2717'}`,
          `GEO score: ${memo.geoScore}/100`
        ].filter(Boolean);
        const boxH = lines.length * 13 + 20;
        this.need(boxH + 10);
        const by4 = this.currentY;
        this.rect(this.margin, by4, this.cw(), boxH, { fill: this.c.surface, stroke: this.c.hair, lw: 0.8, r: 8 });
        let ly = by4 + 16;
        lines.forEach(ln => {
          let txt = ln;
          const maxw = this.cw() - 24;
          while (this.measure(txt, 8, false) > maxw && txt.length > 4) txt = txt.slice(0, -2);
          if (txt !== ln) txt = txt.replace(/\s*$/, '') + '\u2026';
          this.text(this.margin + 12, ly, txt, { size: 8, color: this.c.slate });
          ly += 13;
        });
        this.currentY = by4 + boxH + 14;
      }
    }

    // ---- IMAGES & LINKS -------------------------------------------------
    _imagesLinks(d, ex) {
      this.addPage();
      this.section('Images & Links', { accent: this.c.violet, sub: 'Media accessibility & link profile' });
      const im = d.images || {}, ln = d.links || {};

      this.eyebrow(this.margin, this.currentY, 'Image audit', this.c.muted); this.currentY += 12;
      this.table(['Metric', 'Value', 'Note'], [
        ['Total images', String(im.total || 0), ''],
        ['With alt text', String(im.withAlt || 0), im.total ? Math.round((im.withAlt / im.total) * 100) + '% covered' : ''],
        ['Missing alt text', String(im.missingAlt || 0), (im.missingAlt || 0) > 0 ? 'Fix for SEO + a11y' : 'Good'],
        ['Oversized', String(im.oversized || 0), (im.oversized || 0) > 0 ? 'Compress / resize' : 'Good'],
        ['Above-fold lazy', String(im.aboveFoldLazy || 0), (im.aboveFoldLazy || 0) > 0 ? 'Hurts LCP' : 'Good'],
        ['Duplicate alts', String(im.duplicateAlts || 0), '']
      ], {
        widths: [this.cw() * 0.4, this.cw() * 0.2, this.cw() * 0.4], align: ['left', 'center', 'right'],
        cellColor: (r, c, v) => c === 2 ? (/Good|covered/.test(String(v)) ? this.c.green : /Fix|Compress|Hurts/.test(String(v)) ? this.c.amber : this.c.slate) : this.c.slate
      });

      // Image inventory (KWScanner-style list)
      const imgList = Array.isArray(im.images) ? im.images : [];
      if (imgList.length) {
        this.need(80);
        this.eyebrow(this.margin, this.currentY, 'Images list', this.c.muted); this.currentY += 12;
        this.table(['Source', 'Alt text', 'Format'],
          imgList.slice(0, 25).map(img => [
            (img.src || '').replace(/^https?:\/\//, '').slice(0, 48) || '\u2014',
            (img.alt && String(img.alt).trim()) ? String(img.alt).trim().slice(0, 28) : (img.isDecorative ? '(decorative)' : '(missing)'),
            (img.format || '').toUpperCase() || '\u2014'
          ]), {
          widths: [this.cw() * 0.5, this.cw() * 0.32, this.cw() * 0.18],
          align: ['left', 'left', 'center'],
          cellColor: (r, c, v) => (c === 1 && (v === '(missing)')) ? this.c.amber : this.c.slate
        });
      }

      this.need(120);
      this.eyebrow(this.margin, this.currentY, 'Link profile', this.c.muted); this.currentY += 12;
      this.table(['Type', 'Count', 'Note'], [
        ['Total links', String(ln.total || 0), ''],
        ['Internal', String(ln.internal || 0), 'Spreads link equity'],
        ['External', String(ln.external || 0), ''],
        ['Nofollow', String(ln.nofollow || 0), ''],
        ['Empty / broken', String(ln.empty || 0), (ln.empty || 0) > 0 ? 'Fix hrefs' : 'Good'],
        ['Generic anchors', String(ln.genericAnchor || 0), (ln.genericAnchor || 0) > 3 ? 'Use descriptive text' : 'Good']
      ], {
        widths: [this.cw() * 0.32, this.cw() * 0.18, this.cw() * 0.5], align: ['left', 'center', 'right'],
        cellColor: (r, c, v) => c === 2 ? (/Good/.test(String(v)) ? this.c.green : /Fix|Use/.test(String(v)) ? this.c.amber : this.c.slate) : this.c.slate
      });

      // Links table: prefer status-checked rows; else list from page links
      const statusRows = (ex && Array.isArray(ex.linkStatusRows)) ? ex.linkStatusRows : [];
      const linkList = Array.isArray(ln.links) ? ln.links : [];
      if (statusRows.length) {
        this.need(100);
        this.eyebrow(this.margin, this.currentY, 'Links (with HTTP status)', this.c.muted);
        this.currentY += 12;
        const okN = statusRows.filter(r => r.status >= 200 && r.status < 300).length;
        const errN = statusRows.filter(r => !r.status || r.status >= 400).length;
        this.paragraph(this.margin, this.currentY, this.cw(),
          'Checked ' + statusRows.length + ' links — ' + okN + ' OK (2xx), ' + errN + ' errors (4xx/5xx/ERR).',
          { color: this.c.slate, lh: 12 });
        this.currentY += 6;
        this.table(['Anchor', 'URL', 'Type', 'Status'], statusRows.slice(0, 50).map(r => [
          (r.text || '').slice(0, 22) || (r.img ? '[Image]' : '(no text)'),
          (r.url || '').replace(/^https?:\/\//, '').slice(0, 40),
          r.internal ? 'Internal' : 'External',
          r.status ? String(r.status) : 'ERR'
        ]), {
          widths: [this.cw() * 0.22, this.cw() * 0.46, this.cw() * 0.16, this.cw() * 0.16],
          align: ['left', 'left', 'center', 'center'],
          cellColor: (row, c, v) => {
            if (c !== 3) return this.c.slate;
            const s = parseInt(v, 10);
            if (s >= 200 && s < 300) return this.c.green;
            if (s >= 300 && s < 400) return this.c.violet;
            return this.c.amber;
          }
        });
      } else if (linkList.length) {
        this.need(100);
        this.eyebrow(this.margin, this.currentY, 'Links sample (run Check Status in Links tab for HTTP codes)', this.c.muted);
        this.currentY += 12;
        this.table(['Anchor', 'URL', 'Type', 'Rel'], linkList.slice(0, 40).map(l => [
          (l.text || '').slice(0, 22) || (l.imgInside ? '[Image]' : '(no text)'),
          (l.url || '').replace(/^https?:\/\//, '').slice(0, 40),
          l.isInternal ? 'Internal' : 'External',
          l.isNofollow ? 'nofollow' : (l.isSponsored ? 'sponsored' : 'follow')
        ]), {
          widths: [this.cw() * 0.22, this.cw() * 0.46, this.cw() * 0.16, this.cw() * 0.16],
          align: ['left', 'left', 'center', 'center']
        });
      }
    }

    // ---- TRAFFIC (SimilarWeb) -------------------------------------------
    _traffic(tr) {
      this.addPage();
      this.section('Traffic Overview', { accent: this.c.teal, sub: 'Estimated visits from ' + (tr.source || 'SimilarWeb') });
      const fmt = (n) => {
        if (n == null || n === '') return '\u2014';
        const num = Number(n);
        if (!Number.isFinite(num)) return String(n);
        if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
        if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
        return String(Math.round(num));
      };
      const fmtRank = (n) => {
        if (n == null || n === '') return '\u2014';
        const num = Number(n);
        if (!Number.isFinite(num) || num <= 0) return '\u2014';
        return '#' + Math.round(num).toLocaleString();
      };
      const bounce = tr.bounceRate != null
        ? ((tr.bounceRate <= 1 ? tr.bounceRate * 100 : tr.bounceRate).toFixed(1) + '%')
        : '\u2014';
      const dur = (() => {
        if (tr.timeOnSite == null) return '\u2014';
        const s = Number(tr.timeOnSite);
        if (!Number.isFinite(s)) return '\u2014';
        const m = Math.floor(s / 60);
        const sec = Math.round(s % 60);
        return m + ':' + String(sec).padStart(2, '0');
      })();

      this.table(['Metric', 'Value', 'Note'], [
        ['Monthly visits', fmt(tr.visits), 'Latest month estimate'],
        ['Global rank', fmtRank(tr.globalRank), 'Worldwide'],
        ['Country rank', fmtRank(tr.countryRank), ''],
        ['Category rank', fmtRank(tr.categoryRank), tr.category ? String(tr.category).replace(/_/g, ' ').slice(0, 28) : ''],
        ['Bounce rate', bounce, ''],
        ['Pages / visit', tr.pagePerVisit != null ? Number(tr.pagePerVisit).toFixed(2) : '\u2014', ''],
        ['Avg. duration', dur, 'mm:ss']
      ], {
        widths: [this.cw() * 0.35, this.cw() * 0.25, this.cw() * 0.4],
        align: ['left', 'center', 'right']
      });

      // Monthly trend table
      if (tr.monthlyVisits && tr.monthlyVisits.length) {
        this.need(80);
        this.eyebrow(this.margin, this.currentY, 'Monthly visits trend (' + tr.monthlyVisits.length + ' months)', this.c.muted);
        this.currentY += 12;
        const rows = tr.monthlyVisits.map(m => [
          String(m.month || '').slice(0, 7),
          fmt(m.visits)
        ]);
        this.table(['Month', 'Visits'], rows, {
          widths: [this.cw() * 0.4, this.cw() * 0.6],
          align: ['left', 'right']
        });
      }

      // Traffic sources
      if (tr.trafficSources && typeof tr.trafficSources === 'object') {
        const entries = Object.entries(tr.trafficSources)
          .filter(([, v]) => v != null && Number(v) > 0)
          .sort((a, b) => Number(b[1]) - Number(a[1]));
        if (entries.length) {
          this.need(80);
          this.eyebrow(this.margin, this.currentY, 'Traffic sources', this.c.muted);
          this.currentY += 12;
          this.table(['Channel', 'Share'], entries.map(([name, val]) => {
            const pct = Number(val) <= 1 ? (Number(val) * 100).toFixed(1) + '%' : Number(val).toFixed(1) + '%';
            return [name, pct];
          }), {
            widths: [this.cw() * 0.5, this.cw() * 0.5],
            align: ['left', 'right']
          });
        }
      }

      // Top countries
      if (tr.topCountries && tr.topCountries.length) {
        this.need(70);
        this.eyebrow(this.margin, this.currentY, 'Top countries', this.c.muted);
        this.currentY += 12;
        this.table(['Country', 'Share'], tr.topCountries.map(c => {
          const code = c.CountryCode || c.code || '';
          const pct = c.Value != null
            ? (Number(c.Value) <= 1 ? (Number(c.Value) * 100).toFixed(1) + '%' : Number(c.Value).toFixed(1) + '%')
            : '\u2014';
          return [code, pct];
        }), {
          widths: [this.cw() * 0.4, this.cw() * 0.6],
          align: ['left', 'right']
        });
      }

      this.paragraph(this.margin, this.currentY, this.cw(),
        'Traffic figures are third-party estimates (SimilarWeb), not Google Analytics. Use them for relative trends and competitive context, not absolute billing-grade counts.',
        { color: this.c.slate, lh: 12.5 });
    }

    // ---- AUTHORITY ------------------------------------------------------
    _authority(auth, d) {
      this.addPage();
      this.section('Domain Authority & Backlinks', { accent: this.c.violet, sub: 'Off-page strength signals' });
      const tiles = [
        ['Domain Authority', auth.da != null ? auth.da : '\u2014', 'Moz DA'],
        ['Domain Rating', auth.dr != null ? auth.dr : '\u2014', 'Ahrefs DR'],
        ['Page Authority', auth.pa != null ? auth.pa : '\u2014', 'Moz PA'],
        ['Spam Score', auth.spam != null ? auth.spam + '%' : '\u2014', 'Lower is better'],
        ['Referring Domains', auth.refDomains != null ? fmtNum(auth.refDomains) : '\u2014', ''],
        ['Backlinks', auth.backlinks != null ? fmtNum(auth.backlinks) : '\u2014', ''],
        ['Domain Age', auth.domainAge || '\u2014', '']
      ];
      const tw = (this.cw() - 2 * 12) / 3;
      const rows = Math.ceil(tiles.length / 3);
      tiles.forEach((t, i) => {
        const col = i % 3, row = Math.floor(i / 3);
        const x = this.margin + col * (tw + 12), y = this.currentY + row * 74;
        const tone = t[0] === 'Spam Score' ? (parseInt(t[1]) <= 5 ? this.c.green : this.c.amber)
          : /(Authority|Rating)/.test(t[0]) ? this.toneFor((parseInt(t[1]) || 0)) : this.c.violet;
        this.kpiTile(x, y, tw, 62, t[0], t[1], t[2], tone);
      });
      this.currentY += 74 * rows + 6;
      this.paragraph(this.margin, this.currentY, this.cw(),
        'Authority metrics are estimates from third-party indexes (Moz / SEMrush). Grow them with consistent, relevant link acquisition: digital PR, partnerships, guest expertise and genuinely linkable assets. Authority compounds slowly but is the single biggest lever on competitive rankings.',
        { color: this.c.slate, lh: 12.5 });
    }

    // ---- METHODOLOGY ----------------------------------------------------
    _methodology() {
      this.addPage();
      this.section('Methodology & Next Steps', { accent: this.c.violet });
      this.currentY = this.paragraph(this.margin, this.currentY, this.cw(),
        'This report is generated by ShahzaibSEO\u2019s on-device analysis engine. It inspects the rendered DOM, metadata, headings, links, images, structured data and content, and (where API keys are configured) pulls Core Web Vitals from Google PageSpeed and authority metrics from Moz / SEMrush. Scores are weighted composites benchmarked against current search and AI-answer ranking factors.',
        { color: this.c.slate, lh: 13 }) + 16;
      const steps = [
        ['Fix critical issues first', 'Clear every Critical finding in the action plan \u2014 these block rankings or indexing outright.'],
        ['Strengthen GEO', 'Add Article/FAQ/Organization schema, author bylines and dates, then re-run to track citability gains.'],
        ['Re-audit after changes', 'Run ShahzaibSEO again in 2\u20134 weeks to measure movement and catch regressions early.'],
        ['Build authority', 'Pair on-page wins with steady link acquisition to compete on high-intent terms.']
      ];
      steps.forEach((s, i) => {
        this.need(30);
        const x = this.margin, y = this.currentY;
        this.circle(x + 9, y + 9, 9, { fill: this.c.violetSoft });
        this.text(x + 9, y + 12.5, String(i + 1), { size: 9, bold: true, color: this.c.violet, align: 'center' });
        this.text(x + 26, y + 7, s[0], { size: 9.6, bold: true, color: this.c.ink });
        this.currentY = this.paragraph(x + 26, y + 11, this.cw() - 30, s[1], { size: 8.7, color: this.c.slate, lh: 11.5 }) + 9;
      });
      // sign-off
      this.space(8);
      this.line(this.margin, this.currentY, this.pageWidth - this.margin, this.currentY, { color: this.c.hair });
      this.currentY += 14;
      this.text(this.margin, this.currentY + 8, 'Report produced by ShahzaibSEO \u2014 AEO + GEO Expert', { size: 9, bold: true, color: this.c.ink });
      this.text(this.margin, this.currentY + 22, 'Automate fixes directly to your site with the ShahzaibSEO MCP connector.', { size: 8.6, color: this.c.muted });
    }

    // ====================================================================
    // CONTENT DERIVATION HELPERS
    // ====================================================================
    _lbl(s) { return s >= 85 ? 'Excellent' : s >= 70 ? 'Good' : s >= 50 ? 'Fair' : s >= 30 ? 'Weak' : 'Critical'; }

    _verdict(sc) {
      const avg = Math.round((sc.seo + sc.geo + sc.read + sc.cro + sc.kw + sc.psi) / 6);
      if (avg >= 75) return { tone: this.c.green, soft: this.c.greenSoft, headline: 'Strong foundation \u2014 optimise to dominate', line: `Overall health is ${avg}/100. The fundamentals are solid; targeted GEO and performance work will push you onto page one for competitive terms.` };
      if (avg >= 55) return { tone: this.c.amber, soft: this.c.amberSoft, headline: 'Good base \u2014 clear room to climb', line: `Overall health is ${avg}/100. Several high-leverage fixes below can meaningfully lift rankings and AI visibility within weeks.` };
      return { tone: this.c.red, soft: this.c.redSoft, headline: 'Needs attention \u2014 fix the basics first', line: `Overall health is ${avg}/100. Critical issues are limiting visibility. Resolving the action plan below unlocks the biggest early gains.` };
    }

    _strengthsPriorities(d, sc) {
      const strengths = [], priorities = [];
      const m = d.meta || {};
      if (sc.seo >= 75) strengths.push('Strong on-page SEO foundation with healthy technical signals.');
      if (m.title && m.title.length >= 30 && m.title.length <= 60) strengths.push('Title tag is well-optimised and within the ideal length.');
      if (d.tech?.isHttps) strengths.push('Served securely over HTTPS \u2014 a confirmed ranking signal.');
      if ((d.geo?.structured?.schemas || []).length) strengths.push('Structured data is present, helping AI engines parse the page.');
      if (sc.kw >= 80) strengths.push('Keyword coverage and placement are strong.');
      if ((d.headings?.counts?.h1 || 0) === 1) strengths.push('Clean single-H1 heading hierarchy.');
      while (strengths.length < 3) strengths.push('Core content is crawlable and indexable by search engines.');

      const issues = d.seo?.issues || [];
      issues.filter(i => i.severity === 'error').slice(0, 4).forEach(i => priorities.push(i.msg + '.'));
      issues.filter(i => i.severity === 'warning').slice(0, 4 - priorities.length).forEach(i => priorities.push(i.msg + '.'));
      if (sc.psi < 50) priorities.push('Mobile PageSpeed is low \u2014 improve Core Web Vitals.');
      if (sc.geo < 60) priorities.push('GEO score is low \u2014 strengthen AI-engine visibility.');
      while (priorities.length < 3) priorities.push('Deepen content and authority to outrank competitors.');
      return { strengths: strengths.slice(0, 4), priorities: priorities.slice(0, 4) };
    }

    _rankingDrivers(d, sc, vit) {
      const up = [], down = [], climb = [];
      // tailwinds
      if (d.tech?.isHttps) up.push({ title: 'Secure HTTPS', body: 'Encrypted delivery is a direct ranking factor and a baseline trust signal for both users and crawlers.' });
      if (sc.kw >= 70) up.push({ title: 'Relevant keyword coverage', body: 'Your primary terms appear in the right places, helping search engines match you to intent.' });
      if ((d.headings?.counts?.h1 || 0) === 1) up.push({ title: 'Clear content hierarchy', body: 'A single H1 with logical subheadings makes the topic unambiguous to ranking systems.' });
      if (sc.read >= 65) up.push({ title: 'Readable copy', body: 'Accessible language widens your audience and improves engagement metrics that influence ranking.' });
      if ((d.geo?.structured?.schemas || []).length) up.push({ title: 'Structured data present', body: 'Schema helps you earn rich results and makes the page easier for AI engines to cite.' });
      while (up.length < 2) up.push({ title: 'Indexable & crawlable', body: 'Search engines can access and index the core content without barriers.' });

      // headwinds
      (d.seo?.issues || []).filter(i => i.severity === 'error').slice(0, 3).forEach(i =>
        down.push({ title: i.msg, body: i.desc || 'Resolve this to remove a ranking blocker.' }));
      if (sc.psi < 50) down.push({ title: 'Slow mobile performance', body: `PageSpeed is ${sc.psi}/100. Poor Core Web Vitals suppress rankings on mobile-first indexing.` });
      if (sc.geo < 60) down.push({ title: 'Low AI / GEO visibility', body: `GEO is ${sc.geo}/100. The page is unlikely to be cited by AI answer engines in its current state.` });
      if ((d.images?.missingAlt || 0) > 0) down.push({ title: 'Images missing alt text', body: `${d.images.missingAlt} images lack alt text, weakening image SEO and accessibility.` });
      while (down.length < 2) down.push({ title: 'Thin authority signals', body: 'Limited backlinks and topical depth cap how high you can rank on competitive queries.' });

      // climb
      climb.push({ title: 'Clear blocking issues', body: 'Work top-down through the Critical findings in the action plan; each one directly removes a ceiling on rankings.' });
      if (sc.psi < 75) climb.push({ title: 'Win Core Web Vitals', body: 'Optimise LCP and CLS \u2014 compress hero media, defer non-critical JS, and reserve space for images to stop layout shift.' });
      climb.push({ title: 'Deepen topical content', body: 'Expand the page to fully answer the query and related sub-questions; depth and freshness both lift rankings.' });
      if (sc.geo < 80) climb.push({ title: 'Optimise for AI answers', body: 'Add schema, author/date signals and concise factual summaries so AI engines quote you as the source.' });
      climb.push({ title: 'Build relevant links', body: 'Earn citations from authoritative, topically-relevant sites to raise domain strength over time.' });
      return { up: up.slice(0, 5), down: down.slice(0, 5), climb: climb.slice(0, 5) };
    }

    _geoRecs(d) {
      const recs = [];
      if (!(d.geo?.structured?.schemas || []).length)
        recs.push({ title: 'Add schema markup', body: 'Implement Article, FAQPage and Organization JSON-LD so AI engines can extract structured facts and attribute them to you.' });
      if (!d.geo?.eeat?.hasAuthor)
        recs.push({ title: 'Add author bylines', body: 'Name a credentialed author with a bio. Demonstrable expertise is a core E-E-A-T signal AI engines weigh heavily.' });
      if (!d.geo?.eeat?.hasDate)
        recs.push({ title: 'Show published & updated dates', body: 'Freshness signals tell AI engines the content is current and safe to cite.' });
      recs.push({ title: 'Write extractable answers', body: 'Lead sections with a one- to two-sentence direct answer, then elaborate. AI engines lift concise, self-contained statements.' });
      recs.push({ title: 'Add facts, stats & sources', body: 'Cite data and link primary sources. Verifiable, quotable facts dramatically increase citation rate in AI overviews.' });
      return recs.slice(0, 5);
    }

    // ====================================================================
    // SERIALISE
    // ====================================================================
    generate() {
      if (this.pages.length === 0) this.addPage();
      // Drop truly empty pages (no drawing ops)
      this.pages = this.pages.filter(p => p && p.ops && p.ops.length > 0);
      this.pages.forEach((p, i) => {
        p.number = i + 1;
      });
      const covers = new Set();
      this.pages.forEach((p) => { if (p._isCover) covers.add(p.number); });
      this.coverPages = covers;

      // Build object list first so Kids[] always points at real /Page objects
      // (annotations used to shift object numbers and break page 2+)
      const objects = []; // 1-based: objects[id-1] = body string
      const addObj = (body) => {
        objects.push(body);
        return objects.length; // object id
      };

      const pagesId = 2; // reserved
      const catalogId = addObj('<< /Type /Catalog /Pages 2 0 R >>'); // 1
      addObj(''); // 2 placeholder for /Pages
      const fReg = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      const fBold = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

      const pageObjIds = [];
      this.pages.forEach((page) => {
        const chrome = this._chrome(page);
        const body = page.ops.join('\n') + (chrome ? '\n' + chrome : '');
        const contentId = addObj(`<< /Length ${byteLen(body)} >>\nstream\n${body}\nendstream`);
        const annotIds = (page.annots || []).map((a) => addObj(a));
        const annotsStr = annotIds.length ? ` /Annots [${annotIds.map((id) => id + ' 0 R').join(' ')}]` : '';
        const pageId = addObj(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f3(this.pageWidth)} ${f3(this.pageHeight)}]` +
          ` /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fReg} 0 R /F2 ${fBold} 0 R >> >>${annotsStr} >>`
        );
        pageObjIds.push(pageId);
      });

      objects[pagesId - 1] =
        `<< /Type /Pages /Kids [${pageObjIds.map((id) => id + ' 0 R').join(' ')}] /Count ${pageObjIds.length} >>`;

      let pdf = '%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n';
      const off = [];
      objects.forEach((body, i) => {
        off.push(byteLen(pdf));
        pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
      });
      const n = objects.length + 1;
      const xref = byteLen(pdf);
      pdf += `xref\n0 ${n}\n0000000000 65535 f \n`;
      off.forEach((o) => { pdf += String(o).padStart(10, '0') + ' 00000 n \n'; });
      pdf += `trailer\n<< /Size ${n} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
      return pdf;
    }

    // ====================================================================
    // NICHE REPORTS (downloadable PDF — same path as Audit PDF)
    // ====================================================================
    _nicheFooter() {
      const m = this.margin;
      const w = this.cw();
      this.currentY += 12;
      this.need(56);
      this.rect(m, this.currentY, w, 50, { fill: this.c.surface, r: 10 });
      this.text(m + 14, this.currentY + 18, 'ShahzaibSEO by Mubashir Hassan · 100% free', { size: 10, bold: true, color: this.c.ink });
      this.text(m + 14, this.currentY + 34, 'mubashirhassan.com  ·  rankseo.html  ·  +92 322 2047786  ·  hello@mubashirhassan.com', { size: 8, color: this.c.slate });
    }

    _nicheSerpTable(competitors) {
      const list = Array.isArray(competitors) ? competitors : [];
      const crow = list.slice(0, 10).map((c) => [
        String(c.serpPosition != null ? c.serpPosition : ''),
        String(c.domain || '').slice(0, 34),
        c.dr != null ? String(c.dr) : '—',
        c.da != null ? String(c.da) : '—',
        c.spam != null ? c.spam + '%' : '—',
        String(c.ageLabel || '—'),
      ]);
      this.table(
        ['#', 'Site', 'DR', 'DA', 'Spam', 'Age'],
        crow.length ? crow : [['—', 'No organic results', '—', '—', '—', '—']],
        { widths: [26, 210, 48, 48, 50, 56], rowH: 17 }
      );
    }

    buildNicheMultiReport(p) {
      const fmtVol = (n) => {
        if (n == null || !Number.isFinite(n)) return '—';
        if (n >= 1e6) return (n / 1e6).toFixed(n >= 10e6 ? 1 : 2).replace(/\.0$/, '') + 'M';
        if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'K';
        return String(Math.round(n));
      };
      const scoreTone = (s) => {
        const n = typeof s === 'number' ? s : 0;
        if (n >= 80) return { fill: this.c.greenSoft, ink: this.c.green, deep: [4, 120, 87], label: 'Strong opportunity' };
        if (n >= 50) return { fill: this.c.amberSoft, ink: this.c.amber, deep: [180, 83, 9], label: 'Moderate opportunity' };
        return { fill: this.c.redSoft, ink: this.c.red, deep: [185, 28, 28], label: 'Hard market' };
      };
      const seed = String(p.seed || 'keyword');
      const rows = Array.isArray(p.rows) ? p.rows : [];
      const sorted = [...rows].sort((a, b) => {
        if (a.error && !b.error) return 1;
        if (!a.error && b.error) return -1;
        const sa = a.scoreNum || 0, sb = b.scoreNum || 0;
        if (sb !== sa) return sb - sa;
        const va = typeof a.volume === 'number' ? a.volume : -1;
        const vb = typeof b.volume === 'number' ? b.volume : -1;
        if (vb !== va) return vb - va;
        const wa = a.lowAuth ?? 0, wb = b.lowAuth ?? 0;
        if (wb !== wa) return wb - wa;
        return (a.highAuth ?? 0) - (b.highAuth ?? 0);
      });
      const ok = sorted.filter((r) => !r.error);
      const best = ok[0] || null;
      const highVol = ok.filter((r) => typeof r.volume === 'number').reduce((m, r) => {
        if (!m || r.volume > m.volume) return r;
        return m;
      }, null);
      this.meta.url = seed;
      this.meta.date = p.date || new Date().toISOString().slice(0, 10);
      this.meta.reportType = 'Niche Research';
      this._secNo = 0;

      // ============================================================
      // PAGE 1 — Cover + best country + comparison
      // ============================================================
      this.addPage(true);
      const m = this.margin;
      const w = this.cw();

      // Hero band
      this.gradientV(0, 0, this.pageWidth, 168, this.c.violetDeep, this.c.violet, 70);
      this.rect(0, 160, this.pageWidth, 8, { fill: this.c.violetBright });

      this.text(m, 32, 'RANKSEO', { size: 9, bold: true, color: [196, 181, 253], tracking: 2.2 });
      this.text(m, 52, 'Niche Research', { size: 11, bold: true, color: this.c.white });
      this.text(m, 78, 'Which countries are easiest?', { size: 22, bold: true, color: this.c.white });
      this.text(m, 104, 'Keyword', { size: 8, bold: true, color: [196, 181, 253], tracking: 1.1 });
      this.text(m, 122, seed, { size: 14, bold: true, color: this.c.white });
      this.text(this.pageWidth - m, 32, this.meta.date, { size: 9, color: [196, 181, 253], align: 'right' });
      this.text(this.pageWidth - m, 48, ok.length + ' markets', { size: 9, bold: true, color: this.c.white, align: 'right' });
      this.currentY = 188;

      // KPI strip
      const kpiH = 62;
      const kpiGap = 10;
      const kpiW = (w - kpiGap * 2) / 3;
      const avgScore = ok.length
        ? Math.round(ok.reduce((s, r) => s + (r.scoreNum || 0), 0) / ok.length)
        : 0;
      const kpis = [
        { label: 'Markets scanned', value: String(ok.length), sub: sorted.length + ' total rows', col: this.c.violet },
        { label: 'Best score', value: best && best.scoreNum != null ? String(best.scoreNum) : '—', sub: best ? (best.countryLabel || best.gl) : '—', col: scoreTone(best && best.scoreNum).ink },
        { label: 'Highest volume', value: highVol ? fmtVol(highVol.volume) : '—', sub: highVol ? (highVol.countryLabel || highVol.gl) : '—', col: this.c.teal },
      ];
      kpis.forEach((k, i) => {
        const x = m + i * (kpiW + kpiGap);
        this.kpiTile(x, this.currentY, kpiW, kpiH, k.label, k.value, k.sub, k.col);
      });
      this.currentY += kpiH + 18;

      // Best country hero card (score-colored, not always green)
      if (best) {
        const sc = typeof best.scoreNum === 'number' ? best.scoreNum : 0;
        const tone = scoreTone(sc);
        const cardH = highVol && (highVol.gl !== best.gl || highVol.hl !== best.hl) ? 118 : 102;
        this.rect(m, this.currentY, w, cardH, { fill: tone.fill, r: 14 });
        this.rect(m, this.currentY, 5, cardH, { fill: tone.ink, r: 2.5 });

        this.eyebrow(m + 20, this.currentY + 16, 'Top ranked market (softest competition)', tone.deep);
        const bestName = (best.countryLabel || best.gl || '—').toString();
        this.text(m + 20, this.currentY + 38, bestName, { size: 18, bold: true, color: this.c.ink });

        const verd = String(best.verdict || '—');
        const volTxt = typeof best.volume === 'number' ? 'Vol ~' + fmtVol(best.volume) + '/mo' : 'Vol —';
        this.text(m + 20, this.currentY + 58,
          verd + '  ·  Score ' + sc + '/100  ·  ' + volTxt,
          { size: 11, bold: true, color: tone.deep });

        this.text(m + 20, this.currentY + 76,
          (best.lowAuth ?? 0) + ' weak  ·  ' + (best.lowAge ?? 0) + ' young (<2y)  ·  ' +
          (best.lowSpam ?? 0) + ' low-spam  ·  ' + (best.homepageCount ?? 0) + ' niche sites  ·  ' + tone.label,
          { size: 9, color: this.c.slate });

        // Big score on the right
        this.text(m + w - 20, this.currentY + 48, String(sc), {
          size: 36, bold: true, color: tone.deep, align: 'right'
        });
        this.text(m + w - 20, this.currentY + 66, '/100', {
          size: 10, bold: true, color: this.c.muted, align: 'right'
        });

        if (highVol && (highVol.gl !== best.gl || highVol.hl !== best.hl) && typeof highVol.volume === 'number') {
          this.text(m + 20, this.currentY + 96,
            'Highest volume elsewhere: ' + (highVol.countryLabel || highVol.gl) +
            ' ~' + fmtVol(highVol.volume) + '/mo (score ' + (highVol.scoreNum != null ? highVol.scoreNum : '—') + ')',
            { size: 9, color: this.c.teal });
        }
        this.currentY += cardH + 16;
      }

      // Legend chips
      this.rect(m, this.currentY, w, 36, { fill: this.c.surface, r: 10 });
      this.text(m + 12, this.currentY + 22,
        'Vol = monthly searches (KE)   ·   Best = highest score, then volume   ·   Weak = DR/DA <20   ·   Young = under 2y   ·   AI = info only',
        { size: 8, color: this.c.slate });
      this.currentY += 48;

      // Comparison table
      this.section('Country comparison', { accent: this.c.violet, sub: ok.length + ' markets ranked' });
      const tableRows = sorted.map((r, i) => {
        if (r.error) {
          return [String(i + 1), String(r.countryLabel || r.gl || '—'), 'ERR', '—', '—', '—', '—', '—', '—', '—'];
        }
        const isBest = best && r.gl === best.gl && r.hl === best.hl;
        const name = (r.countryLabel || r.gl || '—') + (isBest ? ' ★' : '');
        return [
          String(i + 1),
          name,
          r.verdict || '—',
          r.scoreNum != null ? String(r.scoreNum) : '—',
          typeof r.volume === 'number' ? fmtVol(r.volume) : '—',
          String(r.lowAuth ?? '—'),
          String(r.homepageCount ?? '—'),
          String(r.lowAge ?? '—'),
          String(r.lowSpam ?? '—'),
          r.hasAiOverview === true ? 'Yes' : r.hasAiOverview === false ? 'No' : '—',
        ];
      });
      this.table(
        ['#', 'Country', 'Easy?', 'Score', 'Vol', 'Weak', 'Niche', 'Young', 'Spam', 'AI'],
        tableRows,
        {
          widths: [22, 92, 38, 36, 40, 34, 36, 36, 36, 28],
          align: ['left', 'left', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'center'],
          rowH: 18,
          headerFill: this.c.violetDeep,
        }
      );

      // How to read — only if space remains (long tables e.g. 37 markets skip this)
      this.currentY += 8;
      if (this.currentY + 52 <= this.contentBottom()) {
        this.rect(m, this.currentY, w, 48, { fill: this.c.violetSoft, r: 10 });
        this.text(m + 12, this.currentY + 14, 'How to use this report', { size: 9, bold: true, color: this.c.violetDeep });
        this.text(m + 12, this.currentY + 28,
          '1. Prefer higher Score (softer Top 10).  2. Check Vol — same keyword can differ by country.',
          { size: 8, color: this.c.slate });
        this.text(m + 12, this.currentY + 40,
          '3. Next pages = Google Top 10 per country.  ★ on a domain = weak DR/DA (easier to outrank).',
          { size: 8, color: this.c.slate });
        this.currentY += 56;
      }
      // No fixed page-1 brand bar — 37-country tables would overlap it.
      // Branding appears once at the end via _nicheFooter().

      // ============================================================
      // Per-country pages
      // ============================================================
      sorted.forEach((r, idx) => {
        this.addPage();
        this.currentY = this.contentTop() + 2;
        const m2 = this.margin;
        const w2 = this.cw();
        const cname = (r.countryLabel || r.gl || '—').toString();
        const comps = (r.payload && r.payload.competitors) || r.competitors || [];
        const sc = typeof r.scoreNum === 'number' ? r.scoreNum : 0;
        const tone = scoreTone(sc);
        const isBest = best && r.gl === best.gl && r.hl === best.hl;

        if (r.error) {
          this.rect(m2, this.currentY, w2, 72, { fill: this.c.redSoft, r: 12 });
          this.rect(m2, this.currentY, 5, 72, { fill: this.c.red, r: 2.5 });
          this.text(m2 + 18, this.currentY + 22, (idx + 1) + '  ·  ' + cname, { size: 14, bold: true, color: this.c.ink });
          this.text(m2 + 18, this.currentY + 42, 'Scan failed for this market', { size: 11, bold: true, color: this.c.red });
          this.text(m2 + 18, this.currentY + 58, String(r.error).slice(0, 90), { size: 9, color: this.c.slate });
          this.currentY += 88;
          return;
        }

        // Country header card
        const headH = 88;
        this.rect(m2, this.currentY, w2, headH, { fill: this.c.white, stroke: this.c.hair, lw: 1, r: 14 });
        this.rect(m2, this.currentY, 5, headH, { fill: tone.ink, r: 2.5 });

        this.eyebrow(m2 + 18, this.currentY + 14,
          (isBest ? 'BEST MARKET  ·  ' : '') + 'MARKET ' + (idx + 1) + ' OF ' + sorted.length,
          tone.deep);
        this.text(m2 + 18, this.currentY + 34, cname, { size: 16, bold: true, color: this.c.ink });

        const verd = String(r.verdict || '—');
        const volTxt = typeof r.volume === 'number' ? fmtVol(r.volume) + '/mo' : '—';
        this.text(m2 + 18, this.currentY + 52,
          verd + '  ·  Score ' + sc + '/100  ·  Volume ' + volTxt,
          { size: 10, bold: true, color: tone.deep });
        this.text(m2 + 18, this.currentY + 70,
          (r.lowAuth ?? 0) + ' weak  ·  ' + (r.midAuth ?? 0) + ' medium  ·  ' + (r.highAuth ?? 0) + ' strong  ·  ' +
          (r.homepageCount ?? 0) + ' niche  ·  ' + (r.lowAge ?? 0) + ' young  ·  ' + (r.lowSpam ?? 0) + ' low-spam  ·  AI: ' +
          (r.hasAiOverview === true ? 'Yes' : r.hasAiOverview === false ? 'No' : '—'),
          { size: 8.5, color: this.c.slate });

        this.text(m2 + w2 - 18, this.currentY + 42, String(sc), {
          size: 28, bold: true, color: tone.deep, align: 'right'
        });
        this.text(m2 + w2 - 18, this.currentY + 58, '/100', {
          size: 9, color: this.c.muted, align: 'right'
        });
        this.currentY += headH + 16;

        // Mini metric tiles
        const tW = (w2 - 20) / 5;
        const tiles = [
          { l: 'Weak', v: r.lowAuth ?? 0, c: this.c.green },
          { l: 'Medium', v: r.midAuth ?? 0, c: this.c.amber },
          { l: 'Strong', v: r.highAuth ?? 0, c: this.c.red },
          { l: 'Niche sites', v: r.homepageCount ?? 0, c: this.c.violet },
          { l: 'Young <2y', v: r.lowAge ?? 0, c: this.c.teal },
        ];
        tiles.forEach((t, i) => {
          const x = m2 + i * (tW + 5);
          this.rect(x, this.currentY, tW, 44, { fill: this.c.surface, r: 8 });
          this.text(x + tW / 2, this.currentY + 18, String(t.v), { size: 14, bold: true, color: t.c, align: 'center' });
          this.text(x + tW / 2, this.currentY + 34, t.l, { size: 7.5, color: this.c.muted, align: 'center' });
        });
        this.currentY += 56;

        this.section('Google Top 10 — ' + cname, { accent: tone.ink, sub: 'keyword: ' + seed });

        const list = Array.isArray(comps) ? comps.slice(0, 10) : [];
        if (!list.length) {
          this.rect(m2, this.currentY, w2, 36, { fill: this.c.amberSoft, r: 10 });
          this.text(m2 + 14, this.currentY + 22, 'No SERP rows captured for this market.', { size: 10, color: this.c.ink });
          this.currentY += 48;
        } else {
          const crow = list.map((c) => {
            const dr = c && c.dr, da = c && c.da;
            const weak = (typeof dr === 'number' && dr < 20) || (typeof da === 'number' && da < 20);
            return [
              String(c && c.serpPosition != null ? c.serpPosition : ''),
              (weak ? '★ ' : '') + String((c && c.domain) || '').slice(0, 36),
              dr != null ? String(dr) : '—',
              da != null ? String(da) : '—',
              c && c.spam != null ? (c.spam + '%') : '—',
              String((c && c.ageLabel) || '—'),
            ];
          });
          this.table(
            ['#', 'Domain (★ = weak)', 'DR', 'DA', 'Spam', 'Age'],
            crow,
            {
              widths: [26, 230, 46, 46, 48, 52],
              align: ['center', 'left', 'center', 'center', 'center', 'center'],
              rowH: 17,
              headerFill: this.c.ink,
            }
          );
          this.currentY += 6;
          this.text(m2, this.currentY + 8, '★ = weak competitor (DR or DA under 20) — easier to outrank with solid content.', {
            size: 8, color: this.c.muted
          });
        }
      });

      // Final brand page footer on last content
      this._nicheFooter();
      return this;
    }

    buildNicheSingleReport(p) {
      const seed = String(p.seed || 'keyword');
      const gl = p.gl || 'us';
      const country = p.countryLabel || gl;
      const verdict = p.verdict || {};
      const competitors = Array.isArray(p.competitors) ? p.competitors : [];
      const volume = (typeof p.volume === 'number' && p.volume > 0) ? p.volume : null;
      const volumeGlobal = (typeof p.volumeGlobal === 'number' && p.volumeGlobal > 0) ? p.volumeGlobal : null;
      const volumeSource = p.volumeSource || (volume ? 'Keywords Everywhere' : null);
      const ads = p.adsense || null;
      const hasAi = p.hasAiOverview;
      this.meta.url = seed;
      this.meta.date = p.date || new Date().toISOString().slice(0, 10);
      this.meta.reportType = 'Niche Research';
      this._secNo = 0;

      const m = this.margin;
      const w = this.cw();
      const score = verdict.scoreNum != null ? verdict.scoreNum : 0;
      const isYes = /yes/i.test(verdict.verdict || '');
      const isNo = /no/i.test(verdict.verdict || '');
      const tone = score >= 80 ? this.c.green : score >= 50 ? this.c.amber : this.c.red;
      const toneDeep = score >= 80 ? [4, 120, 87] : score >= 50 ? [180, 83, 9] : [185, 28, 28];

      // ============================================================
      // PAGE 1 — Hero verdict + metrics + tip + country + revenue + reasons
      // Readable type scale, generous padding (not cramped)
      // ============================================================
      this.addPage(true);

      const bgTop = score >= 80 ? [236, 253, 245] : score >= 50 ? [255, 251, 235] : [254, 242, 242];
      this.gradientV(0, 0, this.pageWidth, 280, bgTop, [255, 255, 255], 70);

      this.currentY = 36;
      this.eyebrow(m, this.currentY, 'ShahzaibSEO · Niche Research', this.c.muted);
      this.currentY += 14;

      // ---- Hero card ----
      const heroY = this.currentY;
      const heroH = 268;
      this.rect(m, heroY, w, heroH, { fill: this.c.white, stroke: this.c.hair, lw: 1, r: 16 });

      const padX = 28;
      const padTop = 26;

      this.text(m + padX, heroY + padTop, 'DOES THIS SEED LEAD TO LOW-HANGING FRUIT?', {
        size: 9, bold: true, color: this.c.muted, tracking: 0.9
      });

      const headline = isYes ? 'YES — Ideal for starters'
        : isNo ? 'NO — Tough for starters'
        : 'MAYBE — ' + (verdict.verdictLabel || 'Requires SEO effort');
      const headlineMaxW = w - padX * 2 - 140;
      let headlineSize = 22;
      while (headlineSize > 14 && this.measure(headline, headlineSize, true) > headlineMaxW) headlineSize -= 1;
      this.text(m + padX, heroY + padTop + 28, headline, { size: headlineSize, bold: true, color: tone });

      // Supporting copy — leave clear gap from the ring
      const nicheType = (verdict.nicheTypeLabel || 'Info blogging') + ' niche.';
      const seedSentence = '"' + seed + '" — ' + (verdict.lowAuth ?? 0) +
        ' site(s) under DR/DA 20, ' + (verdict.homepageCount ?? 0) +
        ' dedicated homepages already ranking.' +
        (volume ? ' Search volume ~' + fmtNum(volume) + '/mo.' : '') +
        ' Score does not guarantee rankings.';
      const paraW = w - padX * 2 - 150;
      this.paragraph(m + padX, heroY + padTop + 52, paraW, nicheType + ' ' + seedSentence, {
        size: 10, color: this.c.slate, lh: 14
      });

      // Ring gauge (right side) — label sits below ring with clear gap
      const ringCx = m + w - padX - 58;
      const ringCy = heroY + 78;
      this.ringGauge(ringCx, ringCy, 38, 8, score / 100, { color: tone, track: this.c.surface2 });
      this.text(ringCx, ringCy - 3, String(score), { size: 20, bold: true, color: this.c.ink, align: 'center' });
      this.text(ringCx, ringCy + 13, '/100', { size: 9, color: this.c.muted, align: 'center' });
      this.text(ringCx, ringCy + 52, 'LOW-HANGING', {
        size: 7, bold: true, color: this.c.muted, align: 'center', tracking: 0.4
      });
      this.text(ringCx, ringCy + 62, 'FRUIT SCORE', {
        size: 7, bold: true, color: this.c.muted, align: 'center', tracking: 0.4
      });

      // 3×2 metric tiles
      const gridY = heroY + 148;
      const metrics = [
        [verdict.lowAuth ?? 0, 'Weak DR/DA'],
        [verdict.midAuth ?? 0, 'Mid DR/DA'],
        [verdict.highAuth ?? 0, 'Strong DR/DA'],
        [verdict.homepageCount ?? 0, 'Niche sites'],
        [verdict.lowAge ?? 0, 'Young <2y'],
        [verdict.lowSpam ?? 0, 'Low spam'],
      ];
      const gGap = 10;
      const gw = (w - padX * 2 - gGap * 2) / 3;
      const gh = 48;
      metrics.forEach((t, i) => {
        const col = i % 3, row = Math.floor(i / 3);
        const x = m + padX + col * (gw + gGap);
        const y = gridY + row * (gh + gGap);
        this.rect(x, y, gw, gh, { fill: this.c.surface, stroke: this.c.hair, lw: 0.7, r: 10 });
        this.text(x + gw / 2, y + 20, String(t[0]), {
          size: 16, bold: true, color: this.c.ink, align: 'center'
        });
        this.text(x + gw / 2, y + 36, t[1].toUpperCase(), {
          size: 7.5, bold: true, color: this.c.muted, align: 'center', tracking: 0.25
        });
      });

      this.currentY = heroY + heroH + 18;

      // Seed title row
      this.text(m, this.currentY + 2, seed, { size: 16, bold: true, color: this.c.ink });
      this.text(this.pageWidth - m, this.currentY + 2, country + '  ·  ' + this.meta.date, {
        size: 9.5, color: this.c.muted, align: 'right'
      });
      this.currentY += 18;
      this.line(m, this.currentY, this.pageWidth - m, this.currentY, { color: this.c.hair, lw: 0.7 });
      this.currentY += 14;

      // Beginner tip
      this.rect(m, this.currentY, w, 42, { fill: this.c.blueSoft, r: 10 });
      this.text(m + 14, this.currentY + 16, 'BEGINNER TIP', {
        size: 8, bold: true, color: this.c.blue, tracking: 0.5
      });
      this.text(m + 14, this.currentY + 30, 'Score 80–100 = soft competition (easiest).  50–79 = doable with effort.  Below 50 = tough for a new site.', {
        size: 9.5, color: this.c.ink
      });
      this.currentY += 54;

      // Target country card
      this.rect(m, this.currentY, w, 56, { fill: this.c.surface, stroke: this.c.hair, lw: 0.7, r: 12 });
      this.text(m + 16, this.currentY + 18, 'TARGET COUNTRY', {
        size: 8, bold: true, color: this.c.muted, tracking: 0.55
      });
      this.text(m + 16, this.currentY + 38, country, { size: 14, bold: true, color: this.c.ink });
      if (volume) {
        this.text(m + w - 16, this.currentY + 28, '~' + fmtNum(volume) + '/mo', {
          size: 13, bold: true, color: this.c.green, align: 'right'
        });
        if (volumeSource) {
          this.text(m + w - 16, this.currentY + 44, String(volumeSource), {
            size: 8, color: this.c.muted, align: 'right'
          });
        }
      } else {
        this.text(m + w - 16, this.currentY + 32, 'Enable Niche Research volume in Settings', {
          size: 9, color: this.c.muted, align: 'right'
        });
      }
      this.currentY += 68;

      // Revenue estimate
      this.text(m, this.currentY + 2, 'REVENUE ESTIMATE', {
        size: 8, bold: true, color: this.c.muted, tracking: 0.55
      });
      this.currentY += 16;
      this.text(m, this.currentY, 'If you rank #1–#3 (display ads)', {
        size: 13, bold: true, color: this.c.ink
      });
      this.currentY += 14;
      this.text(m, this.currentY, volume
        ? 'Based on ~' + fmtNum(volume) + '/mo in ' + country + (ads ? ' · ' + (ads.category || 'General') + ' RPM' : '')
        : 'Rough AdSense estimate (no volume API) · category + country RPM benchmarks', {
        size: 9, color: this.c.slate
      });
      this.currentY += 16;

      let r1 = null, r2 = null, r3 = null;
      if (ads && typeof ads.rpm === 'number') {
        const v = volume || 50000;
        r1 = Math.round((v * 0.22) / 1000 * ads.rpm);
        r2 = Math.round((v * 0.14) / 1000 * ads.rpm);
        r3 = Math.round((v * 0.09) / 1000 * ads.rpm);
      } else if (ads && ads.monthly50k != null) {
        r1 = Math.round(ads.monthly50k * 1.6);
        r2 = Math.round(ads.monthly50k * 1.1);
        r3 = Math.round(ads.monthly50k * 0.75);
      }

      const revCards = [
        { label: 'RANK #1', val: r1, lo: r1 != null ? Math.round(r1 * 0.5) : null, hi: r1 != null ? Math.round(r1 * 1.5) : null },
        { label: 'RANK #2', val: r2, lo: r2 != null ? Math.round(r2 * 0.5) : null, hi: r2 != null ? Math.round(r2 * 1.5) : null },
        { label: 'RANK #3', val: r3, lo: r3 != null ? Math.round(r3 * 0.5) : null, hi: r3 != null ? Math.round(r3 * 1.5) : null },
      ];
      const rcGap = 12;
      const rcW = (w - rcGap * 2) / 3;
      revCards.forEach((rc, i) => {
        const x = m + i * (rcW + rcGap);
        this.rect(x, this.currentY, rcW, 64, { fill: this.c.white, stroke: this.c.hair, lw: 0.8, r: 12 });
        this.text(x + rcW / 2, this.currentY + 18, rc.label, {
          size: 8, bold: true, color: this.c.muted, align: 'center', tracking: 0.4
        });
        this.text(x + rcW / 2, this.currentY + 38, rc.val != null ? '$' + fmtNum(rc.val) + '/mo' : '—', {
          size: 15, bold: true, color: this.c.green, align: 'center'
        });
        if (rc.lo != null) {
          this.text(x + rcW / 2, this.currentY + 54, '$' + fmtNum(rc.lo) + ' – $' + fmtNum(rc.hi), {
            size: 8, color: this.c.muted, align: 'center'
          });
        }
      });
      this.currentY += 74;
      this.text(m, this.currentY, 'Display-ad estimate only. Real earnings vary with CTR, ad layout, seasonality, and network.', {
        size: 8.5, color: this.c.muted
      });
      this.currentY += 18;

      // Why this score — prefer page 1; if tight, spill to page 2 before Top 10
      const reasons = verdict.reasons || [];
      if (reasons.length) {
        const needH = 28 + reasons.length * 22;
        if (this.currentY + needH > this.contentBottom() - 20) {
          this.addPage();
          this.currentY = this.contentTop() + 8;
        }
        this.text(m, this.currentY + 4, 'Why this score', { size: 14, bold: true, color: this.c.ink });
        this.currentY += 22;
        reasons.forEach((r, i) => {
          this.need(24);
          const bubR = 9;
          this.circle(m + bubR, this.currentY + 5, bubR, {
            fill: score >= 80 ? this.c.greenSoft : score >= 50 ? this.c.amberSoft : this.c.redSoft
          });
          this.text(m + bubR, this.currentY + 8, String(i + 1), {
            size: 8, bold: true, color: toneDeep, align: 'center'
          });
          this.currentY = this.paragraph(m + 26, this.currentY + 1, w - 26, String(r), {
            size: 10, color: this.c.slate, lh: 13.5
          }) + 8;
        });
      }

      // ============================================================
      // PAGE 2 — Google Top 10 + AI / dedicated boxes
      // ============================================================
      this.addPage();
      this.currentY = this.contentTop() + 6;

      this.text(m, this.currentY + 4, 'GOOGLE TOP 10 · ' + String(country).toUpperCase(), {
        size: 9, bold: true, color: this.c.muted, tracking: 0.7
      });
      this.currentY += 22;
      this.text(m, this.currentY, 'Ranking pages in the top market', {
        size: 16, bold: true, color: this.c.ink
      });
      this.currentY += 18;
      this.currentY = this.paragraph(m, this.currentY, w,
        'Green / * = DR or DA under 20 (easier targets). A dedicated homepage in the Top 10 means a niche site is already ranking for this keyword — not a Softonic-style portal.',
        { size: 9.5, color: this.c.slate, lh: 13.5 }) + 14;

      // AI + Dedicated side-by-side cards
      const boxH = 58;
      const half = (w - 12) / 2;
      const aiYes = hasAi === true;
      const aiNo = hasAi === false;

      this.rect(m, this.currentY, half, boxH, { fill: this.c.surface, r: 12 });
      this.text(m + 14, this.currentY + 20, 'AI Overview · ' + (aiYes ? 'Yes' : aiNo ? 'No' : '—'), {
        size: 11, bold: true, color: aiYes ? this.c.amber : this.c.green
      });
      this.text(m + 14, this.currentY + 40, aiYes
        ? 'AI Overview present — some clicks may skip organic.'
        : aiNo ? 'No AI Overview detected on this SERP.' : 'AI Overview status unknown.', {
        size: 9, color: this.c.slate
      });

      this.rect(m + half + 12, this.currentY, half, boxH, { fill: this.c.greenSoft, r: 12 });
      this.text(m + half + 26, this.currentY + 20, 'Dedicated niche sites · ' + (verdict.homepageCount ?? 0), {
        size: 11, bold: true, color: this.c.green
      });
      this.text(m + half + 26, this.currentY + 40, 'Apex homepage ranking = dedicated site for this keyword.', {
        size: 9, color: this.c.slate
      });
      this.currentY += boxH + 18;

      // Top 10 table
      const list = competitors.slice(0, 10);
      if (!list.length) {
        this.rect(m, this.currentY, w, 52, { fill: this.c.amberSoft, r: 12 });
        this.text(m + 16, this.currentY + 20, 'No SERP data in this export.', {
          size: 12, bold: true, color: this.c.ink
        });
        this.text(m + 16, this.currentY + 38, 'Re-run Niche Research, wait for Top 10, then Download PDF again.', {
          size: 9.5, color: this.c.slate
        });
        this.currentY += 64;
      } else {
        const crow = list.map((c) => {
          const dr = c && c.dr;
          const da = c && c.da;
          const weak = (typeof dr === 'number' && dr < 20) || (typeof da === 'number' && da < 20);
          const dom = String((c && c.domain) || '').slice(0, 34);
          return [
            String(c && c.serpPosition != null ? c.serpPosition : ''),
            (weak ? '* ' : '') + dom,
            dr != null ? String(dr) : '—',
            da != null ? String(da) : '—',
            c && c.spam != null ? (c.spam + '%') : '—',
            String((c && c.ageLabel) || '—'),
          ];
        });
        this.table(
          ['#', 'Site (* = weak)', 'DR', 'DA', 'Spam', 'Age'],
          crow,
          {
            widths: [28, 214, 48, 48, 50, 50],
            rowH: 20,
            headerFill: this.c.violetDeep,
            cellColor: (ri, i) => {
              if (i !== 1) return this.c.slate;
              const c = list[ri];
              const weak = c && ((typeof c.dr === 'number' && c.dr < 20) || (typeof c.da === 'number' && c.da < 20));
              return weak ? this.c.green : this.c.slate;
            },
            cellBold: (ri, i) => i === 1 && list[ri] &&
              ((typeof list[ri].dr === 'number' && list[ri].dr < 20) ||
               (typeof list[ri].da === 'number' && list[ri].da < 20)),
          }
        );
        this.currentY += 10;
        this.text(m, this.currentY, '* = DR or DA under 20 — realistic target for a new / small site.', {
          size: 9, color: this.c.muted
        });
        this.currentY += 18;
      }

      // Brand footer card
      this.need(54);
      this.rect(m, this.currentY, w, 50, { fill: this.c.surface, r: 12 });
      this.text(m + 16, this.currentY + 20, 'ShahzaibSEO by Mubashir Hassan · 100% free · Competition-based (volume optional)', {
        size: 10, bold: true, color: this.c.ink
      });
      this.text(m + 16, this.currentY + 36, 'mubashirhassan.com  ·  +92 322 2047786  ·  hello@mubashirhassan.com', {
        size: 9, color: this.c.slate
      });
      return this;
    }

    download(filename = 'ShahzaibSEO-Audit.pdf') {
      const blob = new Blob([this.generate()], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    save(path) { require('fs').writeFileSync(path, Buffer.from(this.generate(), 'latin1')); return path; }
  }

  // ---- utils ---------------------------------------------------------------
  function byteLen(s) {
    // content is latin1/ASCII (octal escapes keep it single-byte)
    return s.length;
  }
  function esc(t) {
    let r = '';
    const s = String(t);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 0x5C) r += '\\\\';
      else if (c === 0x28) r += '\\(';
      else if (c === 0x29) r += '\\)';
      else if (c >= 0x20 && c <= 0x7E) r += s[i];
      else if (c >= 0xA0 && c <= 0xFF) r += '\\' + c.toString(8).padStart(3, '0');
      else {
        const map = { 0x2026:0x85,0x2018:0x91,0x2019:0x92,0x201C:0x93,0x201D:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x2122:0x99,0x20AC:0x80,0x00d7:0xD7 };
        const mp = map[c];
        if (mp !== undefined) r += '\\' + mp.toString(8).padStart(3, '0');
        // else drop
      }
    }
    return r;
  }
  function fmtNum(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function fmtBytes(b) {
    b = Number(b) || 0;
    if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
    if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
    return b + ' B';
  }

  if (typeof window !== 'undefined') window.SorankPDF = SorankPDF;
  if (typeof module !== 'undefined' && module.exports) module.exports = SorankPDF;
})(typeof window !== 'undefined' ? window : globalThis);
