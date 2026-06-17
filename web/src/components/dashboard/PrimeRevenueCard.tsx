'use client';

import { Clock, AlertCircle } from 'lucide-react';
import type { HomePrimeRevenue } from '@/lib/types';
import { formatDH } from '@/lib/format';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  data: HomePrimeRevenue | undefined;
  loading: boolean;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Row({
  label,
  value,
  highlight = false,
  muted = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between px-3 py-1.5 md:px-4 md:py-2.5 ${highlight ? 'bg-slate-700/30' : ''}`}
    >
      <span className={`text-[10px] md:text-xs ${muted ? 'text-slate-600' : 'text-slate-400'}`}>{label}</span>
      <span
        className={`text-xs font-semibold md:text-sm ${
          highlight ? 'text-white' : muted ? 'text-slate-600' : 'text-slate-300'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 md:px-4 md:py-2.5">
      <div className="h-2.5 w-36 animate-pulse rounded bg-slate-700 md:h-3 md:w-40" />
      <div className="h-2.5 w-14 animate-pulse rounded bg-slate-700 md:h-3 md:w-20" />
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PrimeRevenueCard({ data, loading }: Props) {
  const allZero =
    data &&
    data.planCommission === 0 &&
    data.targetBonus === 0 &&
    data.manualBonus === 0 &&
    data.totalPrime === 0;

  const hasPending  = data && data.pendingSessionsCount  > 0;
  const hasExcluded = data && data.excludedCommissionSessionsCount > data.pendingSessionsCount;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-800">
      <div className="border-b border-slate-700 px-2 py-2 md:px-4 md:py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xs font-bold text-white md:text-sm">Primes &amp; Recettes</h3>
          {data?.isEstimated && (
            <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
              <Clock className="h-2.5 w-2.5" />
              Estimation shift en cours
            </span>
          )}
          {data && data.eligibleCommissionSessionsCount > 0 && (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
              {data.eligibleCommissionSessionsCount} session{data.eligibleCommissionSessionsCount > 1 ? 's' : ''} éligible{data.eligibleCommissionSessionsCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <p className="mt-0.5 hidden text-xs text-slate-500 md:block">
          {data?.isEstimated
            ? 'Calcul live basé sur les règles actives — définitif à la clôture du shift'
            : 'Basé sur les sessions de la période filtrée'}
        </p>
      </div>

      <div className="divide-y divide-slate-700/40">
        {loading && !data ? (
          Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
        ) : !data ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-slate-600">Aucune donnée disponible</p>
          </div>
        ) : (
          <>
            <Row label="Revenu brut (sessions)" value={formatDH(data.grossRevenue)} />
            <Row
              label="Prime par plan (commission)"
              value={data.planCommission > 0 ? formatDH(data.planCommission) : '—'}
              muted={data.planCommission === 0}
            />
            <Row
              label="Bonus objectif"
              value={data.targetBonus > 0 ? formatDH(data.targetBonus) : '—'}
              muted={data.targetBonus === 0}
            />
            <Row
              label="Bonus manuel"
              value={data.manualBonus > 0 ? formatDH(data.manualBonus) : '—'}
              muted={data.manualBonus === 0}
            />
            <Row
              label="Prime totale"
              value={formatDH(data.totalPrime)}
              highlight={data.totalPrime > 0}
              muted={data.totalPrime === 0}
            />
            <Row
              label="Recette nette (après prime)"
              value={formatDH(data.netRevenue)}
              highlight
            />
          </>
        )}
      </div>

      {/* Warnings and info notes */}
      {data && (hasPending || hasExcluded || allZero) && (
        <div className="divide-y divide-slate-700/20 border-t border-slate-700/40">
          {hasPending && (
            <div className="flex items-start gap-2 px-3 py-2.5 md:px-4">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
              <p className="text-[10px] text-amber-400 md:text-xs">
                {data.pendingSessionsCount} session{data.pendingSessionsCount > 1 ? 's' : ''} en attente de validation — non comptabilisée{data.pendingSessionsCount > 1 ? 's' : ''} dans la commission.
              </p>
            </div>
          )}
          {hasExcluded && (
            <div className="flex items-start gap-2 px-3 py-2.5 md:px-4">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-slate-500" />
              <p className="text-[10px] text-slate-500 md:text-xs">
                {data.excludedCommissionSessionsCount - data.pendingSessionsCount} session{(data.excludedCommissionSessionsCount - data.pendingSessionsCount) > 1 ? 's' : ''} exclue{(data.excludedCommissionSessionsCount - data.pendingSessionsCount) > 1 ? 's' : ''} de la commission (sans plan, trop courte, ou sans règle active).
              </p>
            </div>
          )}
          {allZero && !hasPending && !hasExcluded && (
            <div className="px-4 py-3">
              <p className="text-center text-xs text-slate-600">
                Les primes seront calculées après configuration complète des règles.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
