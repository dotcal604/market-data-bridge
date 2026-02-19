import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface AnalyticsRunnerModule {
  runAnalyticsScript: (
    scriptName: string,
    args?: string[],
    timeoutMs?: number,
    triggerType?: string
  ) => Promise<{
    jobId: number;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    durationMs: number;
    timedOut: boolean;
  }>;
  getKnownScripts: () => string[];
  refreshKnownScripts: () => void;
}

interface DatabaseModule {
  insertAnalyticsJob: (script: string, triggerType: string) => number;
  updateAnalyticsJob: (
    id: number,
    update: {
      status: string;
      exitCode?: number | null;
      stdout?: string | null;
      stderr?: string | null;
      durationMs?: number | null;
    }
  ) => void;
  queryAnalyticsJobs: (limit?: number) => Array<Record<string, unknown>>;
  getAnalyticsJobById: (id: number) => Record<string, unknown> | undefined;
  closeDb: () => void;
}

async function loadDatabaseModule(): Promise<DatabaseModule> {
  vi.resetModules();
  process.env.DB_PATH = ":memory:";
  return import("../db/database.js") as unknown as DatabaseModule;
}

async function loadAnalyticsRunnerModule(): Promise<AnalyticsRunnerModule> {
  vi.resetModules();
  process.env.DB_PATH = ":memory:";
  // Need to load database first to initialize schema
  await import("../db/database.js");
  return import("../ops/analytics-runner.js") as unknown as AnalyticsRunnerModule;
}

describe("ops/analytics-runner", () => {
  beforeEach(() => {
    process.env.DB_PATH = ":memory:";
  });

  afterEach(async () => {
    const db = await loadDatabaseModule();
    db.closeDb();
  });

  it("getKnownScripts returns list of Python scripts from analytics/ directory", async () => {
    const runner = await loadAnalyticsRunnerModule();
    const scripts = runner.getKnownScripts();
    
    // Should find at least some scripts
    expect(Array.isArray(scripts)).toBe(true);
    expect(scripts.length).toBeGreaterThan(0);
    
    // Should include known scripts like recalibrate_weights
    expect(scripts).toContain("recalibrate_weights");
    
    // Should be sorted
    const sorted = [...scripts].sort();
    expect(scripts).toEqual(sorted);
  });

  it("refreshKnownScripts reloads script list", async () => {
    const runner = await loadAnalyticsRunnerModule();
    const scripts1 = runner.getKnownScripts();
    
    runner.refreshKnownScripts();
    const scripts2 = runner.getKnownScripts();
    
    // Should return same list (unless files changed)
    expect(scripts2).toEqual(scripts1);
  });

  it("runAnalyticsScript rejects unknown script name", async () => {
    const runner = await loadAnalyticsRunnerModule();
    
    await expect(
      runner.runAnalyticsScript("nonexistent_script_xyz")
    ).rejects.toThrow(/Unknown script/);
  });

  it("insertAnalyticsJob + getAnalyticsJobById roundtrip", async () => {
    const db = await loadDatabaseModule();
    
    const jobId = db.insertAnalyticsJob("recalibrate_weights", "manual");
    expect(jobId).toBeGreaterThan(0);
    
    const job = db.getAnalyticsJobById(jobId);
    expect(job).toBeDefined();
    expect(job?.script).toBe("recalibrate_weights");
    expect(job?.trigger_type).toBe("manual");
    expect(job?.status).toBe("running");
    expect(job?.exit_code).toBeNull();
    
    db.closeDb();
  });

  it("updateAnalyticsJob updates job record", async () => {
    const db = await loadDatabaseModule();
    
    const jobId = db.insertAnalyticsJob("regime", "api");
    db.updateAnalyticsJob(jobId, {
      status: "success",
      exitCode: 0,
      stdout: "Script completed successfully",
      stderr: "",
      durationMs: 1234,
    });
    
    const job = db.getAnalyticsJobById(jobId);
    expect(job?.status).toBe("success");
    expect(job?.exit_code).toBe(0);
    expect(job?.stdout).toBe("Script completed successfully");
    expect(job?.duration_ms).toBe(1234);
    expect(job?.completed_at).toBeDefined();
    
    db.closeDb();
  });

  it("queryAnalyticsJobs returns recent jobs", async () => {
    const db = await loadDatabaseModule();
    
    db.insertAnalyticsJob("script1", "manual");
    db.insertAnalyticsJob("script2", "scheduled");
    db.insertAnalyticsJob("script3", "api");
    
    const jobs = db.queryAnalyticsJobs(10);
    expect(jobs.length).toBeGreaterThanOrEqual(3);
    
    // Most recent first
    expect(jobs[0]?.script).toBe("script3");
    
    db.closeDb();
  });

  it("runAnalyticsScript with timeout sets timedOut=true and kills process", async () => {
    const runner = await loadAnalyticsRunnerModule();
    
    // Create a test script that sleeps longer than timeout
    const testScriptPath = path.join(__dirname, "../../analytics/test_timeout_script.py");
    const scriptContent = `import time\ntime.sleep(10)\nprint("Should not see this")`;
    fs.writeFileSync(testScriptPath, scriptContent);
    
    try {
      // Refresh to pick up new script
      runner.refreshKnownScripts();
      
      // Run with 100ms timeout (script sleeps 10s)
      const result = await runner.runAnalyticsScript("test_timeout_script", [], 100);
      
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBeNull();
      expect(result.stderr).toContain("timeout");
    } finally {
      // Clean up test script
      if (fs.existsSync(testScriptPath)) {
        fs.unlinkSync(testScriptPath);
      }
    }
  }, 15000); // 15s test timeout to allow for cleanup

  it("runAnalyticsScript captures stdout and stderr", async () => {
    const runner = await loadAnalyticsRunnerModule();
    
    // Create a test script that writes to both stdout and stderr
    const testScriptPath = path.join(__dirname, "../../analytics/test_output_script.py");
    const scriptContent = `import sys\nprint("stdout message")\nprint("stderr message", file=sys.stderr)\nexit(0)`;
    fs.writeFileSync(testScriptPath, scriptContent);
    
    try {
      runner.refreshKnownScripts();
      const result = await runner.runAnalyticsScript("test_output_script");
      
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("stdout message");
      expect(result.stderr).toContain("stderr message");
      expect(result.timedOut).toBe(false);
      expect(result.durationMs).toBeGreaterThan(0);
    } finally {
      if (fs.existsSync(testScriptPath)) {
        fs.unlinkSync(testScriptPath);
      }
    }
  }, 10000);

  it("runAnalyticsScript records success with exit code 0", async () => {
    const runner = await loadAnalyticsRunnerModule();
    const db = await loadDatabaseModule();
    
    const testScriptPath = path.join(__dirname, "../../analytics/test_success_script.py");
    const scriptContent = `print("success")\nexit(0)`;
    fs.writeFileSync(testScriptPath, scriptContent);
    
    try {
      runner.refreshKnownScripts();
      const result = await runner.runAnalyticsScript("test_success_script");
      
      expect(result.exitCode).toBe(0);
      
      const job = db.getAnalyticsJobById(result.jobId);
      expect(job?.status).toBe("success");
      expect(job?.exit_code).toBe(0);
    } finally {
      if (fs.existsSync(testScriptPath)) {
        fs.unlinkSync(testScriptPath);
      }
    }
    
    db.closeDb();
  }, 10000);

  it("runAnalyticsScript records error with non-zero exit code", async () => {
    const runner = await loadAnalyticsRunnerModule();
    const db = await loadDatabaseModule();
    
    const testScriptPath = path.join(__dirname, "../../analytics/test_error_script.py");
    const scriptContent = `import sys\nprint("error", file=sys.stderr)\nexit(1)`;
    fs.writeFileSync(testScriptPath, scriptContent);
    
    try {
      runner.refreshKnownScripts();
      const result = await runner.runAnalyticsScript("test_error_script");
      
      expect(result.exitCode).toBe(1);
      
      const job = db.getAnalyticsJobById(result.jobId);
      expect(job?.status).toBe("error");
      expect(job?.exit_code).toBe(1);
    } finally {
      if (fs.existsSync(testScriptPath)) {
        fs.unlinkSync(testScriptPath);
      }
    }
    
    db.closeDb();
  }, 10000);

  it("runAnalyticsScript respects triggerType parameter", async () => {
    const runner = await loadAnalyticsRunnerModule();
    const db = await loadDatabaseModule();
    
    const testScriptPath = path.join(__dirname, "../../analytics/test_trigger_script.py");
    const scriptContent = `print("trigger test")\nexit(0)`;
    fs.writeFileSync(testScriptPath, scriptContent);
    
    try {
      runner.refreshKnownScripts();
      const result = await runner.runAnalyticsScript("test_trigger_script", [], 5000, "scheduled");
      
      const job = db.getAnalyticsJobById(result.jobId);
      expect(job?.trigger_type).toBe("scheduled");
    } finally {
      if (fs.existsSync(testScriptPath)) {
        fs.unlinkSync(testScriptPath);
      }
    }
    
    db.closeDb();
  }, 10000);
});
