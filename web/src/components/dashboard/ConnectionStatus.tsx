'use client';

import { WifiOff, RefreshCw } from 'lucide-react';
import type { ConnectionStatus } from '@/hooks/useDashboard';

interface Props {
  status: ConnectionStatus;
  lastUpdated: Date | null;
}

export function ConnectionStatusBar({ status, lastUpdated }: Props) {
  if (status === 'connected') return null;

  const isConnecting = status === 'connecting';

  return (
    <div
      className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm ${
        isConnecting
          ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
          : 'bg-red-50 text-red-700 ring-1 ring-red-200'
      }`}
    >
      {isConnecting ? (
        <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
      ) : (
        <WifiOff className="h-4 w-4 shrink-0" />
      )}

      <span className="font-medium">
        {isConnecting ? 'Connexion au serveur…' : 'Mode récupération — données REST'}
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
