/**
 * Lead Finder Module
 * ------------------
 * Queries the Google Places API (New) Text Search endpoint to discover
 * businesses matching a search term + location, then filters out those
 * that already have a website.
 *
 * Exports:
 *   findLeads(searchTerm, location, maxResults) → Lead[]
 */

import config, { requireConfig } from '../config.js';

const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.googleMapsUri',
].join(',');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a likely city name from a formatted address string.
 * Falls back to the last two comma-separated segments.
 */
function extractCity(formattedAddress) {
  if (!formattedAddress) return 'Unknown';
  const parts = formattedAddress.split(',').map(s => s.trim());
  // Typically the second-to-last part is the city
  if (parts.length >= 3) return parts[parts.length - 3];
  if (parts.length >= 2) return parts[parts.length - 2];
  return parts[0];
}

/**
 * Create a URL-safe slug from a business name.
 */
export function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Parse a raw place object from the API into our internal Lead format.
 */
function parseLead(place) {
  return {
    id: place.id,
    name: place.displayName?.text || 'Unknown Business',
    address: place.formattedAddress || '',
    phone: place.internationalPhoneNumber || place.nationalPhoneNumber || '',
    category: place.primaryTypeDisplayName?.text || place.primaryType || 'Business',
    city: extractCity(place.formattedAddress),
    mapsUrl: place.googleMapsUri || '',
    slug: slugify(place.displayName?.text || 'unknown'),
    hasWebsite: !!place.websiteUri,
    websiteUri: place.websiteUri || null,
  };
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Search for businesses without websites using Google Places Text Search.
 *
 * @param {string} searchTerm - e.g. "plumber", "restaurant", "dentist"
 * @param {string} location   - e.g. "Mumbai, India", "Austin, TX"
 * @param {object} [options]
 * @param {number} [options.maxResults=20]  - Max leads to return
 * @param {boolean} [options.includeWithWebsite=false] - If true, don't filter out businesses with websites
 * @returns {Promise<Array>} Array of lead objects without websites
 */
export async function findLeads(searchTerm, location, options = {}) {
  requireConfig('Google Places API');

  const { maxResults = 20, includeWithWebsite = false } = options;
  const query = `${searchTerm} in ${location}`;

  console.log(`\n🔍 Searching for: "${query}"`);
  console.log(`   Max results: ${maxResults} | Filter websites: ${!includeWithWebsite}`);

  const allPlaces = [];
  let pageToken = null;
  let pageCount = 0;

  // Paginate through results (API returns max 20 per page, 3 pages max = 60)
  do {
    pageCount++;
    const body = { textQuery: query };

    // The new Places API uses a different pagination mechanism
    if (pageToken) {
      body.pageToken = pageToken;
    }

    const response = await fetch(PLACES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': config.googlePlacesApiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Google Places API error (${response.status}): ${errorBody}`
      );
    }

    const data = await response.json();
    const places = data.places || [];

    allPlaces.push(...places);
    console.log(`   Page ${pageCount}: fetched ${places.length} results (total: ${allPlaces.length})`);

    // Check for next page token
    pageToken = data.nextPageToken || null;

    // Stop if we have enough
    if (allPlaces.length >= maxResults) break;

    // Small delay between pages to respect rate limits
    if (pageToken) {
      await new Promise(r => setTimeout(r, 500));
    }
  } while (pageToken && pageCount < 3);

  // Parse all places into our lead format
  const allLeads = allPlaces.map(parseLead);

  // Filter out businesses that already have websites (unless opted out)
  const filteredLeads = includeWithWebsite
    ? allLeads
    : allLeads.filter(lead => !lead.hasWebsite);

  // Trim to maxResults
  const results = filteredLeads.slice(0, maxResults);

  console.log(`\n📊 Results: ${allLeads.length} total businesses found`);
  console.log(`   ${allLeads.filter(l => l.hasWebsite).length} already have websites (filtered out)`);
  console.log(`   ${results.length} leads without websites (returned)\n`);

  return results;
}

export default { findLeads, slugify };
