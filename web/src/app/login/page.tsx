'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { login, getMe } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      // Verify session is reachable before navigating — login() already stored
      // the Bearer token so this succeeds even when Safari blocks the cross-site cookie.
      if (process.env.NODE_ENV === 'development') {
        console.log('[auth] login ok — verifying session via GET /api/auth/me');
      }
      try {
        const user = await getMe();
        if (process.env.NODE_ENV === 'development') {
          console.log('[auth] /api/auth/me ok — redirecting by role');
        }
        router.replace(user.role === 'ASSISTANT' ? '/assistant' : '/');
      } catch (meErr) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[auth] /api/auth/me failed:', (meErr as Error).message);
        }
        setError('Connexion réussie mais session non vérifiée. Réessayez.');
        return;
      }
    } catch (err) {
      setError((err as Error).message || 'Connexion échouée');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm">
        {/* Branding */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-stone-900">Dream Massage</h1>
          <p className="mt-1 text-sm text-stone-500">Connexion Dream Care</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            {/* Email */}
            <div className="flex flex-col gap-1">
              <label htmlFor="email" className="text-xs font-semibold text-stone-600">
                Adresse e-mail
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@example.com"
                className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 outline-none transition-colors placeholder:text-stone-300 focus:border-stone-400 focus:bg-white"
              />
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1">
              <label htmlFor="password" className="text-xs font-semibold text-stone-600">
                Mot de passe
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 outline-none transition-colors placeholder:text-stone-300 focus:border-stone-400 focus:bg-white"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-red-200">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-stone-900 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
            >
              {loading ? 'Connexion…' : 'Se connecter'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
