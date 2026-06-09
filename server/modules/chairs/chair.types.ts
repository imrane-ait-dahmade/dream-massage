export interface PowerReading {
  powerWatts: number;
  isOnline: boolean;
  relayIsOn?: boolean;
  recordedAt?: Date;
}
