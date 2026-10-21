import React, { useRef } from 'react';
import { Map as MapIcon, Maximize2, ExternalLink } from 'lucide-react';

export function GeospatialMap({ isCritical = false }: { isCritical?: boolean } = {}) {
  // Resolve the place by name (Google geocodes it), so no hand-typed coordinates can drift off campus
  const place = "Malla Reddy University, Maisammaguda, Hyderabad";
  const q = encodeURIComponent(place);
  const box = useRef<HTMLDivElement>(null);

  // Embed API when a key exists; otherwise the keyless satellite embed (a missing key used to load an error page)
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const mapUrl = apiKey
    ? `https://www.google.com/maps/embed/v1/place?key=${apiKey}&q=${q}&zoom=17&maptype=satellite`
    : `https://maps.google.com/maps?q=${q}&t=k&z=17&output=embed`;
  const goFull = () => { box.current?.requestFullscreen?.().catch(() => {}); };

  return (
    <div className="glass-panel p-5 bg-black/40 border-t-2 border-[#00ffaa] flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-black cyber-text text-[#00ffaa] flex items-center gap-2 tracking-[0.2em] uppercase">
          <MapIcon size={18} /> LIVE_GEOSPATIAL_INTEL
        </h2>
        <div className="flex gap-2">
          <button onClick={goFull} aria-label="Fullscreen map" className="p-1 hover:text-[#00ffaa] text-white/40 transition-colors">
            <Maximize2 size={14} />
          </button>
          <a 
            href={`https://www.google.com/maps/search/?api=1&query=${q}`}
            target="_blank" 
            rel="noopener noreferrer"
            aria-label="Open in Google Maps"
            className="p-1 hover:text-[#00ffaa] text-white/40 transition-colors"
          >
            <ExternalLink size={14} />
          </a>
        </div>
      </div>

      <div ref={box} className="relative h-64 w-full bg-black border border-[#00ffaa]/20 overflow-hidden shadow-[inset_0_0_20px_rgba(0,255,170,0.1)]">
        {/* Scanning Overlay (Pure Visuals) */}
        <div className="absolute inset-0 pointer-events-none z-10">
          <div className="absolute top-0 left-0 w-full h-[2px] bg-[#00ffaa]/30 animate-[scan_3s_linear_infinite]"></div>
          <div className="absolute inset-0 border-[20px] border-black/20"></div>
          
          {/* Corner Brackets */}
          <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-[#00ffaa]/50"></div>
          <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-[#00ffaa]/50"></div>
          <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-[#00ffaa]/50"></div>
          <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-[#00ffaa]/50"></div>
        </div>

        {/* Real Google Maps Iframe */}
        <iframe
          src={mapUrl}
          width="100%"
          height="100%"
          title="MRU campus satellite map"
          style={{ border: 0, filter: 'contrast(1.2) brightness(0.8) hue-rotate(-10deg) grayscale(0.2)' }}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        ></iframe>

        {/* HUD Data Overlay */}
        <div className="absolute bottom-2 left-2 bg-black/80 p-2 border border-[#00ffaa]/30 text-[8px] cyber-text text-[#00ffaa] z-20">
          PLACE: Malla Reddy University<br/>
          VIEW: SATELLITE (Google Maps)
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white/5 p-2 border-l-2 border-[#ff003c]">
          <p className="text-[8px] text-white/40 uppercase">Nearest Responder (static ref.)</p>
          <p className="text-[10px] text-[#ff003c] font-bold">Fire Dept: 1.2 KM</p>
        </div>
        <div className={`bg-white/5 p-2 border-l-2 ${isCritical ? 'border-[#ff003c]' : 'border-[#00ffaa]'}`}>
          <p className="text-[8px] text-white/40 uppercase">Evac Perimeter</p>
          <p className={`text-[10px] font-bold ${isCritical ? 'text-[#ff003c]' : 'text-[#00ffaa]'}`}>{isCritical ? 'STATUS: ACTIVE' : 'STATUS: CLEAR'}</p>
        </div>
      </div>
    </div>
  );
}
