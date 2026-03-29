'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';

export default function SignupPage() {
  const router = useRouter();
  const { signup } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center px-6 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 right-1/4 h-[400px] w-[400px] rounded-full bg-violet-500/8 blur-3xl" />
        <div className="absolute bottom-1/3 left-1/4 h-[300px] w-[300px] rounded-full bg-indigo-500/6 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md animate-fade-in-up">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/25">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Cloud Simulator</span>
        </div>

        <Card className="border-slate-800/50 bg-slate-900/60 backdrop-blur-xl">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Create account</CardTitle>
            <CardDescription>Start building resilience. Default role: Engineer.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-[13px] font-medium text-slate-300">Email</label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
            </div>
            <div className="space-y-2">
              <label className="text-[13px] font-medium text-slate-300">Password</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            {error ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-300">{error}</div>
            ) : null}
            <Button
              className="w-full bg-gradient-to-r from-indigo-500 to-violet-600 text-white border-0 hover:from-indigo-400 hover:to-violet-500 shadow-md shadow-indigo-500/20"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                setError(null);
                try {
                  await signup(email, password);
                  router.push('/dashboard');
                } catch (e: any) {
                  setError(e?.message ?? 'Signup failed');
                } finally {
                  setLoading(false);
                }
              }}
            >
              {loading ? 'Creating…' : 'Create account'}
            </Button>
            <div className="text-center text-[13px] text-slate-500">
              Already have an account?{' '}
              <a className="text-indigo-400 hover:text-indigo-300 transition-colors" href="/login">
                Sign in
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
