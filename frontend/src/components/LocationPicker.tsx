import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/** Pin a place in Guyana: search it, click the map, or drag the pin.
 *
 *  OpenStreetMap tiles and its Nominatim search — no API key, so it works on
 *  any deployment today. Searching is on submit only (never per keystroke),
 *  which keeps within Nominatim's usage policy. Swapping in Google Maps is a
 *  change to this file alone: the component takes and gives a lat/lng and a
 *  place name, nothing provider-specific. */

export interface PickedPlace {
  lat: number;
  lng: number;
  /** What the search named, or what the reverse lookup found at the pin. */
  place?: string;
}

interface SearchHit {
  lat: string;
  lon: string;
  display_name: string;
}

// Georgetown, until something is pinned.
const GEORGETOWN: [number, number] = [6.8013, -58.1551];
const NOMINATIM = "https://nominatim.openstreetmap.org";

const pinIcon = L.divIcon({
  className: "",
  iconSize: [30, 40],
  iconAnchor: [15, 38],
  html: `<svg viewBox="0 0 30 40" width="30" height="40" aria-hidden="true">
    <path d="M15 1C7.3 1 1 7.2 1 14.9 1 25.6 15 39 15 39s14-13.4 14-24.1C29 7.2 22.7 1 15 1z" fill="#0b2654" stroke="#fbbf24" stroke-width="2"/>
    <circle cx="15" cy="15" r="5.5" fill="#fbbf24"/></svg>`,
});

async function reverse(lat: number, lng: number): Promise<string | undefined> {
  try {
    const res = await fetch(
      `${NOMINATIM}/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lng}`,
      {
        headers: { Accept: "application/json" },
      },
    );
    if (!res.ok) return undefined;
    return ((await res.json()) as { display_name?: string }).display_name;
  } catch {
    return undefined;
  }
}

export function LocationPicker({
  lat,
  lng,
  place,
  onChange,
  invalid,
}: {
  lat: number | null;
  lng: number | null;
  place: string;
  onChange: (picked: PickedPlace) => void;
  invalid?: boolean;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const changed = useRef(onChange);
  changed.current = onChange;

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  /** Move the pin there, and say what is there. */
  const pinAt = async (at: L.LatLng, named?: string, zoom?: number) => {
    const m = map.current;
    if (!m) return;
    if (!marker.current) {
      marker.current = L.marker(at, {
        draggable: true,
        icon: pinIcon,
        keyboard: true,
        title: "Business location",
      }).addTo(m);
      marker.current.on("dragend", () => {
        const p = marker.current!.getLatLng();
        void pinAt(p);
      });
    } else {
      marker.current.setLatLng(at);
    }
    if (zoom) m.setView(at, zoom);
    const lat6 = Number(at.lat.toFixed(6));
    const lng6 = Number(at.lng.toFixed(6));
    changed.current({ lat: lat6, lng: lng6, place: named });
    if (!named) {
      const found = await reverse(lat6, lng6);
      if (found) changed.current({ lat: lat6, lng: lng6, place: found });
    }
  };

  useEffect(() => {
    if (!box.current || map.current) return;
    const start: [number, number] =
      lat != null && lng != null ? [lat, lng] : GEORGETOWN;
    const m = L.map(box.current, {
      zoomControl: true,
      attributionControl: true,
    }).setView(start, lat != null ? 16 : 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => void pinAt(e.latlng));
    map.current = m;
    if (lat != null && lng != null) {
      marker.current = L.marker(start, {
        draggable: true,
        icon: pinIcon,
        title: "Business location",
      }).addTo(m);
      marker.current.on(
        "dragend",
        () => void pinAt(marker.current!.getLatLng()),
      );
    }
    // A map drawn inside a container that was still sizing itself needs telling.
    setTimeout(() => m.invalidateSize(), 0);
    return () => {
      m.remove();
      map.current = null;
      marker.current = null;
    };
    // Built once; later pins move the marker rather than rebuilding the map.
  }, []);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setNote(null);
    try {
      const res = await fetch(
        `${NOMINATIM}/search?format=jsonv2&countrycodes=gy&limit=5&q=${encodeURIComponent(query.trim())}`,
        { headers: { Accept: "application/json" } },
      );
      const found = res.ok ? ((await res.json()) as SearchHit[]) : [];
      setHits(found);
      if (!found.length)
        setNote(
          "Nothing found in Guyana. Try a nearby landmark, or drop the pin on the map.",
        );
    } catch {
      setNote(
        "Search is unavailable right now. Drop the pin on the map instead.",
      );
    } finally {
      setSearching(false);
    }
  };

  const useMine = () => {
    if (!navigator.geolocation)
      return setNote(
        "This device cannot share its location. Drop the pin on the map.",
      );
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        void pinAt(
          L.latLng(pos.coords.latitude, pos.coords.longitude),
          undefined,
          17,
        ),
      () =>
        setNote("Location was not shared. Search, or drop the pin on the map."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <div
      className={`overflow-hidden rounded-xl border ${invalid ? "border-rose-400 ring-4 ring-rose-100" : "border-slate-300"}`}
    >
      <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50 p-2 sm:flex-row">
        {/* Not a <form>: this sits inside the step's own form. */}
        <div className="flex flex-1 gap-2" role="search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search(e as unknown as FormEvent);
            }}
            placeholder="Search a place, street or landmark in Guyana"
            aria-label="Search for your business location"
            className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-brand focus:outline-none focus:ring-4 focus:ring-emerald-100"
          />
          <button
            type="button"
            onClick={(e) => void search(e as unknown as FormEvent)}
            disabled={searching}
            className="h-9 rounded-lg bg-brand-dark px-3 text-xs font-bold text-white hover:bg-[#071a3d] disabled:opacity-50"
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </div>
        <button
          type="button"
          onClick={useMine}
          className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-100"
        >
          ◎ Use my current location
        </button>
      </div>

      {hits && hits.length > 0 && (
        <ul
          className="max-h-40 divide-y divide-slate-100 overflow-y-auto border-b border-slate-200 bg-white text-sm"
          aria-label="Search results"
        >
          {hits.map((h) => (
            <li key={`${h.lat},${h.lon}`}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left hover:bg-emerald-50"
                onClick={() => {
                  setHits(null);
                  void pinAt(
                    L.latLng(Number(h.lat), Number(h.lon)),
                    h.display_name,
                    17,
                  );
                }}
              >
                {h.display_name}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div
        ref={box}
        className="h-64 w-full bg-slate-100 sm:h-72"
        aria-label="Map — click to drop the pin, or drag it"
      />

      <div className="flex flex-wrap items-center justify-between gap-2 bg-white px-3 py-2 text-xs">
        {lat != null && lng != null ? (
          <span className="min-w-0 text-slate-700">
            <b className="font-bold text-brand-dark">📍 Pinned</b>{" "}
            {place ? `· ${place}` : ""}
            <span className="ml-1 font-mono text-slate-400">
              ({lat.toFixed(5)}, {lng.toFixed(5)})
            </span>
          </span>
        ) : (
          <span className="text-slate-500">
            Search, click the map, or drag the pin to where your business is.
          </span>
        )}
        {note && <span className="font-semibold text-amber-700">{note}</span>}
      </div>
    </div>
  );
}
