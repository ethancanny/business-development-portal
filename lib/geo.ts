// City → coordinates for the interactive target map.
// Arizona cities resolve instantly from this gazetteer; anything else falls
// back to Nominatim (OpenStreetMap) with graceful failure.

const AZ_GAZETTEER: Record<string, [number, number]> = {
  phoenix: [33.4484, -112.074],
  scottsdale: [33.4942, -111.9261],
  tempe: [33.4255, -111.94],
  mesa: [33.4152, -111.8315],
  chandler: [33.3062, -111.8413],
  glendale: [33.5387, -112.186],
  peoria: [33.5806, -112.2374],
  gilbert: [33.3528, -111.789],
  tucson: [32.2226, -110.9747],
  surprise: [33.6292, -112.3679],
  avondale: [33.4356, -112.3496],
  goodyear: [33.4353, -112.3577],
  buckeye: [33.3703, -112.5838],
  "queen creek": [33.2487, -111.6343],
  "san tan valley": [33.1728, -111.5585],
  "fountain hills": [33.6117, -111.7174],
  "paradise valley": [33.5312, -111.9426],
  carefree: [33.8281, -111.925],
  "cave creek": [33.8333, -111.9497],
  prescott: [34.5404, -111.9298],
  "prescott valley": [34.6101, -112.3157],
  flagstaff: [35.1983, -111.6513],
  sedona: [34.8743, -111.761],
  yuma: [32.6927, -114.6157],
  "sierra vista": [31.5455, -110.2773],
  "casa grande": [32.8795, -111.7574],
  maricopa: [33.0581, -112.0476],
  "apache junction": [33.415, -111.5496],
  eloy: [32.7559, -111.554],
  coolidge: [32.9778, -111.5237],
  florence: [33.0317, -111.3873],
};

function normalizeCity(city: string): string {
  return city
    .toLowerCase()
    .replace(/,\s*(az|arizona)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function geocodeCity(
  city: string
): Promise<{ lat: number; lng: number } | null> {
  const key = normalizeCity(city);
  if (!key) return null;
  const known = AZ_GAZETTEER[key];
  if (known) return { lat: known[0], lng: known[1] };

  // Fallback: Nominatim. Never throws — the map simply skips unlocated deals.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
        city
      )}`,
      {
        headers: { "User-Agent": "canny-bd-portal/1.0" },
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!data.length) return null;
    const lat = Number(data[0].lat);
    const lng = Number(data[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}
