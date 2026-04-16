'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

interface Property {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat?: number;
  lon?: number;
  yearBuilt?: number | null;
  roofAge?: number;
  roofYear?: number;
  ownerFullName?: string | null;
  ownerPhone?: string | null;
  ownerEmail?: string | null;
  propertyType?: string;
  assessedValue?: number | null;
  marketValue?: number | null;
}

export default function PropertiesPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);

  useEffect(() => {
    const fetchProperties = async () => {
      setLoading(true);
      try {
        const res = await api.get('/properties', { params: { limit: 100 } });
        setProperties(res.data?.data || res.data || []);
      } catch (err) {
        console.error('Failed to fetch properties', err);
      } finally {
        setLoading(false);
      }
    };
    fetchProperties();
  }, []);

  const filteredProperties = properties.filter(p =>
    p.address.toLowerCase().includes(search.toLowerCase()) ||
    p.city.toLowerCase().includes(search.toLowerCase()) ||
    p.ownerFullName?.toLowerCase().includes(search.toLowerCase())
  );

  const getRoofAgeColor = (age: number | undefined) => {
    if (!age) return 'bg-gray-100 text-gray-800';
    if (age < 10) return 'bg-green-100 text-green-800';
    if (age < 20) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  const estimateRoofAge = (yearBuilt: number | undefined) => {
    if (!yearBuilt) return null;
    return new Date().getFullYear() - yearBuilt;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Properties</h1>
            <p className="text-sm text-gray-500">{properties.length} properties in Huntsville area</p>
          </div>
          <button className="bg-primary hover:bg-primary-600 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Property
          </button>
        </div>

        {/* Search */}
        <div className="mt-4">
          <input
            type="text"
            placeholder="Search by address, city, or owner name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
          />
        </div>
      </div>

      {/* Properties Grid */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : filteredProperties.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <svg className="w-16 h-16 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <p className="text-lg font-medium">No properties found</p>
            <p className="text-sm">Try adjusting your search</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProperties.map((property) => (
              <div
                key={property.id}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => setSelectedProperty(property)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900">{property.address}</h3>
                    <p className="text-sm text-gray-500">{property.city}, {property.state} {property.zip}</p>
                  </div>
                  {property.roofAge && (
                    <span className={`px-2 py-1 rounded text-xs font-medium ${getRoofAgeColor(property.roofAge)}`}>
                      {property.roofAge} yrs
                    </span>
                  )}
                </div>

                <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-gray-500">Year Built</p>
                    <p className="font-medium">{property.yearBuilt || 'Unknown'}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Roof Age</p>
                    <p className="font-medium">{property.roofAge ? `${property.roofAge} years` : 'Unknown'}</p>
                  </div>
                </div>

                {property.ownerFullName && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <p className="text-sm text-gray-500">Owner: {property.ownerFullName}</p>
                    {property.ownerPhone && (
                      <p className="text-sm text-primary">{property.ownerPhone}</p>
                    )}
                  </div>
                )}

                <div className="mt-3 flex gap-2">
                  <button className="flex-1 bg-primary/10 text-primary hover:bg-primary/20 px-3 py-1.5 rounded text-sm font-medium transition-colors">
                    Create Lead
                  </button>
                  <button className="flex-1 bg-gray-100 text-gray-700 hover:bg-gray-200 px-3 py-1.5 rounded text-sm font-medium transition-colors">
                    View Details
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Property Detail Slide-over */}
      {selectedProperty && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSelectedProperty(null)}></div>
          <div className="relative bg-white w-full max-w-md shadow-xl h-full overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Property Details</h2>
              <button onClick={() => setSelectedProperty(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-2">Address</h3>
                <p className="font-medium text-gray-900">{selectedProperty.address}</p>
                <p className="text-sm text-gray-500">{selectedProperty.city}, {selectedProperty.state} {selectedProperty.zip}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">Year Built</h3>
                  <p className="font-medium">{selectedProperty.yearBuilt || 'Unknown'}</p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">Roof Age</h3>
                  <p className="font-medium">{selectedProperty.roofAge ? `${selectedProperty.roofAge} years` : 'Unknown'}</p>
                  <p className="text-xs text-gray-500">Estimated from year built</p>
                </div>
              </div>

              {selectedProperty.ownerFullName && (
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-2">Owner</h3>
                  <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                    <p className="font-medium">{selectedProperty.ownerFullName}</p>
                    {selectedProperty.ownerPhone && (
                      <a href={`tel:${selectedProperty.ownerPhone}`} className="text-sm text-primary hover:underline flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                        </svg>
                        {selectedProperty.ownerPhone}
                      </a>
                    )}
                    {selectedProperty.ownerEmail && (
                      <a href={`mailto:${selectedProperty.ownerEmail}`} className="text-sm text-primary hover:underline flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        {selectedProperty.ownerEmail}
                      </a>
                    )}
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-2">Roof Recommendation</h3>
                <div className={`rounded-lg p-4 ${
                  (selectedProperty.roofAge || 0) < 10 ? 'bg-green-50 text-green-800' :
                  (selectedProperty.roofAge || 0) < 20 ? 'bg-yellow-50 text-yellow-800' :
                  'bg-red-50 text-red-800'
                }`}>
                  {selectedProperty.roofAge && selectedProperty.roofAge < 10 && (
                    <p>Roof appears relatively new. Likely no immediate replacement needed.</p>
                  )}
                  {selectedProperty.roofAge && selectedProperty.roofAge >= 10 && selectedProperty.roofAge < 20 && (
                    <p>Roof is approaching mid-life. Monitor for signs of wear and consider scheduling an inspection.</p>
                  )}
                  {(!selectedProperty.roofAge || selectedProperty.roofAge >= 20) && (
                    <p>Roof is at or past typical lifespan. Replacement likely needed - high priority for outreach.</p>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <button className="w-full bg-primary hover:bg-primary-600 text-white px-4 py-2 rounded-lg font-medium transition-colors">
                  Create Lead for This Property
                </button>
                <button className="w-full bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg font-medium transition-colors">
                  Add to Target List
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
