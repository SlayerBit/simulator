import { Zap, Shield, BarChart3, GitBranch, Clock, ArrowRight } from 'lucide-react';
import Link from 'next/link';

const features = [
  {
    icon: Zap,
    title: 'Failure Injection',
    desc: '13 failure types with 48+ methods targeting pods, deployments, network policies, and more.',
    color: 'from-amber-500 to-orange-600',
  },
  {
    icon: Shield,
    title: 'Safety First',
    desc: 'Namespace restrictions, kill switch, concurrency limits, dry-run mode, and automatic rollback.',
    color: 'from-emerald-500 to-teal-600',
  },
  {
    icon: BarChart3,
    title: 'Observability',
    desc: 'Built-in Prometheus metrics, Grafana dashboards, and Loki log aggregation.',
    color: 'from-indigo-500 to-violet-600',
  },
  {
    icon: GitBranch,
    title: 'Dependency Mapping',
    desc: 'Visualize service dependencies and understand blast radius before injection.',
    color: 'from-pink-500 to-rose-600',
  },
  {
    icon: Clock,
    title: 'Scheduling',
    desc: 'Cron-based scheduling with templates for recurring chaos experiments.',
    color: 'from-cyan-500 to-blue-600',
  },
  {
    icon: BarChart3,
    title: 'Audit Trail',
    desc: 'Complete audit log of every simulation, action, and recovery event.',
    color: 'from-purple-500 to-fuchsia-600',
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 overflow-hidden">
      {/* Hero */}
      <div className="relative">
        {/* Background gradient orbs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-indigo-500/10 blur-3xl" />
          <div className="absolute top-60 -left-40 h-[400px] w-[400px] rounded-full bg-violet-500/8 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-16">
          <div className="animate-fade-in-up text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-700/50 bg-slate-800/40 px-4 py-1.5 text-[13px] text-slate-300 mb-6 backdrop-blur-sm">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse-soft" />
              Production-Ready Chaos Engineering
            </div>
            <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-tight">
              <span className="bg-gradient-to-r from-slate-100 via-slate-200 to-slate-300 bg-clip-text text-transparent">Cloud Failure</span>{' '}
              <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-purple-400 bg-clip-text text-transparent animate-gradient">Simulator</span>
            </h1>
            <p className="mt-5 text-lg text-slate-400 leading-relaxed max-w-2xl mx-auto">
              Safe, reversible failure injection for Kubernetes workloads. Build resilience through controlled chaos experiments with automatic rollback and comprehensive observability.
            </p>
            <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-6 py-2.5 text-sm font-medium text-white shadow-lg shadow-indigo-500/25 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/30 hover:from-indigo-400 hover:to-violet-500"
              >
                Sign In <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700/60 bg-slate-800/40 px-6 py-2.5 text-sm font-medium text-slate-200 backdrop-blur-sm transition-all duration-200 hover:bg-slate-800/70 hover:border-slate-600/60"
              >
                Create Account
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium text-slate-400 transition-all duration-200 hover:text-slate-200"
              >
                Dashboard →
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Features */}
      <section className="relative mx-auto max-w-6xl px-6 pb-20">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <div
              key={f.title}
              className={`group rounded-xl border border-slate-800/50 bg-slate-900/30 p-6 backdrop-blur-sm transition-all duration-300 hover:border-slate-700/60 hover:bg-slate-900/50 hover:-translate-y-0.5 animate-fade-in stagger-${i + 1}`}
            >
              <div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br ${f.color} shadow-lg mb-4`}>
                <f.icon className="h-5 w-5 text-white" />
              </div>
              <h3 className="text-sm font-semibold text-slate-100 mb-1.5">{f.title}</h3>
              <p className="text-[13px] text-slate-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
