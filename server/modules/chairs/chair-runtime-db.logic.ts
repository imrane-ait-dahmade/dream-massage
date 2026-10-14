/**
 * Pure rules for syncing the in-memory chair runtime with the DB (no Prisma).
 */
import type { PowerAgg } from './chair-state.logic';
import type { ChairMem } from './chair-runtime-cache';

/** Keep full-session sum/count from memory; DB only knows min/max. */
export function mergePowerAgg(mem: PowerAgg, db: PowerAgg): PowerAgg {
  const min =
    mem.min === null ? db.min : db.min === null ? mem.min : Math.min(mem.min, db.min);
  const max =
    mem.max === null ? db.max : db.max === null ? mem.max : Math.max(mem.max, db.max);
  if (mem.count <= 0) return { ...db, min, max };
  return { min, max, sum: mem.sum, count: mem.count };
}

/**
 * Re-hydrate replaces a chair entry with DB values. Carry over memory-only state
 * the DB cannot hold, without overriding DB status or session identity.
 */
export function carryOverRuntimeState(prev: ChairMem | undefined, next: ChairMem): ChairMem {
  if (!prev) return next;

  if (prev.dirtyLive) {
    next.currentPowerWatts = prev.currentPowerWatts;
    next.isOnline = prev.isOnline;
    next.relayIsOn = prev.relayIsOn;
    next.lastSyncedAt = prev.lastSyncedAt;
    next.lastOnlineAt = prev.lastOnlineAt;
    next.dirtyLive = true;
  }

  if (next.status === 'IDLE' && prev.startBlockReason != null) {
    next.startBlockReason = prev.startBlockReason;
  }

  if (next.session && prev.session && prev.session.id === next.session.id) {
    next.session.power = mergePowerAgg(prev.session.power, next.session.power);
    next.session.dirtyMetrics = prev.session.dirtyMetrics;
  }

  return next;
}

/** Stale recovery can only find work when some chair holds or may hold an ACTIVE session. */
export function runtimeNeedsStaleRecovery(
  chairs: Array<Pick<ChairMem, 'status' | 'session' | 'currentSessionId'>>,
): boolean {
  return chairs.some(
    (c) =>
      c.session != null ||
      c.currentSessionId != null ||
      c.status === 'ACTIVE' ||
      c.status === 'MAYBE_FINISHED',
  );
}
