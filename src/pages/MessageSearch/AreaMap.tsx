import React, { useEffect, useRef } from 'react';
import { Button } from '@mantine/core';
import { IconViewfinder } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import { Circle as LeafletCircle, CircleMarker, MapContainer, Rectangle, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { MessageResult } from './index';

export type AreaMode = 'none' | 'box' | 'radius';
export interface BBox { minLat: number; minLon: number; maxLat: number; maxLon: number }
export interface Circle { lat: number; lon: number; radius: number }

const round = (n: number) => Math.round(n * 100000) / 100000;
const clampLat = (n: number) => Math.max(-90, Math.min(90, n));

/** Leaflet bounds -> bbox in -180..180. A box wider than the world becomes the whole world;
 *  one crossing the antimeridian keeps west > east, which the server understands. */
function toBBox(bounds: L.LatLngBounds): BBox {
    const west = bounds.getWest();
    const east = bounds.getEast();
    const whole = east - west >= 360;
    return {
        minLat: round(clampLat(bounds.getSouth())),
        maxLat: round(clampLat(bounds.getNorth())),
        minLon: whole ? -180 : round(L.Util.wrapNum(west, [-180, 180], true)),
        maxLon: whole ? 180 : round(L.Util.wrapNum(east, [-180, 180], true)),
    };
}

function toBounds(bbox: BBox): L.LatLngBoundsExpression {
    // Unwrap an antimeridian box so it draws across the date line, not around the world
    const east = bbox.maxLon < bbox.minLon ? bbox.maxLon + 360 : bbox.maxLon;
    return [[bbox.minLat, bbox.minLon], [bbox.maxLat, east]];
}

/** Shift + drag draws the box; a click sets the radius center. */
function Interaction({ mode, onBbox, onCircle, circle }: {
    mode: AreaMode;
    onBbox: (b: BBox) => void;
    onCircle: (c: Circle) => void;
    circle: Circle | null;
}) {
    const map = useMap();
    const startRef = useRef<L.LatLng | null>(null);
    const previewRef = useRef<L.Rectangle | null>(null);

    useEffect(() => {
        // Shift + drag is Leaflet's box zoom; take it over while drawing a box
        if (mode === 'box') { map.boxZoom.disable(); } else { map.boxZoom.enable(); }
        return () => { map.boxZoom.enable(); };
    }, [map, mode]);

    useMapEvents({
        mousedown(e) {
            if (mode !== 'box' || !e.originalEvent.shiftKey) { return; }
            startRef.current = e.latlng;
            map.dragging.disable();
        },
        mousemove(e) {
            if (!startRef.current) { return; }
            const bounds = L.latLngBounds(startRef.current, e.latlng);
            if (previewRef.current) {
                previewRef.current.setBounds(bounds);
            } else {
                previewRef.current = L.rectangle(bounds, { color: '#228be6', weight: 1, dashArray: '4' }).addTo(map);
            }
        },
        mouseup(e) {
            if (!startRef.current) { return; }
            const bounds = L.latLngBounds(startRef.current, e.latlng);
            startRef.current = null;
            map.dragging.enable();
            previewRef.current?.remove();
            previewRef.current = null;
            if (!bounds.getNorthEast().equals(bounds.getSouthWest())) {
                onBbox(toBBox(bounds));
            }
        },
        click(e) {
            if (mode !== 'radius') { return; }
            const p = e.latlng.wrap();
            onCircle({ lat: round(p.lat), lon: round(p.lng), radius: circle?.radius ?? 1000 });
        },
    });
    return null;
}

function UseViewButton({ onBbox }: { onBbox: (b: BBox) => void }) {
    const { t } = useTranslation();
    const map = useMap();
    const ref = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        // Keep clicks on the button from panning or clicking the map underneath
        if (ref.current) { L.DomEvent.disableClickPropagation(ref.current); }
    }, []);
    return (
        <Button
          ref={ref}
          size="compact-xs"
          variant="white"
          leftSection={<IconViewfinder size={14} />}
          style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000 }}
          onClick={() => onBbox(toBBox(map.getBounds()))}
        >
            {t('Use current view')}
        </Button>
    );
}

/** Zooms to the drawn area when it changes from outside the map (typed coordinates) */
function FitArea({ bbox, circle, mode }: { bbox: BBox | null; circle: Circle | null; mode: AreaMode }) {
    const map = useMap();
    useEffect(() => {
        if (mode === 'radius' && circle) {
            const bounds = L.latLng(circle.lat, circle.lon).toBounds(circle.radius * 2);
            if (!map.getBounds().contains(bounds)) { map.fitBounds(bounds, { padding: [20, 20] }); }
        }
    }, [map, mode, circle]);
    useEffect(() => {
        if (mode === 'box' && bbox) {
            const bounds = L.latLngBounds(toBounds(bbox) as L.LatLngBoundsLiteral);
            if (bounds.isValid() && !map.getBounds().contains(bounds)) { map.fitBounds(bounds, { padding: [20, 20] }); }
        }
    }, [map, mode, bbox]);
    return null;
}

export default function AreaMap({ mode, bbox, circle, onBbox, onCircle, results, onSelect }: {
    mode: AreaMode;
    bbox: BBox | null;
    circle: Circle | null;
    onBbox: (b: BBox) => void;
    onCircle: (c: Circle) => void;
    results: MessageResult[];
    onSelect: (r: MessageResult) => void;
}) {
    return (
        <div style={{ position: 'relative' }}>
            <MapContainer
              center={[20, 0]}
              zoom={2}
              scrollWheelZoom
              worldCopyJump
              style={{ height: 320, width: '100%', borderRadius: 8, zIndex: 0, cursor: mode === 'radius' ? 'crosshair' : undefined }}
            >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <Interaction mode={mode} onBbox={onBbox} onCircle={onCircle} circle={circle} />
                <FitArea bbox={bbox} circle={circle} mode={mode} />
                {mode === 'box' && <UseViewButton onBbox={onBbox} />}
                {mode === 'box' && bbox && <Rectangle bounds={toBounds(bbox)} pathOptions={{ color: '#228be6', weight: 2 }} />}
                {mode === 'radius' && circle && (
                    <LeafletCircle center={[circle.lat, circle.lon]} radius={circle.radius} pathOptions={{ color: '#228be6', weight: 2 }} />
                )}
                {results.filter((r) => r.latitude !== null && r.longitude !== null).map((r) => (
                    <CircleMarker
                      key={r.id}
                      center={[r.latitude as number, r.longitude as number]}
                      radius={4}
                      pathOptions={{ color: '#e8590c', weight: 1, fillOpacity: 0.8 }}
                      eventHandlers={{ click: (e) => { L.DomEvent.stopPropagation(e); onSelect(r); } }}
                    >
                        <Tooltip>{r.callsign ?? r.uid}</Tooltip>
                    </CircleMarker>
                ))}
            </MapContainer>
        </div>
    );
}
