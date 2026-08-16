'use client';
import { Shell } from '../../components/shell';
import { ProtectedGate } from '../../components/route-gate';
import Link from 'next/link';
export default function Dashboard() {
  return (
    <ProtectedGate ready>
      <Shell>
        <div className="page">
          <div className="dash-heading"><div><p className="eyebrow">MONDAY, 16 AUGUST</p><h1>Good morning, learner.</h1><p className="muted">A little progress today keeps your momentum alive.</p></div><Link className="button" href="/practice">Start a practice set <span>→</span></Link></div>
          <section className="stats-grid"><div className="stat-card accent"><span className="stat-icon">◒</span><small>Current streak</small><strong>7 days</strong><span className="trend">↑ 2 from last week</span></div><div className="stat-card"><span className="stat-icon green">✦</span><small>Weekly progress</small><strong>68%</strong><span className="trend">12 of 18 sessions</span></div><div className="stat-card"><span className="stat-icon orange">◷</span><small>Time learning</small><strong>4h 32m</strong><span className="trend">This week</span></div></section>
          <div className="dashboard-grid"><section className="card next-card"><div className="section-top"><div><p className="eyebrow">RECOMMENDED NEXT</p><h2>Keep your momentum</h2></div><span className="pill">12 min</span></div><p className="muted">A short adaptive set built from the ideas you’re currently strengthening.</p><div className="lesson-row"><div className="lesson-dot">∑</div><div><strong>Algebraic thinking</strong><small>4 questions · Medium</small></div><Link className="text-link" href="/practice">Begin →</Link></div></section><section className="card"><div className="section-top"><div><p className="eyebrow">YOUR WEEK</p><h2>Learning rhythm</h2></div><span className="muted small">This week</span></div><div className="bars" aria-label="Weekly activity"><i style={{height:'42%'}}/><i style={{height:'68%'}}/><i style={{height:'54%'}}/><i className="today-bar" style={{height:'88%'}}/><i style={{height:'62%'}}/><i style={{height:'30%'}}/><i style={{height:'18%'}}/></div><div className="bar-labels"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div></section></div>
          <section className="insight"><span className="insight-icon">✦</span><div><strong>Your learning insight</strong><p>You’re strongest when you practice in short, consistent sessions. Keep today’s set under 15 minutes.</p></div><Link className="text-link" href="/progress">View progress →</Link></section>
        </div>
      </Shell>
    </ProtectedGate>
  );
}
