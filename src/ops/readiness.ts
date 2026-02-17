/**
 * Readiness flag — lightweight module to avoid circular deps.
 *
 * Set by index.ts after all subsystems initialize.
 * Read by server.ts health endpoints and pm2/load balancers.
 */

let _ready = false;

export function isReady(): boolean {
  return _ready;
}

export function setReady(value: boolean): void {
  _ready = value;
}
