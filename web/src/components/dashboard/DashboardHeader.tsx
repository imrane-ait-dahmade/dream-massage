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
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          {/* Logo + title */}
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Dream Care" className="h-8 w-auto" />
            <div className="flex items-baseline gap-2">
              <span className="text-base font-bold text-white">Dream Care</span>
              {user && (
                <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-300 ring-1 ring-blue-500/30">
                  {user.role === 'OWNER' ? 'Owner' : 'Admin'}
                </span>
              )}
            </div>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-1">
            <Link
              href="/settings"
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
              title="Paramétrages"
            >
              <Settings className="h-4 w-4" />
            </Link>

            <ConnectionPill status={connStatus} lastUpdated={lastUpdated} />

            <button
              onClick={onLogout}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
              title="Déconnexion"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Hero banner with shop background */}
      <div
        className="relative h-36 overflow-hidden"
        style={{
          backgroundImage: 'url(/feuteuille.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center 40%',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-slate-900 via-slate-900/80 to-slate-900/20" />
        <div className="relative mx-auto flex h-full max-w-6xl flex-col justify-center px-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
            Dream Care
          </p>
          <h2 className="mt-0.5 text-2xl font-bold text-white">Tableau de bord</h2>
          <p className="mt-1 text-sm text-white/55">Suivi temps réel des fauteuils</p>
        </div>
      </div>
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
