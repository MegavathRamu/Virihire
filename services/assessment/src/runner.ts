import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHILD = path.resolve(__dirname, "../runner-child.mjs");

export interface TC { input: string; expected: string; }
export interface CaseResult { input: string; expected: string; got: string; passed: boolean; error: string; }

// Run candidate JS against test cases in a killable child process.
export function runJs(code: string, testCases: TC[]): Promise<{ results: CaseResult[]; passed: number; total: number }> {
  const cases = testCases || [];
  return new Promise((resolve) => {
    const child = execFile("node", [CHILD], { timeout: 8000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
      if ((err && !stdout) || !stdout) {
        resolve({
          results: cases.map((c) => ({ input: c.input, expected: c.expected, got: "", passed: false, error: "execution timed out or failed" })),
          passed: 0,
          total: cases.length,
        });
        return;
      }
      try {
        const out = JSON.parse(stdout);
        resolve({ results: out.results || [], passed: out.passed || 0, total: out.total ?? cases.length });
      } catch {
        resolve({ results: [], passed: 0, total: cases.length });
      }
    });
    child.stdin?.write(JSON.stringify({ code, cases }));
    child.stdin?.end();
  });
}
