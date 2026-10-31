// ======================================================================
// 11. 잎 모양 물 확산 모델 (팀이 만든 '잎맥 물 확산 시뮬레이터'를 옮김)
// 원래 계산식(build, field)은 그대로 두고, 아래만 추가했습니다.
//  - 조직 확산 시간 식 선택(원래: 거리에 비례 / 비교용: 거리²에 비례)
//  - 맥 총길이·맥 부피 지표 표시, 같은 조건 여부 안내
//  - 화면 밖에 있을 때 애니메이션 멈춤
// ======================================================================
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  if (!$("lw-c0")) return;
  const cs = n => getComputedStyle($("leafwater")).getPropertyValue(n).trim();
  // ---- 원래 모델 (변경 없음) ----
  const H = x => (x <= 0 || x >= 1) ? 0 : 0.4 * Math.pow(Math.sin(Math.PI * Math.pow(x, 0.8)), 0.9);   // 잎 윤곽(반폭)
  const NP = 7, MP = 3, KV = 0.3;   // 곁맥 7쌍, 곁맥당 세부맥 3개, 맥 속 이동 속도 계수
  function build(deg, C) {
    const a0 = deg * Math.PI / 180, segs = [];
    const add = (a, b, r, ta) => { const tb = ta + Math.hypot(b[0] - a[0], b[1] - a[1]) / (KV * r); segs.push({ a, b, r, ta, tb }); return tb; };
    let t = 0; for (let i = 0; i < 25; i++) t = add([i / 25, 0], [(i + 1) / 25, 0], C * (0.25 + 0.75 * (1 - (i + .5) / 25)), t);
    const Tm = x => { const i = Math.min(24, Math.floor(x * 25)), s = segs[i]; return s.ta + (x * 25 - i) * (s.tb - s.ta); };
    const rs = C / Math.cbrt(2 * NP), rt = rs / Math.cbrt(MP + 1);    // Murray 법칙(r³ 합 보존)으로 굵기 결정
    for (let i = 0; i < NP; i++) {
      const xi = 0.07 + 0.7 * i / (NP - 1);
      for (const s of [1, -1]) {
        const p = [[xi, 0]], an = []; let x = xi, y = 0;
        for (let k = 0; k < 80; k++) { const a = a0 * (1 - 0.45 * Math.min(1, k / 50)); x += Math.cos(a) * 0.02; y += s * Math.sin(a) * 0.02; if (x >= 0.985 || Math.abs(y) >= 0.93 * H(x)) break; p.push([x, y]); an.push(a); }
        const n = p.length - 1; if (n < 2) continue;
        const pt = [Tm(xi)]; for (let k = 0; k < n; k++) pt.push(add(p[k], p[k + 1], rs * (1 - 0.55 * k / n), pt[k]));
        for (let j = 1; j <= MP; j++) {
          const idx = Math.max(1, Math.min(n - 1, Math.round(n * j / (MP + 1))));
          let ta = an[idx - 1] + (j % 2 ? 1 : -1) * a0; ta = Math.max(0.15, Math.min(Math.PI - 0.15, ta));
          const q = p[idx], tp = [q]; let tx = q[0], ty = q[1];
          for (let k = 0; k < 8; k++) { tx += Math.cos(ta) * 0.02; ty += s * Math.sin(ta) * 0.02; if (tx >= 0.985 || tx <= 0.01 || Math.abs(ty) >= 0.93 * H(tx)) break; tp.push([tx, ty]); }
          const tn = tp.length - 1; let tt = pt[idx]; for (let k = 0; k < tn; k++) tt = add(tp[k], tp[k + 1], rt * (1 - 0.5 * k / tn), tt);
        }
      }
    }
    return segs;
  }
  // 조직 칸이 물에 닿는 시간 = (맥을 따라 도착한 시간) + (맥에서 조직까지 퍼지는 시간)
  const D0 = 0.05;   // '거리²' 식을 원래 식과 거리 0.05(잎 길이의 5%)에서 같게 맞춘 교육용 설정값
  function field(segs, mode) {
    const cells = [];
    for (let x = 0.02; x < 1; x += 0.02) for (let y = -0.45; y <= 0.451; y += 0.02) {
      if (Math.abs(y) >= H(x) * 0.97) continue; let best = 1e9;
      for (const s of segs) {
        const ax = s.a[0], ay = s.a[1], dx = s.b[0] - ax, dy = s.b[1] - ay; let u = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1); u = u < 0 ? 0 : u > 1 ? 1 : u;
        const d = Math.hypot(ax + u * dx - x, ay + u * dy - y);
        const lat = mode === "sq" ? (d * d / D0) / (0.03 + 0.02 * s.r) : d / (0.03 + 0.02 * s.r);
        const tt = s.ta + u * (s.tb - s.ta) + lat; if (tt < best) best = tt;
      }
      cells.push([x, y, best]);
    }
    const ts = cells.map(c => c[2]).sort((p, q) => p - q);
    return { cells, t90: ts[Math.floor(ts.length * 0.9)], t50: ts[Math.floor(ts.length * 0.5)] };
  }
  const stats = segs => segs.reduce((o, s) => { const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]); o.len += L; o.vol += L * s.r * s.r; return o; }, { len: 0, vol: 0 });

  // ---- 화면 ----
  const mk = id => ({ cv: $(id), bg: document.createElement("canvas"), dv: document.createElement("canvas"), wv: document.createElement("canvas") });
  const O = [mk("lw-c0"), mk("lw-c1")]; let col = "#1976d2", tcur = 0, tmax = 10, paused = false, last = 0, visible = true;
  function setup(o, a, C, mode) {
    const w = o.cv.clientWidth || 300, h = Math.round(w * 1.3), dpr = devicePixelRatio || 1;
    for (const c of [o.cv, o.bg, o.dv, o.wv]) { c.width = w * dpr; c.height = h * dpr; } o.cv.style.height = h + "px";
    o.S = h * 0.9; o.ox = w / 2; o.oy = h * 0.95; o.dpr = dpr;
    o.segs = build(a, C); const f = field(o.segs, mode); o.cells = f.cells; o.t90 = f.t90; o.t50 = f.t50; o.st = stats(o.segs); o.done = new Uint8Array(o.segs.length);
    const X = y => o.ox + y * o.S, Y = x => o.oy - x * o.S;
    let g = o.bg.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.beginPath(); for (let i = 0; i <= 40; i++) g.lineTo(X(H(i / 40)), Y(i / 40)); for (let i = 40; i >= 0; i--) g.lineTo(X(-H(i / 40)), Y(i / 40)); g.closePath();
    g.fillStyle = cs("--lw-leaf"); g.fill(); g.strokeStyle = cs("--lw-vein"); g.globalAlpha = .4; g.lineWidth = 1; g.stroke();
    g = o.dv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.strokeStyle = cs("--lw-vein"); g.lineCap = "round";
    for (const s of o.segs) { g.lineWidth = Math.max(.6, 2 * s.r * o.S / 270); g.beginPath(); g.moveTo(X(s.a[1]), Y(s.a[0])); g.lineTo(X(s.b[1]), Y(s.b[0])); g.stroke(); }
  }
  function frame(o, t) {
    const g = o.cv.getContext("2d"), X = y => o.ox + y * o.S, Y = x => o.oy - x * o.S;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, o.cv.width, o.cv.height); g.drawImage(o.bg, 0, 0);
    g.setTransform(o.dpr, 0, 0, o.dpr, 0, 0); g.fillStyle = col; const z = 0.024 * o.S; let wet = 0;
    for (const c of o.cells) { const q = t - c[2]; if (q <= 0) continue; wet++; g.globalAlpha = 0.5 * Math.min(1, q); g.fillRect(X(c[1]) - z / 2, Y(c[0]) - z / 2, z, z); }
    g.globalAlpha = 1;
    const w = o.wv.getContext("2d"); w.setTransform(o.dpr, 0, 0, o.dpr, 0, 0); w.strokeStyle = col; w.lineCap = "round";
    o.segs.forEach((s, i) => {
      if (o.done[i] || t <= s.ta) return; const f = Math.min(1, (t - s.ta) / (s.tb - s.ta));
      w.lineWidth = Math.max(.6, 2 * s.r * o.S / 270); w.beginPath(); w.moveTo(X(s.a[1]), Y(s.a[0])); w.lineTo(X(s.a[1] + f * (s.b[1] - s.a[1])), Y(s.a[0] + f * (s.b[0] - s.a[0]))); w.stroke(); if (f >= 1) o.done[i] = 1;
    });
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(o.dv, 0, 0); g.drawImage(o.wv, 0, 0);
    return wet / o.cells.length * 100;
  }
  function restart() { col = cs("--lw-flow"); tcur = 0; for (const o of O) { o.wv.getContext("2d").clearRect(0, 0, o.wv.width, o.wv.height); o.done.fill(0); } }
  function rebuild() {
    const a = +$("lw-a").value, C = +$("lw-c").value, mode = $("lw-mode").value;
    $("lw-av").textContent = a + "°"; $("lw-cv").textContent = C.toFixed(1); $("lw-h1").textContent = `내 설정 (${a}° · ${C.toFixed(1)})`;
    setup(O[0], 45, 3, mode); setup(O[1], a, C, mode);
    O.forEach((o, i) => {
      $("lw-t" + i).textContent = o.t90.toFixed(1);
      $("lw-s" + i).textContent = `맥 총길이 ${o.st.len.toFixed(2)} · 맥 부피 지표 ${o.st.vol.toFixed(2)} · 50% 젖는 시간 ${o.t50.toFixed(1)}`;
    });
    tmax = Math.max(O[0].t90, O[1].t90) * 1.25 + 1.5;
    const d = O[1].t90 - O[0].t90, vr = O[1].st.vol / O[0].st.vol, lr = O[1].st.len / O[0].st.len;
    let txt = Math.abs(d) < 0.05 ? "기준과 거의 같은 속도로 잎의 90%가 젖습니다." :
      `내 설정은 기준보다 잎의 90%를 적시는 데 <b>${Math.abs(d).toFixed(1)} ${d < 0 ? "빠릅니다" : "느립니다"}</b> (${O[1].t90.toFixed(1)} 대 ${O[0].t90.toFixed(1)}, 모델 상대 시간).`;
    if (Math.abs(vr - 1) > 0.01 || Math.abs(lr - 1) > 0.01)
      txt += `<br><span class="warn">같은 조건 비교가 아닙니다.</span> 내 설정의 맥 부피 지표는 기준의 ${vr.toFixed(2)}배, 맥 총길이는 ${lr.toFixed(2)}배입니다. 시간 차이에는 분기 각도뿐 아니라 통로 양의 차이도 섞여 있습니다.`;
    else txt += "<br>맥 총길이와 맥 부피 지표가 기준과 같습니다(차이 1% 이내).";
    $("lw-sum").innerHTML = txt;
    restart();
  }
  function loop(ts) {
    const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
    if (visible) {
      if (!paused) tcur = Math.min(tmax, tcur + dt * (+$("lw-sp").value));
      O.forEach((o, i) => { const p = frame(o, tcur); $("lw-w" + i).textContent = p.toFixed(0) + "%"; $("lw-b" + i).style.width = p + "%"; });
      $("lw-tm").textContent = tcur.toFixed(1);
    }
    requestAnimationFrame(loop);
  }
  $("lw-a").oninput = rebuild; $("lw-c").oninput = rebuild; $("lw-mode").onchange = rebuild;
  $("lw-re").onclick = () => { paused = false; $("lw-pa").textContent = "⏸ 멈춤"; restart(); };
  $("lw-pa").onclick = () => { paused = !paused; $("lw-pa").textContent = paused ? "▶ 재생" : "⏸ 멈춤"; };
  let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(rebuild, 150); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rebuild);
  if ("IntersectionObserver" in window) new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe($("leafwater"));
  window.__leafwater = { build, field, stats, H };   // 검증·시험용
  rebuild(); requestAnimationFrame(t => { last = t; loop(t); });
})();
