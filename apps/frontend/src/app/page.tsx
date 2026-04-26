import Link from 'next/link'
import { Logo } from '@/components/Logo'
import { PLANS, PLAN_ORDER } from '@/lib/plans'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-slate-900">
      {/* Navigation */}
      <nav className="border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white">
                <Logo className="w-full h-full" />
              </div>
              <span className="text-xl font-bold text-white tracking-tight">Eavesight</span>
            </div>
            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-slate-400 hover:text-white transition-colors text-sm font-medium">Features</a>
              <a href="#how-it-works" className="text-slate-400 hover:text-white transition-colors text-sm font-medium">How It Works</a>
              <a href="#pricing" className="text-slate-400 hover:text-white transition-colors text-sm font-medium">Pricing</a>
              <Link href="/login" className="text-slate-300 hover:text-white transition-colors text-sm font-medium">Sign In</Link>
              <Link href="/signup" className="btn-primary text-sm">
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-6 py-24 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-slate-800/50 border border-slate-700 text-slate-300 px-4 py-2 rounded-full text-sm font-medium mb-8">
            <span className="w-2 h-2 bg-accent-500 rounded-full animate-pulse"></span>
            Now in Beta — First 100 users get 3 months free
          </div>

          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-6 leading-tight tracking-tight">
            The Right Tool to Find Your Next{' '}
            <span className="text-gradient">Roofing Job</span>
          </h1>

          <p className="text-lg md:text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            Damage intelligence made simple. Storm data, roof age, property value, and owner
            info in one platform — so you show up first, prepared, and close more jobs.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/signup" className="btn-accent text-base w-full sm:w-auto">
              See Your Area Free
            </Link>
            <Link href="/demo" className="flex items-center justify-center gap-2 text-slate-400 hover:text-white transition-colors text-sm font-medium w-full sm:w-auto py-3">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Watch Demo
            </Link>
          </div>
        </div>

        {/* Hero Visual - Real Map */}
        <div className="mt-20 max-w-5xl mx-auto">
          <div className="bg-slate-800/50 rounded-2xl border border-slate-700/50 overflow-hidden shadow-card">
            <div className="bg-slate-800 px-4 py-3 flex items-center gap-2 border-b border-slate-700/50">
              <div className="w-3 h-3 bg-red-500/80 rounded-full"></div>
              <div className="w-3 h-3 bg-yellow-500/80 rounded-full"></div>
              <div className="w-3 h-3 bg-green-500/80 rounded-full"></div>
              <div className="flex-1 text-center text-sm text-slate-500">app.eavesight.com</div>
            </div>

            {/* Real Map - Road map fading into satellite with overlay */}
            <div className="relative h-[500px] overflow-hidden rounded-b-xl">
              {/* Road map - darkened, zoomed in 30%, and at bottom layer */}
              <img
                src="/maps/road-map-new.webp"
                alt="Road Map"
                className="absolute inset-0 w-full h-full object-cover"
                style={{ zIndex: 1, filter: 'brightness(0.5) contrast(1.1)', transform: 'scale(1.3)', transformOrigin: 'center' }}
              />

              {/* Dark gradient overlay on satellite side */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  zIndex: 2,
                  background: 'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.2) 30%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,0.6) 100%)',
                  transform: 'scale(1.3)',
                  transformOrigin: 'center'
                }}
              />

              {/* Satellite - on top, masked to fade from left (road map) to right (satellite) */}
              <img
                src="/maps/satellite-new.webp"
                alt="Satellite View"
                className="absolute inset-0 w-full h-full object-cover"
                style={{
                  zIndex: 3,
                  maskImage: 'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.1) 25%, rgba(0,0,0,0.4) 50%, black 75%)',
                  WebkitMaskImage: 'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.1) 25%, rgba(0,0,0,0.4) 50%, black 75%)',
                  transform: 'scale(1.3)',
                  transformOrigin: 'center'
                }}
              />

              {/* Reverse starfield rain - angled streaming away from viewer */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 10 }}>
                <div className="absolute w-0.5 h-6 animate-rain-away" style={{ top: '5%', left: '12%', animationDelay: '0s', background: 'linear-gradient(to bottom, rgba(147, 197, 253, 0) 0%, rgba(147, 197, 253, 0.3) 100%)', transform: 'rotate(15deg)' }}></div>
                <div className="absolute w-0.5 h-5 animate-rain-away" style={{ top: '8%', left: '25%', animationDelay: '0.3s', background: 'linear-gradient(to bottom, rgba(147, 197, 253, 0) 0%, rgba(147, 197, 253, 0.25) 100%)', transform: 'rotate(15deg)' }}></div>
                <div className="absolute w-0.5 h-6 animate-rain-away" style={{ top: '3%', left: '38%', animationDelay: '0.6s', background: 'linear-gradient(to bottom, rgba(147, 197, 253, 0) 0%, rgba(147, 197, 253, 0.3) 100%)', transform: 'rotate(15deg)' }}></div>
                <div className="absolute w-0.5 h-5 animate-rain-away" style={{ top: '10%', left: '52%', animationDelay: '0.1s', background: 'linear-gradient(to bottom, rgba(147, 197, 253, 0) 0%, rgba(147, 197, 253, 0.25) 100%)', transform: 'rotate(15deg)' }}></div>
                <div className="absolute w-0.5 h-6 animate-rain-away" style={{ top: '6%', left: '65%', animationDelay: '0.4s', background: 'linear-gradient(to bottom, rgba(147, 197, 253, 0) 0%, rgba(147, 197, 253, 0.3) 100%)', transform: 'rotate(15deg)' }}></div>
                <div className="absolute w-0.5 h-5 animate-rain-away" style={{ top: '12%', left: '78%', animationDelay: '0.7s', background: 'linear-gradient(to bottom, rgba(147, 197, 253, 0) 0%, rgba(147, 197, 253, 0.25) 100%)', transform: 'rotate(15deg)' }}></div>
                <div className="absolute w-0.5 h-6 animate-rain-away" style={{ top: '4%', left: '88%', animationDelay: '0.2s', background: 'linear-gradient(to bottom, rgba(147, 197, 253, 0) 0%, rgba(147, 197, 253, 0.3) 100%)', transform: 'rotate(15deg)' }}></div>
                <div className="absolute w-0.5 h-5 animate-rain-away" style={{ top: '9%', left: '18%', animationDelay: '0.5s', background: 'linear-gradient(to bottom, rgba(147, 197, 253, 0) 0%, rgba(147, 197, 253, 0.25) 100%)', transform: 'rotate(15deg)' }}></div>
                <div className="absolute w-0.5 h-6 animate-rain-away" style={{ top: '7%', left: '42%', animationDelay: '0.8s', background: 'linear-gradient(to bottom, rgba(147, 197, 253, 0) 0%, rgba(147, 197, 253, 0.3) 100%)', transform: 'rotate(15deg)' }}></div>
                <div className="absolute w-0.5 h-5 animate-rain-away" style={{ top: '11%', left: '55%', animationDelay: '0.15s', background: 'linear-gradient(to bottom, rgba(147, 197, 253, 0) 0%, rgba(147, 197, 253, 0.25) 100%)', transform: 'rotate(15deg)' }}></div>
                <div className="absolute w-0.5 h-6 animate-rain-away" style={{ top: '5%', left: '32%', animationDelay: '0.45s', background: 'linear-gradient(to bottom, rgba(147, 197, 253, 0) 0%, rgba(147, 197, 253, 0.3) 100%)', transform: 'rotate(15deg)' }}></div>
                <div className="absolute w-0.5 h-5 animate-rain-away" style={{ top: '8%', left: '72%', animationDelay: '0.75s', background: 'linear-gradient(to bottom, rgba(147, 197, 253, 0) 0%, rgba(147, 197, 253, 0.25) 100%)', transform: 'rotate(15deg)' }}></div>
                <div className="absolute w-0.5 h-6 animate-rain-away" style={{ top: '6%', left: '8%', animationDelay: '0.25s', background: 'linear-gradient(to bottom, rgba(147, 197, 253, 0) 0%, rgba(147, 197, 253, 0.3) 100%)', transform: 'rotate(15deg)' }}></div>
                <div className="absolute w-0.5 h-5 animate-rain-away" style={{ top: '10%', left: '95%', animationDelay: '0.55s', background: 'linear-gradient(to bottom, rgba(147, 197, 253, 0) 0%, rgba(147, 197, 253, 0.25) 100%)', transform: 'rotate(15deg)' }}></div>
                <div className="absolute w-0.5 h-6 animate-rain-away" style={{ top: '3%', left: '58%', animationDelay: '0.85s', background: 'linear-gradient(to bottom, rgba(147, 197, 253, 0) 0%, rgba(147, 197, 253, 0.3) 100%)', transform: 'rotate(15deg)' }}></div>
              </div>

              {/* Lightning flash overlay */}
              <div className="absolute inset-0 bg-white/10 animate-lightning pointer-events-none" style={{ zIndex: 11 }}></div>

              {/* Leads sparkle wave */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 20 }}>
                {[
                  { top: 15, left: 20, size: 1.6 }, { top: 25, left: 45, size: 0.7 }, { top: 30, left: 70, size: 0.8 },
                  { top: 18, left: 55, size: 0.9 }, { top: 40, left: 30, size: 0.6 }, { top: 35, left: 85, size: 0.7 },
                  { top: 22, left: 10, size: 0.8 }, { top: 45, left: 60, size: 0.6 }, { top: 28, left: 35, size: 0.9 },
                  { top: 50, left: 15, size: 0.7 }, { top: 32, left: 75, size: 0.6 }, { top: 38, left: 50, size: 0.8 },
                  { top: 55, left: 40, size: 0.9 }, { top: 42, left: 80, size: 0.7 }, { top: 20, left: 65, size: 0.8 },
                  { top: 48, left: 25, size: 0.6 }, { top: 33, left: 90, size: 0.7 }, { top: 58, left: 55, size: 0.6 },
                  { top: 25, left: 38, size: 0.9 }, { top: 52, left: 72, size: 0.8 }, { top: 36, left: 12, size: 1.4 },
                  { top: 60, left: 85, size: 0.7 }, { top: 30, left: 48, size: 0.9 }, { top: 44, left: 20, size: 0.6 },
                  { top: 65, left: 35, size: 0.8 }, { top: 38, left: 62, size: 0.7 }, { top: 28, left: 78, size: 0.9 },
                  { top: 55, left: 8, size: 0.6 }, { top: 42, left: 55, size: 0.8 }, { top: 70, left: 68, size: 0.7 },
                  { top: 33, left: 25, size: 0.6 }, { top: 48, left: 42, size: 0.9 }, { top: 62, left: 18, size: 0.8 },
                  { top: 36, left: 88, size: 0.7 }, { top: 50, left: 35, size: 1.5 }, { top: 72, left: 52, size: 0.6 },
                  { top: 40, left: 70, size: 0.8 }, { top: 58, left: 28, size: 0.7 }, { top: 45, left: 92, size: 0.6 },
                  { top: 68, left: 15, size: 0.9 }, { top: 35, left: 55, size: 0.7 }, { top: 75, left: 78, size: 0.8 },
                  { top: 52, left: 45, size: 0.6 }, { top: 38, left: 32, size: 0.9 }, { top: 63, left: 60, size: 0.7 },
                  { top: 47, left: 18, size: 0.6 }
                ].map((dot, i) => (
                  <div
                    key={i}
                    className="absolute rounded-full animate-diamond-flash"
                    style={{
                      top: `${dot.top}%`,
                      left: `${dot.left}%`,
                      width: `${dot.size * 8}px`,
                      height: `${dot.size * 8}px`,
                      animationDelay: `${i * 0.02}s`,
                      backgroundColor: 'rgb(52, 211, 153)',
                      boxShadow: '0 0 3px 1px rgba(52, 211, 153, 0.4)',
                    }}
                  />
                ))}
              </div>

              {/* Floating UI overlay - updated with property card */}
              <div className="absolute top-4 left-4 right-4 pointer-events-none" style={{ zIndex: 15 }}>
                <div className="bg-slate-800/95 backdrop-blur-sm rounded-lg border border-slate-700/50 px-4 py-2 flex items-center gap-4 shadow-lg max-w-xl mx-auto">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-gradient-to-br from-primary-500 to-primary-600 rounded flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </div>
                    <span className="text-white font-medium text-sm">Eavesight</span>
                  </div>
                  <div className="flex-1 flex items-center gap-2 bg-slate-700/50 rounded-md px-3 py-1.5">
                    <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <span className="text-slate-400 text-sm">Huntsville, AL area</span>
                  </div>
                  <span className="text-xs text-slate-400 bg-red-500/20 px-2 py-1 rounded border border-red-500/30">5 Active Storms</span>
                </div>
              </div>

              {/* Property card overlay */}
              <div className="absolute top-20 right-8 pointer-events-none hidden md:block" style={{ zIndex: 25 }}>
                <div className="bg-slate-800/95 backdrop-blur-sm rounded-lg border border-slate-700/50 p-4 shadow-lg w-56">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-500">Lead Score</span>
                    <span className="text-sm font-bold text-green-400 bg-green-500/10 px-2 py-0.5 rounded">87/100</span>
                  </div>
                  <div className="text-sm text-white font-medium mb-1">1423 Oakwood Dr</div>
                  <div className="space-y-1 text-xs text-slate-400">
                    <div className="flex justify-between"><span>Roof Age</span><span className="text-slate-300">18 years</span></div>
                    <div className="flex justify-between"><span>Last Hail</span><span className="text-red-400">Mar 2026</span></div>
                    <div className="flex justify-between"><span>Value</span><span className="text-slate-300">$285,000</span></div>
                    <div className="flex justify-between"><span>Owner</span><span className="text-slate-300">J. Williams</span></div>
                  </div>
                </div>
              </div>

              {/* Custom storm markers overlay */}
              <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 16 }}>
                <div className="absolute top-[35%] left-[55%] w-6 h-6 bg-red-500 rounded-full border-2 border-white/50 shadow-lg flex items-center justify-center animate-pin-hit" style={{ animationDelay: '0.2s' }}>
                  <span className="text-white text-xs font-bold">1</span>
                </div>
                <div className="absolute top-[45%] left-[25%] w-6 h-6 bg-red-500 rounded-full border-2 border-white/50 shadow-lg flex items-center justify-center animate-pin-hit" style={{ animationDelay: '0.4s' }}>
                  <span className="text-white text-xs font-bold">2</span>
                </div>
                <div className="absolute top-[60%] left-[70%] w-6 h-6 bg-orange-500 rounded-full border-2 border-white/50 shadow-lg flex items-center justify-center animate-pin-hit" style={{ animationDelay: '0.6s' }}>
                  <span className="text-white text-xs font-bold">3</span>
                </div>
                <div className="absolute top-[25%] left-[75%] w-6 h-6 bg-red-500 rounded-full border-2 border-white/50 shadow-lg flex items-center justify-center animate-pin-hit" style={{ animationDelay: '0.3s' }}>
                  <span className="text-white text-xs font-bold">4</span>
                </div>
                <div className="absolute top-[50%] left-[40%] w-6 h-6 bg-yellow-500 rounded-full border-2 border-white/50 shadow-lg flex items-center justify-center animate-pin-hit" style={{ animationDelay: '0.5s' }}>
                  <span className="text-white text-xs font-bold">5</span>
                </div>
              </div>

              {/* Stats overlay */}
              <div className="absolute bottom-4 left-4 right-4 pointer-events-none" style={{ zIndex: 15 }}>
                <div className="bg-slate-800/95 backdrop-blur-sm rounded-lg border border-slate-700/50 px-4 py-3 shadow-lg flex items-center justify-between max-w-md mx-auto">
                  <div className="flex items-center gap-6">
                    <div className="text-center">
                      <p className="text-xl font-bold text-red-400">47</p>
                      <p className="text-xs text-slate-400">New Leads</p>
                    </div>
                    <div className="w-px h-8 bg-slate-600"></div>
                    <div className="text-center">
                      <p className="text-xl font-bold text-blue-400">203</p>
                      <p className="text-xs text-slate-400">Properties</p>
                    </div>
                    <div className="w-px h-8 bg-slate-600"></div>
                    <div className="text-center">
                      <p className="text-xl font-bold text-accent-400">12</p>
                      <p className="text-xs text-slate-400">Priority</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Value Props - 4 cards */}
      <section className="border-y border-slate-800 py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Know First */}
            <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-6 text-center">
              <div className="w-12 h-12 bg-primary-500/10 rounded-xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Know First</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Real-time storm alerts and property-level damage scoring. Be the first roofer on the scene, every time.
              </p>
            </div>

            {/* See Everything */}
            <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-6 text-center">
              <div className="w-12 h-12 bg-primary-500/10 rounded-xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">See Everything</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Roof age, material type, property value, owner info, tax history — all before you leave the truck.
              </p>
            </div>

            {/* Beyond the Storm */}
            <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-6 text-center">
              <div className="w-12 h-12 bg-accent-500/10 rounded-xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Beyond the Storm</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                78% of roofs are replaced for non-weather reasons. Aging roofs, home sales, insurance gaps — leads your competitors miss.
              </p>
            </div>

            {/* One Platform */}
            <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-6 text-center">
              <div className="w-12 h-12 bg-green-500/10 rounded-xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">One Platform, Not Five</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Storm data, property intel, lead scoring, canvassing routes, and CRM integration. Replace $900+/mo in fragmented tools.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-24 bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              How Eavesight Works
            </h2>
            <p className="text-slate-400 text-lg">
              From data to deals in three steps
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 relative">
            {/* Step 1 */}
            <div className="relative">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-8 h-8 bg-primary-500 rounded-full flex items-center justify-center text-white font-bold text-sm z-10">1</div>
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 text-center">
                <div className="w-16 h-16 bg-primary-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <svg className="w-8 h-8 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-white mb-3">Set Your Territory</h3>
                <p className="text-slate-400 text-sm">
                  Enter your service area. We scan 243,000+ properties and cross-reference storm data, roof age, and market signals in real time.
                </p>
              </div>
            </div>


            {/* Step 2 */}
            <div className="relative">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-8 h-8 bg-accent-500 rounded-full flex items-center justify-center text-white font-bold text-sm z-10">2</div>
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 text-center">
                <div className="w-16 h-16 bg-accent-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <svg className="w-8 h-8 text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-white mb-3">Get Scored Leads</h3>
                <p className="text-slate-400 text-sm">
                  Every property gets a 0-100 score based on damage probability, roof age, property value, and owner profile. Filter by what matters to you.
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="relative">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white font-bold text-sm z-10">3</div>
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 text-center">
                <div className="w-16 h-16 bg-green-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-white mb-3">Close More Jobs</h3>
                <p className="text-slate-400 text-sm">
                  Owner name, mailing address, optimized door-knocking route — everything you need to show up prepared and win the job.
                </p>
              </div>
            </div>
          </div>

          <div className="text-center mt-12">
            <Link href="/signup" className="btn-primary inline-flex items-center gap-2">
              Start Finding Leads
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section - 6 specific cards */}
      <section id="features" className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              The Data That Wins Jobs
            </h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">
              Six layers of intelligence your competitors don't have
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Feature 1: 3-Source Storm Triangulation */}
            <div className="card p-6">
              <div className="w-10 h-10 bg-red-500/10 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">NOAA-Powered Storm Intelligence</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Three NOAA sources at every address — ground-confirmed storm reports, 1km radar hail detection, and post-storm damage surveys from NWS field teams.
              </p>
            </div>

            {/* Feature 2: Roof Age Intelligence */}
            <div className="card p-6">
              <div className="w-10 h-10 bg-amber-500/10 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Roof Age Intelligence</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Year built, material type, square footage — know which roofs are due for replacement before the homeowner does.
              </p>
            </div>

            {/* Feature 3: Property-Level Lead Scoring */}
            <div className="card p-6">
              <div className="w-10 h-10 bg-green-500/10 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Property-Level Lead Scoring</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                0-100 score combining storm damage, roof age, property value, and owner profile. Focus on the doors most likely to say yes.
              </p>
            </div>

            {/* Feature 4: Smart Canvassing Routes */}
            <div className="card p-6">
              <div className="w-10 h-10 bg-primary-500/10 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Smart Canvassing Routes</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Optimized door-knocking routes that navigate to the highest-scored properties first. Stop wasting drives on cold doors.
              </p>
            </div>

            {/* Feature 5: Owner Intelligence */}
            <div className="card p-6">
              <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Owner Intelligence</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Name, mailing address, property type, tax status, assessed value — skip the skip-trace and show up informed.
              </p>
            </div>

            {/* Feature 6: Non-Weather Triggers */}
            <div className="card p-6">
              <div className="w-10 h-10 bg-accent-500/10 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Non-Weather Triggers</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Aging roofs, recent home sales, insurance non-renewals — the 78% of roof replacement leads your competitors don't even know exist.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof Stats - Real Data */}
      <section className="border-y border-slate-800 py-16">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <p className="text-4xl font-bold text-white">243K+</p>
              <p className="text-slate-500 text-sm mt-1">Properties Analyzed</p>
            </div>
            <div>
              <p className="text-4xl font-bold text-white">2M+</p>
              <p className="text-slate-500 text-sm mt-1">Storm Events Tracked</p>
            </div>
            <div>
              <p className="text-4xl font-bold text-white">34K+</p>
              <p className="text-slate-500 text-sm mt-1">Damage Surveys Mapped</p>
            </div>
            <div>
              <p className="text-4xl font-bold text-white">3</p>
              <p className="text-slate-500 text-sm mt-1">Counties Covered</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      {/* ─── PRICING ─────────────────────────────────────────────────────────── */}
      {/* Tier cards below are rendered from apps/frontend/src/lib/plans.ts
          (mirrored to apps/backend/src/common/plans.ts). To change a price,
          quota, feature label, or overage rate, edit BOTH files. Settings →
          Billing tab reads the same PLANS constant so the marketing site and
          in-app upgrade screen can never drift apart. */}
      <section id="pricing" className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              One Tool. Whole Pipeline.
            </h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">
              Stop paying $900/mo for fragmented tools. Eavesight replaces your storm tracker, property intel, lead scoring, and CRM — for less than the cost of one roofing job.
            </p>
            <p className="text-slate-500 text-sm mt-3 max-w-2xl mx-auto">
              Each tier unlocks new workflow features — not just more reveals. Pick the smallest tier that has the team-size and tooling you need.
            </p>
          </div>

          {/* ── 4-tier grid (Scout / Business / Pro / Enterprise) ── */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">
            {PLAN_ORDER.map((code) => {
              const plan = PLANS[code]
              const isFeatured = !!plan.highlight
              const cardClasses = isFeatured
                ? 'card p-6 border-cyan-500/40 relative flex flex-col'
                : 'card p-6 flex flex-col'
              const ctaClasses = isFeatured
                ? 'block text-center bg-cyan-600 hover:bg-cyan-500 text-white px-6 py-3 rounded-xl font-bold transition-colors text-sm mt-auto shadow-lg shadow-cyan-500/20'
                : plan.code === 'ENTERPRISE'
                  ? 'block text-center bg-slate-700 hover:bg-slate-600 text-white px-6 py-3 rounded-xl font-semibold transition-colors text-sm mt-auto'
                  : 'block text-center bg-slate-800 border border-slate-700 text-white px-6 py-3 rounded-xl font-semibold hover:bg-slate-700 hover:border-slate-600 transition-all text-sm mt-auto'
              return (
                <div key={plan.code} className={cardClasses} style={isFeatured ? { overflow: 'visible' } : undefined}>
                  {isFeatured && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-cyan-500 text-white text-xs px-4 py-1.5 rounded-full font-bold z-50 shadow-lg whitespace-nowrap">
                      Most Popular
                    </div>
                  )}
                  <div className="flex-grow">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
                    </div>
                    <p className="text-slate-500 text-sm mb-4">{plan.tagline}</p>
                    <div className="mb-5">
                      <span className="text-4xl font-bold text-white">{plan.priceDisplay}</span>
                      {plan.priceMonthly > 0 && <span className="text-slate-500 text-sm ml-1">/month</span>}
                    </div>
                    <div className="bg-slate-800/40 rounded-lg px-3 py-2 mb-5 text-xs text-slate-400">
                      <div><span className="text-slate-300 font-medium">{plan.revealQuota.toLocaleString()}</span> reveals included</div>
                      {plan.revealOverageDisplay && <div className="text-slate-500 mt-0.5">{plan.revealOverageDisplay}</div>}
                    </div>
                    <ul className="space-y-2 mb-6">
                      {plan.features.map((f) => (
                        <li key={f.label} className="flex items-start gap-2.5 text-slate-400 text-sm">
                          {f.status === 'soon' ? (
                            <span className="w-4 h-4 mt-0.5 shrink-0 rounded-full border border-amber-500/60 inline-block" />
                          ) : (
                            <svg className={`w-4 h-4 mt-0.5 shrink-0 ${isFeatured ? 'text-cyan-500' : 'text-emerald-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                          <span>
                            {f.label}
                            {f.status === 'soon' && <span className="ml-1 text-amber-400 text-xs">(coming soon)</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="text-xs text-slate-600 mb-4">
                      <span className="text-slate-500">{plan.priceFinePrint}</span>
                    </div>
                  </div>
                  <Link href={plan.ctaHref} className={ctaClasses}>
                    {plan.ctaLabel}
                  </Link>
                </div>
              )
            })}
          </div>

          {/* ── Old hand-coded tier blocks below were replaced by the data-driven
                grid above. The legacy markup follows so we can drop it after a
                visual review. Wrapped in `false &&` to keep the JSX valid until
                someone confirms the new layout looks right and we delete it. ── */}
          <div className="hidden">
            {/* legacy:start */}
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">

            {/* ── Scout (Free) ── */}
            <div className="card p-6 flex flex-col">
              <div className="flex-grow">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-lg font-semibold text-white">Scout</h3>
                </div>
                <p className="text-slate-500 text-sm mb-4">Try it before you buy it</p>
                <div className="mb-5">
                  <span className="text-4xl font-bold text-white">Free</span>
                </div>

                {/* Value callout */}
                <div className="bg-slate-800/60 rounded-xl p-4 mb-5 border border-slate-700/50">
                  <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-1">Perfect for</p>
                  <p className="text-sm text-slate-300">Checking if a storm actually hit your area before you drive out there</p>
                </div>

                <ul className="space-y-2.5 mb-6">
                  {[
                    "See storm damage on a live map",
                    "County-wide storm alerts",
                    "5 property reveals/month",
                    "Basic property data (address, owner)",
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-slate-400 text-sm">
                      <svg className="w-4 h-4 text-slate-600 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>

                <div className="text-xs text-slate-600 mb-4">
                  <span className="text-slate-500">$0/mo &bull; No credit card</span>
                </div>
              </div>
              <Link href="/signup?plan=scout" className="block text-center bg-slate-800 border border-slate-700 text-white px-6 py-3 rounded-xl font-semibold hover:bg-slate-700 hover:border-slate-600 transition-all text-sm mt-auto">
                Start Free
              </Link>
            </div>

            {/* ── Pro ($249) — featured ── */}
            <div className="card p-6 border-cyan-500/40 relative flex flex-col" style={{ overflow: 'visible' }}>
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-cyan-500 text-white text-xs px-4 py-1.5 rounded-full font-bold z-50 shadow-lg whitespace-nowrap">
                Most Popular
              </div>
              <div className="flex-grow">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-lg font-semibold text-white">Pro</h3>
                  <span className="text-xs text-cyan-400 font-medium bg-cyan-500/10 px-2 py-0.5 rounded-full">Best Value</span>
                </div>
                <p className="text-slate-500 text-sm mb-4">For roofers who are serious about outbound</p>
                <div className="mb-5">
                  <span className="text-5xl font-bold text-white">$249</span>
                  <span className="text-slate-500 text-sm ml-1">/month</span>
                </div>

                {/* The math */}
                <div className="bg-cyan-500/8 rounded-xl p-4 mb-5 border border-cyan-500/20">
                  <p className="text-xs text-cyan-400 uppercase tracking-wider font-bold mb-1">What you get</p>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">200 property reveals</span>
                      <span className="text-slate-300 font-medium">$1.25/address</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Unlimited storm alerts</span>
                      <span className="text-slate-300 font-medium">Included</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Unlimited canvassing routes</span>
                      <span className="text-slate-300 font-medium">Included</span>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-cyan-500/20">
                    <p className="text-xs text-slate-500">1 closed job = <span className="text-emerald-400 font-semibold">56x your monthly cost</span></p>
                  </div>
                </div>

                <ul className="space-y-2.5 mb-6">
                  {[
                    "Property-level storm alerts (push)",
                    "200 property reveals/month",
                    "Full 0–100 lead scoring",
                    "Multi-county map access",
                    "Unlimited canvassing routes",
                    "Non-weather leads (roof age, home sales)",
                    "Owner name, phone, mailing address",
                    "15 roof measurement credits/mo",
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-slate-400 text-sm">
                      <svg className="w-4 h-4 text-cyan-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>

                <div className="text-xs text-slate-600 mb-4">
                  <span className="text-slate-500">$249/mo &bull; 14-day free trial &bull; No contract</span>
                </div>
              </div>
              <Link href="/signup?plan=pro" className="block text-center bg-cyan-600 hover:bg-cyan-500 text-white px-6 py-3 rounded-xl font-bold transition-colors text-sm mt-auto shadow-lg shadow-cyan-500/20">
                Start Free Trial
              </Link>
            </div>

            {/* ── Business ($99) ── */}
            <div className="card p-6 flex flex-col">
              <div className="flex-grow">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-lg font-semibold text-white">Business</h3>
                </div>
                <p className="text-slate-500 text-sm mb-4">For solo roofers and small crews</p>
                <div className="mb-5">
                  <span className="text-5xl font-bold text-white">$99</span>
                  <span className="text-slate-500 text-sm ml-1">/month</span>
                </div>

                {/* The math */}
                <div className="bg-slate-800/60 rounded-xl p-4 mb-5 border border-slate-700/50">
                  <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-1">Perfect for</p>
                  <p className="text-sm text-slate-300">Solo roofers doing 10–15 bids/week who need solid leads without the full stack</p>
                </div>

                <ul className="space-y-2.5 mb-6">
                  {[
                    "Zip-code level storm alerts",
                    "50 property reveals/month",
                    "Hot / Warm / Cold lead tiers",
                    "Full property map (1 county)",
                    "1 canvassing route/day",
                    "Owner name & mailing address",
                    "5 roof measurement credits/mo",
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-slate-400 text-sm">
                      <svg className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>

                <div className="text-xs text-slate-600 mb-4">
                  <span className="text-slate-500">$99/mo &bull; 14-day free trial &bull; No contract</span>
                </div>
              </div>
              <Link href="/signup?plan=starter" className="block text-center bg-slate-800 border border-slate-700 text-white px-6 py-3 rounded-xl font-semibold hover:bg-slate-700 hover:border-slate-600 transition-all text-sm mt-auto">
                Start Free Trial
              </Link>
            </div>
          </div>

          {/* ── Enterprise callout ── */}
          <div className="mt-6 max-w-5xl mx-auto">
            <div className="bg-gradient-to-r from-slate-800/80 to-slate-800/40 border border-slate-700/60 rounded-2xl p-6 flex flex-col md:flex-row items-center gap-6">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-lg font-semibold text-white">Enterprise</h3>
                  <span className="text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">For teams</span>
                </div>
                <p className="text-sm text-slate-400 mb-3">Multi-crew operations that need territory locking, team routing, GPS tracking, and white-glove support.</p>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <span className="text-slate-500">Unlimited property reveals</span>
                  <span className="text-slate-500">Custom scoring + API access</span>
                  <span className="text-slate-500">Territory locking</span>
                  <span className="text-slate-500">Team routing + GPS</span>
                  <span className="text-slate-500">40 roof measurement credits</span>
                  <span className="text-slate-500">Priority support</span>
                </div>
              </div>
              <Link href="/signup?plan=enterprise" className="shrink-0 block text-center bg-slate-700 hover:bg-slate-600 text-white px-6 py-3 rounded-xl font-semibold transition-colors text-sm">
                Talk to Sales
              </Link>
            </div>
          </div>
            {/* legacy:end */}
          </div>

          {/* ── Social proof bar ── */}
          <div className="mt-12 text-center">
            <p className="text-slate-600 text-sm mb-4">Trusted by roofing crews across the Southeast</p>
            <div className="flex flex-wrap justify-center gap-8 text-slate-500 text-sm">
              <span>✓ No per-user fees on any plan</span>
              <span>✓ Cancel anytime, no fees</span>
              <span>✓ 14-day free trial on all paid plans</span>
              <span>✓ Setup in under 5 minutes</span>
            </div>
          </div>
        </div>
      </section>

      {/* ─── HOW IT COMPARES ──────────────────────────────────────────────── */}
      <section className="py-20 border-y border-slate-800">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-white text-center mb-10">
            Still using spreadsheets and Google Maps?
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { bad: "Door-to-door with no intel", good: "Know the roof age, value, and storm history before you knock" },
              { bad: "Waiting for storm damage to show up", good: "Get alerts the morning after a storm hits" },
              { bad: "Chasing bad leads all day", good: "0–100 scoring tells you which doors to knock first" },
              { bad: "Paying $200–$400/lead for Google leads", good: "$1.25 per property with full owner data" },
              { bad: "5 different tools to manage your pipeline", good: "Everything in one place — map, scoring, routes, CRM" },
              { bad: "Guessing which neighborhoods got hit", good: "Property-level damage map shows exactly where to go" },
            ].map(({ bad, good }, i) => (
              <div key={i} className="flex items-start gap-3 bg-slate-800/40 border border-slate-700/40 rounded-xl p-4">
                <div className="shrink-0 mt-0.5">
                  <div className="w-5 h-5 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center">
                    <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mb-1.5">{bad}</p>
                <div className="flex items-start gap-1.5">
                  <svg className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <p className="text-xs text-slate-300">{good}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-24 bg-slate-900/50">
        <div className="max-w-3xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Frequently Asked Questions
            </h2>
            <p className="text-slate-400 text-lg">
              Everything you need to know about Eavesight
            </p>
          </div>

          <div className="space-y-4">
            {/* FAQ 1 */}
            <details className="bg-slate-800/50 border border-slate-700 rounded-lg group">
              <summary className="flex items-center justify-between p-6 cursor-pointer list-none">
                <span className="font-medium text-white">How does Eavesight find leads?</span>
                <svg className="w-5 h-5 text-slate-400 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <div className="px-6 pb-6 text-slate-400 text-sm">
                We cross-reference three NOAA data sources at every property address: ground-confirmed storm reports (hail size, wind, tornadoes), MRMS radar that detects hail at 1km resolution even when no one reports it, and NWS damage surveys where meteorologists walked the destruction path. We layer that with county property records — roof age, owner info, property value — and score every property 0-100 based on how likely it needs work. A 20-year-old roof that's taken multiple hailstorms scores very differently than a new roof with no storm history.
              </div>
            </details>

            {/* FAQ 2 */}
            <details className="bg-slate-800/50 border border-slate-700 rounded-lg group">
              <summary className="flex items-center justify-between p-6 cursor-pointer list-none">
                <span className="font-medium text-white">What areas do you cover?</span>
                <svg className="w-5 h-5 text-slate-400 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <div className="px-6 pb-6 text-slate-400 text-sm">
                We currently cover the North Alabama metro — Madison, Limestone, and Morgan counties (Huntsville, Athens, Decatur). Storm event data covers the entire United States. We're actively expanding to new markets and Enterprise customers can request priority access.
              </div>
            </details>

            {/* FAQ 3 */}
            <details className="bg-slate-800/50 border border-slate-700 rounded-lg group">
              <summary className="flex items-center justify-between p-6 cursor-pointer list-none">
                <span className="font-medium text-white">How is Eavesight different from other storm tools?</span>
                <svg className="w-5 h-5 text-slate-400 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <div className="px-6 pb-6 text-slate-400 text-sm">
                Most tools only track storms. Eavesight covers the full picture — storm damage AND the 78% of roof replacements that happen for non-weather reasons like aging, home sales, and insurance gaps. Plus we include property intelligence, owner data, lead scoring, and canvassing routes — replacing 5+ separate tools.
              </div>
            </details>

            {/* FAQ 4 */}
            <details className="bg-slate-800/50 border border-slate-700 rounded-lg group">
              <summary className="flex items-center justify-between p-6 cursor-pointer list-none">
                <span className="font-medium text-white">What data do I get per property?</span>
                <svg className="w-5 h-5 text-slate-400 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <div className="px-6 pb-6 text-slate-400 text-sm">
                Each property reveal includes: year built, roof type, material, square footage, owner name, mailing address, assessed property value, tax status, storm exposure history, and a 0-100 lead score. Pro and Enterprise plans include additional data like home sale history and insurance triggers.
              </div>
            </details>

            {/* FAQ 5 */}
            <details className="bg-slate-800/50 border border-slate-700 rounded-lg group">
              <summary className="flex items-center justify-between p-6 cursor-pointer list-none">
                <span className="font-medium text-white">Do I need to cancel my CRM?</span>
                <svg className="w-5 h-5 text-slate-400 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <div className="px-6 pb-6 text-slate-400 text-sm">
                No. Eavesight is the intelligence layer that feeds better leads into your existing workflow. We integrate with JobNimbus, AccuLynx, and other popular roofing CRMs. Keep what works — we just make your lead pipeline smarter.
              </div>
            </details>

            {/* FAQ 6 */}
            <details className="bg-slate-800/50 border border-slate-700 rounded-lg group">
              <summary className="flex items-center justify-between p-6 cursor-pointer list-none">
                <span className="font-medium text-white">How does pricing work?</span>
                <svg className="w-5 h-5 text-slate-400 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <div className="px-6 pb-6 text-slate-400 text-sm">
                Flat company pricing with no per-user fees. Property reveals are the metered value — each reveal unlocks the full owner details, contact info, and property data for one address. Pick the tier that fits your volume. All paid plans include a 14-day free trial.
              </div>
            </details>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 py-20">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-100 mb-4">
            See What Your Competitors Are Missing
          </h2>
          <p className="text-slate-300 text-lg mb-8 max-w-2xl mx-auto">
            Join the beta and get 3 months free. No credit card required.
          </p>
          <Link href="/signup" className="btn-accent inline-block">
            See Your Area Free
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-950 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-6 py-12">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-primary-600 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </div>
                <span className="text-lg font-bold text-white">Eavesight</span>
              </div>
              <p className="text-slate-500 text-sm">
                The intelligence platform for roofing professionals.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4 text-sm">Product</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#features" className="text-slate-500 hover:text-white transition-colors">Features</a></li>
                <li><a href="#pricing" className="text-slate-500 hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#how-it-works" className="text-slate-500 hover:text-white transition-colors">How It Works</a></li>
                <li><a href="/demo" className="text-slate-500 hover:text-white transition-colors">Demo</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4 text-sm">Company</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="/about" className="text-slate-500 hover:text-white transition-colors">About</a></li>
                <li><a href="/contact" className="text-slate-500 hover:text-white transition-colors">Contact</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4 text-sm">Legal</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="/privacy" className="text-slate-500 hover:text-white transition-colors">Privacy Policy</a></li>
                <li><a href="/terms" className="text-slate-500 hover:text-white transition-colors">Terms of Service</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-800 pt-8 text-center">
            <p className="text-slate-500 text-sm">2026 Eavesight. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
