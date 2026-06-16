'use client';

import Link from 'next/link';
import { Settings, LogOut, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import type { AuthUser } from '@/lib/api';
import type { ConnectionStatus } from '@/hooks/useDashboard';

interface Props {
  user: AuthUser | null;
  connStatus: ConnectionStatus;
  lastUpdated: Date | null;
  onLogout: () => void;
}

export function DashboardHeader({ user, connStatus, lastUpdated, onLogout }: Props) {
  return (
    <>
      {/* Sticky navbar */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-900/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-2 py-1.5 md:gap-3 md:px-4 md:py-3">
          {/* Logo + title */}
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Dream Care" className="h-7 w-auto md:h-8" />
            <div className="flex items-baseline gap-1.5">
              <span className="text-sm font-bold text-white md:text-base">Dream Care</span>
              {user && (
                <span className="hidden rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-300 ring-1 ring-blue-500/30 md:inline-flex">
                  {user.role === 'OWNER' ? 'Owner' : 'Admin'}
                </span>
              )}
            </div>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-0.5 md:gap-1">
            <Link
              href="/settings"
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white md:p-2"
              title="Paramétrages"
            >
              <Settings className="h-4 w-4" />
            </Link>

            <ConnectionPill status={connStatus} lastUpdated={lastUpdated} />

            <button
              onClick={onLogout}
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white md:p-2"
              title="Déconnexion"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

    </>
  );
}

function ConnectionPill({
  status,
  lastUpdated,
}: {
  status: ConnectionStatus;
  lastUpdated: Date | null;
}) {
  if (status === 'connected') {
    return (
      <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400 ring-1 ring-emerald-500/25">
        <Wifi className="h-3 w-3" />
        <span className="hidden sm:block">Connecté</span>
      </div>
    );
  }
  if (status === 'connecting') {
    return (
      <div className="flex items-center gap-1.5 rounded-full bg-blue-500/15 px-2.5 py-1 text-xs font-semibold text-blue-400 ring-1 ring-blue-500/25">
        <RefreshCw className="h-3 w-3 animate-spin" />
        <span className="hidden sm:block">Connexion…</span>
      </div>
    );
  }
  return (
    <div
      className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-400 ring-1 ring-red-500/25"
      title={
        lastUpdated
          ? `Dernière MAJ : ${lastUpdated.toLocaleTimeString('fr-FR')}`
          : undefined
      }
    >
      <WifiOff className="h-3 w-3" />
      <span className="hidden sm:block">Déconnecté</span>
    </div>
  );
}
