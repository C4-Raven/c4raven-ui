import React, { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Accordion, ActionIcon, Badge, Box, Group, Paper, SegmentedControl, Stack, Switch, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconTrash, IconX, IconZoomIn, IconZoomOut, IconZoomReset } from '@tabler/icons-react';
import axios from '../axios_config';
import { apiRoutes } from '../apiRoutes';
import { notifications } from '@mantine/notifications';
import { t } from 'i18next';

interface Edge {
    source: string;
    target: string;
    type: 'solid' | 'dotted';
    // True if a direct (pairwise) connection contributes to this edge, so
    // it can be removed here. False means it's only true because of a
    // shared named group's own Access list -- can't be selectively removed
    // for just this pair without changing that group for everyone in it.
    manual: boolean;
    // Named groups carrying source -> target and target -> source. A one-way
    // line can't take away access one of these already gives.
    source_groups?: string[];
    target_groups?: string[];
}

interface XY { x: number; y: number; }

// Fixed on-screen viewport size -- the logical canvas (where nodes actually
// live) grows past this as there are more users, and zoom is what brings it
// into view, rather than cramming more nodes into the same fixed area.
const VIEWPORT_WIDTH = 1250;
const VIEWPORT_HEIGHT = 680;
const NODE_WIDTH = 156;
const NODE_HEIGHT = 56;
const NODE_GAP = 26;
const MIN_RADIUS = 190;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.5;

// ---- Connector styling ---------------------------------------------------
// Two-way vs one-way differ by colour (blue vs orange -- distinguishable for
// the common colour-vision deficiencies), by arrowheads (both ends vs the
// receiver's end only) and by dash pattern, so no single cue carries the
// meaning alone. Group-inherited edges are thinner, grey and translucent so
// the connections someone actually drew here stay the focus.
type EdgeStyleKey = 'two' | 'one' | 'inherited';
const EDGE_COLOR: Record<EdgeStyleKey, string> = {
    two: 'var(--mantine-color-indigo-4)',
    one: 'var(--mantine-color-orange-5)',
    inherited: 'var(--mantine-color-gray-6)',
};
const EDGE_WIDTH: Record<'manual' | 'inherited', number> = { manual: 2.25, inherited: 1.4 };
const EDGE_WIDTH_ACTIVE: Record<'manual' | 'inherited', number> = { manual: 3.25, inherited: 2.25 };
// Arrowhead size in multiples of the stroke width (markerUnits=strokeWidth),
// so a thicker (highlighted) line gets a proportionally larger head.
const MARKER_SIZE: Record<'manual' | 'inherited', number> = { manual: 4.4, inherited: 6 };
// The marker path lives in a 10x10 box; the line ends at the notch (x=3) and
// the tip is at x=9.5, so the head sticks out 0.65 * size * strokeWidth px
// past the end of the path. The path is trimmed by that much so the tip --
// not the line -- lands on the node border.
const MARKER_TIP = 0.65;
// Clearance between an arrow tip / line end and the node's border.
const BORDER_GAP = 4;
const BOARD_BG = 'var(--mantine-color-dark-8)';
const DIM_OPACITY = 0.12;

function dashFor(type: Edge['type'], width: number): string | undefined {
    if (type === 'solid') { return undefined; }
    // Round caps add half a stroke to each end of every dash, so the gaps
    // are padded to stay visibly open.
    return `${(width * 2.2).toFixed(2)} ${(width * 2.6).toFixed(2)}`;
}

function styleKeyFor(edge: Pick<Edge, 'type' | 'manual'>): EdgeStyleKey {
    if (!edge.manual) { return 'inherited'; }
    return edge.type === 'solid' ? 'two' : 'one';
}

function markerId(prefix: string, key: EdgeStyleKey): string {
    return `${prefix}-arrow-${key}`;
}

// One arrowhead per style. orient="auto-start-reverse" means the same marker
// points forward at the end of a path and backward at its start, so a two-way
// line gets two heads pointing out toward both users.
function ArrowMarkers({ prefix }: { prefix: string }) {
    return (
        <defs>
            {(Object.keys(EDGE_COLOR) as EdgeStyleKey[]).map((key) => {
                const size = MARKER_SIZE[key === 'inherited' ? 'inherited' : 'manual'];
                return (
                    <marker
                        key={key}
                        id={markerId(prefix, key)}
                        viewBox="0 0 10 10"
                        refX={3}
                        refY={5}
                        markerWidth={size}
                        markerHeight={size}
                        markerUnits="strokeWidth"
                        orient="auto-start-reverse"
                    >
                        <path d="M1,1.4 L9.5,5 L1,8.6 L3.2,5 Z" fill={EDGE_COLOR[key]} strokeLinejoin="round" />
                    </marker>
                );
            })}
        </defs>
    );
}

interface BoardSize { width: number; height: number; radius: number; }

function computeBoardSize(count: number): BoardSize {
    // Enough circumference that NODE_WIDTH-wide nodes don't overlap.
    const radius = Math.max(MIN_RADIUS, (count * (NODE_WIDTH + NODE_GAP)) / (2 * Math.PI));
    const height = Math.max(VIEWPORT_HEIGHT, radius * 2 + NODE_HEIGHT + 160);
    const width = Math.max(VIEWPORT_WIDTH, height * (VIEWPORT_WIDTH / VIEWPORT_HEIGHT));
    return { width, height, radius };
}

function fitZoomFor(board: BoardSize): number {
    const fit = Math.min(VIEWPORT_WIDTH / board.width, VIEWPORT_HEIGHT / board.height, 1);
    return Math.max(MIN_ZOOM, Math.round(fit * 20) / 20);
}

// Pan offset that centers the (scaled) canvas -- and so the ring of nodes
// on it, since they're laid out around its center -- within the viewport,
// instead of leaving it pinned to the top-left corner. `viewportWidth` is
// the board's real rendered width (it stretches to its container).
function centeredPanFor(board: BoardSize, zoomValue: number, viewportWidth: number): XY {
    return {
        x: (viewportWidth - board.width * zoomValue) / 2,
        y: (VIEWPORT_HEIGHT - board.height * zoomValue) / 2,
    };
}

function layoutPositions(names: string[], board: BoardSize): Record<string, XY> {
    const cx = board.width / 2;
    const cy = board.height / 2;
    const positions: Record<string, XY> = {};
    names.forEach((name, i) => {
        const angle = (2 * Math.PI * i) / Math.max(names.length, 1) - Math.PI / 2;
        positions[name] = {
            x: cx + board.radius * Math.cos(angle) - NODE_WIDTH / 2,
            y: cy + board.radius * Math.sin(angle) - NODE_HEIGHT / 2,
        };
    });
    return positions;
}

function nodeCenter(pos: XY): XY {
    return { x: pos.x + NODE_WIDTH / 2, y: pos.y + NODE_HEIGHT / 2 };
}

// Where a ray from a node's center, heading toward (dx, dy), exits its
// rectangular box, pushed out a further `extra` px along the same ray -- so
// lines/arrows stop just outside the box edge instead of running under it.
function borderPoint(c: XY, dx: number, dy: number, extra: number): XY {
    const len = Math.hypot(dx, dy);
    if (len === 0) { return c; }
    const ux = dx / len;
    const uy = dy / len;
    const scaleX = ux !== 0 ? NODE_WIDTH / 2 / Math.abs(ux) : Infinity;
    const scaleY = uy !== 0 ? NODE_HEIGHT / 2 / Math.abs(uy) : Infinity;
    const d = Math.min(scaleX, scaleY) + extra;
    return { x: c.x + ux * d, y: c.y + uy * d };
}

function isInsideNode(p: XY, pos: XY): boolean {
    return p.x >= pos.x && p.x <= pos.x + NODE_WIDTH && p.y >= pos.y && p.y <= pos.y + NODE_HEIGHT;
}

function edgeKey(edge: Pick<Edge, 'source' | 'target'>): string {
    return `${edge.source}\u0000${edge.target}`;
}

interface EdgeGeometry {
    key: string;
    edge: Edge;
    style: EdgeStyleKey;
    // Border-to-border curve, used for the invisible hit area.
    hitD: string;
    // Midpoint of the curve (board coords), for anchoring a keyboard-focus tooltip.
    mid: XY;
    // The visible path's end points before arrow trimming plus the control
    // point; the visible path is built from these per stroke width.
    a: XY;
    b: XY;
    ctrl: XY;
}

function computeGeometry(edges: Edge[], positions: Record<string, XY>, board: BoardSize): EdgeGeometry[] {
    // Group by unordered pair so several edges between the same two users
    // (shouldn't normally happen -- the API sends one per pair -- but cheap to
    // handle) fan out side by side instead of drawing on top of each other.
    const pairCount = new Map<string, number>();
    const pairIndex: number[] = [];
    edges.forEach((e) => {
        const pk = e.source < e.target ? `${e.source}\u0000${e.target}` : `${e.target}\u0000${e.source}`;
        const n = pairCount.get(pk) ?? 0;
        pairIndex.push(n);
        pairCount.set(pk, n + 1);
    });
    const boardCenter = { x: board.width / 2, y: board.height / 2 };

    const out: EdgeGeometry[] = [];
    edges.forEach((edge, i) => {
        const pa = positions[edge.source];
        const pb = positions[edge.target];
        if (!pa || !pb || edge.source === edge.target) { return; }
        const ca = nodeCenter(pa);
        const cb = nodeCenter(pb);
        // Normal taken from the alphabetically-first user to the other, so
        // both directions of a pair agree on which side is "+".
        const flip = edge.source > edge.target;
        const lo = flip ? cb : ca;
        const hi = flip ? ca : cb;
        const dist = Math.max(Math.hypot(hi.x - lo.x, hi.y - lo.y), 1);
        let nx = -(hi.y - lo.y) / dist;
        let ny = (hi.x - lo.x) / dist;
        // Bow toward the middle of the ring, like a chord diagram: a line
        // that skips over a neighbour curves away from it instead of
        // slipping underneath that neighbour's box.
        const mx = (ca.x + cb.x) / 2;
        const my = (ca.y + cb.y) / 2;
        if ((mx - boardCenter.x) * nx + (my - boardCenter.y) * ny > 0) { nx = -nx; ny = -ny; }
        const pk = edge.source < edge.target ? `${edge.source}\u0000${edge.target}` : `${edge.target}\u0000${edge.source}`;
        const n = pairCount.get(pk) ?? 1;
        const spread = (pairIndex[i] - (n - 1) / 2) * 26;
        const bow = Math.min(34, Math.max(10, dist * 0.09)) + spread;
        // Quadratic control point sits at twice the desired apex offset.
        const ctrl = { x: mx + nx * bow * 2, y: my + ny * bow * 2 };
        // Leave each box along the curve's own tangent (toward the control
        // point), not the center-to-center line, so the end looks natural.
        const a = borderPoint(ca, ctrl.x - ca.x, ctrl.y - ca.y, BORDER_GAP);
        const b = borderPoint(cb, ctrl.x - cb.x, ctrl.y - cb.y, BORDER_GAP);
        const mid = {
            x: 0.25 * a.x + 0.5 * ctrl.x + 0.25 * b.x,
            y: 0.25 * a.y + 0.5 * ctrl.y + 0.25 * b.y,
        };
        out.push({
            key: edgeKey(edge),
            edge,
            style: styleKeyFor(edge),
            hitD: `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${ctrl.x.toFixed(1)},${ctrl.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`,
            mid,
            a,
            b,
            ctrl,
        });
    });
    return out;
}

// Pull `p` toward `toward` by `by` px (used to trim a path end so the
// arrowhead, rather than the line, finishes on the border).
function pullToward(p: XY, toward: XY, by: number): XY {
    const dx = toward.x - p.x;
    const dy = toward.y - p.y;
    const len = Math.hypot(dx, dy);
    if (len === 0 || by <= 0) { return p; }
    const k = Math.min(by, len * 0.45) / len;
    return { x: p.x + dx * k, y: p.y + dy * k };
}

function visiblePath(a: XY, ctrl: XY, b: XY, trimStart: number, trimEnd: number): string {
    const s = pullToward(a, ctrl, trimStart);
    const e = pullToward(b, ctrl, trimEnd);
    return `M${s.x.toFixed(1)},${s.y.toFixed(1)} Q${ctrl.x.toFixed(1)},${ctrl.y.toFixed(1)} ${e.x.toFixed(1)},${e.y.toFixed(1)}`;
}

interface StrokeProps {
    d: string;
    style: EdgeStyleKey;
    type: Edge['type'];
    width: number;
    markerPrefix: string;
    animate?: boolean;
}

// The halo + coloured stroke pair shared by real edges, the preview line
// and the legend samples, so all three always look identical.
function ConnectorStroke({ d, style, type, width, markerPrefix, animate }: StrokeProps) {
    const marker = `url(#${markerId(markerPrefix, style)})`;
    return (
        <>
            {/* Background-coloured halo underneath, so crossing lines read as
                passing over/under each other instead of merging into a knot. */}
            <path d={d} fill="none" stroke={BOARD_BG} strokeWidth={width + 4} strokeLinecap="round" opacity={0.85} />
            <path
                d={d}
                fill="none"
                stroke={EDGE_COLOR[style]}
                strokeWidth={width}
                strokeLinecap="round"
                strokeDasharray={dashFor(type, width)}
                markerStart={type === 'solid' ? marker : undefined}
                markerEnd={marker}
                className={animate && type !== 'solid' ? 'uvd-flow' : undefined}
                style={animate && type !== 'solid' ? ({ '--uvd-dash-cycle': `${-(width * 4.8)}px` } as React.CSSProperties) : undefined}
            />
        </>
    );
}

function strokeWidthFor(edge: Edge, active: boolean): number {
    const tier = edge.manual ? 'manual' : 'inherited';
    return active ? EDGE_WIDTH_ACTIVE[tier] : EDGE_WIDTH[tier];
}

interface EdgeLayerProps {
    geometry: EdgeGeometry[];
    hoveredEdge: string | null;
    hoveredNode: string | null;
    markerPrefix: string;
    onEdgeEnter: (key: string, e: React.PointerEvent<SVGPathElement> | null) => void;
    onEdgeMove: (e: React.PointerEvent<SVGPathElement>) => void;
    onEdgeLeave: () => void;
    onEdgeActivate: (edge: Edge) => void;
}

function EdgeVisual({ g, active, animate, markerPrefix }: { g: EdgeGeometry; active: boolean; animate: boolean; markerPrefix: string }) {
    const width = strokeWidthFor(g.edge, active);
    const tip = width * MARKER_SIZE[g.edge.manual ? 'manual' : 'inherited'] * MARKER_TIP;
    const d = visiblePath(g.a, g.ctrl, g.b, g.edge.type === 'solid' ? tip : 0, tip);
    return (
        <g opacity={active ? 1 : g.edge.manual ? 0.95 : 0.55}>
            <ConnectorStroke d={d} style={g.style} type={g.edge.type} width={width} markerPrefix={markerPrefix} animate={animate} />
        </g>
    );
}

// Every edge at rest. Depends only on geometry, so hovering never
// re-renders it -- hover just fades this whole layer as one group.
// Quiet inherited edges paint first, drawn ones over them.
function BaseEdgesImpl({ geometry, markerPrefix }: { geometry: EdgeGeometry[]; markerPrefix: string }) {
    const ordered = [...geometry].sort((x, y) => Number(x.edge.manual) - Number(y.edge.manual));
    return <>{ordered.map((g) => <EdgeVisual key={g.key} g={g} active={false} animate={false} markerPrefix={markerPrefix} />)}</>;
}
const BaseEdges = memo(BaseEdgesImpl);

type HitAreasProps = Omit<EdgeLayerProps, 'hoveredEdge' | 'hoveredNode' | 'markerPrefix'>;

// Wide invisible hit areas along each whole border-to-border curve --
// forgiving to hover/click without drawing thick. Topmost, so the
// highlight overlay never steals the pointer.
function HitAreasImpl({ geometry, onEdgeEnter, onEdgeMove, onEdgeLeave, onEdgeActivate }: HitAreasProps) {
    return (
        <>
            {geometry.map((g) => (
                <path
                    key={g.key}
                    d={g.hitD}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={18}
                    strokeLinecap="round"
                    pointerEvents="stroke"
                    className="uvd-edge-hit"
                    tabIndex={0}
                    role="button"
                    aria-label={g.edge.type === 'solid'
                        ? t('{{a}} and {{b}} both share data', { a: g.edge.source, b: g.edge.target })
                        : t('{{b}} receives {{a}}\'s data', { a: g.edge.source, b: g.edge.target })}
                    style={{ cursor: g.edge.manual ? 'pointer' : 'not-allowed' }}
                    onPointerEnter={(e) => onEdgeEnter(g.key, e)}
                    onPointerMove={onEdgeMove}
                    onPointerLeave={onEdgeLeave}
                    onFocus={() => onEdgeEnter(g.key, null)}
                    onBlur={onEdgeLeave}
                    onClick={() => onEdgeActivate(g.edge)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdgeActivate(g.edge); }
                    }}
                />
            ))}
        </>
    );
}
const HitAreas = memo(HitAreasImpl);

// Base layer (dimmed as a whole while something is hovered), the few
// highlighted edges redrawn on top at full strength, then the hit areas.
// Keeps a hover change cheap even with hundreds of edges.
function EdgeLayer({ geometry, hoveredEdge, hoveredNode, markerPrefix, ...handlers }: EdgeLayerProps) {
    const focusActive = hoveredEdge !== null || hoveredNode !== null;
    const active = focusActive
        ? geometry.filter((g) => g.key === hoveredEdge || (hoveredNode !== null && (g.edge.source === hoveredNode || g.edge.target === hoveredNode)))
        : [];
    return (
        <>
            <g pointerEvents="none" opacity={focusActive ? DIM_OPACITY : 1} style={{ transition: 'opacity 120ms ease' }}>
                <BaseEdges geometry={geometry} markerPrefix={markerPrefix} />
            </g>
            <g pointerEvents="none">
                {active.map((g) => <EdgeVisual key={g.key} g={g} active animate={g.key === hoveredEdge} markerPrefix={markerPrefix} />)}
            </g>
            <HitAreas geometry={geometry} {...handlers} />
        </>
    );
}

function LegendSample({ style, type, markerPrefix }: { style: EdgeStyleKey; type: Edge['type']; markerPrefix: string }) {
    const width = style === 'inherited' ? EDGE_WIDTH.inherited : EDGE_WIDTH.manual;
    const tip = width * MARKER_SIZE[style === 'inherited' ? 'inherited' : 'manual'] * MARKER_TIP;
    const a = { x: 3, y: 9 };
    const b = { x: 49, y: 9 };
    const ctrl = { x: 26, y: 9 };
    return (
        <svg width={52} height={18} style={{ flexShrink: 0, overflow: 'visible' }} aria-hidden>
            <ConnectorStroke d={visiblePath(a, ctrl, b, type === 'solid' ? tip : 0, tip)} style={style} type={type} width={width} markerPrefix={markerPrefix} />
        </svg>
    );
}

interface UserVisibilityDiagramProps {
    // When given, only these users are shown as nodes (and only connections
    // between them), e.g. scoped to one group's current roster. Omit to show
    // every active user system-wide.
    scopeToUsernames?: string[];
    // Called after a connection is successfully created or removed, so a
    // parent showing other data about the same users (e.g. a group's own
    // membership table) can refresh and stay in sync.
    onChange?: () => void;
}

// Only used to give this the same look as the visual planning mockup that
// inspired it — has no bearing on the actual users/groups underneath.
export default function UserVisibilityDiagram({ scopeToUsernames, onChange }: UserVisibilityDiagramProps) {
    const [users, setUsers] = useState<string[]>([]);
    const [edges, setEdges] = useState<Edge[]>([]);
    const [positions, setPositions] = useState<Record<string, XY>>({});
    const [selected, setSelected] = useState<string | null>(null);
    const [mode, setMode] = useState<'solid' | 'dotted'>('solid');
    // A member's own group access already implies a connection to every
    // other member with matching access -- drawing all of those by default
    // turns any group past a handful of people into a solid mesh of lines.
    // Only the connections someone actually drew here (manual/removable)
    // are shown by default; the inherited ones are one toggle away.
    const [showInherited, setShowInherited] = useState(false);
    const [, setLoading] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [boardSize, setBoardSize] = useState<BoardSize>(() => computeBoardSize(0));
    const [pan, setPan] = useState<XY>({ x: 0, y: 0 });
    const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
    const [hoveredNode, setHoveredNode] = useState<string | null>(null);
    // Tooltip anchor, in viewport (unscaled, un-panned) px.
    const [tipPos, setTipPos] = useState<XY | null>(null);
    // Pointer position in board coords while a node is selected, for the
    // "now click another user" preview line.
    const [pointer, setPointer] = useState<XY | null>(null);
    const [viewportWidth, setViewportWidth] = useState(VIEWPORT_WIDTH);

    // useId() output contains ':' which isn't safe inside url(#...).
    const markerPrefix = `uvd${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

    const boardRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ name: string; offsetX: number; offsetY: number } | null>(null);
    const panDragRef = useRef<{ startClientX: number; startClientY: number; startPanX: number; startPanY: number } | null>(null);
    const positionsRef = useRef(positions);
    positionsRef.current = positions;
    const panRef = useRef(pan);
    panRef.current = pan;
    const zoomRef = useRef(zoom);
    zoomRef.current = zoom;
    const boardSizeRef = useRef(boardSize);
    boardSizeRef.current = boardSize;

    useEffect(() => {
        const el = boardRef.current;
        if (!el || typeof ResizeObserver === 'undefined') {
            return undefined;
        }
        const ro = new ResizeObserver(() => setViewportWidth(el.clientWidth || VIEWPORT_WIDTH));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    function applyUsers(names: string[]) {
        const nextBoard = computeBoardSize(names.length);
        const nextZoom = fitZoomFor(nextBoard);
        setBoardSize(nextBoard);
        setZoom(nextZoom);
        setPan(centeredPanFor(nextBoard, nextZoom, boardRef.current?.clientWidth || VIEWPORT_WIDTH));
        setUsers(names);
        setPositions((prev) => {
            const next = layoutPositions(names, nextBoard);
            names.forEach((n: string) => { if (prev[n]) { next[n] = prev[n]; } });
            return next;
        });
    }

    function loadUsers() {
        if (scopeToUsernames) {
            applyUsers(scopeToUsernames);
            return;
        }
        axios.get(apiRoutes.allUsers).then((r) => {
            const names = r.data
                .filter((u: any) => u.active)
                .map((u: any) => u.username as string);
            applyUsers(names);
        }).catch((err) => {
            notifications.show({ title: t('Failed to load users'), message: err.response?.data?.error, icon: <IconX />, color: 'red' });
        });
    }

    function loadEdges() {
        setLoading(true);
        axios.get(apiRoutes.userVisibility).then((r) => {
            setLoading(false);
            let data = r.data as Edge[];
            if (scopeToUsernames) {
                const scope = new Set(scopeToUsernames);
                data = data.filter((e) => scope.has(e.source) && scope.has(e.target));
            }
            setEdges(data);
        }).catch((err) => {
            setLoading(false);
            notifications.show({ title: t('Failed to load visibility'), message: err.response?.data?.error, icon: <IconX />, color: 'red' });
        });
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { loadUsers(); loadEdges(); }, [JSON.stringify(scopeToUsernames)]);

    function connect(source: string, target: string) {
        setLoading(true);
        axios.put(apiRoutes.userVisibility, { source, target, type: mode }).then((r) => {
            loadEdges();
            onChange?.();
            const overriddenBy: string[] = r.data?.overridden_by ?? [];
            if (overriddenBy.length > 0) {
                notifications.show({
                    title: t('Saved, but still two-way'),
                    message: t(
                        '{{target}} still sends to {{source}} through: {{groups}}. A one-way line can only add access, not take it away. In those groups, set {{target}} to "Receive only" or {{source}} to "Send only" (or remove them).',
                        { source, target, groups: overriddenBy.join(', ') },
                    ),
                    icon: <IconAlertTriangle />,
                    color: 'orange',
                    autoClose: 15000,
                });
            }
        }).catch((err) => {
            setLoading(false);
            notifications.show({ title: t('Failed to connect users'), message: err.response?.data?.error, icon: <IconX />, color: 'red' });
        });
    }

    function disconnect(edge: Edge) {
        setLoading(true);
        axios.delete(apiRoutes.userVisibility, { params: { source: edge.source, target: edge.target } }).then(() => {
            loadEdges();
            onChange?.();
        }).catch((err) => {
            setLoading(false);
            notifications.show({ title: t('Failed to remove connection'), message: err.response?.data?.error, icon: <IconX />, color: 'red' });
        });
    }

    function handleNodeClick(name: string) {
        if (!selected) {
            setSelected(name);
            return;
        }
        if (selected === name) {
            setSelected(null);
            return;
        }
        const source = selected;
        setSelected(null);
        connect(source, name);
    }

    function onPointerDown(e: React.PointerEvent<HTMLDivElement>, name: string) {
        const board = boardRef.current;
        if (!board) { return; }
        const boardRect = board.getBoundingClientRect();
        const pos = positionsRef.current[name];
        if (!pos) { return; }
        const p = panRef.current;
        dragRef.current = {
            name,
            offsetX: (e.clientX - boardRect.left - p.x) / zoomRef.current - pos.x,
            offsetY: (e.clientY - boardRect.top - p.y) / zoomRef.current - pos.y,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.stopPropagation();
    }

    // Panning starts only when the pointer goes down directly on the
    // background layer (not bubbled up from a node), so it never fights
    // node dragging.
    function onBackgroundPointerDown(e: React.PointerEvent<HTMLDivElement>) {
        if (e.target !== e.currentTarget) { return; }
        panDragRef.current = {
            startClientX: e.clientX,
            startClientY: e.clientY,
            startPanX: panRef.current.x,
            startPanY: panRef.current.y,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
        if (selected && boardRef.current) {
            const rect = boardRef.current.getBoundingClientRect();
            const p = panRef.current;
            setPointer({ x: (e.clientX - rect.left - p.x) / zoomRef.current, y: (e.clientY - rect.top - p.y) / zoomRef.current });
        }
        if (dragRef.current && boardRef.current) {
            const boardRect = boardRef.current.getBoundingClientRect();
            const { name, offsetX, offsetY } = dragRef.current;
            const zoomNow = zoomRef.current;
            const p = panRef.current;
            const board = boardSizeRef.current;
            const x = Math.max(0, Math.min(board.width - NODE_WIDTH, (e.clientX - boardRect.left - p.x) / zoomNow - offsetX));
            const y = Math.max(0, Math.min(board.height - NODE_HEIGHT, (e.clientY - boardRect.top - p.y) / zoomNow - offsetY));
            setPositions((prev) => ({ ...prev, [name]: { x, y } }));
            return;
        }
        if (panDragRef.current) {
            const { startClientX, startClientY, startPanX, startPanY } = panDragRef.current;
            setPan({ x: startPanX + (e.clientX - startClientX), y: startPanY + (e.clientY - startClientY) });
        }
    }

    function onPointerUp() {
        dragRef.current = null;
        panDragRef.current = null;
    }

    function zoomBy(delta: number) {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((zoomRef.current + delta) * 20) / 20));
        setZoom(next);
        setPan(centeredPanFor(boardSizeRef.current, next, boardRef.current?.clientWidth || VIEWPORT_WIDTH));
    }

    const missingPositions = users.some((u) => !positions[u]);
    const inheritedCount = useMemo(() => edges.filter((e) => !e.manual).length, [edges]);
    const visibleEdges = useMemo(() => (showInherited ? edges : edges.filter((e) => e.manual)), [edges, showInherited]);
    const geometry = useMemo(() => computeGeometry(visibleEdges, positions, boardSize), [visibleEdges, positions, boardSize]);
    const geometryByKey = useMemo(() => new Map(geometry.map((g) => [g.key, g])), [geometry]);
    const hoveredGeometry = hoveredEdge ? geometryByKey.get(hoveredEdge) : undefined;

    // Stable callbacks for the memoised edge layer: they only touch setters
    // and refs, so a ref to the latest disconnect is all that's needed.
    const disconnectRef = useRef(disconnect);
    disconnectRef.current = disconnect;
    const edgeHandlers = useMemo(() => {
        const viewportPoint = (e: React.PointerEvent<SVGPathElement>): XY | null => {
            const rect = boardRef.current?.getBoundingClientRect();
            return rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : null;
        };
        return {
            onEdgeEnter: (key: string, e: React.PointerEvent<SVGPathElement> | null) => {
                setHoveredEdge(key);
                // Keyboard focus has no pointer -- null means "anchor at the edge's midpoint".
                setTipPos(e ? viewportPoint(e) : null);
            },
            onEdgeMove: (e: React.PointerEvent<SVGPathElement>) => setTipPos(viewportPoint(e)),
            onEdgeLeave: () => { setHoveredEdge(null); setTipPos(null); },
            onEdgeActivate: (edge: Edge) => {
                if (edge.manual) {
                    disconnectRef.current(edge);
                    setHoveredEdge(null);
                    setTipPos(null);
                } else {
                    notifications.show({ title: t('Not directly removable'), message: t('This comes from a shared group\'s Access list — remove one of them from that group instead.'), color: 'yellow' });
                }
            },
        };
    }, []);

    // Tooltip placement in viewport px: at the pointer, or at the edge's
    // midpoint for keyboard focus; flipped left/up near the right/bottom.
    let tooltip: React.ReactNode = null;
    if (hoveredGeometry) {
        const anchor = tipPos ?? { x: hoveredGeometry.mid.x * zoom + pan.x, y: hoveredGeometry.mid.y * zoom + pan.y };
        const { edge } = hoveredGeometry;
        const flipX = anchor.x > viewportWidth - 340;
        const flipY = anchor.y > VIEWPORT_HEIGHT - 90;
        tooltip = (
            <Paper
                pos="absolute"
                left={anchor.x + (flipX ? -14 : 14)}
                top={anchor.y + (flipY ? -14 : 14)}
                px="sm"
                py={6}
                radius="md"
                shadow="lg"
                withBorder
                bg="dark.7"
                style={{
                    pointerEvents: 'none',
                    zIndex: 5,
                    maxWidth: 320,
                    transform: `translate(${flipX ? '-100%' : '0'}, ${flipY ? '-100%' : '0'})`,
                    borderColor: EDGE_COLOR[hoveredGeometry.style],
                }}
            >
                <Text size="sm" fw={700}>
                    {edge.type === 'solid' ? `${edge.source} ⇄ ${edge.target}` : `${edge.source} → ${edge.target}`}
                </Text>
                <Text size="sm">
                    {edge.type === 'solid'
                        ? t('Both share data')
                        : t('{{b}} receives {{a}}\'s data', { a: edge.source, b: edge.target })}
                </Text>
                {(edge.source_groups?.length ?? 0) > 0 && (
                    <Text size="xs" c="dimmed">
                        {t('{{a}} → {{b}} via {{groups}}', { a: edge.source, b: edge.target, groups: edge.source_groups!.join(', ') })}
                    </Text>
                )}
                {(edge.target_groups?.length ?? 0) > 0 && (
                    <Text size="xs" c="dimmed">
                        {t('{{a}} → {{b}} via {{groups}}', { a: edge.target, b: edge.source, groups: edge.target_groups!.join(', ') })}
                    </Text>
                )}
                <Text size="xs" c="dimmed">
                    {edge.manual ? t('Click to disconnect') : t('Via a shared group\'s Access list — not directly removable here')}
                </Text>
            </Paper>
        );
    }

    // "Click another user" preview: from the selected node toward the
    // pointer, snapping to the border of whichever node is under it.
    let preview: React.ReactNode = null;
    const selectedPos = selected ? positions[selected] : undefined;
    if (selectedPos && pointer && !isInsideNode(pointer, selectedPos)) {
        const style: EdgeStyleKey = mode === 'solid' ? 'two' : 'one';
        const width = EDGE_WIDTH.manual;
        const tip = width * MARKER_SIZE.manual * MARKER_TIP;
        const ca = nodeCenter(selectedPos);
        const targetName = hoveredNode && hoveredNode !== selected ? hoveredNode : null;
        const targetPos = targetName ? positions[targetName] : undefined;
        const end = targetPos ? nodeCenter(targetPos) : pointer;
        const a = borderPoint(ca, end.x - ca.x, end.y - ca.y, BORDER_GAP);
        const b = targetPos ? borderPoint(end, ca.x - end.x, ca.y - end.y, BORDER_GAP) : pointer;
        const ctrl = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        preview = (
            <g pointerEvents="none" opacity={targetPos ? 1 : 0.75}>
                <ConnectorStroke d={visiblePath(a, ctrl, b, mode === 'solid' ? tip : 0, tip)} style={style} type={mode} width={width} markerPrefix={markerPrefix} />
            </g>
        );
    }

    const connectedToHovered = useMemo(() => {
        if (hoveredGeometry) { return new Set<string>([hoveredGeometry.edge.source, hoveredGeometry.edge.target]); }
        if (!hoveredNode) { return null; }
        const set = new Set<string>([hoveredNode]);
        visibleEdges.forEach((e) => {
            if (e.source === hoveredNode) { set.add(e.target); }
            if (e.target === hoveredNode) { set.add(e.source); }
        });
        return set;
    }, [hoveredNode, hoveredGeometry, visibleEdges]);

    // Pointer-driven state (tooltip position, connect preview) changes on
    // every mouse move; keep the node boxes and the plain-language list --
    // which can run to hundreds of rows -- out of those re-renders.
    const nodeClickRef = useRef(handleNodeClick);
    nodeClickRef.current = handleNodeClick;
    const nodePointerDownRef = useRef(onPointerDown);
    nodePointerDownRef.current = onPointerDown;
    const nodeElements = useMemo(() => (users.map((name) => {
        const pos = positions[name];
        if (!pos) { return null; }
        const isSelected = selected === name;
        const isTarget = !!selected && !isSelected && hoveredNode === name;
        const dimmed = connectedToHovered !== null && !connectedToHovered.has(name) && !isSelected;
        return (
            <Paper
                key={name}
                pos="absolute"
                left={pos.x}
                top={pos.y}
                w={NODE_WIDTH}
                h={NODE_HEIGHT}
                p="xs"
                radius="md"
                shadow="md"
                withBorder
                bg={isSelected ? 'blue.9' : 'dark.6'}
                style={{
                    cursor: selected && !isSelected ? 'pointer' : 'grab',
                    userSelect: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderColor: isSelected || isTarget ? 'var(--mantine-color-blue-4)' : undefined,
                    borderWidth: isSelected || isTarget ? 2 : 1,
                    opacity: dimmed ? 0.45 : 1,
                    transition: 'opacity 120ms ease',
                }}
                onPointerDown={(e) => nodePointerDownRef.current(e, name)}
                onPointerEnter={() => setHoveredNode(name)}
                onPointerLeave={() => setHoveredNode((h) => (h === name ? null : h))}
                onClick={(e) => { e.stopPropagation(); nodeClickRef.current(name); }}
            >
                <Text size="sm" fw={700} ta="center" style={{ overflowWrap: 'anywhere' }}>{name}</Text>
            </Paper>
        );
    })), [users, positions, selected, hoveredNode, connectedToHovered]);

    const plainLanguage = useMemo(() => (visibleEdges.length > 0 && (
    <Accordion variant="contained" radius="md" className="raven-surface raven-surface--tile">
        <Accordion.Item value="plain-language">
            <Accordion.Control icon={<Badge circle size="lg" variant="light" color="indigo">{visibleEdges.length}</Badge>}>
                <Text fw={700} size="sm">{t('What this means, plainly')}</Text>
            </Accordion.Control>
            <Accordion.Panel>
                <Stack gap={4}>
                    {visibleEdges.map((edge, i) => (
                        <Group key={i} gap="xs" wrap="nowrap">
                            <Badge color={!edge.manual ? 'gray' : edge.type === 'solid' ? 'indigo' : 'orange'} variant="light" style={{ flexShrink: 0 }}>
                                {edge.type === 'solid' ? t('TWO-WAY') : t('ONE-WAY')}
                            </Badge>
                            <Text size="sm">
                                {edge.type === 'solid'
                                    ? t('{{a}} and {{b}} exchange permitted TAK data (position, chat, and more) with each other — a consequence of this is that they can see each other on the map.', { a: edge.source, b: edge.target })
                                    : t('{{b}} receives {{a}}\'s permitted TAK data (position, chat, and more) — including seeing them on the map — but {{a}} does not receive {{b}}\'s.', { a: edge.source, b: edge.target })}
                                {!edge.manual && <Text component="span" size="xs" c="dimmed"> ({t('via a shared group')})</Text>}
                            </Text>
                            {edge.manual ? (
                                <Tooltip label={t('Remove this connection')}>
                                    <ActionIcon color="red" variant="subtle" style={{ flexShrink: 0 }} onClick={() => disconnectRef.current(edge)}>
                                        <IconTrash size={16} />
                                    </ActionIcon>
                                </Tooltip>
                            ) : (
                                <Tooltip label={t('Comes from a shared group\'s Access list — remove one of them from that group instead')}>
                                    <ActionIcon color="gray" variant="subtle" style={{ flexShrink: 0 }} disabled>
                                        <IconTrash size={16} />
                                    </ActionIcon>
                                </Tooltip>
                            )}
                        </Group>
                    ))}
                </Stack>
            </Accordion.Panel>
        </Accordion.Item>
    </Accordion>
    )), [visibleEdges]);

    return (
        <Stack gap="md">
            <Group justify="center" gap="xs">
    <Text size="sm" c="dimmed">{t('Click a user, choose a connection type, then click another user:')}</Text>
    <SegmentedControl
        value={mode}
        onChange={(v) => setMode(v as 'solid' | 'dotted')}
        data={[
            { label: t('⇄ Two-Way'), value: 'solid' },
            { label: t('→ One-Way'), value: 'dotted' },
        ]}
    />
    {inheritedCount > 0 && (
        <Tooltip label={t('Connections implied by shared groups — off by default to keep the diagram readable')}>
            <Switch
                size="sm"
                checked={showInherited}
                onChange={(e) => setShowInherited(e.currentTarget.checked)}
                label={t('Show {{count}} group-inherited', { count: inheritedCount })}
            />
        </Tooltip>
    )}
    <Tooltip label={t('Zoom out')}>
        <ActionIcon variant="light" onClick={() => zoomBy(-0.1)}><IconZoomOut size={16} /></ActionIcon>
    </Tooltip>
    <Text size="xs" c="dimmed" w={40} ta="center">{Math.round(zoom * 100)}%</Text>
    <Tooltip label={t('Zoom in')}>
        <ActionIcon variant="light" onClick={() => zoomBy(0.1)}><IconZoomIn size={16} /></ActionIcon>
    </Tooltip>
    <Tooltip label={t('Reset zoom')}>
        <ActionIcon variant="light" onClick={() => { const z = fitZoomFor(boardSize); setZoom(z); setPan(centeredPanFor(boardSize, z, boardRef.current?.clientWidth || VIEWPORT_WIDTH)); }}><IconZoomReset size={16} /></ActionIcon>
    </Tooltip>
            </Group>

            <Box
    ref={boardRef}
    pos="relative"
    w="100%"
    h={VIEWPORT_HEIGHT}
    bg="dark.8"
    style={{ borderRadius: 16, border: '1px solid var(--mantine-color-dark-4)', overflow: 'hidden', touchAction: 'none', cursor: selected ? 'crosshair' : 'grab' }}
    onPointerDown={onBackgroundPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={onPointerUp}
    onPointerLeave={() => setPointer(null)}
    onClick={(e) => { if (e.target === e.currentTarget) { setSelected(null); } }}
            >
              <Box
    pos="absolute"
    left={0}
    top={0}
    w={boardSize.width}
    h={boardSize.height}
    style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
    onPointerDown={onBackgroundPointerDown}
    onClick={(e) => { if (e.target === e.currentTarget) { setSelected(null); } }}
              >
    {/* Drawn beneath the nodes: lines end just outside each box,
        and any that pass behind a third user are hidden by it
        rather than scribbled across its name. */}
    {!missingPositions && (
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
            <ArrowMarkers prefix={markerPrefix} />
            <EdgeLayer
                geometry={geometry}
                hoveredEdge={hoveredEdge}
                hoveredNode={hoveredNode}
                markerPrefix={markerPrefix}
                onEdgeEnter={edgeHandlers.onEdgeEnter}
                onEdgeMove={edgeHandlers.onEdgeMove}
                onEdgeLeave={edgeHandlers.onEdgeLeave}
                onEdgeActivate={edgeHandlers.onEdgeActivate}
            />
            {preview}
        </svg>
    )}

    {nodeElements}

    {users.length === 0 && (
        <Text pos="absolute" top="50%" left="50%" style={{ transform: 'translate(-50%, calc(-50% + 70px))' }} c="dimmed" size="sm">
            {scopeToUsernames ? t('No members in this group yet — add some above first.') : t('No users yet.')}
        </Text>
    )}
              </Box>
              {tooltip}
              {selected && (
      <Paper pos="absolute" top={12} left="50%" px="md" py={6} radius="xl" withBorder bg="dark.7" style={{ transform: 'translateX(-50%)', pointerEvents: 'none', borderColor: 'var(--mantine-color-blue-6)', whiteSpace: 'nowrap' }}>
          <Text size="sm">
              {t('Now click another user to connect')} <Text component="span" fw={700} size="sm">{selected}</Text>
              <Text component="span" c="dimmed" size="sm"> · {t('click it again to cancel')}</Text>
          </Text>
      </Paper>
              )}
            </Box>

            <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
    <ArrowMarkers prefix={`${markerPrefix}lg`} />
            </svg>
            <Group justify="center" gap="lg">
    <Group gap={8} wrap="nowrap"><LegendSample style="two" type="solid" markerPrefix={`${markerPrefix}lg`} /><Text size="sm">{t('Two-way — both send permitted TAK data (position, chat, and more) to each other')}</Text></Group>
    <Group gap={8} wrap="nowrap"><LegendSample style="one" type="dotted" markerPrefix={`${markerPrefix}lg`} /><Text size="sm">{t('One-way — the arrow points at the user who receives data')}</Text></Group>
    {showInherited && inheritedCount > 0 && (
        <Group gap={8} wrap="nowrap"><LegendSample style="inherited" type="solid" markerPrefix={`${markerPrefix}lg`} /><Text size="sm" c="dimmed">{t('Grey — implied by a shared group (not removable here)')}</Text></Group>
    )}
            </Group>

            {plainLanguage}
        </Stack>
    );
}
