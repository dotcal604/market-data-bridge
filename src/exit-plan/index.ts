// ── ExitPlan Module — Public API ─────────────────────────────────────────

export type {
  ExitPlan,
  ExitPlanState,
  ExitPolicy,
  ExitPlanRuntime,
  ExitOverrideEvent,
  OverrideReason,
  ExitPlanCreateInput,
  ExitPlanRecommendInput,
  TPTarget,
  RunnerPolicy,
  ProtectTrigger,
  GivebackGuard,
} from "./types.js";

export {
  VALID_TRANSITIONS,
  isValidTransition,
} from "./types.js";

export {
  createExitPlan,
  getExitPlan,
  getExitPlanByCorrelation,
  getActiveExitPlans,
  queryExitPlans,
  transitionState,
  activateExitPlan,
  updateRuntime,
  updatePolicy,
  recordOverride,
  closeExitPlan,
  getExitPlanStats,
} from "./store.js";

export type { ExitPlanStats } from "./store.js";

export { recommendPolicy } from "./recommend.js";
