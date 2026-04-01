'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center px-6 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 h-[400px] w-[400px] rounded-full bg-indigo-500/8 blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 h-[300px] w-[300px] rounded-full bg-violet-500/6 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md animate-fade-in-up">
        {/* Brand */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/25">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Cloud Simulator</span>
        </div>

        <Card className="border-slate-800/50 bg-slate-900/60 backdrop-blur-xl">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Welcome back</CardTitle>
            <CardDescription>Sign in to your simulation control center.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form 
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setLoading(true);
                setError(null);
                try {
                  await login(email, password);
                  router.push('/dashboard');
                } catch (e: any) {
                  setError(e?.message ?? 'Login failed');
                } finally {
                  setLoading(false);
                }
              }}
            >
              <div className="space-y-2">
                <label className="text-[13px] font-medium text-slate-300" htmlFor="email">Email</label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
              </div>
              <div className="space-y-2">
                <label className="text-[13px] font-medium text-slate-300" htmlFor="password">Password</label>
                <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </div>
              {error ? (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-300">{error}</div>
              ) : null}
              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-indigo-500 to-violet-600 text-white border-0 hover:from-indigo-400 hover:to-violet-500 shadow-md shadow-indigo-500/20"
                disabled={loading}
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
            <div className="text-center text-[13px] text-slate-500">
              No account?{' '}
              <a className="text-indigo-400 hover:text-indigo-300 transition-colors" href="/signup">
                Create one
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
