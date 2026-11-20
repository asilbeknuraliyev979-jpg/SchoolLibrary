'use client';

import React, { useState } from 'react';
import { BookOpen, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button, FieldLabel, Input } from '@/components/ui/primitives';
import { useLibrary } from '@/components/library-context';
import { authFetch } from '@/lib/api-client';

export function LoginScreen() {
  const { setupRequired, refreshSession } = useLibrary();

  const [username, setUsername] = useState('nodira.library');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password) {
      setError('Login va parolni kiriting.');
      return;
    }

    if (setupRequired) {
      if (password.length < 8) {
        setError('Parol kamida 8 ta belgidan iborat bo‘lishi kerak.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Parollar bir-biriga mos kelmadi.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const endpoint = setupRequired ? '/api/auth/setup' : '/api/auth/login';
      const res = await authFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Login yoki parol noto‘g‘ri.');
        return;
      }
      toast.success('Xush kelibsiz, Nodira opa!');
      await refreshSession();
    } catch {
      setError('Server bilan bog‘lanishda xatolik yuz berdi.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-[380px] border border-[#E2E8F0] rounded-[12px] p-7 bg-white">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-10 h-10 rounded-[10px] bg-[#1E3A5F] text-white flex items-center justify-center mb-3">
            <BookOpen className="w-5 h-5" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-[#0F172A]">
            SCHOOL LIBRARY
          </h1>
          <p className="text-xs text-[#64748B] mt-1">
            {setupRequired ? 'Boshlang‘ich parolni o‘rnating' : 'Kutubxona tizimiga kirish'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <FieldLabel htmlFor="login-username" required>
              Login
            </FieldLabel>
            <Input
              id="login-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="nodira.library"
              autoComplete="username"
              required
            />
          </div>

          <div>
            <FieldLabel htmlFor={setupRequired ? 'setup-password' : 'login-password'} required>
              Parol
            </FieldLabel>
            <div className="relative">
              <Input
                id={setupRequired ? 'setup-password' : 'login-password'}
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={setupRequired ? 'Kamida 8 ta belgi' : 'Parolingizni kiriting'}
                autoComplete={setupRequired ? 'new-password' : 'current-password'}
                required
                className="pr-9"
              />
              <button
                type="button"
                aria-label={showPass ? 'Parolni yashirish' : 'Parolni ko‘rsatish'}
                onClick={() => setShowPass((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#0F172A] p-1 cursor-pointer"
              >
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {setupRequired && (
            <div>
              <FieldLabel htmlFor="setup-confirm" required>
                Parolni tasdiqlang
              </FieldLabel>
              <Input
                id="setup-confirm"
                type={showPass ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Parolni qayta kiriting"
                autoComplete="new-password"
                required
              />
            </div>
          )}

          {error && (
            <p role="alert" className="text-xs text-[#DC2626] bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" size="lg" disabled={submitting}>
            {submitting ? 'Kirilmoqda...' : 'Kirish'}
          </Button>
        </form>
      </div>
    </div>
  );
}
