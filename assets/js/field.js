/* Поле точек «Рычага».
   Тысячи точек-«данных» (отзывы, конкуренты, компании мира) собираются в фигуры глав:
   рычаг → семь специалистов → один → глобус → кривая из 13 рычагов роста → потоки → рычаг с поднятым шаром.
   У каждой точки своя цель; к цели её тянет пружина с затуханием, поэтому переходы — физика, а не слайды.
   Рисует WebGL без библиотек; если WebGL нет, тот же расчёт рисует Canvas 2D (меньше точек).
   Снаружи: RychagField.start(canvas, { count, layout, still, bg }) → пульт управления или null. */
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  /* знак «Рычага» в координатах его viewBox: x 4…96, y 20…82 */
  var AX = 10, AY = 71, BX = 90, BY = 40.5;
  var LEN = Math.sqrt((BX - AX) * (BX - AX) + (BY - AY) * (BY - AY));
  var DX = (BX - AX) / LEN, DY = (BY - AY) / LEN;  // вдоль плеча
  var NX = DY, NY = -DX;                            // перпендикуляр вверх
  var PVX = 62, PVY = 51.2;                         // точка опоры: вершина треугольника под плечом
  var ARM_W = 6.5;
  var BALLX = 77.3, BALLY = 31.2, BALL_R = 9;
  var F0X = 62, F0Y = 55, F1X = 49.5, F1Y = 79, F2X = 74.5, F2Y = 79;
  var TH0 = 0.42;       // наклон до «обвала»: длинное плечо вверху, шар внизу
  var TH_LIFT = -0.15;  // финал: шар выше, чем на знаке

  var S = { lever: 0, team: 1, one: 2, globe: 3, nodes: 4, flow: 5, lift: 6 };
  var NAMES = ['lever', 'team', 'one', 'globe', 'nodes', 'flow', 'lift'];

  var PAPER = [0.965, 0.957, 0.937], ORANGE = [0.918, 0.353, 0.165], DIM = [0.56, 0.58, 0.63];

  var K = 46, C = 10.5;  // пружина и затухание: чуть меньше критического — лёгкий перелёт, как у живого
  var G = 2400;          // «тяжесть» данных при обвале, px/с²

  function rng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex).trim());
    return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0.08, 0.09, 0.105];
  }

  /* ---------------- отрисовка: WebGL ---------------- */
  var VS = 'attribute vec2 aPos;attribute float aSize;attribute vec4 aCol;uniform vec2 uRes;uniform float uDpr;uniform float uScale;varying vec4 vCol;' +
    'void main(){vec2 p=aPos/uRes*2.0-1.0;gl_Position=vec4(p.x,-p.y,0.0,1.0);gl_PointSize=aSize*uDpr*uScale;vCol=aCol;}';
  var FS = 'precision mediump float;varying vec4 vCol;' +
    'void main(){vec2 c=gl_PointCoord-0.5;float d=dot(c,c)*4.0;if(d>1.0)discard;float a=exp(-d*4.5);gl_FragColor=vec4(vCol.rgb*vCol.a*a,1.0);}';

  function makeGL(canvas) {
    var gl;
    try {
      gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    } catch (e) { gl = null; }
    if (!gl) return null;
    function sh(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    }
    var vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return null;
    var pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
    gl.useProgram(pr);
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    var stride = 7 * 4;
    var aPos = gl.getAttribLocation(pr, 'aPos'), aSize = gl.getAttribLocation(pr, 'aSize'), aCol = gl.getAttribLocation(pr, 'aCol');
    gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(aSize); gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(aCol); gl.vertexAttribPointer(aCol, 4, gl.FLOAT, false, stride, 12);
    var uRes = gl.getUniformLocation(pr, 'uRes'), uDpr = gl.getUniformLocation(pr, 'uDpr'), uScale = gl.getUniformLocation(pr, 'uScale');
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); // свет складывается: густые места светятся ярче
    var cap = 0;
    return {
      kind: 'webgl',
      draw: function (data, n, w, h, dpr, bg, scale) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(uRes, w, h); gl.uniform1f(uDpr, dpr); gl.uniform1f(uScale, scale);
        if (data.length > cap) { cap = data.length; gl.bufferData(gl.ARRAY_BUFFER, cap * 4, gl.DYNAMIC_DRAW); }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, n * 7));
        gl.drawArrays(gl.POINTS, 0, n);
      },
      lost: function () { return gl.isContextLost(); }
    };
  }

  /* ---------------- отрисовка: Canvas 2D (запасная) ---------------- */
  function make2D(canvas) {
    var ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;
    function sprite(c) {
      var s = document.createElement('canvas'); s.width = s.height = 32;
      var x = s.getContext('2d'), g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
      var rgb = Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255);
      g.addColorStop(0, 'rgba(' + rgb + ',1)'); g.addColorStop(0.35, 'rgba(' + rgb + ',.55)'); g.addColorStop(1, 'rgba(' + rgb + ',0)');
      x.fillStyle = g; x.fillRect(0, 0, 32, 32);
      return s;
    }
    var spP = sprite(PAPER), spO = sprite(ORANGE);
    return {
      kind: '2d',
      draw: function (data, n, w, h, dpr, bg, scale) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgb(' + Math.round(bg[0] * 255) + ',' + Math.round(bg[1] * 255) + ',' + Math.round(bg[2] * 255) + ')';
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'lighter';
        for (var i = 0, o = 0; i < n; i++, o += 7) {
          var a = data[o + 6]; if (a < 0.01) continue;
          var s = data[o + 2] * 1.1 * scale;
          ctx.globalAlpha = a > 1 ? 1 : a;
          ctx.drawImage(data[o + 3] > data[o + 4] * 1.6 ? spO : spP, data[o] - s, data[o + 1] - s, s * 2, s * 2);
        }
      },
      lost: function () { return false; }
    };
  }

  /* ---------------- поле ---------------- */
  function start(canvas, opt) {
    opt = opt || {};
    var r = makeGL(canvas), max = opt.count || 6000;
    if (!r) { r = make2D(canvas); max = Math.min(max, 1800); }
    if (!r) return null;

    var N = max, n = max;
    var rnd = rng(20261017);
    var R1 = new Float32Array(N), R2 = new Float32Array(N), R3 = new Float32Array(N), R4 = new Float32Array(N),
      R5 = new Float32Array(N), R6 = new Float32Array(N), G1 = new Float32Array(N), G2 = new Float32Array(N),
      KV = new Float32Array(N), SW = new Float32Array(N), DL = new Float32Array(N);
    var X = new Float32Array(N), Y = new Float32Array(N), VX = new Float32Array(N), VY = new Float32Array(N),
      CR = new Float32Array(N), CG = new Float32Array(N), CB = new Float32Array(N), CA = new Float32Array(N), CS = new Float32Array(N),
      BORN = new Float32Array(N), REL = new Float32Array(N);
    var FALL = new Uint8Array(N);
    var out = new Float32Array(N * 7);
    for (var i = 0; i < N; i++) {
      R1[i] = rnd(); R2[i] = rnd(); R3[i] = rnd(); R4[i] = rnd(); R5[i] = rnd(); R6[i] = rnd();
      var u1 = Math.max(1e-6, rnd()), u2 = rnd(), m = Math.sqrt(-2 * Math.log(u1));
      G1[i] = Math.max(-2.6, Math.min(2.6, m * Math.cos(TAU * u2)));
      G2[i] = Math.max(-2.6, Math.min(2.6, m * Math.sin(TAU * u2)));
      KV[i] = 0.6 + rnd() * 0.8;
      SW[i] = rnd() < 0.5 ? -1 : 1;
      DL[i] = rnd() * 0.45;
    }

    var still = !!opt.still, bg = hexToRgb(opt.bg || '#15171B');
    var vw = 1, vh = 1, dpr = 1, rects = [];
    var time = 0, last = 0, raf = 0, on = false, dirty = true;
    var sceneFrom = S.lever, sceneTo = S.lever, switchT = -10, active = 0;
    var theta = TH0, thetaV = 0, introOn = false, introT = 0, heapN = 1, landed = 0;
    var ptOn = false, ptx = 0, pty = 0, PR = 120, pscale = opt.scale || 1.8;
    var fpsAcc = 0, fpsN = 0, tuned = 0;

    function relayout() {
      dpr = Math.min(window.devicePixelRatio || 1, opt.maxDpr || 2);
      vw = canvas.clientWidth || window.innerWidth; vh = canvas.clientHeight || window.innerHeight;
      canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
      PR = Math.max(80, Math.min(150, vw * 0.09));
      restage();
    }

    /* где стоят фигуры; страница вызывает это и при прокрутке — фигура едет вместе со своей главой,
       а пружины дают точкам лёгкое отставание */
    function restage() {
      for (var s = 0; s < NAMES.length; s++) {
        var q = (opt.layout && opt.layout(NAMES[s], vw, vh)) || { x: 0, y: 0, w: vw, h: vh };
        var sq = Math.min(q.w, q.h), lv = Math.min(q.w / 92, q.h / 62);
        rects[s] = {
          x: q.x, y: q.y, w: q.w, h: q.h,
          sx: q.x + (q.w - sq) / 2, sy: q.y + (q.h - sq) / 2, s: sq,                      // квадрат по центру
          lx: q.align === 'right' ? q.x + q.w - 92 * lv : q.align === 'left' ? q.x : q.x + (q.w - 92 * lv) / 2,  // знак по своей пропорции
          ly: q.y + (q.h - 62 * lv) / 2, lk: lv
        };
      }
      dirty = true;
    }

    /* цель точки i в сцене sc → tx, ty, цвет, прозрачность, размер */
    var tx, ty, tr, tg, tb, ta, ts, tp;
    function col(c) { tr = c[0]; tg = c[1]; tb = c[2]; }

    function ambient(i) {
      tx = R2[i] * vw + Math.sin(time * 0.11 + R4[i] * TAU) * 26;
      ty = R3[i] * vh + Math.cos(time * 0.09 + R5[i] * TAU) * 20;
      col(PAPER); ta = 0.16; ts = 1.2 + R5[i] * 0.7;
    }

    function lever(i, sc) {
      var q = R1[i], lift = sc === S.lift, rc = rects[sc], lx, ly, rot = true;
      ts = 2 + R4[i] * 1.4; ta = 0.82; col(PAPER);
      if (q < 0.3) {                                  // плечо
        var t = R2[i], w = (R3[i] - 0.5) * ARM_W;
        lx = AX + DX * LEN * t + NX * w; ly = AY + DY * LEN * t + NY * w;
      } else if (q < 0.42) {                          // опора
        var a = R2[i], b = R3[i]; if (a + b > 1) { a = 1 - a; b = 1 - b; }
        lx = F0X + (F1X - F0X) * a + (F2X - F0X) * b; ly = F0Y + (F1Y - F0Y) * a + (F2Y - F0Y) * b; rot = false;
      } else if (q < 0.5) {                           // шар — бизнес клиента
        var rr = BALL_R * (lift ? 1.25 : 1) * Math.pow(R2[i], 0.6), an = R3[i] * TAU;
        lx = BALLX + Math.cos(an) * rr; ly = BALLY + Math.sin(an) * rr;
        col(ORANGE); ts = 2.4 + R4[i] * 2; ta = 0.95;
      } else if (q < (lift ? 0.82 : 0.76)) {          // груда данных на длинном плече
        var sx = R2[i], hm = lift ? 17 : 12;
        var along = 0.02 + sx * 0.3, h = hm * Math.sqrt(R3[i]) * (1 - (2 * sx - 1) * (2 * sx - 1));
        lx = AX + DX * LEN * along + NX * (ARM_W / 2 + 0.8 + h); ly = AY + DY * LEN * along + NY * (ARM_W / 2 + 0.8 + h);
        ta = 0.7; if (R5[i] < 0.1) col(ORANGE);
      } else if (q < 0.8 && !lift) {                  // земля
        lx = 4 + R2[i] * 92; ly = 80.5 + (R3[i] - 0.5) * 0.5; rot = false; ta = 0.22; ts = 1.3;
      } else {
        if (lift) {                                   // в финале воздух поднимается вверх
          tx = R2[i] * vw + Math.sin(time * 0.3 + R4[i] * TAU) * 14;
          ty = vh + 20 - ((R3[i] * (vh + 40) + time * (14 + R4[i] * 30)) % (vh + 40));
          if (ty > vh + 10 && Y[i] < vh * 0.5) tp = 1;
          col(R5[i] < 0.12 ? ORANGE : PAPER); ta = 0.2; ts = 1.2 + R5[i] * 0.8;
        } else ambient(i);
        return;
      }
      if (rot) {
        var c = Math.cos(theta), s = Math.sin(theta), dx = lx - PVX, dy = ly - PVY;
        lx = PVX + dx * c - dy * s; ly = PVY + dx * s + dy * c;
      }
      tx = rc.lx + (lx - 4) * rc.lk; ty = rc.ly + (ly - 20) * rc.lk;
    }

    function team(i) {
      var q = R1[i], rc = rects[S.team];
      if (q > 0.86) return ambient(i);
      var k = (R2[i] * 7) | 0, a = -Math.PI / 2 + k * TAU / 7;
      var u = 0.5 + Math.cos(a) * 0.34 + G1[i] * 0.042 + Math.sin(time * 0.7 + R5[i] * TAU) * 0.003;
      var v = 0.5 + Math.sin(a) * 0.34 + G2[i] * 0.042 + Math.cos(time * 0.6 + R4[i] * TAU) * 0.003;
      tx = rc.sx + u * rc.s; ty = rc.sy + v * rc.s;
      col(R3[i] < 0.1 ? ORANGE : PAPER); ta = 0.82; ts = 1.9 + R4[i] * 1.3;
    }

    var RING_R = [0.17, 0.26, 0.355], RING_SP = [0.32, -0.22, 0.15], RING_T = [-0.42, 0.28, 0.06];
    function one(i) {
      var q = R1[i], rc = rects[S.one], u, v;
      if (q > 0.86) return ambient(i);
      if (q < 0.26) {                                 // ядро: специалист + ИИ
        u = 0.5 + G1[i] * 0.034; v = 0.5 + G2[i] * 0.034;
        col(R3[i] < 0.55 ? ORANGE : PAPER); ta = 0.92; ts = 2.1 + R4[i] * 1.4;
      } else {                                        // орбиты: семь ролей теперь вращаются вокруг одного
        var k = (R2[i] * 3) | 0, an = R3[i] * TAU + RING_SP[k] * time;
        var ex = Math.cos(an) * RING_R[k], ey = Math.sin(an) * RING_R[k] * 0.36;
        var c = Math.cos(RING_T[k]), s = Math.sin(RING_T[k]);
        u = 0.5 + ex * c - ey * s + G1[i] * 0.004; v = 0.5 + ex * s + ey * c + G2[i] * 0.004;
        var front = Math.sin(an) > 0;
        col(R4[i] < 0.08 ? ORANGE : PAPER); ta = front ? 0.82 : 0.38; ts = (front ? 2 : 1.4) + R5[i] * 0.9;
      }
      tx = rc.sx + u * rc.s; ty = rc.sy + v * rc.s;
    }

    function globe(i) {
      var q = R1[i], rc = rects[S.globe];
      if (q > 0.88) return ambient(i);
      var kind = R5[i], lat, lon;
      if (kind < 0.3) { lat = (Math.round(R2[i] * 8) / 8 * 2 - 1) * 1.33; lon = R3[i] * TAU; }       // параллели
      else if (kind < 0.55) { lat = Math.asin(2 * R2[i] - 1); lon = Math.round(R3[i] * 12) / 12 * TAU; } // меридианы
      else { lat = Math.asin(2 * R2[i] - 1); lon = R3[i] * TAU; }
      var rot = still ? 0.6 : time * 0.16 + 0.6;
      var cl = Math.cos(lat), x3 = cl * Math.sin(lon + rot), y3 = Math.sin(lat), z3 = cl * Math.cos(lon + rot);
      var ct = Math.cos(0.38), st = Math.sin(0.38), y4 = y3 * ct - z3 * st, z4 = y3 * st + z3 * ct;
      var depth = (z4 + 1) / 2;
      tx = rc.sx + (0.5 + x3 * 0.41) * rc.s; ty = rc.sy + (0.5 + y4 * 0.41) * rc.s;
      var co = R4[i] < 0.07;                          // похожие компании по миру — оранжевые огни
      col(co ? ORANGE : PAPER);
      ta = (co ? 0.45 : 0.16) + 0.74 * depth; ts = (co ? 2.8 : 1.6) * (0.55 + 0.7 * depth) + R6[i] * 0.5;
    }

    function nodeU(k) { return 0.05 + 0.9 * k / 12; }
    function nodeV(k) { return 0.9 - 0.8 * Math.pow(k / 12, 1.6); }
    function nodes(i) {
      var q = R1[i], rc = rects[S.nodes];
      if (q > 0.88) return ambient(i);
      if (q < 0.46) {                                 // 13 узлов: пройденные светлые, текущий оранжевый
        var k = (R2[i] * 13) | 0, act = k === active, sig = act ? 14 : 5;
        tx = rc.x + nodeU(k) * rc.w + G1[i] * sig; ty = rc.y + nodeV(k) * rc.h + G2[i] * sig;
        if (act) { col(ORANGE); ta = 0.85; ts = 2 + R4[i] * 1.4; }
        else if (k < active) { col(PAPER); ta = 0.7; ts = 1.6 + R4[i]; }
        else { col(DIM); ta = 0.34; ts = 1.4 + R4[i] * 0.8; }
      } else {                                        // кривая роста между узлами
        var s = R2[i] * 12, kk = s | 0, f = s - kk;
        tx = rc.x + (nodeU(kk) + (nodeU(kk + 1) - nodeU(kk)) * f) * rc.w + G1[i] * 1.3;
        ty = rc.y + (nodeV(kk) + (nodeV(kk + 1) - nodeV(kk)) * f) * rc.h + G2[i] * 1.3;
        var done = s < active;
        col(done ? PAPER : DIM); ta = done ? 0.5 : 0.16; ts = 1.2 + R4[i] * 0.6;
      }
    }

    function flow(i) {
      var q = R1[i];
      if (q > 0.92) return ambient(i);
      var lane = (R2[i] * 11) | 0, span = vw + 80, speed = 26 + (lane % 4) * 34 + R4[i] * 40;
      var x = ((R3[i] * span + (still ? 0 : speed * time)) % span) - 40;
      tx = x; ty = vh * (0.14 + 0.72 * lane / 10) + Math.sin(x * 0.0045 + lane * 1.7 + time * 0.5) * 16 + G1[i] * 3;
      if (x < 20 && X[i] > vw * 0.5) tp = 1;          // ушла за правый край — появляется слева, без пролёта через экран
      col(R5[i] < 0.09 ? ORANGE : PAPER); ta = 0.42; ts = 1.4 + R4[i] * 1;
    }

    function target(i, sc) {
      tp = 0;
      switch (sc) {
        case S.team: team(i); break;
        case S.one: one(i); break;
        case S.globe: globe(i); break;
        case S.nodes: nodes(i); break;
        case S.flow: flow(i); break;
        default: lever(i, sc);
      }
      if (R6[i] < 0.04 && ta > 0.3) { ts *= 9; ta *= 0.075; } // редкие крупные точки — мягкое свечение вокруг фигур
    }

    function frame(now) {
      raf = 0;
      if (!on) return;
      var dt = last ? Math.min(0.033, (now - last) / 1000) : 0.016;
      last = now;
      if (!still) time += dt;
      step(dt);
      r.draw(out, n, vw, vh, dpr, bg, pscale);
      dirty = false;
      if (!still || dirty) raf = requestAnimationFrame(frame);
      // если устройство не тянет — меньше точек (один-два раза за всё время)
      if (!still && tuned < 2 && time > 1.2) {
        fpsAcc += dt; fpsN++;
        if (fpsN === 90) { if (fpsAcc / fpsN > 0.024) { n = Math.max(1200, (n * 0.6) | 0); tuned++; } else tuned = 2; fpsAcc = 0; fpsN = 0; }
      }
    }

    function step(dt) {
      var sw = sceneTo === S.lift ? TH_LIFT : 0, thT = sw;
      if (introOn) {
        introT += dt;
        thT = TH0 * (1 - easeOut(clamp01(landed / heapN)));
        if (introT > 4.5) introOn = false;
      }
      if (still) { theta = thT; thetaV = 0; }
      else { thetaV += ((thT - theta) * 36 - thetaV * 6.5) * dt; theta += thetaV * dt; }
      var kc = still ? 1 : 1 - Math.exp(-dt * 5);
      var pr2 = PR * PR;
      for (var i = 0, o = 0; i < n; i++, o += 7) {
        var sc = (time - switchT >= DL[i]) ? sceneTo : sceneFrom;
        target(i, sc);
        if (FALL[i]) {
          if (introT < REL[i]) { out[o + 6] = 0; X[i] = tx + (R5[i] - 0.5) * 140; continue; }
          VY[i] += G * dt; X[i] += (tx - X[i]) * Math.min(1, dt * 5); Y[i] += VY[i] * dt;
          if (Y[i] >= ty) { Y[i] = ty; VY[i] *= -0.16; VX[i] = 0; FALL[i] = 0; landed++; }
        } else if (tp || still) {
          X[i] = tx; Y[i] = ty; VX[i] = 0; VY[i] = 0;
        } else {
          var dx = tx - X[i], dy = ty - Y[i], k = K * KV[i], c = SW[i] * k * 0.28;
          var ax = dx * k - dy * c - VX[i] * C, ay = dy * k + dx * c - VY[i] * C;
          if (ptOn) {
            var ex = X[i] - ptx, ey = Y[i] - pty, d2 = ex * ex + ey * ey;
            if (d2 < pr2 && d2 > 1) { var d = Math.sqrt(d2), f = (1 - d / PR) * 5200 / d; ax += ex * f; ay += ey * f; }
          }
          VX[i] += ax * dt; VY[i] += ay * dt; X[i] += VX[i] * dt; Y[i] += VY[i] * dt;
        }
        CR[i] += (tr - CR[i]) * kc; CG[i] += (tg - CG[i]) * kc; CB[i] += (tb - CB[i]) * kc;
        CA[i] += (ta - CA[i]) * kc; CS[i] += (ts - CS[i]) * kc;
        var born = still ? 1 : clamp01((time - BORN[i]) / 0.45);
        out[o] = X[i]; out[o + 1] = Y[i]; out[o + 2] = CS[i];
        out[o + 3] = CR[i]; out[o + 4] = CG[i]; out[o + 5] = CB[i]; out[o + 6] = CA[i] * born;
      }
    }

    /* все точки сразу на своих местах сцены sc (первый кадр, «меньше движения») */
    function place(sc, fadeIn) {
      sceneFrom = sceneTo = sc; switchT = -10;
      theta = sc === S.lift ? TH_LIFT : 0; thetaV = 0;
      for (var i = 0; i < N; i++) {
        target(i, sc);
        X[i] = tx; Y[i] = ty; VX[i] = VY[i] = 0; FALL[i] = 0;
        CR[i] = tr; CG[i] = tg; CB[i] = tb; CA[i] = ta; CS[i] = ts;
        BORN[i] = fadeIn ? time + R4[i] * 0.6 : -10;
      }
      dirty = true; kick();
    }

    /* обвал: данные сыплются сверху на длинное плечо, рычаг поворачивается, шар-бизнес взлетает */
    function intro() {
      if (still) { place(S.lever, false); return; }
      sceneFrom = sceneTo = S.lever; switchT = -10;
      theta = TH0; thetaV = 0; introOn = true; introT = 0; landed = 0; heapN = 0;
      for (var i = 0; i < N; i++) {
        target(i, S.lever);
        var q = R1[i];
        CR[i] = tr; CG[i] = tg; CB[i] = tb; CA[i] = ta; CS[i] = ts;
        VX[i] = VY[i] = 0;
        if (q >= 0.5 && q < 0.76) {                     // груда — падает
          if (i < n) heapN++;
          FALL[i] = 1; REL[i] = 0.55 + R4[i] * 1.5;
          X[i] = tx + (R5[i] - 0.5) * 140; Y[i] = -30 - R5[i] * vh * 0.5; VY[i] = 200 + R2[i] * 300;
          BORN[i] = -10;
        } else {
          FALL[i] = 0; X[i] = tx; Y[i] = ty;
          // плечо прорисовывается слева направо, опора и шар — следом, воздух проявляется медленно
          BORN[i] = time + (q < 0.3 ? 0.05 + R2[i] * 0.55 : q < 0.42 ? 0.15 + R3[i] * 0.3 : q < 0.5 ? 0.45 + R3[i] * 0.2 : 0.2 + R4[i] * 1.4);
        }
      }
      heapN = Math.max(1, heapN);
      kick();
    }

    function scene(name) {
      var sc = S[name]; if (sc === undefined || sc === sceneTo) return;
      if (introOn && sc !== S.lever) { introOn = false; for (var i = 0; i < N; i++) if (FALL[i]) { FALL[i] = 0; BORN[i] = time; } }
      if (still) { place(sc, false); return; }
      sceneFrom = sceneTo; sceneTo = sc; switchT = time;
      kick();
    }

    function kick() { if (on && !raf) { last = 0; raf = requestAnimationFrame(frame); } }

    function anchors(name) {
      var res = [];
      if (name === 'team') {
        var rc = rects[S.team];
        for (var k = 0; k < 7; k++) {
          var a = -Math.PI / 2 + k * TAU / 7;
          res.push({ x: rc.sx + (0.5 + Math.cos(a) * 0.455) * rc.s, y: rc.sy + (0.5 + Math.sin(a) * 0.455) * rc.s, side: Math.cos(a) > 0.3 ? 1 : Math.cos(a) < -0.3 ? -1 : 0 }); // подпись снаружи кольца, по лучу от центра
        }
      } else if (name === 'one') {
        var ro = rects[S.one];
        res.push({ x: ro.sx + 0.5 * ro.s, y: ro.sy + 0.5 * ro.s + ro.s * 0.24 });
      }
      return res;
    }

    relayout();
    var api = {
      kind: r.kind,
      scene: scene,
      intro: intro,
      place: function (name) { place(S[name] || 0, true); },
      active: function (k) { if (k !== active) { active = k; dirty = true; kick(); } },
      run: function (v) { v = !!v; if (v === on) return; on = v; if (on) kick(); else if (raf) { cancelAnimationFrame(raf); raf = 0; } },
      relayout: function () { relayout(); kick(); },
      restage: function () { restage(); if (still) kick(); },
      anchors: anchors,
      pointer: function (x, y) { if (x == null) ptOn = false; else { ptOn = true; ptx = x; pty = y; } },
      burst: function (x, y) {
        if (still) return;
        for (var i = 0; i < n; i++) {
          var ex = X[i] - x, ey = Y[i] - y, d = Math.sqrt(ex * ex + ey * ey);
          if (d < 240 && d > 0.5) { var f = (1 - d / 240) * 900 / d; VX[i] += ex * f; VY[i] += ey * f; }
        }
      },
      setBg: function (hex) { bg = hexToRgb(hex); dirty = true; kick(); },
      setStill: function (v) { still = !!v; var sc = sceneTo; place(sc, false); },
      lost: function () { return r.lost(); }
    };
    return api;
  }

  window.RychagField = { start: start };
})();
