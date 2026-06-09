import { elapsedSeconds, nowISO } from '../../utils/time';

export type ChairStatus =
  | 'IDLE'
  | 'MAYBE_ACTIVE'
  | 'ACTIVE'
  | 'MAYBE_FINISHED'
  | 'OFFLINE'
  | 'ERROR'
  | 'MAINTENANCE';

export interface ChairState {
  name: string;
  status: ChairStatus;
  powerWatts: number;
  isOnline: boolean;
  sessionStartedAt: string | null;
  elapsedSeconds: number;
  warning: string | null;
}

export interface DashboardState {
  serverTime: string;
  connection: 'mock' | 'live';
  todayStats: {
    expectedRevenue: number;
    sessionsCount: number;
    activeChairs: number;
    offlineChairs: number;
  };
  openShift: {
    id: string;
    staffMemberName: string;
    startedAt: string;
  };
  chairs: ChairState[];
}

// Fixed start times set once at module load so elapsed counts up naturally across broadcasts
const MOCK_SESSION_STARTS = {
  F2: new Date(Date.now() - 320_000),
  F3: new Date(Date.now() - 900_000),
  F5: new Date(Date.now() - 120_000),
};

const SHIFT_START = new Date(Date.now() - 2 * 60 * 60 * 1000);

function jitter(base: number, range = 0.3): number {
  return Math.round((base + (Math.random() * 2 - 1) * range) * 10) / 10;
}

export class DashboardService {
  getState(): DashboardState {
    const chairs: ChairState[] = [
      {
        name: 'F1',
        status: 'IDLE',
        powerWatts: jitter(2.1),
        isOnline: true,
        sessionStartedAt: null,
        elapsedSeconds: 0,
        warning: null,
      },
      {
        name: 'F2',
        status: 'ACTIVE',
        powerWatts: jitter(12.4, 0.8),
        isOnline: true,
        sessionStartedAt: MOCK_SESSION_STARTS.F2.toISOString(),
        elapsedSeconds: elapsedSeconds(MOCK_SESSION_STARTS.F2),
        warning: null,
      },
      {
        name: 'F3',
        status: 'MAYBE_FINISHED',
        powerWatts: jitter(3.2, 0.4),
        isOnline: true,
        sessionStartedAt: MOCK_SESSION_STARTS.F3.toISOString(),
        elapsedSeconds: elapsedSeconds(MOCK_SESSION_STARTS.F3),
        warning: 'Possible end detected',
      },
      {
        name: 'F4',
        status: 'IDLE',
        powerWatts: jitter(2.0),
        isOnline: true,
        sessionStartedAt: null,
        elapsedSeconds: 0,
        warning: null,
      },
      {
        name: 'F5',
        status: 'ACTIVE',
        powerWatts: jitter(9.8, 0.6),
        isOnline: true,
        sessionStartedAt: MOCK_SESSION_STARTS.F5.toISOString(),
        elapsedSeconds: elapsedSeconds(MOCK_SESSION_STARTS.F5),
        warning: null,
      },
    ];

    const activeChairs = chairs.filter(
      (c) => c.status === 'ACTIVE' || c.status === 'MAYBE_FINISHED',
    ).length;

    return {
      serverTime: nowISO(),
      connection: 'mock',
      todayStats: {
        expectedRevenue: 0,
        sessionsCount: 0,
        activeChairs,
        offlineChairs: 0,
      },
      openShift: {
        id: 'mock-shift-001',
        staffMemberName: 'Demo Staff',
        startedAt: SHIFT_START.toISOString(),
      },
      chairs,
    };
  }
}

export const dashboardService = new DashboardService();
