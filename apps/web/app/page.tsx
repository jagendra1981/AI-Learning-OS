import Link from 'next/link';
import { PublicGate } from '../components/route-gate';

export default function HomePage() {
  return (
    <PublicGate>
      <header className="site-nav">
        <Link className="site-brand" href="/">
          <span className="site-brand-mark">✦</span>
          <span>AI Learning OS</span>
        </Link>
        <nav className="site-nav-links" aria-label="Primary navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#why-it-works">Why it works</a>
          <Link href="/login">Sign in</Link>
          <Link className="nav-cta" href="/register">Get started <span aria-hidden="true">→</span></Link>
        </nav>
      </header>
      <main className="landing-page">
        <section className="hero hero-modern">
          <div className="hero-copy">
            <div className="launch-badge"><span className="badge-dot" />A calmer way to get better at hard things</div>
            <h1>Make your learning <em>compounding.</em></h1>
            <p className="hero-lede">AI Learning OS turns every answer, mistake, and moment of doubt into a clear next step — so you always know what to do next.</p>
            <div className="actions"><Link className="button" href="/register">Start learning free</Link><Link className="button secondary" href="/login">Open your workspace</Link></div>
            <div className="trust-line"><span>✦</span> Adaptive practice <span>✦</span> AI tutor <span>✦</span> Progress you can feel</div>
          </div>
          <div className="hero-visual" aria-label="Learning progress preview">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            <div className="focus-card"><div className="card-top"><span className="mini-label">TODAY&apos;S FOCUS</span><span className="card-menu">•••</span></div><strong>Algebraic thinking</strong><p className="card-caption">Build the skill behind the answer.</p><div className="mini-progress"><span /></div><div className="card-bottom"><small>72% mastery</small><small>12 min</small></div></div>
            <div className="float-card"><span className="spark">✦</span><div><strong>Small steps, big gains.</strong><small>Consistency beats cramming.</small></div></div>
            <div className="streak-card"><span>7</span><div><strong>day streak</strong><small>You&apos;re building a habit.</small></div></div>
          </div>
        </section>
        <section className="landing-proof" id="how-it-works" aria-labelledby="why-northstar">
          <div><p className="eyebrow">ONE SYSTEM. LESS NOISE.</p><h2 id="why-northstar">Every session has a purpose.</h2><p className="muted">Your goals, practice, mistakes, and progress live together in one calm workspace. The system adapts as you do.</p></div>
          <div className="feature-grid"><article><span className="feature-number">01</span><h3>Find the gaps</h3><p>Start with a diagnostic that maps what you know and where confidence breaks down.</p></article><article><span className="feature-number">02</span><h3>Practice with intent</h3><p>Short, targeted sets keep the challenge right-sized and make time count.</p></article><article><span className="feature-number">03</span><h3>Build lasting recall</h3><p>Revision and mistake review bring the right ideas back at the right moment.</p></article></div>
        </section>
        <section className="quote-band" id="why-it-works">
          <p>“The goal isn’t to spend more time learning. It’s to make the time you already have count.”</p>
          <span>— The AI Learning OS approach</span>
        </section>
        <section className="landing-cta"><p className="eyebrow">YOUR NEXT BEST STEP IS WAITING</p><h2>Start with one focused session.</h2><Link className="button" href="/register">Create your learning OS <span aria-hidden="true">→</span></Link></section>
      </main>
    </PublicGate>
  );
}

