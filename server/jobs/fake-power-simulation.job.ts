/**
 * Fake power simulation — development/testing only.
 * Generates synthetic power readings for chairs F1–F5 and feeds them into the
 * ChairStateService state machine so the full session lifecycle can be observed
 * without real Shelly hardware.
 *
 * Patterns (with SIMULATION_FAST_MODE=true: startConfirm=5s, stopConfirm=10s):
 *   F1 — always idle (~2.1W). Never triggers a session.
 *   F2 — always active (10–13W). Session starts on tick 5, runs forever.
 *   F3 — active with a 4-second false dip every 60 ticks. Tests POWER_RECOVERED.
 *   F4 — idle (~2.0W). Spare chair.
 *   F5 — full cycle every 30 ticks: idle → active → stop → repeat.
 *
 * TODO: remove this job entirely before production. Production reads from Shelly Cloud.
 */

import { prisma } from '../prisma';
import { logger } from '../utils/logger';
import { chairStateService } from '../modules/chairs/chair-state.service';

type ChairIdMap = Record<string, string>; // name → id

let simTick = 0;
let chairIdCache: ChairIdMap | null = null;

async function loadChairIds(): Promise<ChairIdMap> {
  if (chairIdCache) return chairIdCache;
  const chairs = await prisma.chair.findMany({
    where: { isEnabled: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  chairIdCache = Object.fromEntries(chairs.map((c) => [c.name, c.id]));
  logger.info(`[simulation] Loaded chair IDs: ${Object.keys(chairIdCache).join(', ')}`);
  return chairIdCache;
}

function generateReading(name: string, tick: number): { powerWatts: number; isOnline: boolean } {
  const jitter = () => (Math.random() - 0.5) * 0.4; // ±0.2W noise

  switch (name) {
    case 'F1':
      // Always idle — baseline noise, never triggers session
      return { powerWatts: 2.1 + jitter(), isOnline: true };

    case 'F2':
      // Always active — one perpetual session
      return { powerWatts: 11.5 + jitter() * 3, isOnline: true };

    case 'F3': {
      // Active with a brief false dip (4s dip < stopConfirmSeconds=10s → no end)
      const t3 = tick % 60;
      const inDip = t3 >= 30 && t3 < 34;
      return { powerWatts: inDip ? 3.2 + jitter() : 12.0 + jitter() * 2, isOnline: true };
    }

    case 'F4':
      // Idle spare chair
      return { powerWatts: 2.0 + jitter(), isOnline: true };

    case 'F5': {
      // Full lifecycle cycle every 30 ticks:
      //   ticks  0-2  (3s):  idle  (~2.1W) — chair is IDLE
      //   ticks  3-13 (11s): active (~12W) — session starts at tick 3+5=8
      //   ticks 14-29 (16s): low   (~3W)  — session ends at tick 14+10=24
      const t5 = tick % 30;
      if (t5 < 3) return { powerWatts: 2.1 + jitter(), isOnline: true };
      if (t5 < 14) return { powerWatts: 11.8 + jitter() * 2, isOnline: true };
      return { powerWatts: 3.1 + jitter(), isOnline: true };
    }

    default:
      return { powerWatts: 2.1, isOnline: true };
  }
}

/**
 * Process one simulation tick.
 * Called by the realtime job before each dashboard broadcast.
 */
export async function processSimulationTick(): Promise<void> {
  simTick++;
  const tick = simTick;

  const ids = await loadChairIds();

  for (const [name, id] of Object.entries(ids)) {
    try {
      const reading = generateReading(name, tick);
      await chairStateService.processChairReading(id, { ...reading, recordedAt: new Date() });
    } catch (err) {
      logger.error(`[simulation] Chair ${name} tick ${tick} error: ${String(err)}`);
    }
  }
}

/** Expose current tick count for the dev status endpoint. */
export function getSimulationTick(): number {
  return simTick;
}

/** Invalidate the chair ID cache (useful if chairs change during dev). */
export function resetChairIdCache(): void {
  chairIdCache = null;
}
