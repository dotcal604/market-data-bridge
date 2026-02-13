// MUST be imported FIRST in index.ts (before any @stoqey/ib imports).
//
// Problem: @stoqey/ib's logger uses console.log (stdout) in 36 places across 14 files.
// MCP protocol uses stdout for JSON-RPC. Any stdout pollution = corrupted transport = disconnect loop.
//
// Solution: Redirect console.log → console.error BEFORE @stoqey/ib is imported.
// ES module imports are hoisted, so this side-effect module must be the first import.

const _originalLog = console.log;
console.log = (...args: unknown[]) => {
  console.error(...args);
};
