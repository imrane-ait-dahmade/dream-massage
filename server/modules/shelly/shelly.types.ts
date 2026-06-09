// Actual Shelly Cloud API response types.
// The /v2/devices/api/get endpoint returns a plain JSON array (not an {isok} wrapper).

export interface ShellyDeviceStatus {
  relays?: Array<{ ison: boolean; overpower?: boolean }>;
  meters?: Array<{ power: number; is_valid?: boolean }>;
  // Gen2/3 Shelly Plus/Pro fields
  'switch:0'?: { output: boolean; apower?: number };
  'pm1:0'?: { apower: number };
}

export interface ShellyDeviceResult {
  id: string;
  type: string;
  code: string;
  gen: string;
  online: 0 | 1; // Shelly uses 0/1, not boolean
  status: ShellyDeviceStatus;
}

// The batch endpoint returns a plain array of device results
export type ShellyApiResponse = ShellyDeviceResult[];

// Normalized per-chair reading for the rest of the backend
export interface ShellyReading {
  chairName: string;
  deviceId: string;
  isOnline: boolean;
  powerWatts: number;
  relayIsOn: boolean;
}
