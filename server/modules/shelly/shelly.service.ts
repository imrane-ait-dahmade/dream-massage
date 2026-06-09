// Shelly Cloud HTTP client.
// SECURITY: SHELLY_AUTH_KEY must never leave this file or appear in any response.
// All outbound calls are server-to-Shelly; the frontend never touches Shelly directly.

import { request as httpsRequest } from 'https';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import type { ShellyApiResponse, ShellyReading } from './shelly.types';

// ── Config helpers ─────────────────────────────────────────────────────────────

const CHAIR_NAMES = ['F1', 'F2', 'F3', 'F4', 'F5'] as const;

function deviceId(chairName: string): string | undefined {
  return env[`SHELLY_DEVICE_${chairName}` as keyof typeof env] as string | undefined;
}

export function isShellyConfigured(): boolean {
  return !!(
    env.SHELLY_AUTH_KEY &&
    env.SHELLY_SERVER_URL &&
    CHAIR_NAMES.every((n) => deviceId(n))
  );
}

export function getMissingFields(): string[] {
  const missing: string[] = [];
  if (!env.SHELLY_AUTH_KEY) missing.push('SHELLY_AUTH_KEY');
  if (!env.SHELLY_SERVER_URL) missing.push('SHELLY_SERVER_URL');
  for (const name of CHAIR_NAMES) {
    if (!deviceId(name)) missing.push(`SHELLY_DEVICE_${name}`);
  }
  return missing;
}

// ── HTTPS helper ───────────────────────────────────────────────────────────────

function postJson(url: string, body: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(body);
    const parsed = new URL(url);

    const req = httpsRequest(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(json),
        },
        timeout: 8000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Shelly HTTP ${res.statusCode}: ${text.slice(0, 300)}`));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error(`Shelly returned non-JSON: ${text.slice(0, 300)}`));
          }
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Shelly API request timed out (8s)'));
    });
    req.write(json);
    req.end();
  });
}

// ── Service ────────────────────────────────────────────────────────────────────

export class ShellyService {
  /**
   * Fetch live power readings for all 5 chairs in ONE API call.
   * Caller must ensure isShellyConfigured() before calling.
   */
  async fetchDeviceStates(): Promise<ShellyReading[]> {
    const authKey = env.SHELLY_AUTH_KEY!;
    const serverUrl = env.SHELLY_SERVER_URL!;

    const chairs = CHAIR_NAMES.map((name) => ({
      chairName: name,
      id: deviceId(name)!,
    }));

    // Auth key goes only in the query-string — never echoed in response bodies
    const url = `https://${serverUrl}/v2/devices/api/get?auth_key=${encodeURIComponent(authKey)}`;

    logger.debug(`[shelly] POST ${serverUrl}/v2/devices/api/get (${chairs.length} devices)`);

    // Response is a plain JSON array: ShellyDeviceResult[]
    const raw = (await postJson(url, {
      ids: chairs.map((c) => c.id),
      select: ['status'],
    })) as ShellyApiResponse;

    if (!Array.isArray(raw)) {
      throw new Error(`Unexpected Shelly response shape: ${JSON.stringify(raw).slice(0, 200)}`);
    }

    // Index results by device ID for O(1) lookup
    const byId = new Map(raw.map((entry) => [entry.id, entry]));

    return chairs.map(({ chairName, id }) => {
      const entry = byId.get(id);

      if (!entry || entry.online === 0) {
        return { chairName, deviceId: id, isOnline: false, powerWatts: 0, relayIsOn: false };
      }

      const ds = entry.status;

      // Power — Gen1 Shelly Plug S: meters[0].power
      // Gen2/3 Shelly Plus/Pro: switch:0.apower or pm1:0.apower
      let powerWatts = 0;
      if (ds?.meters?.[0]?.power !== undefined) {
        powerWatts = ds.meters[0].power;
      } else if (ds?.['switch:0']?.apower !== undefined) {
        powerWatts = ds['switch:0'].apower;
      } else if (ds?.['pm1:0']?.apower !== undefined) {
        powerWatts = ds['pm1:0'].apower;
      }

      // Relay — Gen1: relays[0].ison  |  Gen2/3: switch:0.output
      let relayIsOn = false;
      if (ds?.relays?.[0]?.ison !== undefined) {
        relayIsOn = ds.relays[0].ison;
      } else if (ds?.['switch:0']?.output !== undefined) {
        relayIsOn = ds['switch:0'].output;
      }

      return { chairName, deviceId: id, isOnline: true, powerWatts, relayIsOn };
    });
  }
}

export const shellyService = new ShellyService();
