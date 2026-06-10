'use client';

import { CheckCircle, XCircle, Database, Wifi, Clock, Zap, Monitor } from 'lucide-react';
import type { SystemSettings } from '@/lib/types';

function StatusRow({ icon, label, ok, value }: { icon: React.ReactNode; label: string; ok: boolean; value?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2.5">
      <div className="flex items-center gap-2.5 text-sm text-stone-600">
        <span className="text-stone-400">{icon}</span>
        {label}
      </div>
      <div className="flex items-center gap-1.5">
        {value && <span className="text-xs text-stone-500">{value}</span>}
        {ok ? (
          <CheckCircle className="h-4 w-4 text-emerald-500" />
        ) : (
          <XCircle className="h-4 w-4 text-red-400" />
        )}
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2.5">
      <div className="flex items-center gap-2.5 text-sm text-stone-600">
        <span className="text-stone-400">{icon}</span>
        {label}
      </div>
      <span className="font-mono text-xs text-stone-500">{value}</span>
    </div>
  );
}

export function SystemSettingsPanel({ info }: { info: SystemSettings }) {
  return (
    <div className="space-y-4">
      {/* Server */}
      <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-stone-400">Serveur</p>
        <div className="divide-y divide-stone-50">
          <InfoRow icon={<Clock className="h-4 w-4" />} label="Fuseau horaire" value={info.appTimezone} />
          <InfoRow icon={<Zap className="h-4 w-4" />} label="Intervalle de sync" value={`${info.syncIntervalMs} ms`} />
          <StatusRow icon={<Monitor className="h-4 w-4" />} label="Mode simulation" ok={info.simulationEnabled} value={info.simulationEnabled ? 'Activé' : 'Désactivé'} />
          <StatusRow icon={<Database className="h-4 w-4" />} label="Base de données" ok={info.database.connected} value={info.database.connected ? 'Connectée' : 'Déconnectée'} />
        </div>
      </div>

      {/* Shelly */}
      <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-stone-400">Shelly Cloud</p>
        <div className="divide-y divide-stone-50">
          <StatusRow icon={<Wifi className="h-4 w-4" />} label="URL serveur configurée" ok={info.shelly.serverUrlConfigured} />
          <StatusRow icon={<Wifi className="h-4 w-4" />} label="Clé API configurée" ok={info.shelly.authKeyConfigured} />
        </div>
      </div>

      {/* Devices */}
      <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-stone-400">Appareils Shelly</p>
        <div className="divide-y divide-stone-50">
          {info.shelly.devices.map((d) => (
            <div key={d.chairName} className="flex items-center justify-between py-2.5">
              <div className="flex items-center gap-2.5 text-sm text-stone-600">
                <span className="font-mono text-xs font-semibold text-stone-700">{d.chairName}</span>
                {d.deviceIdMasked && (
                  <span className="font-mono text-xs text-stone-400">{d.deviceIdMasked}</span>
                )}
              </div>
              {d.deviceIdConfigured ? (
                <CheckCircle className="h-4 w-4 text-emerald-500" />
              ) : (
                <XCircle className="h-4 w-4 text-stone-300" />
              )}
            </div>
          ))}
        </div>
      </div>

      <p className="text-center text-xs text-stone-400">
        Les clés d&apos;API et identifiants complets ne sont jamais exposés par le serveur.
      </p>
    </div>
  );
}
