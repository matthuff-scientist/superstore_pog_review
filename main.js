'use strict';
// Aisle Lab: shelf-elevation + floor-plan what-if for one retail aisle.
// Reads Product Name, Sub-Category, Quantity, Sales, Profit (summary rows).
// Dwell/traffic are MODELED from unit movement (Superstore has no sensor data).
(function () {
  var LEVELS = [{ n: 'Top', f: 0.85 }, { n: 'Eye', f: 1.3 }, { n: 'Waist', f: 1.05 }, { n: 'Floor', f: 0.7 }];
  var POSF = [1, 0.97, 0.9, 0.82];
  var NB = 4, SLOTS = 4, SH = 4, BW = 200, SLOTW = 50, OX = 76, LH = 44, SHH = 108, TH = 84, PX0 = 56, SHD = 64, EXIT = 0.35, ELAST = -1.2;
  var DEF_A = ['Paper', 'Binders', 'Labels', 'Envelopes'], DEF_B = ['Art', 'Fasteners', 'Storage', 'Supplies'];
  var VIRIDIS = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'];
  var MAGMA = ['#1b0c41', '#6a176e', '#c03a51', '#f1731d', '#fcfdbf'];

  var P = {}, BYSUB = {}, subs = [], slots = [], entries = [], recs = [], hist = [], shoppers = [];
  var S = {
    side: 0, sel: null, live: false, levelFx: true, elast: true, large: false,
    layer: { units: true, floor: true, shoppers: true, labels: true, spot: false, blocks: true, attn: true, oos: true, marg: true }, heat: 'tier', binFocus: null, bins: null, legendHit: [], oosFx: true, cap: 12, restock: 2, vol: 25, oosObs: {}, opA: 0.6, maxAttn: 1, brandFocus: null, brands: [], mode: 'layout', hasTime: false, nQ: 0, q0: 0, proj: null, pMetric: 'units', pH: 4, pHist: 0, supp: null, promo: { disc: 15, weeks: 4, fund: 50, elast: 1.2, dip: 20 }, tFilter: 'all', tSortK: 'score', tSortD: -1,
    floorMode: 'both', traffic: 120, aisleW: 150, opU: 0.55, opF: 0.8, maxU: 1, minU: 1,
    stats: null, grid: null
  };
  var views = { elev: { s: 1, tx: 0, ty: 0 }, plan: { s: 1, tx: 0, ty: 0 } };
  var cv = {}, dpr = 1, drag = null, pan = null, hover = null, sliderGesture = false, lastT = 0, spawnAcc = 0, worksheet = null;

  function $(id) { return document.getElementById(id); }
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function fmt(n) { return Math.round(n).toLocaleString(); }
  function money(n) { return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString(); }
  function pct(n) { return (n * 100).toFixed(0) + '%'; }
  function hexRgb(x) { return [parseInt(x.substr(1, 2), 16), parseInt(x.substr(3, 2), 16), parseInt(x.substr(5, 2), 16)]; }
  var RGB = { v: VIRIDIS.map(hexRgb), m: MAGMA.map(hexRgb) };
  function ramp(set, t) {
    t = clamp(t, 0, 1); var a = RGB[set], n = a.length - 1, i = Math.min(n - 1, Math.floor(t * n)), f = t * n - i;
    return [a[i][0] + (a[i + 1][0] - a[i][0]) * f, a[i][1] + (a[i + 1][1] - a[i][1]) * f, a[i][2] + (a[i + 1][2] - a[i][2]) * f];
  }
  function css(c, a) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (a == null ? 1 : a) + ')'; }
  function hashHue(s) { var x = 7; for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 360; return x; }
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast._t); toast._t = setTimeout(function () { t.style.display = 'none'; }, 2600); }
  function logE(e) { try { console.error('AisleLab: ' + (e && e.stack ? e.stack : e)); } catch (x) { /* noop */ } }

  // ---------------------------------------------------------------- data
  function sampleRows() {
    var rows = [], all = DEF_A.concat(DEF_B);
    all.forEach(function (sub, si) {
      for (var i = 1; i <= 20; i++) {
        var u = Math.round(900 / Math.pow(i, 0.8) * (1 + (si % 3) * 0.2));
        var price = 4 + ((i * 7 + si * 3) % 40), mg = (i % 7 === 0) ? -0.05 : 0.12 + (i % 5) * 0.04;
        var kind = i % 11 === 0 ? 'stall' : i % 5 === 0 ? 'dec' : i % 7 === 0 ? 'gro' : 'flat';
        for (var q = 0; q < 12; q++) {
          var w = kind === 'dec' ? 1.6 - 0.12 * q : kind === 'gro' ? 0.4 + 0.12 * q : kind === 'stall' ? (q < 8 ? 1.3 : 0) : 1, uq = u / 12 * Math.max(0, w);
          rows.push([sub + ' sample ' + i, sub, uq, uq * price, uq * price * mg, 2020 * 4 + q]);
        }
      }
    });
    return rows;
  }
  function loadRows(rows) {
    P = {}; BYSUB = {}; var qmin = 1e9, qmax = -1e9;
    rows.forEach(function (r) {
      var k = r[0] + '||' + r[1], p = P[k];
      if (!p) { p = P[k] = { id: k, name: r[0], sub: r[1], units: 0, sales: 0, profit: 0, q: {} }; }
      p.units += r[2]; p.sales += r[3]; p.profit += r[4];
      if (r[5] != null) { var qq = p.q[r[5]] || (p.q[r[5]] = { u: 0, s: 0, p: 0 }); qq.u += r[2]; qq.s += r[3]; qq.p += r[4]; qmin = Math.min(qmin, r[5]); qmax = Math.max(qmax, r[5]); }
    });
    S.q0 = qmin; S.nQ = qmax >= qmin ? qmax - qmin + 1 : 0; S.hasTime = S.nQ >= 4;
    var tot = {};
    Object.keys(P).forEach(function (k) {
      var p = P[k]; if (p.units <= 0) { delete P[k]; return; }
      p.price = p.sales / p.units; p.uprofit = p.profit / p.units;
      if (S.hasTime) { p.hu = []; p.hs = []; p.hp = []; for (var qi = 0; qi < S.nQ; qi++) { var c = p.q[S.q0 + qi]; p.hu.push(c ? c.u : 0); p.hs.push(c ? c.s : 0); p.hp.push(c ? c.p : 0); } trendStats(p); }
      (BYSUB[p.sub] = BYSUB[p.sub] || []).push(k); tot[p.sub] = (tot[p.sub] || 0) + p.units;
    });
    Object.keys(BYSUB).forEach(function (s) { BYSUB[s].sort(function (a, b) { return P[b].units - P[a].units; }); });
    subs = Object.keys(BYSUB).sort(function (a, b) { return tot[b] - tot[a]; });
    var want = DEF_A.concat(DEF_B).filter(function (s) { return BYSUB[s]; });
    subs.forEach(function (s) { if (want.length < 8 && want.indexOf(s) < 0) want.push(s); });
    slots = []; S.baseLoc = {};
    for (var i = 0; i < 8; i++) {
      var sl = { idx: i, side: Math.floor(i / 4), pos: i % 4 };
      var sub = DEF_A.indexOf(want[i]) >= 0 || DEF_B.indexOf(want[i]) >= 0 ? want[i] : want[i];
      slots.push(sl); stock(sl, sub || subs[i % subs.length]); sl.sub0 = sl.sub;
    }
    S.sel = null; recompute(); fitViews(); renderBar();
  }
  function mk(pid, lvl, pos, fac) { return { pid: pid, fac: fac, baseFac: fac, uMult: 1, pPct: 0, baseLvl: lvl, basePos: pos, bk: null }; }
  var PAL = ['#4e79a7', '#f28e2b', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#9c755f', '#17becf', '#8c6bb1', '#bab0ab'], BCOL = {};
  function brandOf(it) { if (it.bk) return it.bk; var w = (P[it.pid].name || '').split(/\s+/)[0].replace(/[^A-Za-z0-9&'\-]/g, ''); return w || 'Other'; }
  function brandStats() {
    var bm = {}, key = {};
    entries.forEach(function (e) { var b = brandOf(e.it), o = bm[b] || (bm[b] = { name: b, units: 0, sales: 0, profit: 0, items: 0, bays: {}, runs: {}, splits: 0 }); o.units += e.m.units; o.sales += e.m.sales; o.profit += e.m.profit; o.items++; o.bays[e.slot.idx] = 1; });
    slots.forEach(function (sl) { sl.shelves.forEach(function (sh, lvl) { var prev = null; sh.forEach(function (it) { var b = brandOf(it); if (b !== prev) { var k = sl.idx + '/' + lvl; bm[b].runs[k] = (bm[b].runs[k] || 0) + 1; } prev = b; }); }); });
    S.brands = Object.keys(bm).map(function (k) { return bm[k]; }).sort(function (a, b) { return b.units - a.units; });
    S.brands.forEach(function (o, i) { o.color = PAL[i % PAL.length]; BCOL[o.name] = o.color; var sp = Math.max(0, Object.keys(o.bays).length - 1); Object.keys(o.runs).forEach(function (k) { sp += Math.max(0, o.runs[k] - 1); }); o.splits = sp; });
  }
  function stock(sl, sub) {
    sl.sub = sub; sl.shelves = [[], [], [], []];
    Object.keys(S.baseLoc).forEach(function (k) { if (S.baseLoc[k].bay === bayName(sl)) delete S.baseLoc[k]; });
    var list = (BYSUB[sub] || []).slice(0, SLOTS * SH);
    list.sort(function (a, b) { return P[a].name < P[b].name ? -1 : 1; });
    var b = { units: 0, sales: 0, profit: 0 };
    list.forEach(function (pid, i) {
      var l = Math.floor(i / SLOTS); sl.shelves[l].push(mk(pid, l, sl.pos, 1)); S.baseLoc[pid] = { bay: bayName(sl), lvl: l, fac: 1 };
      b.units += P[pid].units; b.sales += P[pid].sales; b.profit += P[pid].profit;
    });
    sl.base = b;
  }

  // ---------------------------------------------------------------- model
  function eff(it, sl, lvl) {
    var p = P[it.pid];
    var lf = S.levelFx ? (LEVELS[lvl].f / LEVELS[it.baseLvl].f) * (POSF[sl.pos] / POSF[it.basePos]) : 1;
    var pr = 1 + it.pPct / 100, el = S.elast ? Math.pow(pr, ELAST) : 1, dm = it.uMult * lf * el;
    var s1 = stockModel(p, it, dm), oosM = 1, ff;
    if (S.oosFx) { var s0 = stockModel(p, { fac: it.baseFac, baseFac: it.baseFac }, 1); oosM = (1 - s1.loss) / Math.max(0.2, 1 - s0.loss); ff = Math.pow(it.fac / it.baseFac, 0.25); }
    else ff = Math.pow(it.fac / it.baseFac, 0.4);
    var units = p.units * dm * ff * oosM, price = p.price * pr, upr = p.uprofit + p.price * (pr - 1);
    return { units: units, sales: units * price, profit: units * upr, margin: price ? upr / price : 0, price: price, risk: s1.risk, cap: s1.cap, cover: s1.cover, obs: s1.obs, loss: s1.loss };
  }
  function Phi(z) { var t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), q = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - q : q; }
  function nloss(z) { return 0.3989423 * Math.exp(-z * z / 2) - z * (1 - Phi(z)); }
  function stockModel(p, it, dm) {
    var W = S.hasTime ? S.nQ * 13 : 208, wk = p.units * S.vol / W * dm, D = wk / S.restock, C = it.fac * S.cap, cv = p.cv || 0.5, cover = wk > 0 ? C / (wk / 7) : 99, ob = S.oosObs[p.id];
    if (ob != null) { var r = clamp(ob / 100 * Math.pow(it.baseFac / it.fac, 1.5) * dm, 0, 0.95); return { risk: r, loss: r, cap: C, cover: cover, obs: true }; }
    if (D <= 0) return { risk: 0, loss: 0, cap: C, cover: cover, obs: false };
    var z = (C - D) / (cv * D); return { risk: clamp(1 - Phi(z), 0, 0.99), loss: clamp(cv * nloss(z), 0, 0.8), cap: C, cover: cover, obs: false };
  }
  function shelfW(sh) { var w = 0; sh.forEach(function (it) { w += it.fac; }); return w; }
  function recompute() {
    entries = []; var tot = { units: 0, sales: 0, profit: 0 }, base = { units: 0, sales: 0, profit: 0 };
    slots.forEach(function (sl) {
      sl.units = 0; sl.sales = 0; sl.profit = 0; sl.flags = 0;
      base.units += sl.base.units; base.sales += sl.base.sales; base.profit += sl.base.profit;
      sl.shelves.forEach(function (sh, lvl) {
        sh.forEach(function (it, idx) {
          var m = eff(it, sl, lvl), e = { it: it, slot: sl, lvl: lvl, idx: idx, m: m, upf: m.units / it.fac, reasons: [], flag: false };
          it._e = e; entries.push(e);
          sl.units += m.units; sl.sales += m.sales; sl.profit += m.profit; tot.units += m.units; tot.sales += m.sales; tot.profit += m.profit;
        });
      });
    });
    var u = entries.map(function (e) { return e.upf; }).sort(function (a, b) { return a - b; });
    var q25 = u.length ? u[Math.floor(0.25 * (u.length - 1))] : 0, med = u.length ? u[Math.floor(0.5 * (u.length - 1))] : 0;
    S.maxU = 1; S.minU = 1e9;
    entries.forEach(function (e) {
      if (e.upf <= q25 && e.upf < 0.6 * med) e.reasons.push('Low velocity');
      if (e.m.profit < 0) e.reasons.push('Negative margin');
      var tr = P[e.it.pid].tr; if (tr) { if (tr.status === 'Stalled') e.reasons.push('Stalled sales'); else if (tr.status === 'Declining' && e.upf <= med) e.reasons.push('Declining trend'); }
      if (e.lvl === 1 && e.upf <= med * 0.7 && e.reasons.indexOf('Low velocity') < 0) e.reasons.push('Prime shelf underused');
      e.flag = e.reasons.length > 0; if (e.flag) e.slot.flags++;
      S.maxU = Math.max(S.maxU, e.m.units); S.minU = Math.min(S.minU, e.m.units);
    });
    S.stats = { tot: tot, base: base, med: med }; brandStats();
    floorModel();
  }
  function surv(pos) { return 1 - EXIT * pos / 3; }
  function floorModel() {
    var maxS = 1; slots.forEach(function (sl) { maxS = Math.max(maxS, sl.units); });
    slots.forEach(function (sl) {
      var r = sl.units / maxS;
      sl.stopP = clamp(0.08 + 0.8 * Math.pow(r, 0.7), 0, 0.92) * surv(sl.pos);
      sl.stopSec = 6 + 24 * Math.pow(r, 0.6);
      sl.dwell = sl.stopP * sl.stopSec;
      sl.flow = S.traffic * surv(sl.pos);
    });
    var bayMax = {}; entries.forEach(function (e) { bayMax[e.slot.idx] = Math.max(bayMax[e.slot.idx] || 1, e.m.units); }); S.maxAttn = 1e-6;
    entries.forEach(function (e) { e.attn = e.slot.stopP * (0.5 + 0.5 * e.m.units / bayMax[e.slot.idx]); S.maxAttn = Math.max(S.maxAttn, e.attn); });
    var cell = 6, x0 = PX0 - 30, x1 = PX0 + NB * BW + 30, W = S.aisleW, gw = Math.ceil((x1 - x0) / cell), gh = Math.max(2, Math.ceil(W / cell));
    var dw = new Float32Array(gw * gh), dn = new Float32Array(gw * gh), md = 1e-6, mn = 1e-6, i, j, k;
    for (j = 0; j < gh; j++) for (i = 0; i < gw; i++) {
      var x = x0 + (i + 0.5) * cell, y = (j + 0.5) * cell, d = 0;
      for (k = 0; k < slots.length; k++) {
        var sl = slots[k], cx = PX0 + sl.pos * BW + BW / 2, dy = sl.side === 0 ? y : W - y;
        d += sl.dwell * Math.exp(-Math.pow((x - cx) / (BW * 0.4), 2)) * Math.exp(-Math.pow(dy / (W * 0.4), 2));
      }
      var frac = clamp((x - PX0) / (NB * BW), 0, 1), flow = S.traffic * (1 - EXIT * frac);
      var cy = (y - W / 2) / (W * 0.45), dens = flow / (W / 150) * (1 + 0.12 * d) * (0.7 + 0.3 * Math.exp(-cy * cy));
      dw[j * gw + i] = d; dn[j * gw + i] = dens; md = Math.max(md, d); mn = Math.max(mn, dens);
    }
    var off = document.createElement('canvas'); off.width = gw; off.height = gh;
    var g = off.getContext('2d'), img = g.createImageData(gw, gh);
    for (k = 0; k < gw * gh; k++) {
      var t = S.floorMode === 'dwell' ? dw[k] / md : S.floorMode === 'density' ? dn[k] / mn : 0.5 * dw[k] / md + 0.5 * dn[k] / mn;
      var c = ramp('m', t); img.data[k * 4] = c[0]; img.data[k * 4 + 1] = c[1]; img.data[k * 4 + 2] = c[2]; img.data[k * 4 + 3] = 255 * (0.12 + 0.88 * t);
    }
    g.putImageData(img, 0, 0);
    S.grid = { off: off, gw: gw, gh: gh, cell: cell, x0: x0, dw: dw, dn: dn, md: md, mn: mn };
  }

  // ---------------------------------------------------------------- history / edits

  // ---------------------------------------------------------------- recommendations
  function bayName(sl) { return (sl.side === 0 ? 'A' : 'B') + (sl.pos + 1); }
  function shortN(pid) { var n = P[pid] ? P[pid].name : pid; return n.length > 34 ? n.slice(0, 33) + '…' : n; }

  // ---------------------------------------------------------------- canvas helpers
  function sizeCanvas(c) {
    var r = c.parentNode.getBoundingClientRect(); dpr = window.devicePixelRatio || 1;
    c.width = Math.max(10, Math.round(r.width * dpr)); c.height = Math.max(10, Math.round(r.height * dpr)); c._w = r.width; c._h = r.height;
  }
  function planDims() { var W = S.aisleW; return { w: PX0 * 2 + NB * BW, h: 14 + SHD + W + SHD + 40, top: 14 + SHD, bot: 14 + SHD + W }; }
  function fitViews() {
    sizeCanvas(cv.elev); sizeCanvas(cv.plan);
    var ev = views.elev, ww = OX + NB * BW + 14, wh = LH + SH * SHH + 16;
    ev.s = Math.min(cv.elev._w / ww, cv.elev._h / wh); ev.tx = (cv.elev._w - ww * ev.s) / 2; ev.ty = (cv.elev._h - wh * ev.s) / 2;
    var pv = views.plan, d = planDims();
    pv.s = Math.min(cv.plan._w / d.w, cv.plan._h / d.h); pv.tx = (cv.plan._w - d.w * pv.s) / 2; pv.ty = (cv.plan._h - d.h * pv.s) / 2;
  }
  function zoomBay(sl) {
    var ev = views.elev, ww = BW + 60;
    ev.s = clamp(cv.elev._w / ww, 0.4, 2.8); ev.tx = cv.elev._w / 2 - (OX + (sl.pos + 0.5) * BW) * ev.s;
    var wh = LH + SH * SHH + 16, mid = (LH + SH * SHH) / 2; ev.ty = cv.elev._h / 2 - mid * ev.s; if (wh * ev.s < cv.elev._h) ev.ty = (cv.elev._h - wh * ev.s) / 2;
  }
  function loc(c, ev) { var r = c.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
  function toWorld(v, p) { return { x: (p.x - v.tx) / v.s, y: (p.y - v.ty) / v.s }; }
  function fs(n) { return n * (S.large ? 1.3 : 1); }

  // ---------------------------------------------------------------- drawing: product art
  function art(g, x, y, w, hh, sub, hue) {
    var c = 'hsl(' + hue + ',60%,62%)', d = 'hsl(' + hue + ',60%,34%)', cx = x + w / 2, cy = y + hh / 2, k = Math.min(w, hh);
    g.fillStyle = '#f2efe8'; g.fillRect(x, y, w, hh);
    switch (sub) {
      case 'Paper': g.fillStyle = '#fff'; g.fillRect(x + w * .12, y + hh * .12, w * .76, hh * .76); g.fillStyle = c; g.fillRect(x + w * .12, y + hh * .12, w * .76, hh * .22); g.strokeStyle = '#c9c9c9'; for (var i = 0; i < 3; i++) { g.beginPath(); g.moveTo(x + w * .2, y + hh * (.5 + i * .12)); g.lineTo(x + w * .8, y + hh * (.5 + i * .12)); g.stroke(); } break;
      case 'Binders': g.fillStyle = c; g.fillRect(x + w * .2, y + hh * .04, w * .6, hh * .92); g.fillStyle = d; g.fillRect(x + w * .2, y + hh * .04, w * .12, hh * .92); g.fillStyle = '#fff'; g.fillRect(x + w * .4, y + hh * .15, w * .3, hh * .22); g.fillStyle = '#d8d8d8'; for (var r = 0; r < 3; r++) { g.beginPath(); g.arc(x + w * .26, y + hh * (.25 + r * .25), k * .06, 0, 6.3); g.fill(); } break;
      case 'Labels': g.fillStyle = '#fff'; g.fillRect(x + w * .1, y + hh * .08, w * .8, hh * .84); g.fillStyle = c; for (var a = 0; a < 3; a++) for (var b = 0; b < 2; b++) g.fillRect(x + w * (.16 + b * .38), y + hh * (.16 + a * .26), w * .3, hh * .18); break;
      case 'Envelopes': g.fillStyle = '#fbf6e4'; g.fillRect(x + w * .08, y + hh * .22, w * .84, hh * .56); g.strokeStyle = d; g.beginPath(); g.moveTo(x + w * .08, y + hh * .22); g.lineTo(cx, y + hh * .55); g.lineTo(x + w * .92, y + hh * .22); g.stroke(); g.strokeRect(x + w * .08, y + hh * .22, w * .84, hh * .56); break;
      case 'Art': g.fillStyle = c; g.fillRect(x + w * .3, y + hh * .1, w * .4, hh * .62); g.fillStyle = d; g.beginPath(); g.moveTo(x + w * .3, y + hh * .72); g.lineTo(cx, y + hh * .95); g.lineTo(x + w * .7, y + hh * .72); g.fill(); g.fillStyle = '#e9b8b8'; g.fillRect(x + w * .3, y + hh * .1, w * .4, hh * .1); break;
      case 'Fasteners': g.fillStyle = '#d6d9de'; g.fillRect(x + w * .1, y + hh * .25, w * .8, hh * .5); g.strokeStyle = d; g.lineWidth = 1.2; for (var f = 0; f < 3; f++) { g.beginPath(); g.arc(x + w * (.28 + f * .22), cy, k * .1, 0, 6.3); g.stroke(); } g.lineWidth = 1; break;
      case 'Storage': g.fillStyle = c; g.fillRect(x + w * .1, y + hh * .2, w * .8, hh * .7); g.fillStyle = d; g.fillRect(x + w * .3, y + hh * .3, w * .4, hh * .1); g.fillRect(x + w * .1, y + hh * .2, w * .8, hh * .06); break;
      case 'Supplies': g.strokeStyle = d; g.lineWidth = 2; g.beginPath(); g.arc(x + w * .32, y + hh * .75, k * .12, 0, 6.3); g.arc(x + w * .68, y + hh * .75, k * .12, 0, 6.3); g.moveTo(x + w * .35, y + hh * .65); g.lineTo(x + w * .65, y + hh * .1); g.moveTo(x + w * .65, y + hh * .65); g.lineTo(x + w * .35, y + hh * .1); g.stroke(); g.lineWidth = 1; break;
      default: g.fillStyle = c; g.fillRect(x + w * .15, y + hh * .15, w * .7, hh * .7); g.fillStyle = d; g.fillRect(x + w * .15, y + hh * .15, w * .7, hh * .15);
    }
  }
  function wrapText(g, text, maxW, maxLines) {
    var words = text.split(/\s+/), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var t = cur ? cur + ' ' + words[i] : words[i];
      if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = words[i]; if (lines.length === maxLines) break; } else cur = t;
    }
    if (lines.length < maxLines && cur) lines.push(cur);
    if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, '…');
    return lines;
  }
  function lum(c) { return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255; }


  // ---- shelf heat: one metric at a time, 5 quantile classes, light = low, dark = high
  var BLUE = ['#e8f0fb', '#bcd3f0', '#86b0e3', '#4a82cc', '#1f4e9c'], WARM = ['#fff1d6', '#fdd49e', '#fc8d59', '#d7301f', '#7f0000'];
  function moneyK(v) { var a = Math.abs(v), s = v < 0 ? '-$' : '$'; return a >= 10000 ? s + (a / 1000).toFixed(0) + 'k' : a >= 1000 ? s + (a / 1000).toFixed(1) + 'k' : s + Math.round(a); }
  function lerpPal(pal, t) { t = clamp(t, 0, 1); var n = pal.length - 1, i = Math.min(n - 1, Math.floor(t * n)), f = t * n - i, a = hexRgb(pal[i]), b = hexRgb(pal[i + 1]); return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
  var DIV = ['#c2410c', '#fdba74', '#eef1f5', '#93c5fd', '#1d4ed8'], TIER = ['#e8f0fb', '#86b0e3', '#1f4e9c'];
  function sgnMoney(v) { return (v > 0 ? '+' : v < 0 ? '-' : '') + moneyK(Math.abs(v)).replace('-', ''); }
  var HEATS = {
    tier: { n: 'Sales tier (A/B/C by cumulative share)', kind: 'tier', f: function (e) { return e.m.sales; }, fmt: moneyK },
    delta: { n: 'Sales change vs. baseline', kind: 'delta', f: function (e) { return e.m.sales - (S.baseLoc[e.it.pid] ? P[e.it.pid].sales : 0); }, fmt: sgnMoney },
    share: { n: 'Sales share ÷ space share', kind: 'share', f: function (e) { return e.shareIdx; }, fmt: function (v) { return v.toFixed(1) + '×'; } },
    units: { n: 'Units sold', kind: 'q', f: function (e) { return e.m.units; }, fmt: function (v) { return fmt(v) + ' u'; }, pal: BLUE },
    sales: { n: 'Sales', kind: 'q', f: function (e) { return e.m.sales; }, fmt: moneyK, pal: BLUE },
    profit: { n: 'Profit', kind: 'q', f: function (e) { return e.m.profit; }, fmt: moneyK, pal: BLUE },
    upf: { n: 'Units per facing', kind: 'q', f: function (e) { return e.upf; }, fmt: function (v) { return fmt(v) + '/facing'; }, pal: BLUE },
    attn: { n: 'Customer attention (modeled)', kind: 'q', f: function (e) { return attIndex(e); }, fmt: function (v) { return v + '/100'; }, pal: WARM },
    oos: { n: 'Stock-out risk', kind: 'q', f: function (e) { return e.m.risk; }, fmt: function (v) { return Math.round(v * 100) + '%'; }, pal: WARM },
    none: { n: 'No heat', f: null }
  };
  function heatPrep() {
    var H = HEATS[S.heat]; S.bins = null; if (!H || !H.f || !entries.length) return;
    var tf = 0, ts = 0; entries.forEach(function (e) { tf += e.it.fac; ts += e.m.sales; });
    entries.forEach(function (e) { e.shareIdx = ts > 0 && tf > 0 ? (e.m.sales / ts) / (e.it.fac / tf) : 1; });
    var cls, ed, cv = H.f, lo = null, hi = null, qn = ['bottom 20%', '20–40%', 'middle 20%', '60–80%', 'top 20%'], f = H.fmt;
    if (H.kind === 'tier') {
      var srt = entries.slice().sort(function (a, b) { return b.m.sales - a.m.sales; }), cum = 0, maxC = 0, maxB = 0, tot = 0; srt.forEach(function (e) { tot += Math.max(0, e.m.sales); });
      srt.forEach(function (e) { var before = tot ? cum / tot : 0; e.hb = before < 0.7 ? 2 : before < 0.9 ? 1 : 0; cum += Math.max(0, e.m.sales); if (e.hb === 0) maxC = Math.max(maxC, e.m.sales); if (e.hb === 1) maxB = Math.max(maxB, e.m.sales); });
      ed = [maxC, maxB]; cls = [{ c: TIER[0], dark: false, label: 'C · last 10%', name: 'C tier (long tail)', tag: 'C' }, { c: TIER[1], dark: false, label: 'B · next 20%', name: 'B tier', tag: 'B' }, { c: TIER[2], dark: true, label: 'A · first 70%', name: 'A tier (core sellers)', tag: 'A' }];
    } else if (H.kind === 'delta') {
      cv = function (e) { var hs = S.baseLoc[e.it.pid] ? P[e.it.pid].sales : 0; return hs > 0 ? e.m.sales / hs - 1 : 9.99; }; ed = [-0.2, -0.03, 0.03, 0.2]; lo = -0.5; hi = 0.5;
      cls = [{ label: '≤-20%', name: 'big loss' }, { label: '-20 to -3%', name: 'loss' }, { label: '±3% (flat)', name: 'no change' }, { label: '+3 to +20%', name: 'gain' }, { label: '>+20%', name: 'big gain' }].map(function (o, k) { o.c = DIV[k]; o.dark = k === 0 || k === 4; return o; });
      entries.forEach(function (e) { var v = cv(e), k = 0; while (k < 4 && v > ed[k]) k++; e.hb = k; });
    } else if (H.kind === 'share') {
      ed = [0.5, 0.8, 1.25, 2]; lo = 0; hi = 3;
      cls = [{ label: '<0.5× over-spaced', name: 'over-spaced' }, { label: '0.5–0.8×', name: 'slightly over-spaced' }, { label: '0.8–1.25× fair', name: 'fair share' }, { label: '1.25–2×', name: 'slightly under-spaced' }, { label: '>2× under-spaced', name: 'under-spaced' }].map(function (o, k) { o.c = DIV[4 - k] === DIV[4 - k] ? DIV[k] : DIV[k]; o.dark = k === 0 || k === 4; return o; });
      entries.forEach(function (e) { var v = e.shareIdx, k = 0; while (k < 4 && v > ed[k]) k++; e.hb = k; });
    } else {
      var vals = entries.map(cv).sort(function (a, b) { return a - b; }); ed = [0.2, 0.4, 0.6, 0.8].map(function (q) { return vals[Math.floor(q * (vals.length - 1))]; });
      cls = H.pal.map(function (c, k) { var lb = k === 0 ? '≤' + f(ed[0]) : k === 4 ? '>' + f(ed[3]) : f(ed[k - 1]) + '–' + f(ed[k]); return { c: c, dark: k >= 3, label: lb, name: qn[k] }; });
      entries.forEach(function (e) { var v = cv(e), k = 0; while (k < 4 && v > ed[k]) k++; e.hb = k; });
    }
    var cnt = cls.map(function () { return 0; }); entries.forEach(function (e) { e.hv = H.f(e); cnt[e.hb]++; });
    var cvals = entries.map(cv), mn = lo != null ? lo : Math.min.apply(null, cvals), mx = hi != null ? hi : Math.max.apply(null, cvals); if (mx <= mn) mx = mn + 1;
    var hist = []; for (var i = 0; i < 14; i++) hist.push(0); cvals.forEach(function (v) { hist[clamp(Math.floor((v - mn) / (mx - mn) * 14), 0, 13)]++; });
    S.bins = { H: H, ed: ed, cls: cls, cnt: cnt, hist: hist, mn: mn, mx: mx, kindNote: H.kind === 'tier' ? 'A = items making the first 70% of sales' : H.kind === 'delta' ? 'Flat until you change the layout' : H.kind === 'share' ? 'Sales share ÷ shelf-facing share' : 'Equal-sized classes (quintiles)' };
  }
  function classOf(B, v) { var k = 0; while (k < B.ed.length && v > B.ed[k]) k++; return k; }
  var legendKey = '';
  function renderHeatLegend() {
    var B = S.bins, box = $('heatLegend'), key = B ? [S.heat, S.binFocus, B.cnt.join(','), B.ed.join(',')].join('|') : 'none';
    if (key === legendKey) return; legendKey = key; while (box.firstChild) box.removeChild(box.firstChild);
    if (!B) { box.style.display = 'none'; return; } box.style.display = 'flex';
    var t = h('div', 'lt'); t.appendChild(h('b', null, B.H.n)); t.appendChild(h('span', 'muted', B.kindNote + ' · click a class to spotlight')); box.appendChild(t);
    var hc = document.createElement('canvas'); hc.className = 'ch'; var hw = 96, hh2 = 30, d = window.devicePixelRatio || 1; hc.width = hw * d; hc.height = hh2 * d; hc.style.width = hw + 'px'; hc.style.height = hh2 + 'px'; hc.title = 'Distribution of products';
    var g = hc.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); var mxh = Math.max.apply(null, B.hist.concat([1])), bwd = hw / B.hist.length;
    B.hist.forEach(function (ct, i) { var v = B.mn + (i + 0.5) / B.hist.length * (B.mx - B.mn), k = classOf(B, v), bh = (hh2 - 2) * ct / mxh; g.fillStyle = B.cls[k].c; g.fillRect(i * bwd, hh2 - bh, bwd - 1, bh); g.strokeStyle = 'rgba(0,0,0,.3)'; g.strokeRect(i * bwd + 0.5, hh2 - bh + 0.5, bwd - 2, Math.max(0, bh - 1)); });
    box.appendChild(hc);
    var sw = h('div', 'sws'); B.cls.forEach(function (c, k) {
      var b = h('button', 'sw' + (S.binFocus === k ? ' on2' : '')); b.style.background = c.c; b.style.color = c.dark ? '#fff' : '#111'; b.appendChild(h('span', 'a', c.label)); b.appendChild(h('span', 'b', B.cnt[k] + ' items'));
      b.onclick = function () { S.binFocus = S.binFocus === k ? null : k; drawElev(); }; sw.appendChild(b);
    }); box.appendChild(sw);
  }
  function heatRank(e) { var r = 1; entries.forEach(function (o) { if (o.hv > e.hv) r++; }); return r; }
  function drawTile(g, e, x, y, w, hh, ghost) {
    var p = P[e.it.pid], B = S.bins, dim = (S.layer.spot && !e.flag) || (S.brandFocus && brandOf(e.it) !== S.brandFocus) || (B && S.binFocus != null && e.hb !== S.binFocus) ? 0.25 : 1;
    var compact = views.elev.s * w < 80, strip = compact ? 15 : 26, barH = 22, ay = y + strip, ah = hh - strip - barH, col = B ? B.cls[e.hb].c : null;
    g.globalAlpha = ghost ? 0.55 : dim; g.fillStyle = '#fff'; g.fillRect(x, y, w, hh);
    art(g, x, ay, w, ah, p.sub, hashHue(p.name));
    if (col && S.heat !== 'attn') { g.globalAlpha = (ghost ? 0.55 : dim) * S.opU; g.fillStyle = col; g.fillRect(x, ay, w, ah); g.globalAlpha = ghost ? 0.55 : dim; }
    g.fillStyle = 'rgba(255,255,255,.96)'; g.fillRect(x, y, w, strip);
    if (S.layer.blocks) { g.fillStyle = BCOL[brandOf(e.it)] || '#888'; g.fillRect(x, y, w, 4); }
    g.fillStyle = '#1f2430'; g.textBaseline = 'top';
    if (compact) { g.font = 'bold ' + fs(9) + 'px sans-serif'; var br = brandOf(e.it); while (br.length > 3 && g.measureText(br).width > w - 4) br = br.slice(0, -1); g.fillText(br, x + 2, y + 5); }
    else if (S.layer.labels) { g.font = fs(7.4) + 'px sans-serif'; wrapText(g, p.name, w - 4, 3).forEach(function (ln, i) { g.fillText(ln, x + 2, y + 5 + i * fs(7)); }); }
    g.fillStyle = col || '#4a5468'; g.fillRect(x, y + hh - barH, w, barH);
    g.fillStyle = col ? (B.cls[e.hb].dark ? '#fff' : '#111') : '#fff'; g.textBaseline = 'middle';
    var vtxt = B ? (B.cls[e.hb].tag ? B.cls[e.hb].tag + ' \u00B7 ' : '') + B.H.fmt(e.hv) : fmt(e.m.units) + ' u'; g.font = 'bold ' + fs(vtxt.length > 8 && compact ? 9 : 12) + 'px sans-serif'; g.fillText(vtxt, x + 3, y + hh - barH / 2);
    if (S.heat !== 'oos' && e.m.risk >= 0.3) { g.fillStyle = '#b91c1c'; g.fillRect(x + w - 15, y + hh - barH - 11, 14, 10); g.fillStyle = '#fff'; g.font = 'bold ' + fs(7) + 'px sans-serif'; g.fillText('OOS', x + w - 14, y + hh - barH - 6); }
    var ch = Math.abs(e.m.units - p.units) > 0.5 && (S.heat === 'units' || S.heat === 'sales' || S.heat === 'profit'); if (ch && w > 60) { var dd = e.m.units / p.units - 1; g.font = fs(8) + 'px sans-serif'; g.textAlign = 'right'; g.fillText((dd > 0 ? '+' : '') + (dd * 100).toFixed(0) + '%', x + w - 3, y + hh - barH / 2); g.textAlign = 'left'; }
    if (S.heat === 'oos') {
      var rk = e.m.risk, cov = clamp(e.m.cover / 14, 0, 1);
      g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(x, ay, 6, ah); g.fillStyle = rk >= 0.3 ? '#b91c1c' : rk >= 0.1 ? '#d97706' : '#2563eb'; g.fillRect(x, ay + ah * (1 - cov), 6, ah * cov); g.strokeStyle = '#fff'; g.lineWidth = 1; g.strokeRect(x, ay, 6, ah);
    }
    g.globalAlpha = ghost ? 0.55 : 1;
    g.strokeStyle = '#8d93a0'; g.lineWidth = 0.6; g.strokeRect(x, y, w, hh);
    if (e.flag) {
      g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(x + 1, y + 1, w - 2, hh - 2);
      g.strokeStyle = '#d4231a'; g.lineWidth = 3; g.setLineDash([6, 3]); g.strokeRect(x + 1, y + 1, w - 2, hh - 2); g.setLineDash([]);
      g.fillStyle = '#d4231a'; g.beginPath(); g.arc(x + w - 8, y + strip + 8, 7.5, 0, 6.3); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', x + w - 8, y + strip + 8.5); g.textAlign = 'left';
    }
    if (!ghost && e.it.fac < 3) {
      var px = x + 3, py = ay + 3; g.globalAlpha = dim; g.fillStyle = '#1f4e9c'; g.fillRect(px, py, 15, 15); g.strokeStyle = '#fff'; g.lineWidth = 1; g.strokeRect(px + 0.5, py + 0.5, 14, 14);
      g.fillStyle = '#fff'; g.font = 'bold 13px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('+', px + 7.5, py + 8); g.textAlign = 'left'; g.globalAlpha = 1;
      S.plusHit.push({ x: px, y: py, w: 15, h: 15, e: e });
    }
    if (S.sel && S.sel.kind === 'item' && S.sel.it === e.it) { g.strokeStyle = '#0b5fff'; g.lineWidth = 3; g.strokeRect(x - 1, y - 1, w + 2, hh + 2); }
    g.globalAlpha = 1; g.lineWidth = 1;
  }
  function attY(y) { var d = y - (LH + SHH * 1.5), sg = d < 0 ? SHH : SHH * 1.5; return Math.exp(-Math.pow(d / sg, 2)); }
  function attIndex(e) { return Math.round(100 * e.attn / S.maxAttn * attY(LH + e.lvl * SHH + SHH - 7 - TH / 2)); }
  function drawElev() {
    var c = cv.elev, g = c.getContext('2d'), V = views.elev; heatPrep(); S.plusHit = [];
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, c._w, c._h); g.fillStyle = '#f4f5f8'; g.fillRect(0, 0, c._w, c._h);
    g.setTransform(dpr * V.s, 0, 0, dpr * V.s, dpr * V.tx, dpr * V.ty);
    g.textBaseline = 'middle';
    // level labels + eye-level band
    g.fillStyle = 'rgba(255, 214, 102, .28)'; g.fillRect(0, LH + SHH, OX + NB * BW + 8, SHH);
    LEVELS.forEach(function (L, i) { g.fillStyle = i === 1 ? '#7a4b00' : '#4a5468'; g.font = 'bold ' + fs(10) + 'px sans-serif'; g.fillText(L.n, 4, LH + i * SHH + SHH / 2 - 6); g.font = fs(8) + 'px sans-serif'; g.fillText('×' + L.f.toFixed(2), 4, LH + i * SHH + SHH / 2 + 7); });
    // density strip: smoothed sales density along the aisle (top = scenario, bottom = baseline), shared scale
    var byS = [0, 0, 0, 0], totS = 0, sideCh = S.side === 0 ? 'A' : 'B', pts = [], bpts = [];
    entries.forEach(function (e) { if (e.slot.side === S.side) { byS[e.slot.pos] += e.m.sales; totS += e.m.sales; } });
    slots.forEach(function (sl) { if (sl.side !== S.side) return; sl.shelves.forEach(function (sh) { var cur = 0; sh.forEach(function (it) { pts.push([OX + sl.pos * BW + 2 + (cur + it.fac / 2) * SLOTW, it._e.m.sales]); cur += it.fac; }); }); });
    Object.keys(S.baseLoc).forEach(function (pid) { var bl = S.baseLoc[pid]; if (bl.bay.charAt(0) === sideCh && P[pid]) { var bi = +bl.bay.charAt(1) - 1; for (var u = 0; u < 4; u++) bpts.push([OX + bi * BW + (u + 0.5) * BW / 4, P[pid].sales / 4]); } });
    if (S.layer.marg) {
      var ns = 160, stp = NB * BW / ns, dS = [], dB = [], mxD = 1e-6, kk;
      for (kk = 0; kk < ns; kk++) { var xx = OX + (kk + 0.5) * stp, a = 0, b = 0; pts.forEach(function (p) { a += p[1] * Math.exp(-Math.pow((xx - p[0]) / (SLOTW * 0.9), 2)); }); bpts.forEach(function (p) { b += p[1] * Math.exp(-Math.pow((xx - p[0]) / (SLOTW * 0.9), 2)); }); dS.push(a); dB.push(b); mxD = Math.max(mxD, a, b); }
      for (kk = 0; kk < ns; kk++) { g.fillStyle = css(lerpPal(BLUE, Math.pow(dS[kk] / mxD, 0.7)), 1); g.fillRect(OX + kk * stp, 3, stp + 0.6, 7); g.fillStyle = css(lerpPal(BLUE, Math.pow(dB[kk] / mxD, 0.7)), 1); g.fillRect(OX + kk * stp, 11, stp + 0.6, 7); }
      g.strokeStyle = '#8d93a0'; g.lineWidth = 0.8; g.strokeRect(OX, 3, NB * BW, 7); g.strokeRect(OX, 11, NB * BW, 7); for (kk = 1; kk < NB; kk++) { g.beginPath(); g.moveTo(OX + kk * BW, 2); g.lineTo(OX + kk * BW, 19); g.stroke(); } g.lineWidth = 1;
      g.fillStyle = '#566074'; g.font = '7.5px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('Sales: scenario', 4, 7); g.fillText('Sales: baseline', 4, 15);
      // vertical strip: sales density by shelf height (left = scenario, right = baseline)
      var vn = 90, vh = SH * SHH / vn, vS = [], vB = [], mxV = 1e-6, vi, lvS = [0, 0, 0, 0], ysg = SHH * 0.5, yOf = function (l) { return LH + l * SHH + SHH - 7 - TH / 2; };
      entries.forEach(function (e) { if (e.slot.side === S.side) lvS[e.lvl] += e.m.sales; });
      for (vi = 0; vi < vn; vi++) {
        var yy = LH + (vi + 0.5) * vh, a2 = 0, b2 = 0;
        entries.forEach(function (e) { if (e.slot.side === S.side) a2 += e.m.sales * Math.exp(-Math.pow((yy - yOf(e.lvl)) / ysg, 2)); });
        Object.keys(S.baseLoc).forEach(function (pid) { var bl = S.baseLoc[pid]; if (bl.bay.charAt(0) === sideCh && P[pid]) b2 += P[pid].sales * Math.exp(-Math.pow((yy - yOf(bl.lvl)) / ysg, 2)); });
        vS.push(a2); vB.push(b2); mxV = Math.max(mxV, a2, b2);
      }
      for (vi = 0; vi < vn; vi++) { g.fillStyle = css(lerpPal(BLUE, Math.pow(vS[vi] / mxV, 0.7)), 1); g.fillRect(44, LH + vi * vh, 8, vh + 0.6); g.fillStyle = css(lerpPal(BLUE, Math.pow(vB[vi] / mxV, 0.7)), 1); g.fillRect(53, LH + vi * vh, 8, vh + 0.6); }
      g.strokeStyle = '#8d93a0'; g.lineWidth = 0.8; g.strokeRect(44, LH, 8, SH * SHH); g.strokeRect(53, LH, 8, SH * SHH); g.lineWidth = 1;
      g.fillStyle = '#566074'; g.font = '7.5px sans-serif'; g.textAlign = 'center'; g.fillText('Scen', 48, LH - 7); g.fillText('Base', 57, LH - 7); g.textAlign = 'left';
      var lvT = lvS[0] + lvS[1] + lvS[2] + lvS[3]; lvS.forEach(function (v, i) { g.fillStyle = '#1f2430'; g.font = 'bold ' + fs(8.5) + 'px sans-serif'; g.fillText((lvT ? Math.round(v / lvT * 100) : 0) + '% sales', 4, LH + i * SHH + SHH / 2 + 20); });
    }
    if (S.heat === 'attn') {
    var sg = g.createLinearGradient(0, LH, 0, LH + SH * SHH); for (var q = 0; q <= 16; q++) { var tq = attY(LH + SH * SHH * q / 16); sg.addColorStop(q / 16, css(ramp('m', tq), 0.15 + 0.85 * tq)); }
    g.fillStyle = sg; g.fillRect(OX - 14, LH, 9, SH * SHH); g.strokeStyle = '#8d93a0'; g.strokeRect(OX - 14, LH, 9, SH * SHH);
    g.save(); g.translate(OX - 17, LH + SH * SHH / 2); g.rotate(-Math.PI / 2); g.fillStyle = '#4a5468'; g.font = 'bold ' + fs(8) + 'px sans-serif'; g.textAlign = 'center'; g.fillText('Customer attention by height', 0, 0); g.restore(); g.textAlign = 'left';
    }
    for (var i = 0; i < NB; i++) {
      var sl = slots[S.side * 4 + i], x0 = OX + i * BW, cells = [];
      g.fillStyle = '#e5e1d8'; g.fillRect(x0, LH - 4, BW, SH * SHH + 6);
      g.fillStyle = '#1f2430'; g.font = 'bold ' + fs(12) + 'px sans-serif'; g.textBaseline = 'middle';
      g.fillText('Bay ' + bayName(sl) + ' · ' + sl.sub, x0 + 4, LH - 17);
      var shT = (totS ? Math.round(byS[i] / totS * 100) : 0) + '% of sales'; g.font = '9px sans-serif'; g.textAlign = 'right'; g.fillStyle = '#566074'; g.fillText(shT, x0 + BW - 4, LH - 17); var shW = g.measureText(shT).width;
      if (sl.flags) { g.fillStyle = '#d4231a'; g.font = 'bold ' + fs(10) + 'px sans-serif'; g.fillText('⚠ ' + sl.flags, x0 + BW - 10 - shW, LH - 17); } g.textAlign = 'left';
      for (var s = 0; s < SH; s++) {
        var y = LH + s * SHH, cur = x0 + 2, sh = sl.shelves[s];
        g.fillStyle = '#8f8574'; g.fillRect(x0, y + SHH - 7, BW, 7);
        sh.forEach(function (it) { var w = it.fac * SLOTW; if (!(drag && drag.active && drag.e.it === it)) drawTile(g, it._e, cur, y + SHH - 7 - TH, w - 3, TH, false); else { g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(cur, y + SHH - 7 - TH, w - 3, TH); } cells.push({ it: it, x: cur, w: w - 3, s: s }); cur += w; });
        if (S.layer.blocks) {
          var rx = x0 + 2, run = null, runs = [];
          sh.forEach(function (it) { var b = brandOf(it), w2 = it.fac * SLOTW; if (run && run.b === b) run.w += w2; else { run = { b: b, x: rx, w: w2 }; runs.push(run); } rx += w2; });
          runs.forEach(function (r) {
            var ty = y + SHH - 7 - TH - 13, wd = r.w - 3; g.fillStyle = BCOL[r.b] || '#888'; g.fillRect(r.x, ty, wd, 11);
            g.fillStyle = lum(hexRgb(BCOL[r.b] || '#888888')) > 0.6 ? '#111' : '#fff'; g.font = 'bold ' + fs(8) + 'px sans-serif'; g.textBaseline = 'middle'; g.fillText(wd > 40 ? r.b : r.b.slice(0, 5), r.x + 2, ty + 5.5);
          });
        }
        var free = SLOTS - shelfW(sh);
        if (free > 0) {
          var sel = S.sel && S.sel.kind === 'shelf' && S.sel.slot === sl && S.sel.lvl === s;
          g.strokeStyle = sel ? '#0b5fff' : '#9aa1ae'; g.lineWidth = sel ? 2.5 : 1; g.setLineDash([4, 3]); g.strokeRect(cur, y + SHH - 7 - TH, free * SLOTW - 3, TH); g.setLineDash([]); g.lineWidth = 1;
          g.fillStyle = '#6a7487'; g.font = fs(9) + 'px sans-serif'; g.textAlign = 'center'; g.fillText('+ add', cur + (free * SLOTW - 3) / 2, y + SHH - 7 - TH / 2); g.textAlign = 'left';
        }
      }
      if (S.heat === 'attn') cells.forEach(function (c) {
        if (drag && drag.active && drag.kind === 'item' && drag.e.it === c.it) return;
        var e = c.it._e, ty = LH + c.s * SHH + SHH - 7 - TH, f = e.attn / S.maxAttn, gr = g.createLinearGradient(0, ty, 0, ty + TH);
        for (var k = 0; k <= 4; k++) { var t = attY(ty + TH * k / 4) * f; gr.addColorStop(k / 4, css(ramp('m', t), S.opA * (0.15 + 0.85 * t))); }
        g.fillStyle = gr; g.fillRect(c.x, ty, c.w, TH);
      });
      if (S.sel && S.sel.kind === 'bay' && S.sel.slot === sl) { g.strokeStyle = '#0b5fff'; g.lineWidth = 3; g.strokeRect(x0 - 1, LH - 5, BW + 2, SH * SHH + 8); g.lineWidth = 1; }
    }
    if (drag && drag.active && drag.kind === 'item') { var gw = drag.e.it.fac * SLOTW - 3; drawTile(g, drag.e, drag.wx - gw / 2, drag.wy - TH / 2, gw, TH, true); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    S.legendHit = []; renderHeatLegend();
    g.fillStyle = '#d4231a'; g.font = 'bold 11px sans-serif'; g.textBaseline = 'middle'; g.fillText('Red dashed = underperformer', 10, c._h - 14);
    var tr = trashRect(c), over = drag && drag.active && drag.kind === 'item' && drag.overTrash;
    g.fillStyle = over ? '#d4231a' : 'rgba(255,255,255,.95)'; g.fillRect(tr.x, tr.y, tr.w, tr.h); g.strokeStyle = '#d4231a'; g.lineWidth = over ? 3 : 1.5; g.setLineDash(over ? [] : [5, 3]); g.strokeRect(tr.x, tr.y, tr.w, tr.h); g.setLineDash([]); g.lineWidth = 1;
    g.fillStyle = over ? '#fff' : '#d4231a'; g.textAlign = 'center'; g.font = '22px sans-serif'; g.fillText('🗑', tr.x + tr.w / 2, tr.y + 20); g.font = 'bold 10px sans-serif'; g.fillText('Drop to delist', tr.x + tr.w / 2, tr.y + 43); g.textAlign = 'left';
  }
  function trashRect(c) { return { x: c._w - 112, y: c._h - 64, w: 104, h: 54 }; }
  function inTrash(p) { var t = trashRect(cv.elev); return p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h; }
  function legendBar(g, x, y, title, set, lo, hi) {
    g.fillStyle = 'rgba(255,255,255,.92)'; g.fillRect(x - 6, y - 14, 184, 44);
    g.fillStyle = '#1f2430'; g.font = 'bold 10px sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(title, x, y - 6);
    var gr = g.createLinearGradient(x, 0, x + 170, 0); for (var i = 0; i <= 8; i++) gr.addColorStop(i / 8, css(ramp(set, i / 8), 1));
    g.fillStyle = gr; g.fillRect(x, y + 3, 170, 8); g.fillStyle = '#1f2430'; g.font = '10px sans-serif'; g.fillText(lo, x, y + 20); g.textAlign = 'right'; g.fillText(hi, x + 170, y + 20); g.textAlign = 'left';
  }

  function drawPlan() {
    var c = cv.plan, g = c.getContext('2d'), V = views.plan, d = planDims(), W = S.aisleW;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, c._w, c._h); g.fillStyle = '#f4f5f8'; g.fillRect(0, 0, c._w, c._h);
    g.setTransform(dpr * V.s, 0, 0, dpr * V.s, dpr * V.tx, dpr * V.ty); g.textBaseline = 'middle';
    g.fillStyle = '#ece7dc'; g.fillRect(PX0 - 40, d.top, NB * BW + 80, W);
    if (S.layer.floor && S.grid) { g.save(); g.globalAlpha = S.opF; g.imageSmoothingEnabled = true; g.drawImage(S.grid.off, S.grid.x0, d.top, S.grid.gw * S.grid.cell, S.grid.gh * S.grid.cell * (W / (S.grid.gh * S.grid.cell))); g.restore(); }
    g.strokeStyle = 'rgba(0,0,0,.18)'; g.setLineDash([3, 4]); for (var gx = 0; gx <= NB * BW; gx += 50) { g.beginPath(); g.moveTo(PX0 + gx, d.top); g.lineTo(PX0 + gx, d.bot); g.stroke(); } g.setLineDash([]);
    slots.forEach(function (sl) {
      var x = PX0 + sl.pos * BW, y = sl.side === 0 ? 14 : d.bot, isSel = S.sel && S.sel.slot === sl && (S.sel.kind === 'bay');
      var inView = sl.side === S.side;
      g.fillStyle = inView ? '#d6dbe6' : '#e4e7ee'; g.fillRect(x + 2, y, BW - 4, SHD); g.strokeStyle = isSel ? '#0b5fff' : '#7b8495'; g.lineWidth = isSel ? 3 : 1; g.strokeRect(x + 2, y, BW - 4, SHD); g.lineWidth = 1;
      g.fillStyle = '#1f2430'; g.font = 'bold ' + fs(12) + 'px sans-serif'; g.fillText(bayName(sl) + ' · ' + sl.sub, x + 8, y + 13);
      g.font = fs(10) + 'px sans-serif'; g.fillText(fmt(sl.units) + ' units · ' + money(sl.profit) + ' profit', x + 8, y + 29);
      g.fillText('Dwell ≈ ' + sl.dwell.toFixed(1) + ' s/shopper · ' + pct(sl.stopP) + ' stop', x + 8, y + 44);
      if (sl.flags) { g.fillStyle = '#d4231a'; g.font = 'bold ' + fs(11) + 'px sans-serif'; g.textAlign = 'right'; g.fillText('⚠ ' + sl.flags, x + BW - 8, y + 13); g.textAlign = 'left'; }
    });
    if (drag && drag.active && drag.kind === 'bay') { g.fillStyle = 'rgba(11,95,255,.35)'; g.fillRect(drag.wx - BW / 2, drag.wy - SHD / 2, BW - 4, SHD); }
    // shoppers
    if (S.layer.shoppers) shoppers.forEach(function (s) { g.fillStyle = s.wait > 0 ? '#ff9f1a' : '#111'; g.strokeStyle = '#fff'; g.lineWidth = 1.2; g.beginPath(); g.arc(s.x, s.y, 4, 0, 6.3); g.fill(); g.stroke(); });
    // entrance / exit
    g.fillStyle = '#1f2430'; g.font = 'bold ' + fs(11) + 'px sans-serif'; g.textAlign = 'center'; g.fillText('▶ ENTRANCE', PX0 - 22, d.top + W / 2 - 8); g.fillText('EXIT ▶', PX0 + NB * BW + 28, d.top + W / 2 - 8); g.textAlign = 'left';
    g.font = fs(10) + 'px sans-serif'; g.fillStyle = '#4a5468'; g.fillText('Aisle width ' + (W / 20).toFixed(1) + ' ft · ' + S.traffic + ' shoppers/hr (model)', PX0, d.bot + SHD + 18);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var nm = S.floorMode === 'dwell' ? 'Dwell time (modeled)' : S.floorMode === 'density' ? 'Traffic density (modeled)' : 'Dwell + density (modeled)';
    if (S.layer.floor) legendBar(g, c._w - 190, c._h - 30, 'Floor: ' + nm, 'm', 'low', 'high');
  }
  function drawAll() { drawElev(); drawPlan(); }

  // ---------------------------------------------------------------- shoppers (illustrative)
  function spawn() {
    var d = planDims(), lane = d.top + 18 + Math.random() * (S.aisleW - 36), wps = [{ x: PX0 - 30, y: lane, wait: 0 }], exitPos = Math.random() < EXIT ? Math.floor(Math.random() * NB) : NB;
    for (var pos = 0; pos < NB; pos++) {
      if (pos > exitPos) break;
      for (var side = 0; side < 2; side++) {
        var sl = slots[side * 4 + pos]; if (Math.random() < sl.stopP / surv(pos)) {
          var cx = PX0 + pos * BW + 40 + Math.random() * (BW - 80), ey = side === 0 ? d.top + 8 : d.bot - 8;
          wps.push({ x: cx, y: lane, wait: 0 }, { x: cx, y: ey, wait: sl.stopSec * (0.5 + Math.random()) / 6 }, { x: cx + 10, y: lane, wait: 0 });
        }
      }
    }
    wps.push({ x: exitPos >= NB ? PX0 + NB * BW + 40 : PX0 + (exitPos + 1) * BW, y: lane, wait: 0 });
    shoppers.push({ x: wps[0].x, y: wps[0].y, wp: wps, i: 1, wait: 0 });
  }
  function tick(ts) {
    var dt = Math.min(0.1, (ts - lastT) / 1000 || 0); lastT = ts;
    if (S.layer.shoppers && slots.length && S.mode === 'layout') {
      spawnAcc += dt; var iv = 60 / Math.max(10, S.traffic); while (spawnAcc > iv) { spawnAcc -= iv; if (shoppers.length < 70) spawn(); }
      shoppers.forEach(function (s) {
        if (s.wait > 0) { s.wait -= dt; return; }
        var t = s.wp[s.i]; if (!t) { s.done = true; return; }
        var dx = t.x - s.x, dy = t.y - s.y, dist = Math.sqrt(dx * dx + dy * dy), step = 110 * dt;
        if (dist <= step) { s.x = t.x; s.y = t.y; s.wait = t.wait; s.i++; } else { s.x += dx / dist * step; s.y += dy / dist * step; }
      });
      shoppers = shoppers.filter(function (s) { return !s.done; });
      drawPlan();
    }
    requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------- hit testing & interaction
  function elevHit(w) {
    var bi = Math.floor((w.x - OX) / BW), si = Math.floor((w.y - LH) / SHH); if (bi < 0 || bi >= NB || si < 0 || si >= SH) return null;
    var sl = slots[S.side * 4 + bi], rx = w.x - OX - bi * BW - 2, cur = 0, hit = { slot: sl, lvl: si, item: null, bay: true };
    sl.shelves[si].forEach(function (it) { var wd = it.fac * SLOTW; if (rx >= cur && rx < cur + wd && w.y > LH + si * SHH + SHH - 7 - TH - 2) hit.item = it; cur += wd; }); return hit;
  }
  function planHit(w) {
    var d = planDims(); for (var i = 0; i < slots.length; i++) { var sl = slots[i], x = PX0 + sl.pos * BW, y = sl.side === 0 ? 14 : d.bot; if (w.x >= x && w.x <= x + BW && w.y >= y && w.y <= y + SHD) return sl; } return null;
  }
  function tip(html, ev) { var t = $('tip'); if (!html) { t.style.display = 'none'; return; } while (t.firstChild) t.removeChild(t.firstChild); html.forEach(function (ln, i) { var d = h('div', null, ln); if (i === 0) d.style.fontWeight = '700'; t.appendChild(d); }); t.style.display = 'block'; t.style.left = Math.min(window.innerWidth - 270, ev.clientX + 14) + 'px'; t.style.top = Math.min(window.innerHeight - 110, ev.clientY + 14) + 'px'; }
  function itemTip(e) {
    var p = P[e.it.pid], m = e.m, l = [p.name, p.sub + ' · Bay ' + bayName(e.slot) + ' · ' + LEVELS[e.lvl].n + ' shelf · ' + e.it.fac + ' facing(s)', 'Units: ' + fmt(p.units) + ' hist → ' + fmt(m.units) + ' scenario', 'Sales ' + money(m.sales) + ' · Profit ' + money(m.profit) + ' (' + pct(m.margin) + ' margin)'];
    if (S.bins) l.push(S.bins.H.n + ': ' + S.bins.H.fmt(e.hv) + ' · rank ' + heatRank(e) + ' of ' + entries.length + ' (' + S.bins.cls[e.hb].name + ')');
    l.push('Shelf holds ' + fmt(m.cap) + ' units ≈ ' + (m.cover >= 99 ? '99+' : m.cover.toFixed(1)) + ' days of supply · stock-out risk ' + pct(m.risk) + (m.obs ? ' (observed)' : ' (modeled)'));
    l.push('Customer attention index ' + attIndex(e) + '/100 (modeled)');
    if (e.flag) l.push('⚠ ' + e.reasons.join(', ')); return l;
  }
  function wire() {
    ['elev', 'plan'].forEach(function (name) {
      var c = cv[name], V = views[name];
      c.addEventListener('wheel', function (ev) {
        if (name === 'plan') return; ev.preventDefault(); var p = loc(c, ev), w = toWorld(V, p), ns = clamp(V.s * (ev.deltaY < 0 ? 1.12 : 1 / 1.12), 0.25, 6); V.s = ns; V.tx = p.x - w.x * ns; V.ty = p.y - w.y * ns; name === 'elev' ? drawElev() : drawPlan();
      }, { passive: false });
      c.addEventListener('mousedown', function (ev) {
        var p = loc(c, ev), w = toWorld(V, p);
        if (name === 'elev') {
          for (var li = 0; li < S.legendHit.length; li++) { var lh = S.legendHit[li]; if (p.x >= lh.x && p.x <= lh.x + lh.w && p.y >= lh.y && p.y <= lh.y + lh.h) { S.binFocus = S.binFocus === lh.k ? null : lh.k; drawElev(); return; } }
          for (var pi = 0; pi < S.plusHit.length; pi++) { var ph = S.plusHit[pi]; if (w.x >= ph.x && w.x <= ph.x + ph.w && w.y >= ph.y && w.y <= ph.y + ph.h) { S.sel = { kind: 'item', it: ph.e.it }; addFacing(ph.e); return; } }
          var hit = elevHit(w);
          if (hit && hit.item) { S.sel = { kind: 'item', it: hit.item }; drag = { kind: 'item', e: hit.item._e, sx: p.x, sy: p.y, active: false, wx: w.x, wy: w.y }; renderBar(); drawElev(); return; }
          if (S.sel) { S.sel = null; renderBar(); drawElev(); }
        } else {
          var sl = planHit(w); if (sl) { S.side = sl.side; zoomBay(sl); renderBar(); drawAll(); return; }
        }
        if (name === 'plan') return;
        pan = { name: name, sx: p.x, sy: p.y, tx: V.tx, ty: V.ty }; c.style.cursor = 'grabbing';
      });
      c.addEventListener('mousemove', function (ev) {
        var p = loc(c, ev), w = toWorld(V, p);
        if (drag && name === 'elev') {
          if (!drag.active && Math.abs(p.x - drag.sx) + Math.abs(p.y - drag.sy) > 6) drag.active = true;
          drag.wx = w.x; drag.wy = w.y; drag.overTrash = inTrash(p); if (drag.active) { tip(null); drawElev(); } return;
        }
        if (pan && pan.name === name) { V.tx = pan.tx + p.x - pan.sx; V.ty = pan.ty + p.y - pan.sy; name === 'elev' ? drawElev() : drawPlan(); return; }
        if (name === 'elev') { var hit = elevHit(w), onPlus = S.plusHit.some(function (ph) { return w.x >= ph.x && w.x <= ph.x + ph.w && w.y >= ph.y && w.y <= ph.y + ph.h; }); tip(hit && hit.item ? itemTip(hit.item._e) : null, ev); c.style.cursor = onPlus || (hit && hit.item) ? 'pointer' : 'grab'; }
        else {
          var sl = planHit(w); if (sl) { tip(['Bay ' + bayName(sl) + ' · ' + sl.sub, fmt(sl.units) + ' units · ' + money(sl.profit) + ' profit', 'Modeled dwell ' + sl.dwell.toFixed(1) + ' s per passing shopper', 'Stops: ' + pct(sl.stopP) + ' of shoppers · ' + sl.flags + ' underperformer(s)', 'Click to show this bay'], ev); c.style.cursor = 'pointer'; }
          else if (S.grid && w.y > planDims().top && w.y < planDims().bot) { var gi = Math.floor((w.x - S.grid.x0) / S.grid.cell), gj = Math.floor((w.y - planDims().top) / S.grid.cell); if (gi >= 0 && gi < S.grid.gw && gj >= 0 && gj < S.grid.gh) { var k = gj * S.grid.gw + gi; tip(['Floor spot (modeled)', 'Dwell ≈ ' + S.grid.dw[k].toFixed(1) + ' s per shopper', 'Traffic density index ' + Math.round(100 * S.grid.dn[k] / S.grid.mn)], ev); } else tip(null); c.style.cursor = 'default'; }
          else { tip(null); c.style.cursor = 'default'; }
        }
      });
      c.addEventListener('mouseleave', function () { tip(null); });
    });
    window.addEventListener('mouseup', function (ev) {
      cv.elev.style.cursor = 'grab';
      pan = null;
      if (!drag) return; var d = drag; drag = null;
      if (d.active && inTrash(loc(cv.elev, ev))) { removeItem(d.e); toast('Delisted ' + shortN(d.e.it.pid)); return; }
      drawElev();
    });
    window.addEventListener('resize', function () { fitViews(); drawAll(); });
  }

  // ---------------------------------------------------------------- panels
  function removeItem(e) { var sh = e.slot.shelves[e.lvl]; sh.splice(sh.indexOf(e.it), 1); S.sel = null; recompute(); drawAll(); renderBar(); }
  function addFacing(e) {
    if (e.it.fac >= 3) { toast('Max 3 facings'); return; }
    if (shelfW(e.slot.shelves[e.lvl]) >= SLOTS) { toast('No room on this shelf'); return; }
    e.it.fac++; recompute(); drawAll(); renderBar();
  }
  function renderBar() {
    var b = $('bar'); while (b.firstChild) b.removeChild(b.firstChild);
    b.appendChild(h('span', 'title', 'Aisle Lab'));
    [['Side A (north)', 0], ['Side B (south)', 1]].forEach(function (s) { var x = h('button', S.side === s[1] ? 'on' : '', s[0]); x.onclick = function () { S.side = s[1]; renderBar(); drawAll(); }; b.appendChild(x); });
    var sel = S.sel && S.sel.kind === 'item' && S.sel.it._e ? S.sel.it._e : null, af = h('button', 'primary', sel ? 'Add facing (' + sel.it.fac + ' of 3)' : 'Add facing');
    af.disabled = !sel; af.title = 'Select a product, then add a facing'; af.onclick = function () { if (sel) addFacing(sel); }; b.appendChild(af);
    var f = h('button', '', 'Fit view'); f.onclick = function () { fitViews(); drawAll(); }; b.appendChild(f);
    var hl = h('label', 'row'); hl.style.margin = '0'; hl.appendChild(h('span', null, 'Shelf heat:')); var hs = h('select');
    [['tier', 'Sales tiers (A/B/C)'], ['units', 'Units sold'], ['sales', 'Sales'], ['profit', 'Profit'], ['none', 'None']].forEach(function (o) { var op = h('option', null, o[1]); op.value = o[0]; if (S.heat === o[0]) op.selected = true; hs.appendChild(op); });
    hs.onchange = function () { S.heat = hs.value; S.binFocus = null; drawElev(); }; hl.appendChild(hs); b.appendChild(hl);
    b.appendChild(h('span', 'badge' + (S.live ? '' : ' warn'), S.live ? 'Live Superstore data' : 'Preview data — add fields to the sheet'));
    $('elevCap').textContent = 'Planogram · Side ' + (S.side === 0 ? 'A' : 'B') + ' · click a product to select it · drag it to the bin to delist · scroll = zoom · drag background = pan';
    $('planCap').textContent = 'Aisle traffic flow (modeled) · click a bay to show its shelves';
  }
  function qLabel(i) { return Math.floor(i / 4) + ' Q' + (i % 4 + 1); }
  function reg(a) { var n = a.length, sx = 0, sy = 0, sxy = 0, sxx = 0, i; for (i = 0; i < n; i++) { sx += i; sy += a[i]; sxy += i * a[i]; sxx += i * i; } var d = n * sxx - sx * sx, b = d ? (n * sxy - sx * sy) / d : 0; return { b: b, a: (sy - b * sx) / n }; }
  function sum(a) { var s = 0; a.forEach(function (v) { s += v; }); return s; }
  function trendStats(p) {
    var n = p.hu.length, w = p.hu.slice(Math.max(0, n - 12)), r = reg(w), l4 = p.hu.slice(n - 4), p4 = n >= 8 ? p.hu.slice(n - 8, n - 4) : null;
    var mean4 = sum(l4) / 4, mean = sum(w) / w.length, slopePct = mean > 0 ? r.b / mean : 0, yoy = p4 && sum(p4) > 0 ? sum(l4) / sum(p4) - 1 : null, prior = sum(p.hu.slice(Math.max(0, n - 6), n - 2));
    var st = 'Stable';
    if (sum(p.hu.slice(n - 2)) === 0 && prior > 0) st = 'Stalled';
    else if (slopePct < -0.04 && (yoy == null || yoy < -0.15)) st = 'Declining';
    else if (slopePct > 0.04 && (yoy == null || yoy > 0.15)) st = 'Growing';
    var wq = p.hu.slice(Math.max(0, n - 8)), mq = sum(wq) / wq.length, vq = 0; wq.forEach(function (v) { vq += Math.pow(v - mq, 2); }); p.cv = mq > 0 ? clamp(Math.sqrt(vq / wq.length) / mq, 0.3, 1) : 0.5;
    p.tr = { slope: r.b, slopePct: slopePct, yoy: yoy, mean4: mean4, last: p.hu[n - 1], status: st };
  }

  // ---------------------------------------------------------------- boot
  function col(cols, re) { for (var i = 0; i < cols.length; i++) if (re.test(cols[i].fieldName)) return i; return -1; }
  function num(c) { var v = Number(c.value); return isFinite(v) ? v : 0; }
  function qOf(c) {
    var f = String(c.formattedValue), v = c.value, m = f.match(/Q([1-4])/i), y = f.match(/(?:19|20)\d\d/);
    if (m && y) return +y[0] * 4 + (+m[1] - 1);
    if (typeof v === 'string' && /^\d{4}-\d{2}/.test(v)) return +v.slice(0, 4) * 4 + Math.floor((+v.slice(5, 7) - 1) / 3);
    var d = new Date(f); if (!isNaN(d.getTime()) && /(?:19|20)\d\d/.test(f)) return d.getFullYear() * 4 + Math.floor(d.getMonth() / 3);
    return null;
  }
  function fetchLive() {
    worksheet.getSummaryDataAsync({ maxRows: 0 }).then(function (data) {
      var cs = data.columns, idt = col(cs, /order date/i), ip = col(cs, /^product name$/i), is = col(cs, /sub-?category/i), iq = col(cs, /quantity/i), ia = col(cs, /sales/i), ig = col(cs, /profit/i);
      if (ip < 0 || is < 0 || iq < 0 || ia < 0 || ig < 0) { S.live = false; renderBar(); toast('Add Product Name, Sub-Category, Quantity, Sales, Profit to the sheet'); return; }
      var bad = 0, rows = data.data.map(function (r) { var q = idt >= 0 ? qOf(r[idt]) : null; if (idt >= 0 && q == null) bad++; return [String(r[ip].formattedValue), String(r[is].formattedValue), num(r[iq]), num(r[ia]), num(r[ig]), q]; });
      S.live = true; loadRows(rows); drawAll(); if (bad) toast(bad + ' rows had a date without a year, so trends are off. Use Month or Quarter with year, or Exact Date.');
    }, function (err) { toast('Data error: ' + (err && err.message ? err.message : err)); });
  }
  window.onload = function () {
    try {
      cv.elev = $('elev'); cv.plan = $('plan'); wire(); renderBar();
      if (window.ResizeObserver) new ResizeObserver(function () { if (S.mode !== 'layout') return; sizeCanvas(cv.elev); sizeCanvas(cv.plan); drawAll(); }).observe($('main'));
      loadRows(sampleRows()); drawAll(); requestAnimationFrame(tick);
    } catch (e) { logE(e); document.body.appendChild(h('pre', null, 'Init error: ' + e)); }
    tableau.extensions.initializeAsync().then(function () {
      worksheet = tableau.extensions.worksheetContent.worksheet;
      worksheet.addEventListener(tableau.TableauEventType.SummaryDataChanged, fetchLive);
      fetchLive();
    }, function (err) { toast('Init error: ' + (err && err.message ? err.message : err)); });
  };
})();
