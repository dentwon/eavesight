'use client';

import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { usePreferencesStore } from '@/stores/preferences';

interface UserProfile {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  organizationMemberships: Array<{
    role: string;
    organization: {
      id: string;
      name: string;
      plan: string;
      phone: string | null;
      website: string | null;
      address: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
    };
  }>;
}

export default function SettingsPage() {
  const { user, updateUser, logout } = useAuthStore();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activeTab, setActiveTab] = useState<'profile' | 'organization' | 'notifications' | 'billing' | 'preferences'>('profile');
  const mapTheme = usePreferencesStore((s) => s.mapTheme);
  const setMapTheme = usePreferencesStore((s) => s.setMapTheme);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Profile form
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');

  // Org form
  const [orgName, setOrgName] = useState('');
  const [orgPhone, setOrgPhone] = useState('');
  const [orgWebsite, setOrgWebsite] = useState('');
  const [orgAddress, setOrgAddress] = useState('');
  const [orgCity, setOrgCity] = useState('');
  const [orgState, setOrgState] = useState('');
  const [orgZip, setOrgZip] = useState('');

  // Notification preferences
  const [stormAlerts, setStormAlerts] = useState(true);
  const [leadUpdates, setLeadUpdates] = useState(true);
  const [weeklyDigest, setWeeklyDigest] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await api.get('/auth/me');
        const data = res.data;
        setProfile(data);
        setFirstName(data.firstName || '');
        setLastName(data.lastName || '');
        setEmail(data.email || '');

        const org = data.organizationMemberships?.[0]?.organization;
        if (org) {
          setOrgName(org.name || '');
          setOrgPhone(org.phone || '');
          setOrgWebsite(org.website || '');
          setOrgAddress(org.address || '');
          setOrgCity(org.city || '');
          setOrgState(org.state || '');
          setOrgZip(org.zip || '');
        }
      } catch (error) {
        console.error('Failed to fetch profile:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      await api.patch(`/users/${user?.id}`, { firstName, lastName, email });
      updateUser({ firstName, lastName, email });
      showMessage('success', 'Profile updated');
    } catch (error: any) {
      showMessage('error', error.response?.data?.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const saveOrganization = async () => {
    const orgId = profile?.organizationMemberships?.[0]?.organization?.id;
    if (!orgId) return;
    setSaving(true);
    try {
      await api.patch(`/orgs/${orgId}`, {
        name: orgName,
        phone: orgPhone,
        website: orgWebsite,
        address: orgAddress,
        city: orgCity,
        state: orgState,
        zip: orgZip,
      });
      showMessage('success', 'Organization updated');
    } catch (error: any) {
      showMessage('error', error.response?.data?.message || 'Failed to update organization');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (e) {
      // ignore
    }
    logout();
    window.location.href = '/login';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const tabs = [
    { key: 'profile', label: 'Profile' },
    { key: 'organization', label: 'Organization' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'billing', label: 'Billing' },
    { key: 'preferences', label: 'Preferences' },
  ] as const;

  const org = profile?.organizationMemberships?.[0];

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      {/* Message toast */}
      {message && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
          message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Profile Tab */}
      {activeTab === 'profile' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Your Profile</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                <input type="text" value={lastName} onChange={e => setLastName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <p className="text-sm text-gray-600">{user?.role || 'User'}</p>
            </div>
            <button onClick={saveProfile} disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Profile'}
            </button>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-200">
            <h3 className="text-sm font-semibold text-red-600 mb-2">Danger Zone</h3>
            <button onClick={handleLogout}
              className="px-4 py-2 bg-red-50 text-red-600 text-sm font-medium rounded-lg hover:bg-red-100 border border-red-200">
              Sign Out
            </button>
          </div>
        </div>
      )}

      {/* Organization Tab */}
      {activeTab === 'organization' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Organization</h2>
            {org && (
              <span className="px-3 py-1 bg-blue-50 text-blue-700 text-xs font-semibold rounded-full border border-blue-200">
                {org.organization.plan} Plan
              </span>
            )}
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
              <input type="text" value={orgName} onChange={e => setOrgName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input type="tel" value={orgPhone} onChange={e => setOrgPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
                <input type="url" value={orgWebsite} onChange={e => setOrgWebsite(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  placeholder="https://" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <input type="text" value={orgAddress} onChange={e => setOrgAddress(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                <input type="text" value={orgCity} onChange={e => setOrgCity(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                <input type="text" value={orgState} onChange={e => setOrgState(e.target.value)} maxLength={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  placeholder="AL" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ZIP</label>
                <input type="text" value={orgZip} onChange={e => setOrgZip(e.target.value)} maxLength={10}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <button onClick={saveOrganization} disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Organization'}
            </button>
          </div>
        </div>
      )}

      {/* Notifications Tab */}
      {activeTab === 'notifications' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Notification Preferences</h2>
          <div className="space-y-4">
            {[
              { key: 'stormAlerts', label: 'Storm Alerts', desc: 'Get notified when storms hit your service area', value: stormAlerts, setter: setStormAlerts },
              { key: 'leadUpdates', label: 'Lead Updates', desc: 'Notifications when new leads are generated', value: leadUpdates, setter: setLeadUpdates },
              { key: 'weeklyDigest', label: 'Weekly Digest', desc: 'Weekly summary of storms, leads, and performance', value: weeklyDigest, setter: setWeeklyDigest },
            ].map((pref) => (
              <div key={pref.key} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                <div>
                  <p className="text-sm font-medium text-gray-900">{pref.label}</p>
                  <p className="text-xs text-gray-500">{pref.desc}</p>
                </div>
                <button
                  onClick={() => pref.setter(!pref.value)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    pref.value ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                    pref.value ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>
            ))}
            <p className="text-xs text-gray-400 mt-4">
              Email notifications will be sent to {email || 'your registered email'}.
              SMS notifications coming soon.
            </p>
          </div>
        </div>
      )}

      {/* Billing Tab */}
      {activeTab === 'billing' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Billing & Plan</h2>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-blue-900">Current Plan: {org?.organization.plan || 'STARTER'}</p>
                <p className="text-xs text-blue-700 mt-1">You&apos;re on the free tier during alpha testing</p>
              </div>
              <span className="px-3 py-1 bg-blue-100 text-blue-800 text-xs font-bold rounded-full">ALPHA</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { name: 'Starter', price: 'Free', features: ['5 leads/month', 'Storm map', 'Basic analytics'], current: true },
              { name: 'Pro', price: '$49/mo', features: ['Unlimited leads', 'Canvassing lists', 'Lead scoring', 'Property enrichment', 'CSV export'], current: false },
              { name: 'Team', price: '$149/mo', features: ['Everything in Pro', 'Multi-user', 'Territory management', 'Branded reports', 'API access'], current: false },
            ].map((plan) => (
              <div key={plan.name} className={`rounded-xl border-2 p-4 ${
                plan.current ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200'
              }`}>
                <p className="font-semibold text-gray-900">{plan.name}</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{plan.price}</p>
                <ul className="mt-3 space-y-1.5">
                  {plan.features.map((f) => (
                    <li key={f} className="text-xs text-gray-600 flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  className={`mt-4 w-full py-2 rounded-lg text-xs font-medium ${
                    plan.current
                      ? 'bg-blue-600 text-white cursor-default'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                  disabled={plan.current}
                >
                  {plan.current ? 'Current Plan' : 'Coming Soon'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Preferences Tab */}
      {activeTab === 'preferences' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Map Preferences</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Default Map Theme</label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { key: 'dark', label: 'Dark', desc: 'Dark basemap with colored labels' },
                  { key: 'light', label: 'Light', desc: 'Light basemap for daytime use' },
                  { key: 'satellite', label: 'Satellite', desc: 'Aerial imagery from ESRI' },
                ].map((theme) => (
                  <button
                    key={theme.key}
                    onClick={() => setMapTheme(theme.key as any)}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${
                      mapTheme === theme.key
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className="font-medium text-gray-900">{theme.label}</p>
                    <p className="text-xs text-gray-500 mt-1">{theme.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
