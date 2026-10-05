// In-page WebGL hook: counts and times the calls that block the main thread
// (shader link status reads, texture uploads, buffer uploads, mip generation).
export const GLHOOK = `(() => {
  const S = { calls: {}, events: [], programs: [] };
  for (const Ctx of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!Ctx) continue;
    const orig = Ctx.prototype.shaderSource;
    Ctx.prototype.shaderSource = function (shader, src) {
      if (src.includes('gl_Position') && S.programs.length < 2000) {
        const def = (k) => { const m = src.match(new RegExp('#define ' + k + ' ([^\\\\s]+)')); return m ? m[1] : ''; };
        S.programs.push([Math.round(performance.now()), def('SHADER_NAME'), 'D' + def('NUM_DIR_LIGHTS') + 'P' + def('NUM_POINT_LIGHTS') + 'S' + def('NUM_SPOT_LIGHTS') + 'H' + def('NUM_HEMI_LIGHTS'), /USE_FOG/.test(src) ? (/FOG_EXP2/.test(src) ? 'exp2' : 'lin') : 'nofog', /USE_SHADOWMAP/.test(src) ? 'shadow' : '']);
      }
      return orig.call(this, shader, src);
    };
  }
  const watch = ['compileShader','linkProgram','getProgramParameter','getShaderParameter','getProgramInfoLog','getShaderInfoLog','texImage2D','texSubImage2D','texImage3D','texStorage2D','compressedTexImage2D','compressedTexSubImage2D','generateMipmap','bufferData','bufferSubData','readPixels','useProgram','drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced'];
  const big = new Set(['linkProgram','getProgramParameter','getShaderParameter','getProgramInfoLog','texImage2D','texSubImage2D','texImage3D','texStorage2D','compressedTexImage2D','generateMipmap','bufferData','readPixels','compileShader']);
  for (const Ctx of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!Ctx) continue;
    for (const name of watch) {
      const orig = Ctx.prototype[name]; if (!orig || orig.__hooked) continue;
      const wrapped = function (...args) {
        const t = performance.now(); const r = orig.apply(this, args); const d = performance.now() - t;
        const c = S.calls[name] ??= { n: 0, ms: 0, max: 0 }; c.n++; c.ms += d; if (d > c.max) c.max = d;
        if (big.has(name) && d > 2) S.events.push([Math.round(t), name, +d.toFixed(1), name.startsWith('tex') && args.length > 5 ? (args[3] + 'x' + args[4]) : (args[0] && args[0].width ? args[0].width + 'x' + args[0].height : '')]);
        return r;
      };
      wrapped.__hooked = true; Ctx.prototype[name] = wrapped;
    }
  }
  window.__gl = { reset() { S.calls = {}; S.events = []; S.programs = []; }, summary() {
    const calls = {}; for (const [k, v] of Object.entries(S.calls)) calls[k] = { n: v.n, ms: +v.ms.toFixed(1), max: +v.max.toFixed(1) };
    return { calls, events: S.events.slice().sort((a, b) => b[2] - a[2]).slice(0, 40), eventsCount: S.events.length, programs: S.programs.slice(0, 300) };
  }, raw: S };
})();`;

const KEY = new Set(["EvaluateScript", "v8.compile", "v8.compileModule", "v8.evaluateModule", "FunctionCall", "ParseHTML", "Layout", "UpdateLayoutTree", "Paint", "PrePaint", "Layerize", "MajorGC", "MinorGC", "V8.GC_SCAVENGER", "V8.GC_MARK_COMPACTOR", "BlinkGC.AtomicPhase", "Decode Image", "ImageDecodeTask", "Decode LazyPixelRef", "TimerFire", "FireAnimationFrame", "XHRLoad", "ParseAuthorStyleSheet", "HitTest", "EventDispatch", "RunMicrotasks", "v8.run", "CpuProfiler::StartProfiling", "ResourceReceivedData", "Commit", "ScheduleStyleRecalculation"]);

export function summarizeTrace(events) {
  const threads = new Map();
  for (const e of events) if (e.ph === "M" && e.name === "thread_name") threads.set(`${e.pid}:${e.tid}`, e.args.name);
  const byThread = new Map();
  for (const e of events) {
    if (e.ph !== "X" || e.dur === undefined) continue;
    const k = `${e.pid}:${e.tid}`;
    if (!byThread.has(k)) byThread.set(k, []);
    byThread.get(k).push(e);
  }
  const pick = (name) => [...byThread.entries()].filter(([k]) => threads.get(k) === name).sort((a, b) => b[1].length - a[1].length)[0];
  const main = pick("CrRendererMain"), gpu = pick("CrGpuMain"), viz = pick("VizCompositorThread");
  const navStart = events.find((e) => e.name === "navigationStart" || e.name === "TracingStartedInBrowser")?.ts ?? Math.min(...(main?.[1] ?? []).map((e) => e.ts));
  const t0 = Math.min(...(main?.[1] ?? []).filter((e) => e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask").map((e) => e.ts));
  return {
    traceEvents: events.length,
    main: threadSummary(main?.[1] ?? [], t0, true),
    gpu: threadSummary(gpu?.[1] ?? [], t0, false),
    viz: threadSummary(viz?.[1] ?? [], t0, false),
    rasterDecode: decodeSummary(events, threads),
  };
}

function threadSummary(list, t0, detail) {
  const tasks = list.filter((e) => e.name === "ThreadControllerImpl::RunTask" || e.name === "RunTask").sort((a, b) => a.ts - b.ts);
  const long = tasks.filter((e) => e.dur > 50000);
  const totals = {};
  for (const e of list) if (KEY.has(e.name) || /GC|compile|Compile|Link|Program|Shader|TexImage|TexSubImage|TexStorage|Mipmap|BufferData|SwapBuffers|Draw|Flush|Finish/.test(e.name)) { const t = totals[e.name] ??= { n: 0, ms: 0 }; t.n++; t.ms += e.dur / 1000; }
  const sortedTotals = Object.entries(totals).map(([k, v]) => [k, v.n, +v.ms.toFixed(1)]).sort((a, b) => b[2] - a[2]).slice(0, detail ? 25 : 15);
  const longDetail = long.sort((a, b) => b.dur - a.dur).slice(0, detail ? 15 : 8).map((task) => {
    const inner = list.filter((e) => e !== task && e.ts >= task.ts && e.ts + e.dur <= task.ts + task.dur && e.dur > 3000 && e.name !== "ThreadControllerImpl::RunTask" && e.name !== "RunTask");
    const named = inner.sort((a, b) => b.dur - a.dur).slice(0, 6).map((e) => {
      const d = e.args?.data ?? {};
      const what = d.functionName || d.url || d.stackTrace?.[0]?.functionName || d.type || "";
      return `${e.name}${what ? `(${String(what).replace(/^https?:\/\/[^/]+/, "").slice(0, 70)})` : ""} ${(e.dur / 1000).toFixed(0)}ms`;
    });
    return { atMs: Math.round((task.ts - t0) / 1000), ms: Math.round(task.dur / 1000), inner: named };
  });
  return { tasks: tasks.length, busyMs: Math.round(tasks.reduce((a, e) => a + e.dur, 0) / 1000), longTasks: long.length, longMs: Math.round(long.reduce((a, e) => a + e.dur, 0) / 1000), totals: sortedTotals, long: longDetail };
}

function decodeSummary(events, threads) {
  const out = {};
  for (const e of events) {
    if (e.ph !== "X" || !/Decode|decode/.test(e.name)) continue;
    const t = threads.get(`${e.pid}:${e.tid}`) ?? "?";
    const k = `${t} | ${e.name}`; out[k] ??= { n: 0, ms: 0 }; out[k].n++; out[k].ms += e.dur / 1000;
  }
  return Object.entries(out).map(([k, v]) => [k, v.n, +v.ms.toFixed(1)]).sort((a, b) => b[2] - a[2]).slice(0, 10);
}
