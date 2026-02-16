// Setup file for risk-gate tests
// This runs BEFORE any modules are imported, allowing us to set env vars
// that will be picked up by module-level constants in risk-gate.ts

// Set a large account equity base so that the 5% position limit (hardcoded in RISK_CONFIG_DEFAULTS)
// doesn't constrain test orders. Tests place orders up to ~$15k notional.
// With $1M account: 5% = $50k max notional (well above test requirements)
process.env.RISK_ACCOUNT_EQUITY_BASE = "1000000";
