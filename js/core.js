"use strict";
// ======================================================================
// CORE MODEL — shared by the page and the Web Worker (no DOM access here)
// ======================================================================
const W = 2000;          // tissue size (μm), 기존 값
const N = 200;           // distance grid cells per side (10 μm), 기존 값
const CELL = W / N;

// ---------------- geometry ----------------
function clipSeg(x1, y1, x2, y2) {           // Liang–Barsky clip to [0,W]^2
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const p = [-dx, dx, -dy, dy], q = [x1, W - x1, y1, W - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; }
    else {
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
  }
  if (t1 - t0 < 1e-9) return null;
  return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
}
const segLen = s => Math.hypot(s[2] - s[0], s[3] - s[1]);
const totalLen = segs => segs.reduce((a, s) => a + segLen(s), 0);

// 직선형: m개의 평행 통로. 입구 1개면 왼쪽 매니폴드(공통 연결 통로)를 포함하고 그 길이도 총길이에 넣는다.
function straightGeom(P) {
  if (P.m === "auto") {   // 총길이에 맞춰, 통로가 조직 끝을 넘지 않는 최소 개수
    const Lt = P.L * 1000, x0 = P.inlet === "one" ? P.chw / 2 : 0;
    let m = 2;
    while (m < 40) { const man = P.inlet === "one" ? (m - 1) * W / m : 0; if ((Lt - man) / m <= W - x0) break; m++; }
    const g = straightGeom({ ...P, m }); g.info.auto = true; return g;
  }
  const m = P.m, chw = P.chw, Lt = P.L * 1000;
  const ys = Array.from({ length: m }, (_, i) => (i + 0.5) * W / m);
  const segs = []; let inlets, man = 0, line, warn = null;
  if (P.inlet === "one") {
    const x0 = chw / 2, maxLine = W - x0;
    man = ys[m - 1] - ys[0];
    line = (Lt - man) / m;
    if (line <= 1) { warn = "총길이가 매니폴드 길이보다 짧아 직선형을 만들 수 없습니다"; line = 1; }
    if (line > maxLine) { warn = "총길이가 길어 직선형 통로가 조직 밖으로 나갑니다. 직선형 통로 수를 늘리세요"; line = maxLine; }
    segs.push([x0, ys[0], x0, ys[m - 1]]);
    ys.forEach(y => segs.push([x0, y, x0 + line, y]));
    inlets = [[0, W / 2]];
  } else {
    line = Lt / m;
    if (line > W) { warn = "총길이가 길어 직선형 통로가 조직 밖으로 나갑니다. 직선형 통로 수를 늘리세요"; line = W; }
    ys.forEach(y => segs.push([0, y, line, y]));
    inlets = ys.map(y => [0, y]);
  }
  return { kind: "A", segs, inlets, len: totalLen(segs), warn, info: { m, line, man, spacing: W / m } };
}

// 잎맥형: 주맥 1개 + 측맥 k쌍(주맥을 따라 고르게) + 측맥마다 세맥 분기점 tert개(각 분기점에서 2갈래)
const TERT_POS = { 0: [], 1: [0.5], 2: [0.35, 0.7], 3: [0.25, 0.5, 0.75] };
function leafRaw(k, angleDeg, tert, f) {
  const a = angleDeg * Math.PI / 180, mid = W / 2, s = W / k;
  const L = f * (W / 2) / Math.sin(a), dx = Math.cos(a);
  const raw = [[0, mid, W, mid]];
  for (let j = 0; j < k; j++) {
    const x0 = Math.max(0, (j + 0.5) * s - L * dx / 2);
    for (const sg of [-1, 1]) {
      const dy = sg * Math.sin(a);
      raw.push([x0, mid, x0 + dx * L, mid + dy * L]);
      const base = Math.atan2(dy, dx);
      for (const t of TERT_POS[tert] || []) {
        const bx = x0 + dx * L * t, by = mid + dy * L * t, tl = 0.4 * L;
        for (const r of [-1, 1]) {
          const ang = base + r * 50 * Math.PI / 180;
          raw.push([bx, by, bx + Math.cos(ang) * tl, by + Math.sin(ang) * tl]);
        }
      }
    }
  }
  return raw.map(r => clipSeg(...r)).filter(Boolean);
}
function leafGeom(P) {
  const Lt = P.L * 1000, tot = (k, f) => totalLen(leafRaw(k, P.angle, P.tert, f));
  let k, fmax, warn = null, f;
  if (P.pairs === "auto") { k = 1; while (k < 60 && tot(k, 1) < Lt) k++; fmax = 1; }   // 기존 방식: 측맥이 가장자리까지 닿는다고 할 때(f=1) 총길이를 채우는 최소 쌍 수
  else { k = +P.pairs; fmax = 4; }
  if (tot(k, fmax) < Lt) { f = fmax; warn = "잎맥형이 조직 밖으로 잘려 목표 총길이에 도달하지 못했습니다"; }
  else if (tot(k, 0.01) > Lt) { f = 0.01; warn = "총길이가 너무 짧아 잎맥형을 만들 수 없습니다"; }
  else {
    let lo = 0.01, hi = fmax;
    for (let i = 0; i < 40; i++) { const mm = (lo + hi) / 2; if (tot(k, mm) < Lt) lo = mm; else hi = mm; }
    f = hi;
  }
  const segs = leafRaw(k, P.angle, P.tert, f);
  return { kind: "B", segs, inlets: [[0, W / 2]], len: totalLen(segs), warn, k, info: { k, f, spacing: W / k, tert: P.tert } };
}

// ---------------- distance metrics (기존 방식 유지: 10 μm 격자, 칸 중심 → 가장 가까운 통로 벽) ----------------
function evaluate(segs, thr, chw = 20) {
  const dist = new Float32Array(N * N);
  const S = segs.length;
  const ax = new Float64Array(S), ay = new Float64Array(S), bx = new Float64Array(S), by = new Float64Array(S), l2 = new Float64Array(S);
  segs.forEach((s, i) => { ax[i] = s[0]; ay[i] = s[1]; bx[i] = s[2] - s[0]; by[i] = s[3] - s[1]; l2[i] = bx[i] * bx[i] + by[i] * by[i]; });
  let sum = 0, cnt = 0, within = 0, max = -1, farX = 0, farY = 0;
  const half = chw / 2;
  for (let r = 0; r < N; r++) {
    const py = (r + 0.5) * CELL;
    for (let c = 0; c < N; c++) {
      const px = (c + 0.5) * CELL;
      let m = Infinity;
      for (let i = 0; i < S; i++) {
        const wx = px - ax[i], wy = py - ay[i];
        let t = l2[i] > 0 ? (wx * bx[i] + wy * by[i]) / l2[i] : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = wx - t * bx[i], ey = wy - t * by[i];
        const d2 = ex * ex + ey * ey;
        if (d2 < m) m = d2;
      }
      const d = S ? Math.sqrt(m) - half : Infinity;
      const k = r * N + c;
      if (d <= 0) { dist[k] = -1; continue; }
      dist[k] = d; sum += d; cnt++;
      if (d <= thr) within++;
      if (d > max) { max = d; farX = px; farY = py; }
    }
  }
  return { dist, mean: cnt ? sum / cnt : 0, max: Math.max(max, 0), cover: cnt ? within / cnt : 0,
           far: [farX, farY], len: totalLen(segs), nets: countNetworks(segs, chw), empty: S === 0 };
}

// networks = groups of touching segments (each group needs its own inlet)
function segSegDist(s, t) {
  const o = (ax, ay, bx, by, cx, cy) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  const o1 = o(s[0], s[1], s[2], s[3], t[0], t[1]), o2 = o(s[0], s[1], s[2], s[3], t[2], t[3]);
  const o3 = o(t[0], t[1], t[2], t[3], s[0], s[1]), o4 = o(t[0], t[1], t[2], t[3], s[2], s[3]);
  if (o1 * o2 < 0 && o3 * o4 < 0) return 0;
  return Math.min(ptSeg(s[0], s[1], t), ptSeg(s[2], s[3], t), ptSeg(t[0], t[1], s), ptSeg(t[2], t[3], s));
}
function ptSeg(px, py, q) {
  const bx = q[2] - q[0], by = q[3] - q[1], l = bx * bx + by * by;
  let u = l ? ((px - q[0]) * bx + (py - q[1]) * by) / l : 0; u = Math.max(0, Math.min(1, u));
  return Math.hypot(px - q[0] - u * bx, py - q[1] - u * by);
}
function components(segs, chw) {
  const p = segs.map((_, i) => i);
  const f = i => (p[i] === i ? i : (p[i] = f(p[i])));
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++)
      if (f(i) !== f(j) && segSegDist(segs[i], segs[j]) <= chw) p[f(i)] = f(j);
  return segs.map((_, i) => f(i));
}
function countNetworks(segs, chw = 20) { return new Set(components(segs, chw)).size; }
// 입구에서 연결된 통로 비율 = 입구와 그래프로 이어진 통로 길이 / 전체 통로 길이
function connectedRatio(segs, inlets, chw) {
  if (!segs.length) return 0;
  const comp = components(segs, chw), ok = new Set();
  segs.forEach((s, i) => { if (inlets.some(([x, y]) => ptSeg(x, y, s) <= chw)) ok.add(comp[i]); });
  const tot = totalLen(segs);
  return segs.reduce((a, s, i) => a + (ok.has(comp[i]) ? segLen(s) : 0), 0) / tot;
}

// ---------------- concentration model ----------------
// ∂C/∂t = D ∇²C − k C  (명시적 유한차분, 5점 라플라시안)
// 통로 칸: 고정 농도(디리클레). 모델 A: C0, 모델 B: C0·exp(−s/Ls) (s = 입구에서 통로를 따라 잰 거리)
// 조직 바깥 경계: 무플럭스(거울 경계). 입구와 연결되지 않은 통로 칸은 공급하지 않는다(조직으로 취급).
function rasterize(geom, P) {
  const dx = P.dx, n = Math.round(W / dx), rad = Math.max(P.chw / 2, dx / 2);
  const segs = geom.segs, S = segs.length, NN = n * n;
  const eps = 1e-3 * dx;   // 격자선과 통로가 정확히 겹칠 때 한쪽 칸만 고르기 위한 고정된 아주 작은 이동
  const isCh = new Uint8Array(NN);
  for (let r = 0; r < n; r++) {
    const py = (r + 0.5) * dx + eps * 1.3;
    for (let c = 0; c < n; c++) {
      const px = (c + 0.5) * dx + eps;
      for (let i = 0; i < S; i++) { if (ptSeg(px, py, segs[i]) <= rad) { isCh[r * n + c] = 1; break; } }
    }
  }
  // 입구에서 통로를 따라가는 최단 거리 (8방향 다익스트라)
  const s = new Float64Array(NN).fill(Infinity);
  const heap = []; const push = (d, i) => { heap.push([d, i]); let j = heap.length - 1; while (j > 0) { const p = (j - 1) >> 1; if (heap[p][0] <= heap[j][0]) break; [heap[p], heap[j]] = [heap[j], heap[p]]; j = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let j = 0; for (;;) { const l = 2 * j + 1, r = l + 1; let m = j; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === j) break; [heap[m], heap[j]] = [heap[j], heap[m]]; j = m; } } return top; };
  for (const [ix, iy] of geom.inlets) {
    const reach = rad + dx;
    const c0 = Math.max(0, Math.floor((ix - reach) / dx)), c1 = Math.min(n - 1, Math.floor((ix + reach) / dx));
    const r0 = Math.max(0, Math.floor((iy - reach) / dx)), r1 = Math.min(n - 1, Math.floor((iy + reach) / dx));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const i = r * n + c; if (!isCh[i]) continue;
      const d = Math.hypot((c + 0.5) * dx - ix, (r + 0.5) * dx - iy);
      if (d <= reach && d < s[i]) { s[i] = d; push(d, i); }
    }
  }
  const D8 = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [1, 1, Math.SQRT2]];
  while (heap.length) {
    const [d, i] = pop(); if (d > s[i]) continue;
    const r = (i / n) | 0, c = i % n;
    for (const [dr, dc, w] of D8) {
      const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
      const j = rr * n + cc; if (!isCh[j]) continue;
      const nd = d + w * dx; if (nd < s[j]) { s[j] = nd; push(nd, j); }
    }
  }
  return { n, dx, isCh, s };
}

function simulate(geom, P, opt = {}) {
  const g = rasterize(geom, P), { n, dx, isCh, s } = g, NN = n * n;
  const D = P.D, k = P.kc, T = P.T, C0 = P.C0, Ct = P.Ct, crit = P.crit / 100;
  const dtPure = dx * dx / (4 * D);                 // 확산만 있을 때의 안정 조건 Δt ≤ Δx²/(4D)
  const dtStab = dx * dx / (4 * D + k * dx * dx);   // 소모 항까지 포함한 안정 조건
  const steps = Math.max(1, Math.ceil(T / (0.9 * dtStab))), dt = T / steps;
  const r = D * dt / (dx * dx), kd = k * dt;
  const fixed = new Uint8Array(NN), C = new Float64Array(NN);
  let chCells = 0, chReach = 0, pathSum = 0, pathMax = 0, supSum = 0;
  for (let i = 0; i < NN; i++) if (isCh[i]) {
    chCells++;
    if (isFinite(s[i])) {
      fixed[i] = 1; chReach++; C[i] = P.model === "B" ? C0 * Math.exp(-s[i] / P.Ls) : C0;
      pathSum += s[i]; if (s[i] > pathMax) pathMax = s[i]; supSum += C[i];
    }
  }
  const tissue = []; for (let i = 0; i < NN; i++) if (!fixed[i]) tissue.push(i);
  const nt = tissue.length, T32 = Int32Array.from(tissue), nb = new Int32Array(4 * nt);
  for (let t = 0; t < nt; t++) {
    const i = T32[t], rr = (i / n) | 0, cc = i % n;
    nb[4 * t] = rr > 0 ? i - n : i; nb[4 * t + 1] = rr < n - 1 ? i + n : i;     // 바깥 경계: 자기 자신 = 무플럭스
    nb[4 * t + 2] = cc > 0 ? i - 1 : i; nb[4 * t + 3] = cc < n - 1 ? i + 1 : i;
    C[i] = P.Cinit;
  }
  let Cn = Float64Array.from(C), Cc = C;
  const arrival = new Float32Array(nt).fill(-1);
  let above = 0, tCrit = null;
  for (let t = 0; t < nt; t++) if (Cc[T32[t]] >= Ct) { arrival[t] = 0; above++; }
  if (above >= crit * nt && nt) tCrit = 0;
  let M0 = 0; for (let t = 0; t < nt; t++) M0 += Cc[T32[t]];
  let supply = 0, consumed = 0;
  const nFrames = opt.frames || 0, frames = [], series = { t: [], above: [], mean: [] };
  const saveFrame = (time, sum) => {
    series.t.push(+time.toFixed(3)); series.above.push(nt ? above / nt * 100 : 0); series.mean.push(nt ? sum / nt : 0);
    if (nFrames) frames.push(Float32Array.from(Cc));
  };
  saveFrame(0, M0);
  let nextFrame = nFrames ? T / nFrames : T / 30;
  const frameStep = nFrames ? T / nFrames : T / 30;
  for (let st = 1; st <= steps; st++) {
    const time = st * dt; let sup = 0, con = 0, sum = 0;
    for (let t = 0; t < nt; t++) {
      const i = T32[t], ci = Cc[i], q = 4 * t;
      const a = nb[q], b = nb[q + 1], c = nb[q + 2], d = nb[q + 3];
      const ca = Cc[a], cb = Cc[b], cc = Cc[c], cd = Cc[d];
      if (fixed[a]) sup += ca - ci; if (fixed[b]) sup += cb - ci; if (fixed[c]) sup += cc - ci; if (fixed[d]) sup += cd - ci;
      const v = ci + r * (ca + cb + cc + cd - 4 * ci) - kd * ci;
      Cn[i] = v; con += ci; sum += v;
      if (arrival[t] < 0 && v >= Ct) { arrival[t] = time; above++; }
    }
    supply += r * sup; consumed += kd * con;
    const tmp = Cc; Cc = Cn; Cn = tmp;
    if (tCrit === null && nt && above >= crit * nt) tCrit = time;
    if (time >= nextFrame - 1e-9 || st === steps) { saveFrame(time, sum); nextFrame += frameStep; }
  }
  // 최종 지표
  let sum = 0, sum2 = 0, tSum = 0, tMax = 0, reached = 0, chk = 0;
  for (let t = 0; t < nt; t++) {
    const v = Cc[T32[t]]; sum += v; sum2 += v * v; chk += v * ((t % 97) + 1);
    if (arrival[t] >= 0) { reached++; tSum += arrival[t]; if (arrival[t] > tMax) tMax = arrival[t]; }
  }
  const mean = nt ? sum / nt : 0, std = nt ? Math.sqrt(Math.max(0, sum2 / nt - mean * mean)) : 0;
  const M1 = sum, massErr = Math.abs((M1 - M0) - (supply - consumed)) / Math.max(Math.abs(supply), 1e-12);
  const arrMap = new Float32Array(NN).fill(NaN);
  for (let t = 0; t < nt; t++) arrMap[T32[t]] = arrival[t];
  const areaMM2 = above * dx * dx / 1e6, lenMM = geom.len / 1000;
  return {
    n, dx, dt, steps, dtPure, dtStab, r, kd, chCells, chReach, nt, frames, series, arrMap, fixed,
    path: { mean: chReach ? pathSum / chReach : 0, max: pathMax, supplyMean: chReach ? supSum / chReach : 0 },
    final: { cAbove: nt ? above / nt * 100 : 0, cMean: mean, cStd: std, cv: mean > 1e-9 ? std / mean : null,
             tMean: reached ? tSum / reached : null, tMax: reached ? tMax : null, tCrit, unreached: nt ? (1 - reached / nt) * 100 : 0,
             perLen: lenMM > 0 ? areaMM2 / lenMM : 0 },
    mass: { M0, M1, supply, consumed, err: massErr }, checksum: chk
  };
}

// ---------------- metrics & verdicts ----------------
// better: low = 작을수록 좋음, high = 클수록 좋음. abs = 0에 가까운 값을 위한 절대 기준(교육용 설정값)
const METRICS = [
  { key: "mean", name: "평균 거리", unit: "μm", better: "low", abs: 5, group: "거리", d: 0 },
  { key: "max", name: "최대 거리", unit: "μm", better: "low", abs: 5, group: "거리", d: 0 },
  { key: "cover", name: "거리 기준 이내 비율", unit: "%", better: "high", abs: 1, group: "거리", d: 1 },
  { key: "cAbove", name: "목표 농도 이상 영역", unit: "%", better: "high", abs: 1, group: "농도", d: 1 },
  { key: "tCrit", name: "판정 기준 도달 시간", unit: "s", better: "low", abs: 1, group: "농도", d: 1 },
  { key: "cv", name: "농도 변동계수(균일성)", unit: "", better: "low", abs: 0.02, group: "농도", d: 3 },
  { key: "cMean", name: "평균 농도", unit: "C₀", better: "high", abs: 0.01, group: "농도", d: 3 },
  { key: "perLen", name: "통로 1 mm당 목표 이상 면적", unit: "mm²/mm", better: "high", abs: 0.005, group: "농도", d: 3 },
];
function metricsOf(dres, sim) {
  return { mean: dres.mean, max: dres.max, cover: dres.cover * 100, ...sim.final };
}
// 결과: "B"=잎맥형 우세, "A"=직선형 우세, "="=비슷함
function judge(a, b, m, relPct) {
  if (m.key === "tCrit") {                           // 미도달(null) 처리
    if (a === null && b === null) return "=";
    if (a === null) return "B"; if (b === null) return "A";
  }
  if (a === null || b === null) return "=";
  const lim = Math.max(relPct / 100 * Math.max(Math.abs(a), Math.abs(b)), m.abs);
  if (Math.abs(b - a) <= lim) return "=";
  const bBetter = m.better === "low" ? b < a : b > a;
  return bBetter ? "B" : "A";
}
function compareGeoms(P, opt = {}) {
  const gA = straightGeom(P), gB = leafGeom(P);
  const lenDiff = Math.abs(gA.len - gB.len) / Math.max(gA.len, 1) * 100;
  const dA = evaluate(gA.segs, P.thr, P.chw), dB = evaluate(gB.segs, P.thr, P.chw);
  const sA = simulate(gA, P, opt), sB = simulate(gB, P, opt);
  return { gA, gB, lenDiff, dA, dB, sA, sB, mA: metricsOf(dA, sA), mB: metricsOf(dB, sB),
           connA: connectedRatio(gA.segs, gA.inlets, P.chw), connB: connectedRatio(gB.segs, gB.inlets, P.chw) };
}

// ---------------- verification helpers ----------------
function verifyDistance() {   // 단순 통로 1개: 가운데 수평 통로(굵기 20 μm)
  const r = evaluate([[0, 1000, 2000, 1000]], 100, 20);
  // 손계산: 칸 중심 y=5,15,…,1995. 거리 = |y−1000|−10. 통로 칸 2줄, 조직 198줄.
  // 한쪽 거리 = 985, 975, …, 5 → 평균 (985+5)/2 = 495, 최대 985, 100 μm 이내 = 한쪽 10줄 → 20/198 = 10.10%
  return [
    { name: "평균 거리 (μm)", hand: 495, calc: r.mean },
    { name: "최대 거리 (μm)", hand: 985, calc: r.max },
    { name: "100 μm 이내 비율 (%)", hand: 20 / 198 * 100, calc: r.cover * 100 },
  ];
}
function verifyAnalytic(P) {  // 정상 상태 1차원 해석해와 비교
  const Q = { ...P, model: "A", T: Math.max(P.T, 12 / P.kc), Cinit: 0, dx: 20, chw: 20 };
  const geom = { segs: [[0, 1000, 2000, 1000]], inlets: [[0, 1000]], len: 2000 };
  const sim = simulate(geom, Q, { frames: 1 });
  const n = sim.n, dx = sim.dx, last = sim.frames[sim.frames.length - 1];
  // 통로 칸 행 찾기
  let chRow = -1; const col = n >> 1;
  for (let rr = 0; rr < n; rr++) if (sim.fixed[rr * n + col]) { chRow = rr; break; }
  const yCh = (chRow + 0.5) * dx, lam = Math.sqrt(Q.D / Q.kc), Lw = yCh;   // 위쪽 벽(y=0, 무플럭스)까지
  const rows = [];
  for (const dist of [100, 200, 400, 800]) {
    const rr = chRow - Math.round(dist / dx); if (rr < 0) continue;
    const y = (rr + 0.5) * dx, num = last[rr * n + col], ana = Math.cosh(y / lam) / Math.cosh(Lw / lam);
    rows.push({ dist: yCh - y, num, ana, err: Math.abs(num - ana) / Math.max(ana, 1e-12) * 100 });
  }
  return { rows, lam, T: Q.T };
}

// ---------------- worker task runner ----------------
const SWEEP_VARS = {
  angle: { label: "분기 각도", values: [30, 40, 50, 60, 70, 80, 90], fmt: v => v + "°" },
  pairs: { label: "측맥 쌍 수", values: ["auto", 1, 2, 3, 4, 5, 6], fmt: v => v === "auto" ? "자동" : v + "쌍" },
  tert: { label: "세맥 분기점 수", values: [0, 1, 2, 3], fmt: v => v + "개" },
  chw: { label: "통로 굵기", values: [10, 20, 30, 40], fmt: v => v + " μm" },
  L: { label: "총 통로 길이", values: [4, 6, 8, 10, 12, 16, 20], fmt: v => v + " mm" },
  inlet: { label: "입구 조건", values: ["one", "each"], fmt: v => v === "one" ? "입구 1개(매니폴드)" : "직선형 개별 입구" },
  model: { label: "통로 내부 농도 모델", values: ["A", "B"], fmt: v => v === "A" ? "A 이상적 공급" : "B 제한적 공급" },
  D: { label: "확산계수", values: [1000, 2000, 3000], fmt: v => v + " μm²/s" },
  kc: { label: "소모율", values: [0.02, 0.05, 0.089, 0.2], fmt: v => v + " /s" },
};
function sweepRow(P, extra) {
  const c = compareGeoms(P);
  return { ...extra, P, mA: c.mA, mB: c.mB, lenDiff: c.lenDiff, warn: c.gA.warn || c.gB.warn,
           info: { m: c.gA.info.m, man: c.gA.info.man, line: c.gA.info.line, k: c.gB.info.k, chA: c.sA.chReach, chB: c.sB.chReach,
                   pathA: c.sA.path, pathB: c.sB.path } };
}
function runTask(msg, post) {
  const { type, id } = msg;
  if (type === "sim") {
    const P = msg.P, c = compareGeoms(P, { frames: 30 });
    post({ type, id, P, lenDiff: c.lenDiff, connA: c.connA, connB: c.connB, mA: c.mA, mB: c.mB,
           sA: c.sA, sB: c.sB, warnA: c.gA.warn, warnB: c.gB.warn });
  } else if (type === "sweep") {
    const base = { ...msg.base, dx: msg.dx }, rows = [];
    let conds = [];
    if (msg.mode === "oat") {
      for (const key of Object.keys(SWEEP_VARS)) for (const v of SWEEP_VARS[key].values)
        conds.push({ P: { ...base, [key]: v, ...(key === "L" ? { m: "auto" } : {}) }, extra: { key, val: v, isBase: String(msg.base[key]) === String(v) } });
    } else {
      const [kx, ky] = msg.vars;
      for (const vy of SWEEP_VARS[ky].values) for (const vx of SWEEP_VARS[kx].values)
        conds.push({ P: { ...base, [kx]: vx, [ky]: vy, ...(kx === "L" || ky === "L" ? { m: "auto" } : {}) }, extra: { kx, ky, vx, vy } });
    }
    conds.forEach((cd, i) => { rows.push(sweepRow(cd.P, cd.extra)); post({ type: "progress", id, done: i + 1, total: conds.length }); });
    post({ type, id, mode: msg.mode, vars: msg.vars, rows, rel: msg.rel, dx: msg.dx, base: msg.base });
  } else if (type === "conv") {
    const out = [];
    for (const dx of [40, 20, 10]) {
      const P = { ...msg.P, dx }, gA = straightGeom(P), gB = leafGeom(P);
      const sA = simulate(gA, P), sB = simulate(gB, P);
      out.push({ dx, A: sA.final, B: sB.final, steps: sA.steps, dt: sA.dt });
      post({ type: "progress", id, done: out.length, total: 3 });
    }
    post({ type, id, out });
  } else if (type === "verify") {
    const ana = verifyAnalytic(msg.P);
    const P = msg.P, g = straightGeom(P);
    const s1 = simulate(g, P), s2 = simulate(g, P);
    post({ type, id, ana, repro: { c1: s1.checksum, c2: s2.checksum, same: s1.checksum === s2.checksum } });
  }
}
