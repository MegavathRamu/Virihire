// Executes candidate JS in an isolated vm context and runs it against test cases.
// The candidate must define:  function solve(input) { ... }
// Prototype sandbox (vm + per-call timeout). For production use container
// isolation (isolated-vm / Judge0 / gVisor) — vm is not a hard security boundary.
import vm from "node:vm";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  const out = { results: [], passed: 0, total: 0, error: "" };
  try {
    const { code, cases } = JSON.parse(raw || "{}");
    const ctx = vm.createContext({});
    vm.runInContext(String(code || ""), ctx, { timeout: 1500 });
    for (const c of cases || []) {
      out.total++;
      const r = { input: c.input, expected: c.expected, got: "", passed: false, error: "" };
      try {
        let arg;
        try { arg = JSON.parse(c.input); } catch { arg = c.input; }
        ctx.__ARG__ = arg;
        const res = vm.runInContext(
          "typeof solve==='function' ? solve(__ARG__) : (()=>{throw new Error('define function solve(input)')})()",
          ctx,
          { timeout: 1500 }
        );
        r.got = res && typeof res === "object" ? JSON.stringify(res) : String(res);
        r.passed = r.got.trim() === String(c.expected).trim();
      } catch (e) {
        r.error = String((e && e.message) || e);
      }
      if (r.passed) out.passed++;
      out.results.push(r);
    }
  } catch (e) {
    out.error = String((e && e.message) || e);
  }
  process.stdout.write(JSON.stringify(out));
});
