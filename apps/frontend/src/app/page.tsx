import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-slate-900">
      {/* Navigation */}
      <nav className="border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-600 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                </svg>
              </div>
              <span className="text-xl font-bold text-white tracking-tight">StormVault</span>
            </div>
            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-slate-400 hover:text-white transition-colors text-sm font-medium">Features</a>
              <a href="#pricing" className="text-slate-400 hover:text-white transition-colors text-sm font-medium">Pricing</a>
              <a href="#about" className="text-slate-400 hover:text-white transition-colors text-sm font-medium">About</a>
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
            Find More Roofing Jobs with{' '}
            <span className="text-gradient">Storm Intelligence</span>
          </h1>
          
          <p className="text-lg md:text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            StormVault combines storm damage data, property insights, and lead management 
            into one powerful platform. Stop wasting hours researching leads.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/signup" className="btn-accent text-base w-full sm:w-auto">
              Start Free Trial
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
              <div className="flex-1 text-center text-sm text-slate-500">app.stormvault.com</div>
            </div>
            
            {/* Real Map - Embedded OSM */}
            <div className="relative h-[500px] bg-slate-900 overflow-hidden rounded-b-xl">
              <iframe 
                src="https://www.openstreetmap.org/export/embed.html?bbox=-87.0%2C34.2%2C-86.0%2C35.2&amp;layer=mapnik&amp;marker=34.73%2C-86.58" 
                width="100%" 
                height="100%" 
                frameBorder="0" 
                scrolling="no"
                title="StormVault Map"
                className="w-full h-full"
              />
              
              {/* Floating UI overlay */}
              <div className="absolute top-4 left-4 right-4 pointer-events-none">
                <div className="bg-slate-800/95 backdrop-blur-sm rounded-lg border border-slate-700/50 px-4 py-2 flex items-center gap-4 shadow-lg max-w-xl mx-auto">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-gradient-to-br from-primary-500 to-primary-600 rounded flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                      </svg>
                    </div>
                    <span className="text-white font-medium text-sm">StormVault</span>
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
              
              {/* Custom storm markers overlay */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-[35%] left-[55%] w-6 h-6 bg-red-500 rounded-full border-2 border-white/50 shadow-lg flex items-center justify-center animate-pulse">
                  <span className="text-white text-xs font-bold">1</span>
                </div>
                <div className="absolute top-[45%] left-[25%] w-6 h-6 bg-red-500 rounded-full border-2 border-white/50 shadow-lg flex items-center justify-center animate-pulse">
                  <span className="text-white text-xs font-bold">2</span>
                </div>
                <div className="absolute top-[60%] left-[70%] w-6 h-6 bg-orange-500 rounded-full border-2 border-white/50 shadow-lg flex items-center justify-center animate-pulse">
                  <span className="text-white text-xs font-bold">3</span>
                </div>
                <div className="absolute top-[25%] left-[75%] w-6 h-6 bg-red-500 rounded-full border-2 border-white/50 shadow-lg flex items-center justify-center animate-pulse">
                  <span className="text-white text-xs font-bold">4</span>
                </div>
                <div className="absolute top-[50%] left-[40%] w-6 h-6 bg-yellow-500 rounded-full border-2 border-white/50 shadow-lg flex items-center justify-center animate-pulse">
                  <span className="text-white text-xs font-bold">5</span>
                </div>
              </div>
              
              {/* Stats overlay */}
              <div className="absolute bottom-4 left-4 right-4 pointer-events-none">
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

      {/* Trusted By */}
      <section className="border-y border-slate-800">
        <div className="max-w-7xl mx-auto px-6 py-12">
          <p className="text-center text-slate-500 text-sm mb-8 uppercase tracking-wider font-medium">Trusted by roofing professionals across the U.S.</p>
          <div className="flex flex-wrap items-center justify-center gap-12 opacity-40">
            <div className="text-slate-400 font-semibold text-lg">Dallas, TX</div>
            <div className="text-slate-400 font-semibold text-lg">Denver, CO</div>
            <div className="text-slate-400 font-semibold text-lg">Oklahoma City</div>
            <div className="text-slate-400 font-semibold text-lg">Phoenix, AZ</div>
            <div className="text-slate-400 font-semibold text-lg">Minneapolis</div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Everything You Need to Find More Jobs
            </h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">
              StormVault integrates the data you need into one simple platform
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Feature 1 */}
            <div className="card p-6">
              <div className="w-10 h-10 bg-primary-500/10 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Storm Tracking</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                View historical hail and storm events overlaid on property maps. Know exactly which neighborhoods were hit and when.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="card p-6">
              <div className="w-10 h-10 bg-primary-500/10 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Property Insights</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Get instant access to property details including year built, roof age estimates, and ownership information.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="card p-6">
              <div className="w-10 h-10 bg-primary-500/10 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Lead Management</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Create, organize, and track leads from first contact to signed contract. Never lose a potential customer again.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="card p-6">
              <div className="w-10 h-10 bg-primary-500/10 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Interactive Maps</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Beautiful, easy-to-use map interface with parcel overlays, storm zones, and lead pins all in one view.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="card p-6">
              <div className="w-10 h-10 bg-primary-500/10 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Analytics Dashboard</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Track your performance with real-time metrics on leads generated, storms hit, and jobs closed.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="card p-6">
              <div className="w-10 h-10 bg-primary-500/10 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Export & Share</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Export leads to CSV, share team assignments, and integrate with your existing CRM tools.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="bg-slate-800/30 py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              How StormVault Works
            </h2>
            <p className="text-slate-400 text-lg">
              Three simple steps to more roofing jobs
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <div className="text-center">
              <div className="w-12 h-12 bg-slate-700 rounded-xl flex items-center justify-center text-xl font-bold text-white mx-auto mb-4">
                1
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Storm Hits</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                When a hail or wind storm passes through an area, StormVault automatically captures the data and maps the affected neighborhoods.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-slate-700 rounded-xl flex items-center justify-center text-xl font-bold text-white mx-auto mb-4">
                2
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">We Research</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                StormVault instantly pulls property records, roof age estimates, and ownership information for every affected address.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-slate-700 rounded-xl flex items-center justify-center text-xl font-bold text-white mx-auto mb-4">
                3
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">You Close</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Review prioritized leads in your dashboard, assign to your team, and start knocking doors with all the info you need.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Simple, Transparent Pricing
            </h2>
            <p className="text-slate-400 text-lg">
              Start for free, scale as you grow
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Starter Plan */}
            <div className="card p-8">
              <h3 className="text-lg font-semibold text-white mb-1">Starter</h3>
              <p className="text-slate-500 text-sm mb-4">Perfect for solo roofers</p>
              <div className="mb-4">
                <span className="text-4xl font-bold text-white">$49</span>
                <span className="text-slate-500">/month</span>
              </div>
              <p className="text-xs text-slate-500 mb-6">
                First 3 months at 50% off ($24.50/mo)
              </p>
              <ul className="space-y-3 mb-8">
                {['1 user account', '1 metro area', '500 property lookups/month', 'Basic storm data', 'Email support'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-slate-400 text-sm">
                    <svg className="w-4 h-4 text-accent-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
              <Link href="/signup?plan=starter" className="block text-center bg-slate-700 text-white px-6 py-3 rounded-lg font-medium hover:bg-slate-600 transition-colors text-sm">
                Get Started
              </Link>
            </div>

            {/* Professional Plan */}
            <div className="card p-8 border-primary-500/50 relative">
              <div className="bg-primary-500 text-white text-xs px-3 py-1 rounded-full font-medium inline-block mb-3">Most Popular</div>
              <h3 className="text-lg font-semibold text-white mb-1">Professional</h3>
              <p className="text-slate-500 text-sm mb-4">For growing teams</p>
              <div className="mb-4">
                <span className="text-4xl font-bold text-white">$149</span>
                <span className="text-slate-500">/month</span>
              </div>
              <p className="text-xs text-slate-500 mb-6">
                First 3 months at 50% off ($74.50/mo)
              </p>
              <ul className="space-y-3 mb-8">
                {['5 user accounts', '3 metro areas', '2,500 property lookups/month', 'Full storm + property data', 'Lead scoring', 'Priority support'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-slate-400 text-sm">
                    <svg className="w-4 h-4 text-accent-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
              <Link href="/signup?plan=professional" className="block text-center btn-primary text-sm">
                Get Started
              </Link>
            </div>

            {/* Enterprise Plan */}
            <div className="card p-8">
              <h3 className="text-lg font-semibold text-white mb-1">Enterprise</h3>
              <p className="text-slate-500 text-sm mb-4">For large organizations</p>
              <div className="mb-4">
                <span className="text-4xl font-bold text-white">$499</span>
                <span className="text-slate-500">/month</span>
              </div>
              <p className="text-xs text-slate-500 mb-6">
                First 3 months at 50% off ($249.50/mo)
              </p>
              <ul className="space-y-3 mb-8">
                {['Unlimited users', 'Nationwide coverage', '10,000 lookups/month', 'API access', 'Custom integrations', 'Dedicated support'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-slate-400 text-sm">
                    <svg className="w-4 h-4 text-accent-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
              <Link href="/signup?plan=enterprise" className="block text-center bg-slate-700 text-white px-6 py-3 rounded-lg font-medium hover:bg-slate-600 transition-colors text-sm">
                Contact Sales
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 py-20">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-100 mb-4">
            Ready to Find More Jobs?
          </h2>
          <p className="text-slate-300 text-lg mb-8 max-w-2xl mx-auto">
            Join the beta program today and get 3 months free. No credit card required.
          </p>
          <Link href="/signup" className="btn-accent inline-block">
            Start Your Free Trial
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
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                  </svg>
                </div>
                <span className="text-lg font-bold text-white">StormVault</span>
              </div>
              <p className="text-slate-500 text-sm">
                Roofing intelligence for the modern contractor.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4 text-sm">Product</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#features" className="text-slate-500 hover:text-white transition-colors">Features</a></li>
                <li><a href="#pricing" className="text-slate-500 hover:text-white transition-colors">Pricing</a></li>
                <li><a href="/demo" className="text-slate-500 hover:text-white transition-colors">Demo</a></li>
                <li><a href="/changelog" className="text-slate-500 hover:text-white transition-colors">Changelog</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4 text-sm">Company</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="/about" className="text-slate-500 hover:text-white transition-colors">About</a></li>
                <li><a href="/blog" className="text-slate-500 hover:text-white transition-colors">Blog</a></li>
                <li><a href="/careers" className="text-slate-500 hover:text-white transition-colors">Careers</a></li>
                <li><a href="/contact" className="text-slate-500 hover:text-white transition-colors">Contact</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4 text-sm">Legal</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="/privacy" className="text-slate-500 hover:text-white transition-colors">Privacy Policy</a></li>
                <li><a href="/terms" className="text-slate-500 hover:text-white transition-colors">Terms of Service</a></li>
                <li><a href="/security" className="text-slate-500 hover:text-white transition-colors">Security</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-800 pt-8 text-center">
            <p className="text-slate-500 text-sm">2026 StormVault. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
