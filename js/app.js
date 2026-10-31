"use strict";
// ======================================================================
// PAGE SCRIPT (uses the core model above)
// ======================================================================
const state = {
  m: 4, mAuto: false, L: 8, inlet: "one", angle: 50, pairs: "auto", tert: 0, chw: 20, thr: 100,
  model: "A", Ls: 2000, D: 2000, kc: 0.089, Ct: 0.3, crit: 50, T: 60, dx: 20, rel: 5,
  view: "conc", frame: 30,
};
const params = () => ({
  m: state.mAuto ? "auto" : state.m, L: state.L, inlet: state.inlet, angle: state.angle, pairs: state.pairs, tert: state.tert,
  chw: state.chw, thr: state.thr, model: state.model, Ls: state.Ls, D: state.D, kc: state.kc,
  C0: 1, Cinit: 0, Ct: state.Ct, crit: state.crit, T: state.T, dx: state.dx,
});
const $ = id => document.getElementById(id);
const fmtMM = v => (v / 1000).toFixed(2);
const fx = (v, d) => (v === null || v === undefined || !isFinite(v)) ? "—" : (+v).toFixed(d);

// ---------------- workers ----------------
// Worker: js/worker.js가 core.js를 불러와 계산합니다.
// file://로 직접 열면 브라우저가 Worker를 막을 수 있어, 그때는 메인 스레드에서 같은 계산을 합니다.
function makeWorker(onFail) {
  try {
    const w = new Worker("js/worker.js");
    w.onmessage = e => onTaskMessage(e.data);
    w.onerror = e => { e.preventDefault && e.preventDefault(); onFail && onFail(); };
    return w;
  } catch (err) { return null; }
}
const lanes = { sim: { w: null, last: null, broken: false }, ex: { w: null, last: null, broken: false } };
function send(msg, lane = "sim") {
  const L = lanes[lane]; L.last = msg;
  if (!L.broken && !L.w) L.w = makeWorker(() => { L.broken = true; L.w = null; fallback(L.last); });
  if (L.w) L.w.postMessage(msg); else fallback(msg);
}
function fallback(msg) { setTimeout(() => runTask(msg, m => onTaskMessage(m)), 0); }  // Worker를 못 쓰는 환경: 메인 스레드에서 계산
function onTaskMessage(m) {
  if (m.type === "sim" && m.id === simId) onSim(m);
  else if (m.type === "progress" && m.id === exId) exProgress(m);
  else if (m.type === "progress" && m.id === convId) $("convStatus").textContent = `계산 중… ${m.done}/${m.total}`;
  else if (m.type === "sweep" && m.id === exId) onSweep(m);
  else if (m.type === "conv" && m.id === convId) onConv(m);
  else if (m.type === "verify") onVerify(m);
}

// ---------------- colors ----------------
const STOPS_IN = [[0, [240, 248, 233]], [0.5, [190, 225, 160]], [1, [246, 196, 83]]];
const STOPS_OUT = [[0, [236, 120, 92]], [1, [128, 22, 60]]];
const STOPS_C = [[0, [244, 248, 253]], [0.25, [183, 211, 246]], [0.5, [109, 167, 236]], [0.75, [42, 120, 214]], [1, [13, 54, 107]]];
function ramp(stops, t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
    const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], u = (t - t0) / (t1 - t0);
    return c0.map((v, k) => Math.round(v + (c1[k] - v) * u));
  }
  return stops[stops.length - 1][1];
}
function colorFor(d, thr) { return d <= thr ? ramp(STOPS_IN, d / thr) : ramp(STOPS_OUT, (d - thr) / thr); }
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
const hexRGB = h => { h = h.replace("#", ""); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };

// ---------------- rendering (distance maps; 기존 함수 유지) ----------------
// one offscreen buffer per map: Safari defers drawImage from a shared canvas, which swapped the maps
const offs = new WeakMap();
function offFor(cv, size = N) {
  if (!offs.has(cv)) offs.set(cv, {});
  const m = offs.get(cv);
  if (!m[size]) { const o = document.createElement("canvas"); o.width = size; o.height = size; m[size] = o; }
  return m[size];
}
function sizeCanvas(cv) {
  const dpr = window.devicePixelRatio || 1, w = Math.round(cv.clientWidth * dpr);
  if (cv.width !== w) { cv.width = w; cv.height = w; }
  return cv.width / W; // px per μm
}
function drawScaleBar(ctx, cv, k) {
  const fs = Math.max(11, Math.round(cv.width / 34)), pad = fs * 0.6, bar = 500 * k;
  const bw = Math.max(bar, fs * 4) + pad * 2, bh = fs * 2.4, bx0 = cv.width - bw - pad, by0 = cv.height - bh - pad;
  ctx.fillStyle = "rgba(255,255,255,.88)"; ctx.fillRect(bx0, by0, bw, bh);
  ctx.fillStyle = "#1d2622"; ctx.fillRect(bx0 + (bw - bar) / 2, by0 + bh - pad - 3, bar, 3);
  ctx.font = `${fs}px "Noto Sans KR", sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.fillText("500 μm", bx0 + bw / 2, by0 + fs * 1.15);
}
function render(cv, res, segs, color, opts = {}) {
  const k = sizeCanvas(cv), ctx = cv.getContext("2d"), chw = opts.chw || state.chw;
  const off = offFor(cv), offCtx = off.getContext("2d");
  const img = offCtx.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const d = res ? res.dist[i] : Infinity;
    const col = !res || res.empty ? [247, 247, 244] : d < 0 ? [255, 255, 255] : colorFor(d, opts.thr || state.thr);
    img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; img.data[i * 4 + 3] = 255;
  }
  offCtx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(off, 0, 0, cv.width, cv.height);
  ctx.lineCap = "round"; ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, chw * k);
  ctx.beginPath(); segs.forEach(s => { ctx.moveTo(s[0] * k, s[1] * k); ctx.lineTo(s[2] * k, s[3] * k); }); ctx.stroke();
  if (opts.inlets) {
    const a = Math.max(5, 45 * k);
    ctx.fillStyle = color;
    opts.inlets.forEach(y => { ctx.beginPath(); ctx.moveTo(0, y * k - a); ctx.lineTo(a * 1.3, y * k); ctx.lineTo(0, y * k + a); ctx.closePath(); ctx.fill(); });
  }
  if (opts.mini) {
    if (res && !res.empty && res.max > 0) {
      const [fx_, fy] = res.far, r = Math.max(4, 45 * k);
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "#111"; ctx.lineWidth = Math.max(1.5, 8 * k);
      ctx.beginPath(); ctx.arc(fx_ * k, fy * k, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    return;
  }
  if (res && !res.empty && res.max > 0) {
    const [fx_, fy] = res.far, X = fx_ * k, Y = fy * k, r = Math.max(6, 35 * k);
    ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#111"; ctx.lineWidth = Math.max(2, 5 * k);
    ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const lf = Math.max(11, Math.round(cv.width / 36));
    ctx.font = `700 ${lf}px "Noto Sans KR", sans-serif`;
    const text = `가장 먼 곳 ${Math.round(res.max)} μm`, tw = ctx.measureText(text).width, pad = lf * 0.45;
    const bw = tw + pad * 2, bh = lf * 1.7;
    let lx = X < cv.width / 2 ? X + r + 6 : X - r - 6 - bw;
    let ly = Y < cv.height / 2 ? Y + r + 4 : Y - r - 4 - bh;
    lx = Math.max(4, Math.min(cv.width - bw - 4, lx)); ly = Math.max(4, Math.min(cv.height - bh - 4, ly));
    ctx.fillStyle = "rgba(17,17,17,.82)"; ctx.fillRect(lx, ly, bw, bh);
    ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(text, lx + pad, ly + bh / 2);
  }
  drawScaleBar(ctx, cv, k);
}

function statsHTML(res, extra = {}) {
  if (!res || res.empty) return `<div class="stat" style="grid-column:1/-1"><div class="k">아직 통로가 없습니다</div><div class="v">통로를 그려 보세요</div></div>`;
  const rel = extra.relTo ? (res.max / extra.relTo) ** 2 : null;
  const rows = [
    ["통로 총길이", `${fmtMM(res.len)}<small>mm</small>` + (extra.budget ? ` <small class="${res.len > extra.budget * 1.01 ? "warn" : ""}">/ 예산 ${fmtMM(extra.budget)} mm</small>` : "")],
    ["필요한 입구 수", `${res.nets}<small>개</small>`],
    ["평균 거리", `${Math.round(res.mean)}<small>μm</small>`],
    ["최대 거리 (○)", `${Math.round(res.max)}<small>μm</small>`],
    [`거리 기준 ${state.thr} μm 이내`, `${(res.cover * 100).toFixed(1)}<small>%</small>`],
    ["가장 먼 곳 확산 시간(참고)", rel === null ? `기준(1.00)<small>A 기준</small>` : `${rel.toFixed(2)}<small>배 (A 대비)</small>`],
  ];
  if (extra.conn !== undefined) rows.push(["입구 연결 통로 비율", `${(extra.conn * 100).toFixed(1)}<small>%</small>`]);
  return rows.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
}

// ---------------- 1단계: structure comparison (distance) ----------------
let cur = {};
function updateCompare() {
  const P = params(), gA = straightGeom(P), gB = leafGeom(P);
  const ra = evaluate(gA.segs, P.thr, P.chw), rb = evaluate(gB.segs, P.thr, P.chw);
  const connA = connectedRatio(gA.segs, gA.inlets, P.chw), connB = connectedRatio(gB.segs, gB.inlets, P.chw);
  cur = { gA, gB, ra, rb, a: gA.segs, b: gB.segs, k: gB.info.k, connA, connB };
  render($("mapA"), ra, gA.segs, cssVar("--straight") || "#4f5a68", { inlets: gA.inlets.map(p => p[1]) });
  render($("mapB"), rb, gB.segs, cssVar("--leaf") || "#2f6b4f", { inlets: [W / 2] });
  const iA = gA.info;
  $("infoA").textContent = `통로 ${iA.m}개 · 간격 ${Math.round(iA.spacing)} μm · 통로 하나 ${fmtMM(iA.line)} mm` +
    (P.inlet === "one" ? ` · 매니폴드 ${fmtMM(iA.man)} mm · 입구 1개` : ` · 입구 ${iA.m}개(개별)`);
  $("infoB").textContent = `주맥 1개 + 측맥 ${gB.info.k}쌍(간격 ${Math.round(gB.info.spacing)} μm) · 세맥 분기점 ${P.tert}개 · 입구 1개`;
  $("statsA").innerHTML = statsHTML(ra, { conn: connA });
  $("statsB").innerHTML = statsHTML(rb, { relTo: ra.max, conn: connB });
  const diff = Math.abs(gA.len - gB.len) / gA.len * 100, ok = diff <= 1 && !gA.warn && !gB.warn;
  $("lenCheck").className = "lencheck " + (ok ? "ok" : "bad");
  $("lenCheck").innerHTML = `<b>총길이 확인</b> 목표 ${state.L.toFixed(1)} mm · 직선형 ${fmtMM(gA.len)} mm · 잎맥형 ${fmtMM(gB.len)} mm · 차이 ${diff.toFixed(2)}% ` +
    (ok ? "→ 1% 이내 ✓" : "→ <b>비교 조건을 만족하지 않습니다</b>") +
    (gA.warn ? `<br>직선형: ${gA.warn}` : "") + (gB.warn ? `<br>잎맥형: ${gB.warn}` : "");
  const pct = (x, y) => Math.abs((x - y) / Math.max(x, y) * 100).toFixed(0);
  const who = (x, y) => (Math.abs(x - y) < 0.5 ? "같음" : (x < y ? "A(직선형)" : "B(잎맥형)"));
  $("verdict").innerHTML = `
    <b>거리 지표 요약</b> (총길이 ${fmtMM(ra.len)} mm, ${P.inlet === "one" ? "입구 1개" : "직선형 개별 입구"})
    <ul>
      <li>평균 거리가 더 짧은 구조: <b>${who(ra.mean, rb.mean)}</b> (A ${Math.round(ra.mean)} μm, B ${Math.round(rb.mean)} μm, 차이 ${pct(ra.mean, rb.mean)}%)</li>
      <li>최대 거리가 더 짧은 구조: <b>${who(ra.max, rb.max)}</b> (A ${Math.round(ra.max)} μm, B ${Math.round(rb.max)} μm, 차이 ${pct(ra.max, rb.max)}%)</li>
      <li>거리 기준 ${state.thr} μm 이내 비율: A ${(ra.cover * 100).toFixed(1)}%, B ${(rb.cover * 100).toFixed(1)}%</li>
      <li>필요한 입구 수: A ${ra.nets}개, B ${rb.nets}개</li>
    </ul>`;
  updateLegend();
  updateDraw(false);
  if (state.mAuto) { $("nOut").textContent = `자동 → ${gA.info.m}개 · 간격 ${Math.round(W / gA.info.m)} μm`; }
}

// ---------------- sweep (기존 3번 그래프) ----------------
let sweep = [];
function updateSweep() {
  sweep = [];
  const base = params();
  for (let n = 2; n <= 10; n++) {
    const x0 = base.inlet === "one" ? base.chw / 2 : 0, man = base.inlet === "one" ? (n - 1) * W / n : 0;
    const P = { ...base, m: n, L: (n * (W - x0) + man) / 1000 };
    const gA = straightGeom(P), gB = leafGeom(P);
    sweep.push({ n, gap: W / n, k: gB.info.k, A: evaluate(gA.segs, P.thr, P.chw), B: evaluate(gB.segs, P.thr, P.chw) });
  }
  drawChart(); drawSweepTable();
}
function drawChart() {
  const svg = $("chart");
  const muted = cssVar("--muted"), line = cssVar("--line");
  const cA = cssVar("--straight"), cB = cssVar("--leaf");
  const m = { l: 56, r: 150, t: 20, b: 48 }, w = 760 - m.l - m.r, h = 340 - m.t - m.b;
  const xv = d => d.A.len / 1000;
  const xs = sweep.map(xv), xmin = Math.min(...xs), xmax = Math.max(...xs);
  const ymax = Math.ceil(Math.max(...sweep.flatMap(d => [d.A.max, d.B.max])) / 100) * 100;
  const X = v => m.l + (v - xmin) / (xmax - xmin) * w, Y = v => m.t + h - v / ymax * h;
  let s = "";
  for (let v = 0; v <= ymax; v += ymax / 5) s += `<line x1="${m.l}" x2="${m.l + w}" y1="${Y(v)}" y2="${Y(v)}" stroke="${line}"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="12" fill="${muted}">${Math.round(v)}</text>`;
  sweep.forEach(d => { s += `<text x="${X(xv(d))}" y="${m.t + h + 18}" text-anchor="middle" font-size="12" fill="${muted}">${xv(d).toFixed(1)}</text>`; });
  s += `<text x="${m.l + w / 2}" y="${340 - 8}" text-anchor="middle" font-size="12" fill="${muted}">통로 총길이 (mm) — 오른쪽일수록 통로가 많고 촘촘함</text>`;
  s += `<text x="14" y="${m.t + h / 2}" text-anchor="middle" font-size="12" fill="${muted}" transform="rotate(-90 14 ${m.t + h / 2})">거리 (μm)</text>`;
  s += `<line x1="${m.l}" x2="${m.l + w}" y1="${Y(state.thr)}" y2="${Y(state.thr)}" stroke="${cssVar("--warn")}" stroke-dasharray="3 4"/>`;
  const series = [["A", "max", cA, "6 5", "A 최대"], ["B", "max", cB, "6 5", "B 최대"], ["A", "mean", cA, "", "A 평균"], ["B", "mean", cB, "", "B 평균"]];
  const pts = [];
  series.forEach(([k, f, col, dash]) => {
    const p = sweep.map(d => `${X(xv(d))},${Y(d[k][f])}`).join(" ");
    s += `<polyline points="${p}" fill="none" stroke="${col}" stroke-width="2.5" ${dash ? `stroke-dasharray="${dash}"` : ""}/>`;
    sweep.forEach(d => { s += `<circle cx="${X(xv(d))}" cy="${Y(d[k][f])}" r="3.5" fill="${col}"><title>${k} ${f === "max" ? "최대" : "평균"} 거리 ${Math.round(d[k][f])} μm (총길이 ${xv(d).toFixed(2)} mm, 직선형 간격 ${Math.round(d.gap)} μm, 잎맥형 측맥 ${d.k}쌍)</title></circle>`; });
    const last = sweep[sweep.length - 1]; pts.push({ y: Y(last[k][f]) });
  });
  const labels = series.map((sr, i) => ({ y: pts[i].y, col: sr[2], text: sr[4] })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 15) labels[i].y = labels[i - 1].y + 15;
  labels.forEach(l => { s += `<text x="${m.l + w + 10}" y="${l.y + 4}" font-size="12.5" font-weight="700" fill="${l.col}">${l.text}</text>`; });
  s += `<text x="${m.l + w + 10}" y="${Y(state.thr) - 6}" font-size="11" fill="${cssVar("--warn")}">기준 ${state.thr} μm</text>`;
  svg.innerHTML = s;
}
function drawSweepTable() {
  $("sweepTable").innerHTML = `<thead><tr><th>직선형 개수</th><th>간격(μm)</th><th>총길이(mm)</th><th>B 측맥 쌍</th><th>A 평균</th><th>B 평균</th><th>A 최대</th><th>B 최대</th><th>A 기준 이내</th><th>B 기준 이내</th></tr></thead><tbody>` +
    sweep.map(d => `<tr><td>${d.n}</td><td>${Math.round(d.gap)}</td><td>${fmtMM(d.A.len)}</td><td>${d.k}</td><td>${Math.round(d.A.mean)}</td><td>${Math.round(d.B.mean)}</td><td>${Math.round(d.A.max)}</td><td>${Math.round(d.B.max)}</td><td>${(d.A.cover * 100).toFixed(1)}%</td><td>${(d.B.cover * 100).toFixed(1)}%</td></tr>`).join("") + "</tbody>";
}
function downloadCSV(name, lines) {
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("csvBtn").addEventListener("click", () => {
  const head = "구조,직선형통로개수,직선형간격_um,잎맥형측맥쌍,총길이_mm,입구수,평균거리_um,최대거리_um,기준이내비율_%,기준거리_um,분기각도,세맥분기점,통로굵기_um,입구조건";
  const rows = sweep.flatMap(d => [["A_직선형", d.A], ["B_잎맥형", d.B]].map(([k, r]) =>
    [k, d.n, d.gap.toFixed(0), d.k, fmtMM(r.len), r.nets, r.mean.toFixed(1), r.max.toFixed(1), (r.cover * 100).toFixed(2), state.thr, state.angle, state.tert, state.chw, state.inlet === "one" ? "입구1개" : "개별입구"].join(",")));
  downloadCSV("organoleaf_distance_sweep.csv", [head, ...rows]);
});

// ---------------- legend ----------------
function updateLegend() {
  const bar = $("legendBar"), stops = [];
  for (let i = 0; i <= 20; i++) { const d = i / 20 * state.thr * 2; const c = colorFor(d, state.thr); stops.push(`rgb(${c}) ${i * 5}%`); }
  bar.style.background = `linear-gradient(90deg, ${stops.join(",")})`;
  $("legendMark").style.left = "50%";
  $("legendText").textContent = `색 막대 가운데 선 = 거리 기준 ${state.thr} μm (그보다 먼 곳은 붉은색) · 선 = 통로 · ○ = 가장 먼 곳 · ▶ = 입구`;
}

// ---------------- 2·3단계: concentration ----------------
let simId = 0, simData = null, simTimer = null, simT0 = 0, playTimer = null;
function scheduleSim() {
  clearTimeout(simTimer);
  $("simStatus").textContent = "조건이 바뀌어 다시 계산합니다…";
  simTimer = setTimeout(() => { simId++; simT0 = performance.now(); send({ type: "sim", id: simId, P: params() }, "sim"); }, 300);
}
function onSim(m) {
  simData = m;
  const s = m.sA, ms = Math.round(performance.now() - simT0);
  $("simStatus").innerHTML = `계산 완료 (${ms} ms) · 격자 ${s.n}×${s.n} (Δx = ${s.dx} μm) · Δt = ${s.dt.toFixed(4)} s · ${s.steps}단계 · 두 구조에 같은 매개변수 사용`;
  const nf = s.series.t.length - 1;
  $("frame").max = nf;
  if (state.frame > nf || !playTimer) state.frame = nf;
  $("frame").value = state.frame;
  drawConcMaps(); drawConcStats(); drawSeries(); updateAutoTable(); renderParamTable(); updateVerifyFromSim();
}
function drawConc(cv, sim, segs, color) {
  if (!sim) return;
  const k = sizeCanvas(cv), ctx = cv.getContext("2d"), n = sim.n;
  const off = offFor(cv, n), oc = off.getContext("2d"), img = oc.createImageData(n, n);
  const fi = Math.min(state.frame, sim.frames.length - 1), F = sim.frames[fi], t = sim.series.t[fi];
  const sc = hexRGB(color), Ct = simData.P.Ct, T = simData.P.T;
  for (let i = 0; i < n * n; i++) {
    let col;
    if (sim.fixed[i]) col = sc;
    else if (state.view === "conc") {
      const v = F[i]; col = ramp(STOPS_C, v);
      if (v >= Ct) {   // 목표 농도 경계선
        const r = (i / n) | 0, c = i % n;
        const nbs = [r > 0 ? i - n : -1, r < n - 1 ? i + n : -1, c > 0 ? i - 1 : -1, c < n - 1 ? i + 1 : -1];
        if (nbs.some(j => j >= 0 && !sim.fixed[j] && F[j] < Ct)) col = [235, 104, 52];
      }
    } else {
      const a = sim.arrMap[i];
      col = (a < 0 || a > t) ? [217, 217, 212] : ramp(STOPS_C, 1 - a / T);
    }
    img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; img.data[i * 4 + 3] = 255;
  }
  oc.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(off, 0, 0, cv.width, cv.height);
  drawScaleBar(ctx, cv, k);
}
function drawConcMaps() {
  if (!simData) return;
  drawConc($("concA"), simData.sA, cur.a, cssVar("--straight") || "#4f5a68");
  drawConc($("concB"), simData.sB, cur.b, cssVar("--leaf") || "#2f6b4f");
  const t = simData.sA.series.t[Math.min(state.frame, simData.sA.series.t.length - 1)];
  $("frameOut").textContent = `${t.toFixed(1)} s`;
  const stops = []; for (let i = 0; i <= 10; i++) stops.push(`rgb(${ramp(STOPS_C, state.view === "conc" ? i / 10 : 1 - i / 10)}) ${i * 10}%`);
  $("cLegendBar").style.background = `linear-gradient(90deg, ${stops.join(",")})`;
  if (state.view === "conc") {
    $("cLegLo").textContent = "C = 0"; $("cLegHi").textContent = "C = C₀";
    $("cLegendText").innerHTML = `조직 농도(공급 농도 C₀ 대비). <span style="color:#eb6834;font-weight:700">주황 선</span> = 목표 농도 ${simData.P.Ct} 경계 · 진한 단색 칸 = 통로(공급 칸)`;
  } else {
    $("cLegLo").textContent = "늦게 도달"; $("cLegHi").textContent = "바로 도달";
    $("cLegendText").innerHTML = `각 칸이 목표 농도 ${simData.P.Ct}에 처음 도달한 시간. 회색 = 현재 시간까지 <b>미도달</b>`;
  }
}
function concStatsHTML(mt, sim, conn, len) {
  const f = mt;
  const rows = [
    ["목표 농도 이상 영역", `${f.cAbove.toFixed(1)}<small>%</small>`],
    [`판정 기준(${simData.P.crit}%) 도달 시간`, f.tCrit === null ? `<span class="warn">미도달</span>` : `${f.tCrit.toFixed(1)}<small>s</small>`],
    ["미도달 조직 비율", `${f.unreached.toFixed(1)}<small>%</small>`],
    ["평균 농도", `${f.cMean.toFixed(3)}<small>C₀</small>`],
    ["농도 변동계수", `${fx(f.cv, 3)}<small>표준편차 ${f.cStd.toFixed(3)}</small>`],
    ["통로 1 mm당 목표 이상 면적", `${f.perLen.toFixed(3)}<small>mm²/mm</small>`],
    ["입구 연결 통로 비율", `${(conn * 100).toFixed(1)}<small>%</small>`],
    ["공급 칸 수 (통로 칸)", `${sim.chReach}<small>칸</small>`],
  ];
  return rows.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("") +
    `<p class="note" style="grid-column:1/-1;margin:2px 0 0">T = ${simData.P.T} s 시점 값 · 도달 지점 평균 도달 시간 ${fx(f.tMean, 1)} s</p>`;
}
function drawConcStats() {
  $("cstatsA").innerHTML = concStatsHTML(simData.mA, simData.sA, simData.connA);
  $("cstatsB").innerHTML = concStatsHTML(simData.mB, simData.sB, simData.connB);
}
function drawSeries() {
  const cA = cssVar("--s-a"), cB = cssVar("--s-b1"), t = simData.sA.series.t;
  const every = Math.max(1, Math.round(t.length / 6));
  lineChart("tsAbove", { xs: t, xTitle: "시간 (s)", yTitle: "목표 이상 영역 (%)", unit: "%", yMax: 100, yStep: 20, xEvery: every, noDots: true,
    xFmt: v => `${v.toFixed(1)} s`, xLab: v => v.toFixed(0), vFmt: v => v.toFixed(1),
    series: [{ name: "A 직선형", color: cA, values: simData.sA.series.above }, { name: "B 잎맥형", color: cB, values: simData.sB.series.above }] });
  lineChart("tsMean", { xs: t, xTitle: "시간 (s)", yTitle: "평균 농도 (C₀)", unit: "", yMax: 1, yStep: 0.2, yFmt: v => v.toFixed(1), xEvery: every, noDots: true,
    xFmt: v => `${v.toFixed(1)} s`, xLab: v => v.toFixed(0), vFmt: v => v.toFixed(3),
    series: [{ name: "A 직선형", color: cA, values: simData.sA.series.mean }, { name: "B 잎맥형", color: cB, values: simData.sB.series.mean }] });
}
$("frame").addEventListener("input", e => { state.frame = +e.target.value; drawConcMaps(); });
$("playBtn").addEventListener("click", () => {
  if (playTimer) { clearInterval(playTimer); playTimer = null; $("playBtn").textContent = "▶ 재생"; return; }
  if (!simData) return;
  const nf = simData.sA.frames.length - 1;
  if (state.frame >= nf) state.frame = 0;
  $("playBtn").textContent = "❚❚ 멈춤";
  playTimer = setInterval(() => {
    state.frame++; $("frame").value = state.frame; drawConcMaps();
    if (state.frame >= nf) { clearInterval(playTimer); playTimer = null; $("playBtn").textContent = "▶ 재생"; }
  }, 160);
});
document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => {
  state.view = b.dataset.view;
  document.querySelectorAll("[data-view]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  drawConcMaps();
}));

// ---------------- parameters & sources ----------------
function renderParamTable() {
  const P = params(), lam = Math.sqrt(P.D / P.kc), s = simData && simData.sA;
  const rows = [
    ["조직 크기", "2 mm × 2 mm (2차원 단면)", "기존 프로그램 값 · 임의 설정값(교육용)"],
    ["거리 지표 격자", "10 μm (200 × 200칸)", "기존 프로그램 값"],
    ["통로 굵기", `${P.chw} μm`, "기존 값 20 μm · 임의 설정값(교육용)"],
    ["농도 격자 Δx", `${P.dx} μm`, "계산 시간과 정확도의 절충 · 임의 설정값(교육용). 8번 격자 수렴 확인으로 차이를 봅니다"],
    ["시간 간격 Δt", s ? `${s.dt.toFixed(4)} s (${s.steps}단계)` : "계산 후 표시", "자동 계산: Δt = T ÷ 단계 수 ≤ 0.9 × Δx² ÷ (4D + kΔx²). 이 값은 확산 안정 조건 Δx²/(4D)와 소모 포함 안정 한계보다 작고, 농도가 음수가 되지 않게 합니다"],
    ["확산계수 D", `${P.D} μm²/s (= ${(P.D / 1e3).toFixed(1)}×10⁻⁹ m²/s)`, "기본값 2×10⁻⁹ m²/s: 세포 속 산소 확산계수 문헌값(Grimes 외, 2014를 인용한 조직 구형체 산소 확산 모델 연구, arXiv:2501.12095)"],
    ["소모율 k", `${P.kc} /s`, `1차 소모(kC)로 단순화. 침투 길이 λ = √(D/k) = ${lam.toFixed(0)} μm. 기본값은 λ를 문헌의 산소 확산 한계 100~200 μm의 중간인 150 μm로 두고 역산한 교육용 설정값. 확산 한계(산소가 거의 닿지 않는 거리)와 λ(농도가 공급 농도의 약 37%로 줄어드는 거리)는 같은 양이 아니므로, 이것은 단순화한 가정입니다`],
    ["공급 농도 C₀", "1 (상대 농도)", "정규화 · 임의 설정값(교육용)"],
    ["초기 농도", "0", "조직에 물질이 없는 상태에서 시작한다고 가정"],
    ["목표 농도", `${P.Ct} C₀`, "임의 설정값(교육용)"],
    ["도달 판정 기준", `조직의 ${P.crit}%`, "임의 설정값(교육용)"],
    ["계산 시간 T", `${P.T} s`, `1/k ≈ ${(1 / P.kc).toFixed(1)} s의 약 ${(P.T * P.kc).toFixed(1)}배 (기본 60 s ≈ 5/k로 정상 상태에 가까워지는 시간)`],
    ["모델 B 감소 길이 Lₛ", P.model === "B" ? `${P.Ls} μm` : `${P.Ls} μm (모델 B에서만 사용)`, "임의 설정값(교육용). 실제 유량·대류를 계산한 값이 아닙니다"],
  ];
  $("paramTable").innerHTML = `<thead><tr><th>항목</th><th>현재 값</th><th>선택 근거</th></tr></thead><tbody>` +
    rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td style="text-align:left">${r[2]}</td></tr>`).join("") + "</tbody>";
}

// ---------------- 자동 비교표 ----------------
const VLABEL = { B: "잎맥형 우세", A: "직선형 우세", "=": "비슷함", X: "판정 제외" };
const VCLS = { B: "vB", A: "vA", "=": "vS", X: "vX" };
function ruleText(rel) {
  return `상대 차이가 ${rel}% 이내이거나, 0에 가까운 값을 위한 절대 기준(거리 5 μm, 비율 1%p, 시간 1 s, 변동계수 0.02, 평균 농도 0.01, 면적 0.005 mm²/mm) 이내이면 '비슷함'. 판정 기준 도달 시간은 한쪽만 미도달이면 도달한 쪽이 우세. 두 구조에 같은 규칙을 적용하며 가중치는 쓰지 않습니다.`;
}
function updateAutoTable() {
  $("ruleText").textContent = ruleText(state.rel);
  if (!simData) return;
  const A = simData.mA, B = simData.mB, rel = state.rel;
  const excluded = simData.lenDiff > 1 || simData.warnA || simData.warnB;
  const cell = (m, v) => m.key === "tCrit" && v === null ? "미도달" : fx(v, m.d);
  let html = `<thead><tr><th>지표</th><th>단위</th><th>A 직선형</th><th>B 잎맥형</th><th>차이 (B−A)/|A|</th><th>판정</th></tr></thead><tbody>`;
  let cnt = { A: 0, B: 0, "=": 0 };
  ["거리", "농도"].forEach(g => {
    html += `<tr class="grp"><td colspan="6">${g} 지표${g === "거리" ? " (10 μm 격자, 통로 벽까지 직선 거리)" : ` (T = ${simData.P.T} s, Δx = ${simData.P.dx} μm, 모델 ${simData.P.model})`}</td></tr>`;
    METRICS.filter(m => m.group === g).forEach(m => {
      const a = A[m.key], b = B[m.key], v = excluded ? "X" : judge(a, b, m, rel);
      if (v !== "X") cnt[v]++;
      const d = (a === null || b === null || Math.abs(a) < 1e-9) ? "—" : `${((b - a) / Math.abs(a) * 100).toFixed(1)}%`;
      const lab = (m.key === "tCrit" && a === null && b === null) ? "비슷함 (둘 다 미도달)" : VLABEL[v];
      html += `<tr><td>${m.name}</td><td>${m.unit}</td><td>${cell(m, a)}</td><td>${cell(m, b)}</td><td>${d}</td><td><span class="vchip ${VCLS[v]}">${lab}</span></td></tr>`;
    });
  });
  const sA = simData.sA, sB = simData.sB, gA = cur.gA, gB = cur.gB;
  html += `<tr class="grp"><td colspan="6">구조 정보 (판정하지 않음)</td></tr>
    <tr><td>통로 총길이</td><td>mm</td><td>${fmtMM(gA.len)}</td><td>${fmtMM(gB.len)}</td><td>${simData.lenDiff.toFixed(2)}%</td><td>${simData.lenDiff <= 1 ? "1% 이내 ✓" : "<b class='warn'>1% 초과</b>"}</td></tr>
    <tr><td>필요한 입구 수</td><td>개</td><td>${cur.ra.nets}</td><td>${cur.rb.nets}</td><td colspan="2"></td></tr>
    <tr><td>입구 연결 통로 비율</td><td>%</td><td>${(simData.connA * 100).toFixed(1)}</td><td>${(simData.connB * 100).toFixed(1)}</td><td colspan="2">입구와 그래프로 이어진 통로 길이 ÷ 전체 통로 길이</td></tr>
    <tr><td>공급 칸 수 (농도 격자의 통로 칸)</td><td>칸</td><td>${sA.chReach}</td><td>${sB.chReach}</td><td>${sA.chReach ? ((sB.chReach - sA.chReach) / sA.chReach * 100).toFixed(1) + "%" : "—"}</td><td></td></tr>
    <tr><td>통로 칸의 입구까지 평균 경로 거리</td><td>mm</td><td>${fmtMM(sA.path.mean)}</td><td>${fmtMM(sB.path.mean)}</td><td colspan="2">통로를 따라 잰 거리 (모델 B의 감소에 쓰임)</td></tr>
    <tr><td>통로 칸의 평균 공급 농도</td><td>C₀</td><td>${sA.path.supplyMean.toFixed(3)}</td><td>${sB.path.supplyMean.toFixed(3)}</td><td colspan="2">${simData.P.model === "A" ? "모델 A는 모두 1" : "모델 B: exp(−s/Lₛ)의 평균"}</td></tr>
    </tbody>`;
  $("cmpAuto").innerHTML = html +
    `<caption class="note" style="caption-side:bottom;text-align:left;padding-top:8px">현재 조건 판정 개수: 잎맥형 우세 ${cnt.B} · 직선형 우세 ${cnt.A} · 비슷함 ${cnt["="]}${excluded ? " · <b class='warn'>총길이 조건을 만족하지 않아 판정 제외</b>" : ""}</caption>`;
}
$("rel").addEventListener("input", e => { state.rel = Math.max(1, Math.min(30, +e.target.value || 5)); updateAutoTable(); $("exRule").textContent = "실행 전 고정되는 판정 기준: " + ruleText(state.rel) + " 총길이 차이가 1%를 넘거나 구조를 만들 수 없는 조건은 판정에서 제외합니다."; });

// ---------------- 4단계: 자동 조건 탐색 ----------------
let exId = 0, exRes = null;
const exKeys = Object.keys(SWEEP_VARS);
["exX", "exY"].forEach((id, j) => { $(id).innerHTML = exKeys.map(k => `<option value="${k}" ${k === (j ? "tert" : "angle") ? "selected" : ""}>${SWEEP_VARS[k].label}</option>`).join(""); });
$("exMetric").innerHTML = METRICS.map(m => `<option value="${m.key}">${m.group} · ${m.name}</option>`).join("");
function exModeUI() {
  const grid = $("exMode").value === "grid";
  $("exXBox").hidden = !grid; $("exYBox").hidden = !grid;
}
$("exMode").addEventListener("change", exModeUI); exModeUI();
$("exRun").addEventListener("click", () => {
  const mode = $("exMode").value, vars = [$("exX").value, $("exY").value];
  if (mode === "grid" && vars[0] === vars[1]) { $("exStatus").textContent = "가로·세로 변수를 다르게 골라 주세요."; return; }
  exId++;
  $("exRun").disabled = true; $("exStop").disabled = false; $("convBtn").disabled = true;
  $("exBar").style.width = "0%"; $("exStatus").textContent = "계산 시작…";
  send({ type: "sweep", id: exId, mode, vars, base: params(), dx: +$("exDx").value, rel: state.rel }, "ex");
});
$("exStop").addEventListener("click", () => {
  const L = lanes.ex; if (L.w) { L.w.terminate(); L.w = null; }
  exId++; $("exRun").disabled = false; $("exStop").disabled = true; $("convBtn").disabled = false;
  $("exStatus").textContent = "중지했습니다.";
});
function exProgress(m) { $("exBar").style.width = (m.done / m.total * 100).toFixed(1) + "%"; $("exStatus").textContent = `계산 중… ${m.done} / ${m.total} 조건`; }
function verdictsOf(row, rel) {
  const ex = row.lenDiff > 1 || !!row.warn, v = {};
  METRICS.forEach(m => { v[m.key] = ex ? "X" : judge(row.mA[m.key], row.mB[m.key], m, rel); });
  return v;
}
function onSweep(m) {
  exRes = m; exRes.rows.forEach(r => { r.v = verdictsOf(r, m.rel); });
  $("exRun").disabled = false; $("exStop").disabled = true; $("convBtn").disabled = false;
  $("exStatus").textContent = `완료: ${m.rows.length}개 조건`;
  $("exOut").hidden = false;
  $("exMetricBox").hidden = m.mode !== "grid";
  $("exApplied").textContent = `이 결과에 적용된 판정 기준(실행 전에 고정): 비슷함 = 상대 차이 ${m.rel}% 이내 또는 지표별 절대 기준 이내 · 탐색 농도 격자 Δx = ${m.dx} μm · 나머지 조건은 실행 당시 설정값`;
  drawHeat(); $("exInterp").innerHTML = m.mode === "oat" ? interpretOAT(m) : interpretGrid(m);
}
function fmtVal(m, v) { return m.key === "tCrit" && v === null ? "미도달" : fx(v, m.d); }
function cellHTML(r, m) {
  const v = r.v[m.key], a = r.mA[m.key], b = r.mB[m.key];
  const sym = { B: "잎", A: "직", "=": "≈", X: "×" }[v];
  const tip = v === "X" ? `판정 제외: ${r.warn || "총길이 차이 " + r.lenDiff.toFixed(2) + "%"}` : `A ${fmtVal(m, a)} / B ${fmtVal(m, b)} ${m.unit}`;
  return `<td class="hm ${VCLS[v]}" title="${tip}"><span>${sym}</span></td>`;
}
function drawHeat() {
  const m = exRes, box = $("exHeat");
  if (m.mode === "oat") {
    let h = `<table class="heat"><thead><tr><th>변수</th><th>값</th>${METRICS.map(x => `<th class="rot"><span>${x.group}<br>${x.name}</span></th>`).join("")}</tr></thead><tbody>`;
    let lastKey = null;
    m.rows.forEach(r => {
      const V = SWEEP_VARS[r.key];
      h += `<tr class="${r.key !== lastKey ? "first" : ""}${r.isBase ? " base" : ""}"><td>${r.key !== lastKey ? V.label : ""}</td><td>${V.fmt(r.val)}${r.isBase ? " (현재값)" : ""}</td>`;
      lastKey = r.key;
      h += METRICS.map(x => cellHTML(r, x)).join("") + "</tr>";
    });
    box.innerHTML = h + "</tbody></table><p class='note'>셀에 마우스를 올리면 A·B 값이 나옵니다. '현재값' 행은 현재 설정과 같은 조건입니다.</p>";
  } else {
    const key = $("exMetric").value, mt = METRICS.find(x => x.key === key);
    const [kx, ky] = m.vars, X = SWEEP_VARS[kx], Y = SWEEP_VARS[ky];
    let h = `<table class="heat grid"><thead><tr><th>${Y.label} ↓ / ${X.label} →</th>${X.values.map(v => `<th>${X.fmt(v)}</th>`).join("")}</tr></thead><tbody>`;
    Y.values.forEach(vy => {
      h += `<tr><th>${Y.fmt(vy)}</th>` + X.values.map(vx => cellHTML(m.rows.find(r => String(r.vx) === String(vx) && String(r.vy) === String(vy)), mt)).join("") + "</tr>";
    });
    box.innerHTML = h + `</tbody></table><p class="note">표시 지표: ${mt.group} · ${mt.name} (${mt.better === "low" ? "작을수록 좋음" : "클수록 좋음"})</p>`;
  }
}
$("exMetric").addEventListener("change", () => { if (exRes && exRes.mode === "grid") { drawHeat(); $("exInterp").innerHTML = interpretGrid(exRes); } });
$("exCsv").addEventListener("click", () => {
  if (!exRes) return;
  const head = ["조건", "총길이차이_%", "제외사유", ...METRICS.flatMap(m => [`A_${m.name}`, `B_${m.name}`, `판정_${m.name}`])].join(",");
  const lines = exRes.rows.map(r => {
    const cond = exRes.mode === "oat" ? `${SWEEP_VARS[r.key].label}=${SWEEP_VARS[r.key].fmt(r.val)}` : `${SWEEP_VARS[r.kx].label}=${SWEEP_VARS[r.kx].fmt(r.vx)} / ${SWEEP_VARS[r.ky].label}=${SWEEP_VARS[r.ky].fmt(r.vy)}`;
    return [cond, r.lenDiff.toFixed(3), r.warn || "", ...METRICS.flatMap(m => [fmtVal(m, r.mA[m.key]), fmtVal(m, r.mB[m.key]), VLABEL[r.v[m.key]]])].map(x => `"${String(x).replace(/"/g, '""')}"`).join(",");
  });
  downloadCSV("organoleaf_auto_search.csv", [head, ...lines]);
});

// ---------------- 결과 해석 자동 생성 ----------------
const DIST = METRICS.filter(m => m.group === "거리"), CONC = METRICS.filter(m => m.group === "농도");
const score = (r, ms) => ms.reduce((a, m) => a + (r.v[m.key] === "B" ? 1 : r.v[m.key] === "A" ? -1 : 0), 0);
function condLabel(r) { const V = SWEEP_VARS[r.key]; return `${V.label} ${V.fmt(r.val)}${r.key === "L" ? `(직선형 ${r.info.m}개)` : ""}${r.isBase ? "(현재값)" : ""}`; }
function interpretOAT(m) {
  const rows = m.rows, valid = rows.filter(r => r.v.mean !== "X"), excl = rows.filter(r => r.v.mean === "X");
  const leafAll = [], strAll = [], split = [], same = [], dc = [];
  valid.forEach(r => {
    const vs = METRICS.map(x => r.v[x.key]), hasB = vs.includes("B"), hasA = vs.includes("A");
    if (hasB && !hasA) leafAll.push(r); else if (hasA && !hasB) strAll.push(r); else if (hasA && hasB) split.push(r); else same.push(r);
    const sd = score(r, DIST), scn = score(r, CONC);
    if (sd * scn < 0) dc.push({ r, sd, scn });
  });
  const list = (arr, f) => arr.length ? "<ul>" + arr.map(f).join("") + "</ul>" : "<p class='note'>해당 조건 없음</p>";
  const metricWins = r => { const b = METRICS.filter(x => r.v[x.key] === "B").map(x => x.name), a = METRICS.filter(x => r.v[x.key] === "A").map(x => x.name); return { b, a }; };
  const find = (key, val) => rows.find(r => r.key === key && String(r.val) === String(val));
  let h = `<div class="ibox calc"><h4>계산 결과</h4>`;
  h += `<p><b>잎맥형이 유리한 조건</b> (판정이 갈린 지표가 모두 잎맥형 우세)</p>` + list(leafAll, r => `<li>${condLabel(r)} — 잎맥형 우세: ${metricWins(r).b.join(", ")}</li>`);
  h += `<p><b>직선형이 유리한 조건</b> (판정이 갈린 지표가 모두 직선형 우세)</p>` + list(strAll, r => `<li>${condLabel(r)} — 직선형 우세: ${metricWins(r).a.join(", ")}</li>`);
  h += `<p><b>지표별로 결론이 갈리는 조건</b></p>` + list(split, r => { const w = metricWins(r); return `<li>${condLabel(r)} — 잎맥형 우세: ${w.b.join(", ")} / 직선형 우세: ${w.a.join(", ")}</li>`; });
  if (same.length) h += `<p><b>모든 지표가 비슷한 조건</b>: ${same.map(condLabel).join(", ")}</p>`;
  h += `<p><b>거리 지표와 농도 지표의 결론이 반대인 조건</b></p>` + list(dc, x => `<li>${condLabel(x.r)} — 거리 지표는 ${x.sd > 0 ? "잎맥형" : "직선형"} 쪽, 농도 지표는 ${x.scn > 0 ? "잎맥형" : "직선형"} 쪽</li>`);
  // 입구·매니폴드
  const one = find("inlet", "one"), each = find("inlet", "each");
  if (one && each) {
    h += `<p><b>입구 개수·매니폴드의 영향</b></p><ul>
      <li>직선형: 입구 1개(매니폴드 ${fmtMM(one.info.man)} mm 포함, 통로 하나 ${fmtMM(one.info.line)} mm) → 개별 입구(통로 하나 ${fmtMM(each.info.line)} mm)로 바꾸면 목표 농도 이상 영역 ${one.mA.cAbove.toFixed(1)}% → ${each.mA.cAbove.toFixed(1)}%, 평균 거리 ${one.mA.mean.toFixed(0)} → ${each.mA.mean.toFixed(0)} μm, 최대 거리 ${one.mA.max.toFixed(0)} → ${each.mA.max.toFixed(0)} μm</li>
      <li>잎맥형(입구 조건과 무관하게 입구 1개): 목표 이상 영역 ${one.mB.cAbove.toFixed(1)}% / ${each.mB.cAbove.toFixed(1)}%</li>
      <li>목표 이상 영역 판정: 입구 1개일 때 ${VLABEL[one.v.cAbove]}, 개별 입구일 때 ${VLABEL[each.v.cAbove]}</li></ul>`;
  }
  // 총길이
  const Ls = rows.filter(r => r.key === "L");
  if (Ls.length) h += `<p><b>총길이의 영향</b> (총길이 탐색에서는 직선형 통로 수를 '자동'으로 정함)</p><ul><li>직선형 통로 수: ${Ls.map(r => `${r.val} mm → ${r.info.m}개`).join(" · ")} / 잎맥형 측맥: ${Ls.map(r => `${r.info.k}쌍`).join(" · ")}</li><li>목표 농도 이상 영역: ${Ls.map(r => `${r.val} mm ${VLABEL[r.v.cAbove]}`).join(" · ")}</li><li>평균 거리: ${Ls.map(r => `${r.val} mm ${VLABEL[r.v.mean]}`).join(" · ")}</li></ul>`;
  // 내부 농도 감소
  const mA_ = find("model", "A"), mB_ = find("model", "B");
  if (mA_ && mB_) {
    h += `<p><b>통로 내부 농도 감소(모델 B)의 영향</b></p><ul>
      <li>목표 이상 영역: 모델 A에서 직선형 ${mA_.mA.cAbove.toFixed(1)}% / 잎맥형 ${mA_.mB.cAbove.toFixed(1)}% (${VLABEL[mA_.v.cAbove]}) → 모델 B에서 직선형 ${mB_.mA.cAbove.toFixed(1)}% / 잎맥형 ${mB_.mB.cAbove.toFixed(1)}% (${VLABEL[mB_.v.cAbove]})</li>
      <li>통로 칸의 입구까지 평균 경로 거리: 직선형 ${fmtMM(mB_.info.pathA.mean)} mm, 잎맥형 ${fmtMM(mB_.info.pathB.mean)} mm · 통로 칸 평균 공급 농도(모델 B): 직선형 ${mB_.info.pathA.supplyMean.toFixed(3)}, 잎맥형 ${mB_.info.pathB.supplyMean.toFixed(3)}</li>
      <li>${(() => { const d = Math.abs(mB_.info.pathB.mean - mB_.info.pathA.mean) / Math.max(mB_.info.pathA.mean, 1) * 100;
        return d < 5 ? `두 구조의 평균 경로 거리 차이는 ${d.toFixed(1)}%로 작습니다. 따라서 <b>평균 경로 거리만으로는</b> 모델 B에서의 결과 차이를 설명하기 어렵습니다.`
                     : `두 구조의 평균 경로 거리 차이는 ${d.toFixed(1)}%입니다.`; })()}</li></ul>`;
  }
  // 나머지 변수 요약
  const others = ["angle", "pairs", "tert", "chw", "D", "kc"];
  h += `<p><b>그 밖의 변수</b> (목표 농도 이상 영역 / 평균 거리 판정)</p><ul>` + others.map(k => {
    const rs = rows.filter(r => r.key === k); if (!rs.length) return "";
    return `<li>${SWEEP_VARS[k].label}: ${rs.map(r => `${SWEEP_VARS[k].fmt(r.val)} ${short(r.v.cAbove)}/${short(r.v.mean)}`).join(" · ")}</li>`;
  }).join("") + `</ul><p class="note">약어: 잎 = 잎맥형 우세, 직 = 직선형 우세, ≈ = 비슷함, × = 판정 제외</p>`;
  if (excl.length) h += `<p class="warn">판정 제외 ${excl.length}개: ${excl.map(r => `${condLabel(r)}(${r.warn || "총길이 차이 " + r.lenDiff.toFixed(2) + "%"})`).join(", ")}</p>`;
  h += `</div>` + assumptionsBox(m) + estimateBox();
  return h;
}
const short = v => ({ B: "잎", A: "직", "=": "≈", X: "×" }[v]);
function interpretGrid(m) {
  const key = $("exMetric").value, mt = METRICS.find(x => x.key === key);
  const X = SWEEP_VARS[m.vars[0]], Y = SWEEP_VARS[m.vars[1]];
  const cnt = v => m.rows.filter(r => r.v[key] === v);
  let h = `<div class="ibox calc"><h4>계산 결과 (${mt.name})</h4><ul>
    <li>잎맥형 우세 ${cnt("B").length}칸 · 직선형 우세 ${cnt("A").length}칸 · 비슷함 ${cnt("=").length}칸 · 판정 제외 ${cnt("X").length}칸 (전체 ${m.rows.length}칸)</li>
    <li>잎맥형 우세 조건: ${cnt("B").map(r => `${X.fmt(r.vx)}·${Y.fmt(r.vy)}`).join(", ") || "없음"}</li>
    <li>직선형 우세 조건: ${cnt("A").map(r => `${X.fmt(r.vx)}·${Y.fmt(r.vy)}`).join(", ") || "없음"}</li></ul>`;
  h += `<p><b>모든 지표의 판정 개수</b></p><div class="scroll"><table><thead><tr><th>지표</th><th>잎맥형 우세</th><th>직선형 우세</th><th>비슷함</th><th>제외</th></tr></thead><tbody>` +
    METRICS.map(x => `<tr><td>${x.group} · ${x.name}</td>${["B", "A", "=", "X"].map(v => `<td>${m.rows.filter(r => r.v[x.key] === v).length}</td>`).join("")}</tr>`).join("") + `</tbody></table></div>`;
  const dc = m.rows.filter(r => r.v.mean !== "X" && score(r, DIST) * score(r, CONC) < 0);
  h += `<p><b>거리 지표와 농도 지표의 결론이 반대인 칸</b>: ${dc.map(r => `${X.fmt(r.vx)}·${Y.fmt(r.vy)}`).join(", ") || "없음"}</p></div>`;
  return h + assumptionsBox(m) + estimateBox();
}
function assumptionsBox(m) {
  return `<div class="ibox assume"><h4>설정한 가정 (계산 결과가 아님)</h4><ul>
    <li>2차원 정사각형 조직(2 mm × 2 mm), 확산 + 1차 소모만 계산. 유량, 압력, 혈류, 대류는 계산하지 않았습니다.</li>
    <li>통로 칸은 고정 농도(모델 A: 일정, 모델 B: exp(−s/Lₛ)로 감소). 모델 B의 감소는 실제 흐름을 계산한 것이 아니라 가정한 식입니다.</li>
    <li>조직 바깥 경계는 무플럭스, 초기 농도 0, 탐색 격자 Δx = ${m.dx} μm, 계산 시간 T = ${m.base.T} s.</li>
    <li>두 구조에 같은 조직 크기·확산계수·통로 굵기·공급 농도·소모율을 쓰고, 총길이 차이 1% 이내인 조건만 판정했습니다.</li></ul></div>`;
}
function estimateBox() {
  return `<div class="ibox guess"><h4>가능한 설명 (추정 — 이 시뮬레이터로 원인을 직접 확인하지 않음)</h4><ul>
    <li>거리 지표는 각 지점에서 <b>가장 가까운 통로 하나</b>만 보지만, 농도 지표는 여러 통로에서 온 물질이 겹쳐 쌓이는 효과, 소모, 시간, 통로 내부 농도(모델 B)를 함께 반영합니다. 두 지표의 결론이 다른 것은 이 정의 차이 때문일 수 있습니다(정의의 차이는 사실이지만, 각 조건에서 어떤 요인이 결정적이었는지는 확인하지 않았습니다).</li>
    <li>모델 B에서 판정이 달라지는 원인은 확인하지 않았습니다. 평균 경로 거리가 비슷하더라도, 농도가 높은 통로(입구 가까운 통로)가 조직의 어느 위치에 놓이는지(예: 잎맥형은 주맥이 조직 가운데를 지남)가 영향을 줄 수 있다는 것은 가설입니다.</li>
    <li>직선형에서 입구를 하나로 모으면 매니폴드에 길이를 쓰는 만큼 평행 통로가 짧아집니다. 이 효과는 '입구 조건' 행에서 수치로 비교할 수 있습니다.</li></ul></div>`;
}

// ---------------- 검증 ----------------
let convId = 0;
function renderVerifyDistance() {
  const rows = verifyDistance();
  $("vDist").innerHTML = `<thead><tr><th>항목</th><th>손계산</th><th>프로그램</th><th>결과</th></tr></thead><tbody>` +
    rows.map(r => { const ok = Math.abs(r.hand - r.calc) < 0.01; return `<tr><td>${r.name}</td><td>${r.hand.toFixed(2)}</td><td>${r.calc.toFixed(2)}</td><td>${ok ? "일치 ✓" : "<b class='warn'>불일치</b>"}</td></tr>`; }).join("") + "</tbody>";
}
function updateVerifyFromSim() {
  const s = simData.sA, P = simData.P;
  const pure = s.dx * s.dx / (4 * P.D);
  $("vStab").innerHTML = `<thead><tr><th>항목</th><th>값</th><th>결과</th></tr></thead><tbody>
    <tr><td>사용한 Δt</td><td>${s.dt.toFixed(5)} s</td><td></td></tr>
    <tr><td>확산 안정 조건 Δx²/(4D)</td><td>${pure.toFixed(5)} s</td><td>${s.dt <= pure ? "Δt ≤ 한계 ✓" : "<b class='warn'>초과</b>"}</td></tr>
    <tr><td>소모 포함 안정 한계(폰 노이만) Δx²/(4D + kΔx²/2)</td><td>${(s.dx * s.dx / (4 * P.D + P.kc * s.dx * s.dx / 2)).toFixed(5)} s</td><td>${s.dt <= s.dx * s.dx / (4 * P.D + P.kc * s.dx * s.dx / 2) ? "Δt ≤ 한계 ✓" : "<b class='warn'>초과</b>"}</td></tr>
    <tr><td>음수가 생기지 않는 조건 Δx²/(4D + kΔx²) (더 엄격, 이 조건으로 Δt를 정함)</td><td>${s.dtStab.toFixed(5)} s</td><td>${s.dt <= s.dtStab ? "Δt ≤ 한계 ✓" : "<b class='warn'>초과</b>"}</td></tr>
    <tr><td>1 − 4r − kΔt (0 이상이면 새 농도가 이전 농도들을 음수 아닌 가중치로 더한 값이 되어 음수·진동이 생기지 않음)</td><td>${(1 - 4 * s.r - s.kd).toFixed(4)}</td><td>${1 - 4 * s.r - s.kd >= 0 ? "✓" : "<b class='warn'>불안정</b>"}</td></tr></tbody>`;
  const mrow = (name, x) => `<tr><td>${name}</td><td>${x.supply.toFixed(2)}</td><td>${x.consumed.toFixed(2)}</td><td>${(x.M1 - x.M0).toFixed(2)}</td><td>${x.err.toExponential(2)}</td><td>${x.err < 1e-8 ? "보존 ✓" : "<b class='warn'>오차 큼</b>"}</td></tr>`;
  $("vMass").innerHTML = `<thead><tr><th>구조</th><th>들어온 양</th><th>소모된 양</th><th>조직 속 변화량</th><th>상대 오차</th><th>결과</th></tr></thead><tbody>${mrow("A 직선형", simData.sA.mass)}${mrow("B 잎맥형", simData.sB.mass)}</tbody>
    <caption class="note" style="caption-side:bottom;text-align:left;padding-top:6px">단위: 칸 수 × 상대 농도. 상대 오차 = |변화량 − (들어온 양 − 소모된 양)| ÷ 들어온 양</caption>`;
}
function onVerify(m) {
  const a = m.ana;
  $("vAna").innerHTML = `<thead><tr><th>통로에서 거리</th><th>해석해</th><th>프로그램</th><th>상대 오차</th></tr></thead><tbody>` +
    a.rows.map(r => `<tr><td>${r.dist.toFixed(0)} μm</td><td>${r.ana.toFixed(4)}</td><td>${r.num.toFixed(4)}</td><td>${r.err.toFixed(2)}% ${r.err < 2 ? "✓" : "<b class='warn'>큼</b>"}</td></tr>`).join("") +
    `</tbody><caption class="note" style="caption-side:bottom;text-align:left;padding-top:6px">λ = ${a.lam.toFixed(1)} μm, Δx = 20 μm, T = ${a.T.toFixed(0)} s (정상 상태 근사). 오차 기준 2%는 임의 설정값</caption>`;
  $("vRepro").innerHTML = `<thead><tr><th>1회차 검사합</th><th>2회차 검사합</th><th>결과</th></tr></thead><tbody><tr><td>${m.repro.c1.toFixed(6)}</td><td>${m.repro.c2.toFixed(6)}</td><td>${m.repro.same ? "완전히 같음 ✓" : "<b class='warn'>다름</b>"}</td></tr></tbody>`;
}
$("convBtn").addEventListener("click", () => {
  convId++; $("convBtn").disabled = true; $("convStatus").textContent = "계산 중…";
  send({ type: "conv", id: convId, P: params() }, "ex");
});
function onConv(m) {
  $("convBtn").disabled = false; $("convStatus").textContent = "완료";
  const ref = m.out.find(o => o.dx === 10);
  const rd = (v, r) => (v === null || r === null || Math.abs(r) < 1e-9) ? "—" : `${((v - r) / Math.abs(r) * 100).toFixed(1)}%`;
  const ca = METRICS.find(x => x.key === "cAbove");
  $("vConv").innerHTML = `<thead><tr><th>Δx</th><th>단계 수</th><th>A 목표 이상</th><th>B 목표 이상</th><th>A 변동계수</th><th>B 변동계수</th><th>A 도달 시간</th><th>B 도달 시간</th><th>목표 이상 판정</th></tr></thead><tbody>` +
    m.out.map(o => `<tr><td>${o.dx} μm</td><td>${o.steps}</td><td>${o.A.cAbove.toFixed(2)}% <small>(${rd(o.A.cAbove, ref.A.cAbove)})</small></td><td>${o.B.cAbove.toFixed(2)}% <small>(${rd(o.B.cAbove, ref.B.cAbove)})</small></td><td>${fx(o.A.cv, 3)}</td><td>${fx(o.B.cv, 3)}</td><td>${o.A.tCrit === null ? "미도달" : o.A.tCrit.toFixed(1) + " s"}</td><td>${o.B.tCrit === null ? "미도달" : o.B.tCrit.toFixed(1) + " s"}</td><td>${VLABEL[judge(o.A.cAbove, o.B.cAbove, ca, state.rel)]}</td></tr>`).join("") +
    `</tbody><caption class="note" style="caption-side:bottom;text-align:left;padding-top:6px">괄호 = 10 μm 결과와의 상대 차이. 격자를 줄여도 값과 판정이 크게 바뀌지 않으면 수렴한 것으로 봅니다.</caption>`;
}

// ---------------- draw challenge (기존 기능 유지) ----------------
const cvC = $("mapC");
let strokes = [], drawing = null, resC = null, connC = 0;
const drawSegs = () => strokes.flatMap(st => st.slice(1).map((p, i) => [st[i][0], st[i][1], p[0], p[1]]));
function updateDraw(recompute = true) {
  const segs = drawSegs();
  if (recompute || (resC && segs.length)) resC = segs.length ? evaluate(segs, state.thr, state.chw) : null;
  connC = segs.length ? connectedRatio(segs, [[0, W / 2]], state.chw) : 0;
  render(cvC, resC, segs, cssVar("--draw") || "#8a4fb0", { inlets: [W / 2] });
  const budget = cur.gA ? cur.gA.len : state.L * 1000;
  $("statsC").innerHTML = statsHTML(resC, { budget, relTo: cur.ra && cur.ra.max, conn: segs.length ? connC : undefined });
  const row = (name, r) => r && !r.empty ? `<tr><td>${name}</td><td>${fmtMM(r.len)}</td><td>${r.nets}</td><td>${Math.round(r.mean)}</td><td>${Math.round(r.max)}</td><td>${(r.cover * 100).toFixed(1)}%</td></tr>` : `<tr><td>${name}</td><td colspan="5">—</td></tr>`;
  $("cmpTable").innerHTML = `<thead><tr><th>구조</th><th>길이(mm)</th><th>입구</th><th>평균(μm)</th><th>최대(μm)</th><th>기준 이내</th></tr></thead><tbody>${row("A 직선형", cur.ra)}${row("B 잎맥형", cur.rb)}${row("C 나의 설계", resC)}</tbody>`;
}
function toUm(e) {
  const r = cvC.getBoundingClientRect();
  return [Math.max(0, Math.min(W, (e.clientX - r.left) / r.width * W)), Math.max(0, Math.min(W, (e.clientY - r.top) / r.height * W))];
}
cvC.addEventListener("pointerdown", e => { cvC.setPointerCapture(e.pointerId); drawing = [toUm(e)]; strokes.push(drawing); });
cvC.addEventListener("pointermove", e => {
  if (!drawing) return;
  const p = toUm(e), q = drawing[drawing.length - 1];
  if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= 25) {
    drawing.push(p);
    const k = cvC.width / W, ctx = cvC.getContext("2d");
    ctx.strokeStyle = cssVar("--draw") || "#8a4fb0"; ctx.lineWidth = Math.max(2, state.chw * k); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(q[0] * k, q[1] * k); ctx.lineTo(p[0] * k, p[1] * k); ctx.stroke();
  }
});
const endStroke = () => { if (!drawing) return; if (drawing.length < 2) strokes.pop(); drawing = null; updateDraw(true); };
cvC.addEventListener("pointerup", endStroke); cvC.addEventListener("pointercancel", endStroke);
$("undoBtn").addEventListener("click", () => { strokes.pop(); updateDraw(true); });
$("clearBtn").addEventListener("click", () => { strokes = []; updateDraw(true); });
$("loadBBtn").addEventListener("click", () => { strokes = (cur.b || []).map(s => [[s[0], s[1]], [s[2], s[3]]]); updateDraw(true); });

// ---------------- controls ----------------
function syncOutputs() {
  $("LOut").textContent = `${state.L.toFixed(1)} mm`;
  const mm_ = state.mAuto && cur.gA ? cur.gA.info.m : state.m;
  $("nOut").textContent = `${state.mAuto ? "자동 → " : ""}${mm_}개 · 간격 ${Math.round(W / mm_)} μm`;
  $("n").disabled = state.mAuto;
  $("angleOut").textContent = `${state.angle}°`;
  $("chwOut").textContent = `${state.chw} μm`;
  $("thrOut").textContent = `${state.thr} μm`;
  $("LsOut").textContent = `${state.Ls} μm`;
  $("DOut").textContent = `${state.D} μm²/s`;
  $("kcOut").textContent = `${state.kc.toFixed(3)} /s`;
  $("CtOut").textContent = `${state.Ct.toFixed(2)} C₀`;
  $("critOut").textContent = `조직의 ${state.crit}%`;
  $("TOut").textContent = `${state.T} s`;
  $("lamNote").textContent = `1차 소모(kC). 침투 길이 λ = √(D/k) = ${Math.sqrt(state.D / state.kc).toFixed(0)} μm. 기본값 0.089 /s는 λ를 문헌의 산소 확산 한계 100~200 μm의 중간(150 μm)으로 둔 교육용 설정값(λ는 농도가 약 37%로 줄어드는 거리로, 확산 한계와 같은 양은 아님)`;
  $("TNote").textContent = `1/k ≈ ${(1 / state.kc).toFixed(1)} s의 약 ${(state.T * state.kc).toFixed(1)}배. 기본 60 s ≈ 5/k (정상 상태에 가까워지는 시간)`;
  $("LsBox").hidden = state.model !== "B";
  $("modelNote").textContent = state.model === "A" ? "통로 안 모든 칸이 공급 농도 C₀를 유지한다고 가정합니다." : "통로 안 농도 = C₀ × exp(−s ÷ Lₛ). 입구에서 통로를 따라 멀어질수록 줄어든다고 가정한 식입니다(유량·대류는 계산하지 않음).";
  $("exRule").textContent = "실행 전 고정되는 판정 기준: " + ruleText(state.rel) + " 총길이 차이가 1%를 넘거나 구조를 만들 수 없는 조건은 판정에서 제외합니다.";
}
let pending = null, sweepTimer = null;
function schedule(structural = true) {
  syncOutputs(); renderParamTable();
  if (structural) {
    if (pending) cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => { pending = null; updateCompare(); });
    clearTimeout(sweepTimer); sweepTimer = setTimeout(updateSweep, 250);
  }
  scheduleSim();
}
const NUM = { L: "L", n: "m", angle: "angle", chw: "chw", thr: "thr", Ls: "Ls", D: "D", kc: "kc", Ct: "Ct", crit: "crit", T: "T" };
const STRUCT = new Set(["L", "m", "angle", "chw", "thr", "inlet", "pairs", "tert"]);
Object.entries(NUM).forEach(([id, key]) => $(id).addEventListener("input", e => { state[key] = +e.target.value; schedule(STRUCT.has(key)); }));
$("inlet").addEventListener("change", e => { state.inlet = e.target.value; schedule(true); });
$("mAuto").addEventListener("change", e => { state.mAuto = e.target.checked; schedule(true); });
$("pairs").addEventListener("change", e => { state.pairs = e.target.value === "auto" ? "auto" : +e.target.value; schedule(true); });
$("tert").addEventListener("change", e => { state.tert = +e.target.value; schedule(true); });
$("model").addEventListener("change", e => { state.model = e.target.value; schedule(false); });
$("dx").addEventListener("change", e => { state.dx = +e.target.value; schedule(false); });
let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { updateCompare(); drawConcMaps(); if (simData) drawSeries(); if ($("cAngle").innerHTML) drawResultCharts(); }, 150); });
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { updateCompare(); drawChart(); drawConcMaps(); if (simData) drawSeries(); buildResults(); });

// ================= results section (recorded data) =================
const RES_THR = 100;
const R_A4 = { mean: 120, max: 235, cover: 41.7 };
// [angle, levels, pairs, mean, max, cover%, timeRatio]
const R_LEVEL = [[50,1,3,148,635,38.8,7.30],[70,1,3,140,478,39.6,4.14],[90,1,3,144,322,37.9,1.87],
                 [50,2,1,198,811,37.3,11.92],[70,2,2,189,580,34.6,6.10],[90,2,2,179,535,34.8,5.19]];
// [n, A mean, A max, A cover, B1 pairs, B1 mean, B1 max, B1 cover, B2 pairs, B2 mean, B2 max, B2 cover]
const R_COUNT = [[2,245,485,20.4,1,330,985,19.2,1,371,985,17.1],[3,162,322,30.9,2,205,485,28.4,1,249,792,27.9],
  [4,120,235,41.7,3,144,322,37.9,2,179,535,34.8],[5,95,185,52.6,4,110,235,47.6,2,120,356,46.5],
  [6,78,155,63.8,5,89,185,57.4,2,100,315,56.1],[7,66,132,75.3,6,74,155,67.5,3,86,266,65.4],
  [8,60,110,90.9,7,63,132,77.8,3,72,245,73.4],[9,51,101,98.9,8,56,110,90.2,4,76,261,71.8],
  [10,45,85,100.0,9,49,101,99.0,4,63,210,79.4]];
// [angle, pairs, mean, max, cover%, timeRatio]  (2단, 총 길이 8 mm)
const R_ANGLE = [[30,1,235,975,34.4,17.22],[35,1,222,934,36.0,15.78],[40,1,213,895,36.9,14.50],[45,1,204,853,37.4,13.18],
  [50,1,198,811,37.3,11.92],[55,2,209,658,33.3,7.84],[60,2,201,629,34.0,7.16],[65,2,194,603,34.3,6.58],
  [70,2,189,580,34.6,6.10],[75,2,185,562,34.6,5.72],[80,2,182,548,34.6,5.44],[85,2,180,539,34.7,5.26],[90,2,179,535,34.8,5.19]];

// 이전 버전 조건(직선형 개별 입구, 총길이 = n × 2 mm)을 그대로 재현
function legacyStraight(n) { return straightGeom({ m: n, L: n * W / 1000, inlet: "each", chw: 20 }).segs; }
function leafFor(n, angle, levels) {
  const g = leafGeom({ L: n * W / 1000, angle, pairs: "auto", tert: levels === 2 ? 2 : 0, chw: 20 });
  return { segs: g.segs, k: g.info.k };
}
function miniCard(parent, title, segs, color, metaHTML, extraClass = "") {
  const box = document.createElement("div"); box.className = "mini " + extraClass;
  box.innerHTML = `<div class="t">${title}</div><canvas></canvas><div class="m">${metaHTML}</div>`;
  parent.appendChild(box);
  const cv = box.querySelector("canvas");
  return () => { const r = evaluate(segs, RES_THR, 20); render(cv, r, segs, color, { thr: RES_THR, mini: true, chw: 20 }); };
}
const miniJobs = [];
function buildResults() {
  const cA = cssVar("--s-a"), cB1 = cssVar("--s-b1"), cB2 = cssVar("--s-b2");
  // ① levels maps
  const lm = document.getElementById("levelMaps"); lm.innerHTML = "";
  const l1 = R_LEVEL.find(r => r[0] === 90 && r[1] === 1), l2 = R_LEVEL.find(r => r[0] === 90 && r[1] === 2);
  const meta = (mean, max, cover, extra) => `평균 <b>${mean}</b> · 최대 <b>${max}</b> μm<br>100 μm 이내 ${cover}%${extra ? " · " + extra : ""}`;
  miniJobs.push(miniCard(lm, `<i class="swatch" style="background:${cA}"></i>A 직선형 (4개)`, legacyStraight(4), cA, meta(R_A4.mean, R_A4.max, R_A4.cover, "입구 4개")));
  miniJobs.push(miniCard(lm, `<i class="swatch" style="background:${cB1}"></i>B 1단 (측맥 3쌍)`, leafFor(4, 90, 1).segs, cB1, meta(l1[3], l1[4], l1[5], "입구 1개")));
  miniJobs.push(miniCard(lm, `<i class="swatch" style="background:${cB2}"></i>B 2단 (측맥 2쌍+세맥)`, leafFor(4, 90, 2).segs, cB2, meta(l2[3], l2[4], l2[5], "입구 1개")));
  document.getElementById("levelTable").innerHTML = `<thead><tr><th>분기 각도</th><th>분기 단계</th><th>측맥</th><th>평균(μm)</th><th>최대(μm)</th><th>100 μm 이내</th><th>확산 시간(A 대비)</th></tr></thead><tbody>
    <tr><td>직선형 A</td><td>—</td><td>통로 4개</td><td>120</td><td>235</td><td>41.7%</td><td>1.00</td></tr>` +
    [50, 70, 90].flatMap(a => [1, 2].map(lv => R_LEVEL.find(r => r[0] === a && r[1] === lv))).map(r =>
      `<tr><td>${r[0]}°</td><td>${r[1]}단</td><td>${r[2]}쌍</td><td>${r[3]}</td><td>${r[4]}</td><td>${r[5]}%</td><td>${r[6].toFixed(2)}배</td></tr>`).join("") + "</tbody>";
  // ② count charts + table
  document.getElementById("countTable").innerHTML = `<thead><tr><th>직선형 개수</th><th>총 길이</th><th>A 평균</th><th>A 최대</th><th>A 100 이내</th><th>B1 측맥</th><th>B1 평균</th><th>B1 최대</th><th>B1 100 이내</th><th>B2 측맥</th><th>B2 평균</th><th>B2 최대</th><th>B2 100 이내</th></tr></thead><tbody>` +
    R_COUNT.map(r => `<tr${r[0] === 9 ? ' class="hl"' : ""}><td>${r[0]}개</td><td>${r[0] * 2} mm</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}%</td><td>${r[4]}쌍</td><td>${r[5]}</td><td>${r[6]}</td><td>${r[7]}%</td><td>${r[8]}쌍</td><td>${r[9]}</td><td>${r[10]}</td><td>${r[11]}%</td></tr>`).join("") +
    `</tbody><caption style="caption-side:bottom;text-align:left;padding-top:6px" class="note">거리 단위 μm · 굵게 표시: 2단 측맥이 3쌍 → 4쌍으로 바뀌며 거리가 늘어난 구간</caption>`;
  // ③ angle maps + chart + table
  const am = document.getElementById("angleMaps"); am.innerHTML = "";
  const best = Math.min(...R_ANGLE.map(r => r[3]));
  R_ANGLE.forEach(r => miniJobs.push(miniCard(am, `${r[0]}°`, leafFor(4, r[0], 2).segs, cB2, `측맥 ${r[1]}쌍<br>평균 ${r[2]} μm<br>최대 <b>${r[3]}</b> μm`, r[3] === best ? "best" : "")));
  document.getElementById("angleTable").innerHTML = `<thead><tr><th>분기 각도</th><th>측맥</th><th>평균(μm)</th><th>최대(μm)</th><th>100 μm 이내</th><th>확산 시간(A 대비)</th></tr></thead><tbody>` +
    R_ANGLE.map(r => `<tr${r[3] === best ? ' class="hl"' : ""}><td>${r[0]}°</td><td>${r[1]}쌍</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}%</td><td>${r[5].toFixed(2)}배</td></tr>`).join("") + "</tbody>";
  drawResultCharts();
  runMiniJobs();
}
function drawResultCharts() {
  const cA = cssVar("--s-a"), cB1 = cssVar("--s-b1"), cB2 = cssVar("--s-b2");
  const xs = R_COUNT.map(r => r[0] * 2);
  lineChart("cMean", { xs, xTitle: "통로 총 길이 (mm)", unit: "μm", xFmt: v => v + " mm",
    series: [{ name: "A 직선형", color: cA, values: R_COUNT.map(r => r[1]) }, { name: "B 1단", color: cB1, values: R_COUNT.map(r => r[5]) }, { name: "B 2단", color: cB2, values: R_COUNT.map(r => r[9]) }],
    refs: [{ y: 100, label: "기준 100 μm" }] });
  lineChart("cMax", { xs, xTitle: "통로 총 길이 (mm)", unit: "μm", xFmt: v => v + " mm",
    series: [{ name: "A 직선형", color: cA, values: R_COUNT.map(r => r[2]) }, { name: "B 1단", color: cB1, values: R_COUNT.map(r => r[6]) }, { name: "B 2단", color: cB2, values: R_COUNT.map(r => r[10]) }],
    refs: [{ y: 100, label: "기준 100 μm" }] });
  lineChart("cAngle", { xs: R_ANGLE.map(r => r[0]), xTitle: "분기 각도 (°)", unit: "μm", xFmt: v => v + "°",
    series: [{ name: "잎맥형 평균", color: cB2, values: R_ANGLE.map(r => r[2]) }, { name: "잎맥형 최대", color: cB2, dash: "7 5", values: R_ANGLE.map(r => r[3]) }],
    refs: [{ y: 120, label: "A 평균 120", color: cA }, { y: 235, label: "A 최대 235", color: cA }],
    vline: { x: 52.5, label: "측맥 1쌍 → 2쌍" } });
}
function runMiniJobs() { // draw small maps a few at a time so the page stays responsive
  const jobs = miniJobs.splice(0);
  const step = () => { const t = performance.now(); while (jobs.length && performance.now() - t < 30) jobs.shift()(); if (jobs.length) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

// generic line chart with crosshair tooltip
function lineChart(id, cfg) {
  const svg = document.getElementById(id), box = svg.parentElement, tip = box.querySelector(".tip");
  const VH = cfg.h || 300, VW = Math.round(Math.max(330, Math.min(900, svg.clientWidth || 520)));
  svg.setAttribute("viewBox", `0 0 ${VW} ${VH}`);
  const muted = cssVar("--muted"), line = cssVar("--line"), ink = cssVar("--ink"), card = cssVar("--card");
  const m = { l: 46, r: VW < 420 ? 92 : 112, t: 14, b: 44 }, w = VW - m.l - m.r, h = VH - m.t - m.b;
  const xs = cfg.xs, xmin = Math.min(...xs), xmax = Math.max(...xs);
  const allY = cfg.series.flatMap(s => s.values).concat((cfg.refs || []).map(r => r.y));
  const step = cfg.yStep || 200, ymax = cfg.yMax || Math.ceil(Math.max(...allY) / step) * step;
  const X = v => m.l + (v - xmin) / (xmax - xmin) * w, Y = v => m.t + h - v / ymax * h;
  let s = "";
  for (let i = 0; i * step <= ymax + 1e-9; i++) { const v = i * step; s += `<line x1="${m.l}" x2="${m.l + w}" y1="${Y(v)}" y2="${Y(v)}" stroke="${line}" stroke-width="1"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="12" fill="${muted}">${cfg.yFmt ? cfg.yFmt(v) : v}</text>`; }
  const every = cfg.xEvery || (xs.length > 9 || w < 260 ? 2 : 1);
  xs.forEach((x, i) => { if (i % every === 0 || i === xs.length - 1) s += `<text x="${X(x)}" y="${m.t + h + 18}" text-anchor="middle" font-size="12" fill="${muted}">${cfg.xLab ? cfg.xLab(x) : x}</text>`; });
  s += `<text x="${m.l + w / 2}" y="${VH - 6}" text-anchor="middle" font-size="12" fill="${muted}">${cfg.xTitle}</text>`;
  s += `<text x="12" y="${m.t + h / 2}" text-anchor="middle" font-size="12" fill="${muted}" transform="rotate(-90 12 ${m.t + h / 2})">${cfg.yTitle || "거리 (" + cfg.unit + ")"}</text>`;
  if (cfg.vline) s += `<line x1="${X(cfg.vline.x)}" x2="${X(cfg.vline.x)}" y1="${m.t}" y2="${m.t + h}" stroke="${muted}" stroke-dasharray="2 4"/><text x="${X(cfg.vline.x) + 6}" y="${m.t + 12}" font-size="11.5" fill="${muted}">${cfg.vline.label}</text>`;
  (cfg.refs || []).forEach(r => { s += `<line x1="${m.l}" x2="${m.l + w}" y1="${Y(r.y)}" y2="${Y(r.y)}" stroke="${r.color || muted}" stroke-width="1.5" stroke-dasharray="4 4" opacity=".85"/>`; });
  cfg.series.forEach(se => {
    s += `<polyline points="${se.values.map((v, i) => `${X(xs[i])},${Y(v)}`).join(" ")}" fill="none" stroke="${se.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" ${se.dash ? `stroke-dasharray="${se.dash}"` : ""}/>`;
    if (!cfg.noDots) se.values.forEach((v, i) => { s += `<circle cx="${X(xs[i])}" cy="${Y(v)}" r="4" fill="${se.color}" stroke="${card}" stroke-width="2"/>`; });
  });
  // direct end labels (series + refs), nudged apart
  const labs = cfg.series.map(se => ({ y: Y(se.values[se.values.length - 1]), text: se.name, color: ink }))
    .concat((cfg.refs || []).map(r => ({ y: Y(r.y), text: r.label, color: muted }))).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 14) labs[i].y = labs[i - 1].y + 14;
  labs.forEach(l => { s += `<text x="${m.l + w + 8}" y="${l.y + 4}" font-size="12" fill="${l.color}" font-weight="${l.color === ink ? 700 : 400}">${l.text}</text>`; });
  s += `<line class="xh" x1="0" x2="0" y1="${m.t}" y2="${m.t + h}" stroke="${ink}" stroke-width="1" opacity="0"/>`;
  s += `<rect class="hit" x="${m.l}" y="${m.t}" width="${w}" height="${h}" fill="transparent"/>`;
  svg.innerHTML = s;
  const xh = svg.querySelector(".xh"), hit = svg.querySelector(".hit");
  const show = e => {
    const r = svg.getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * VW;
    let i = 0, best = Infinity; xs.forEach((x, j) => { const d = Math.abs(X(x) - vx); if (d < best) { best = d; i = j; } });
    xh.setAttribute("x1", X(xs[i])); xh.setAttribute("x2", X(xs[i])); xh.setAttribute("opacity", ".35");
    tip.innerHTML = `<b>${cfg.xFmt(xs[i])}</b><br>` + cfg.series.map(se => `<i style="background:${se.color}"></i>${se.name} ${cfg.vFmt ? cfg.vFmt(se.values[i]) : se.values[i]} ${cfg.unit}`).join("<br>");
    tip.style.opacity = 1;
    const bx = box.getBoundingClientRect(), px = e.clientX - bx.left, py = e.clientY - bx.top;
    const tw = tip.offsetWidth; tip.style.left = Math.max(4, Math.min(bx.width - tw - 4, px + 14 > bx.width - tw ? px - tw - 14 : px + 14)) + "px";
    tip.style.top = Math.max(4, py - 30) + "px";
  };
  const hide = () => { tip.style.opacity = 0; xh.setAttribute("opacity", "0"); };
  hit.addEventListener("pointermove", show); hit.addEventListener("pointerdown", show); hit.addEventListener("pointerleave", hide);
}

// ---------------- start ----------------
syncOutputs(); updateCompare(); updateSweep(); renderVerifyDistance(); renderParamTable(); updateAutoTable();
simId++; simT0 = performance.now(); send({ type: "sim", id: simId, P: params() }, "sim");
send({ type: "verify", id: 0, P: params() }, "sim");
setTimeout(buildResults, 60);
