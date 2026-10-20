import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { cn } from "@/lib/utils";

// Initialize Mapbox with API Key
// We provide a fallback token for demo purposes if env is missing
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN ?? "";

interface PhysicsZone {
  id: string;
  coordinates: [number, number]; // [lng, lat]
  severity: number;              // 0.0 to 1.0
  physicsFactors: {
    elevation: number;
    slope: number;
    wind: number;
    water: number;
    terrain: number;
  };
}

interface Heatmap2DProps {
  className?: string;
  initialCenter?: [number, number];
  initialZoom?: number;
  zones?: PhysicsZone[];
}

const toGeoJSON = (zones: PhysicsZone[]): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: zones.map((zone) => ({
    type: "Feature",
    properties: { severity: zone.severity, ...zone.physicsFactors },
    geometry: { type: "Point", coordinates: zone.coordinates },
  })),
});

export function Heatmap2D({
  className,
  initialCenter = [78.4744, 17.3753], // Assuming generic Hyderabad/MRUH coords
  initialZoom = 16,
  zones = [],
}: Heatmap2DProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const [failed, setFailed] = useState<string | null>(null);
  const [lng, lat] = initialCenter; // primitives: a fresh default array must not rebuild the map (WebGL context churn)

  useEffect(() => {
    if (!mapContainer.current) return;
    if (!mapboxgl.accessToken) { setFailed("Mapbox token missing (VITE_MAPBOX_TOKEN)"); return; }
    setFailed(null);

    // Initialize Mapbox (throws if WebGL is unavailable)
    let m: mapboxgl.Map;
    try {
      m = new mapboxgl.Map({
        container: mapContainer.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: [lng, lat],
        zoom: initialZoom,
        pitch: 45, // Angled slightly to show 3D buildings if available
      });
    } catch (e) {
      setFailed("Map could not start (WebGL unavailable)");
      return;
    }
    map.current = m;
    m.on("error", (ev) => {
      const status = (ev as { error?: { status?: number } }).error?.status;
      if (status === 401 || status === 403) setFailed("Mapbox rejected the access token");
    });

    m.on("load", () => {
      // Add 3D buildings layer if available in Mapbox
      const layers = map.current?.getStyle().layers;
      const labelLayerId = layers?.find(
        (layer) => layer.type === "symbol" && layer.layout?.["text-field"]
      )?.id;

      map.current?.addLayer(
        {
          id: "add-3d-buildings",
          source: "composite",
          "source-layer": "building",
          filter: ["==", "extrude", "true"],
          type: "fill-extrusion",
          minzoom: 15,
          paint: {
            "fill-extrusion-color": "#aaa",
            "fill-extrusion-height": [
              "interpolate",
              ["linear"],
              ["zoom"],
              15,
              0,
              15.05,
              ["get", "height"],
            ],
            "fill-extrusion-base": [
              "interpolate",
              ["linear"],
              ["zoom"],
              15,
              0,
              15.05,
              ["get", "min_height"],
            ],
            "fill-extrusion-opacity": 0.6,
          },
        },
        labelLayerId
      );

      // Initialize an empty GeoJSON source for our Physics Heatmap zones
      map.current?.addSource("physics-zones", {
        type: "geojson",
        data: toGeoJSON(zonesRef.current), // zones that arrived before 'load' are no longer dropped
      });

      // Add the heatmap layer mapping the abstract 'severity' value to a color gradient
      map.current?.addLayer({
        id: "physics-heatmap-layer",
        type: "heatmap",
        source: "physics-zones",
        maxzoom: 24,
        paint: {
          // Increase weight based on severity
          "heatmap-weight": ["interpolate", ["linear"], ["get", "severity"], 0, 0, 1, 1],
          
          // Heatmap transition colors: Blue -> Cyan -> Green -> Yellow -> Red
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0, "rgba(0, 0, 255, 0)",
            0.2, "royalblue",
            0.4, "cyan",
            0.6, "lime",
            0.8, "yellow",
            1, "red"
          ],
          // Radius based on zoom level to keep logical size
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 15, 20, 60],
          // Opacity lowers as you zoom in tightly to see ground details
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.8, 20, 0.3],
        },
      });
    });

    return () => {
      m.remove();
      map.current = null;
    };
  }, [lng, lat, initialZoom]);

  // Update GeoJSON source dynamically when zones change due to Physics calculations
  useEffect(() => {
    try {
      const source = map.current?.getSource("physics-zones") as mapboxgl.GeoJSONSource | undefined;
      source?.setData(toGeoJSON(zones));
    } catch {
      /* style not loaded yet: the load handler seeds from zonesRef */
    }
  }, [zones]);

  return (
    <div className={cn("relative w-full h-full min-h-[500px] rounded-lg overflow-hidden", className)}>
      <div ref={mapContainer} className="absolute inset-0" />
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#020617] text-[11px] text-slate-400 p-4 text-center">
          2D heatmap unavailable: {failed}
        </div>
      )}
      {!failed && (
        <div className="absolute bottom-2 left-2 bg-black/80 border border-white/10 p-2 text-[10px] font-mono text-slate-300 pointer-events-none">
          <p className="text-[#0dccf2] font-bold tracking-widest mb-1">FIRE SEVERITY HEAT</p>
          <div className="h-2 w-40 rounded-sm" style={{ background: "linear-gradient(90deg,#4169e1,#00ffff,#00ff00,#ffff00,#ff0000)" }} />
          <div className="flex justify-between w-40 text-slate-500"><span>low</span><span>severity 0-1</span><span>high</span></div>
        </div>
      )}
    </div>
  );
}
