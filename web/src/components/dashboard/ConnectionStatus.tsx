'use client';

import { WifiOff, RefreshCw, AlertTriangle } from 'lucide-react';
import type { ConnectionStatus } from '@/hooks/useDashboard';

interface Props {
  status: ConnectionStatus;
  lastUpdated: Date | null;
  serviceMessage?: string | null;
}

export function ConnectionStatusBar({ status, lastUpdated, serviceMessage }: Props) {
  if (status === 'connected' && !serviceMessage) return null;

  const isConnecting = status === 'connecting';
  const isUnavailable = status === 'unavailable';

  return (
    <div
      className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm ${
        isConnecting
          ? 'border border-blue-500/20 bg-blue-500/10 text-blue-300'
          : isUnavailable
            ? 'border border-amber-500/20 bg-amber-500/10 text-amber-200'
            : 'border border-red-500/20 bg-red-500/10 text-red-300'
      }`}
    >
      {isConnecting ? (
        <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
      ) : isUnavailable ? (
        <AlertTriangle className="h-4 w-4 shrink-0" />
      ) : (
        <WifiOff className="h-4 w-4 shrink-0" />
      )}

      <span className="font-medium">
        {isConnecting
          ? 'Connexion au serveur…'
          : isUnavailable
            ? (serviceMessage ??
              'Service temporairement indisponible. Nouvelle tentative automatique.')
            : 'Mode récupération — données REST'}
      </span>

      {lastUpdated && (
        <span className="ml-auto shrink-0 text-xs opacity-60">
          {lastUpdated.toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </span>
      )}
    </div>
  );
}
