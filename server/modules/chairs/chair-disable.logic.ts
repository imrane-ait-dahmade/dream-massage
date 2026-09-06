/**
 * Pure chair-disable helpers (no database, no runtime cache).
 */

export type DisabledChairMemPatch = {
  isEnabled: false;
  startBlockReason: null;
  status: 'IDLE';
  currentSessionId: null;
  maybeFinishedSince: null;
  maybeActiveSince: null;
  session: null;
  dirtyLive: false;
};

/** In-memory fields cleared when a chair is disabled or stale session finalized. */
export function disabledChairMemPatch(): DisabledChairMemPatch {
  return {
    isEnabled: false,
    startBlockReason: null,
    status: 'IDLE',
    currentSessionId: null,
    maybeFinishedSince: null,
    maybeActiveSince: null,
    session: null,
    dirtyLive: false,
  };
}

/** State machine must not process Shelly ticks for disabled chairs. */
export function shouldProcessChairReading(isEnabled: boolean): boolean {
  return isEnabled;
}
