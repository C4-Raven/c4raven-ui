import React, { useEffect, useRef, useState } from 'react';
import { ActionIcon, Badge, Box, Button, Group, Paper, SegmentedControl, Stack, Text, Tooltip } from '@mantine/core';
import { IconTrash, IconX, IconZoomIn, IconZoomOut, IconZoomReset } from '@tabler/icons-react';
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
// instead of leaving it pinned to the top-left corner.
function centeredPanFor(board: BoardSize, zoomValue: number): XY {
    return {
        x: (VIEWPORT_WIDTH - board.width * zoomValue) / 2,
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
    const [loading, setLoading] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [boardSize, setBoardSize] = useState<BoardSize>(() => computeBoardSize(0));
    const [pan, setPan] = useState<XY>({ x: 0, y: 0 });

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

    function applyUsers(names: string[]) {
        const nextBoard = computeBoardSize(names.length);
        const nextZoom = fitZoomFor(nextBoard);
        setBoardSize(nextBoard);
        setZoom(nextZoom);
        setPan(centeredPanFor(nextBoard, nextZoom));
        setUsers(names);
        setPositions((prev) => {
            const next = layoutPositions(names, nextBoard);
            names.forEach((n: string) => { if (prev[n]) next[n] = prev[n]; });
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
        axios.put(apiRoutes.userVisibility, { source, target, type: mode }).then(() => {
            loadEdges();
            onChange?.();
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
        if (!board) return;
        const boardRect = board.getBoundingClientRect();
        const pos = positionsRef.current[name];
        if (!pos) return;
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
        if (e.target !== e.currentTarget) return;
        panDragRef.current = {
            startClientX: e.clientX,
            startClientY: e.clientY,
            startPanX: panRef.current.x,
            startPanY: panRef.current.y,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
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
        setPan(centeredPanFor(boardSizeRef.current, next));
    }

    function center(name: string): XY {
        const p = positions[name];
        if (!p) return { x: boardSize.width / 2, y: boardSize.height / 2 };
        return { x: p.x + NODE_WIDTH / 2, y: p.y + NODE_HEIGHT / 2 };
    }

    // Where a ray from a node's center, heading toward (dx, dy), exits its
    // rectangular box -- so lines/arrows stop at the box edge instead of
    // running into the middle of it.
    function edgePoint(nodeCenter: XY, dx: number, dy: number): XY {
        if (dx === 0 && dy === 0) return nodeCenter;
        const halfW = NODE_WIDTH / 2;
        const halfH = NODE_HEIGHT / 2;
        const scaleX = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
        const scaleY = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
        const scale = Math.min(scaleX, scaleY);
        return { x: nodeCenter.x + dx * scale, y: nodeCenter.y + dy * scale };
    }

    const missingPositions = users.some((u) => !positions[u]);

    return (
        <Stack gap="md">
            <Group justify="center" gap="xs">
                <Text size="sm" c="dimmed">{t('Click a user, choose a connection type, then click another user:')}</Text>
                <SegmentedControl
                    value={mode}
                    onChange={(v) => setMode(v as 'solid' | 'dotted')}
                    data={[
                        { label: t('— Two-Way'), value: 'solid' },
                        { label: t('┄ One-Way'), value: 'dotted' },
                    ]}
                />
                <Tooltip label={t('Zoom out')}>
                    <ActionIcon variant="light" onClick={() => zoomBy(-0.1)}><IconZoomOut size={16} /></ActionIcon>
                </Tooltip>
                <Text size="xs" c="dimmed" w={40} ta="center">{Math.round(zoom * 100)}%</Text>
                <Tooltip label={t('Zoom in')}>
                    <ActionIcon variant="light" onClick={() => zoomBy(0.1)}><IconZoomIn size={16} /></ActionIcon>
                </Tooltip>
                <Tooltip label={t('Reset zoom')}>
                    <ActionIcon variant="light" onClick={() => { const z = fitZoomFor(boardSize); setZoom(z); setPan(centeredPanFor(boardSize, z)); }}><IconZoomReset size={16} /></ActionIcon>
                </Tooltip>
            </Group>

            <Box
                ref={boardRef}
                pos="relative"
                w="100%"
                h={VIEWPORT_HEIGHT}
                bg="dark.8"
                style={{ borderRadius: 16, border: '1px solid var(--mantine-color-dark-4)', overflow: 'hidden', touchAction: 'none', cursor: 'grab' }}
                onPointerDown={onBackgroundPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}
            >
              <Box
                pos="absolute"
                left={0}
                top={0}
                w={boardSize.width}
                h={boardSize.height}
                style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
                onPointerDown={onBackgroundPointerDown}
                onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}
              >
                {users.map((name) => {
                    const pos = positions[name];
                    if (!pos) return null;
                    const isSelected = selected === name;
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
                                cursor: 'grab',
                                userSelect: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderColor: isSelected ? 'var(--mantine-color-blue-4)' : undefined,
                                borderWidth: isSelected ? 2 : 1,
                            }}
                            onPointerDown={(e) => onPointerDown(e, name)}
                            onClick={(e) => { e.stopPropagation(); handleNodeClick(name); }}
                        >
                            <Text size="sm" fw={700} ta="center" style={{ overflowWrap: 'anywhere' }}>{name}</Text>
                        </Paper>
                    );
                })}

                {!missingPositions && (
                    <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                        <defs>
                            {/* Points forward (toward the target) -- used for markerEnd. */}
                            <marker id="uvArrowEnd" markerWidth="4" markerHeight="3" refX="2.7" refY="1.35" orient="auto">
                                <path d="M0,0 L0,2.7 L3,1.35 z" fill="var(--mantine-color-blue-4)" />
                            </marker>
                            {/* Mirror image, points backward -- used for markerStart, so on a
                                solid (two-way) line the two arrowheads point out away from
                                each other instead of both the same direction. */}
                            <marker id="uvArrowStart" markerWidth="4" markerHeight="3" refX="0.3" refY="1.35" orient="auto">
                                <path d="M3,0 L3,2.7 L0,1.35 z" fill="var(--mantine-color-blue-4)" />
                            </marker>
                        </defs>
                        {edges.map((edge, i) => {
                            const aCenter = center(edge.source);
                            const bCenter = center(edge.target);
                            const dx = bCenter.x - aCenter.x;
                            const dy = bCenter.y - aCenter.y;
                            const a = edgePoint(aCenter, dx, dy);
                            const b = edgePoint(bCenter, -dx, -dy);
                            const mx = (a.x + b.x) / 2;
                            const my = (a.y + b.y) / 2;
                            const removable = edge.manual;
                            return (
                                <g key={`${edge.source}-${edge.target}-${edge.type}-${i}`}>
                                    <line
                                        x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                                        stroke={removable ? 'var(--mantine-color-gray-5)' : 'var(--mantine-color-dark-2)'}
                                        strokeWidth={4}
                                        strokeDasharray={edge.type === 'dotted' ? '7 8' : undefined}
                                        markerStart={edge.type === 'solid' ? 'url(#uvArrowStart)' : undefined}
                                        markerEnd="url(#uvArrowEnd)"
                                        pointerEvents="stroke"
                                        style={{ cursor: removable ? 'pointer' : 'not-allowed' }}
                                        onClick={() => { if (removable) disconnect(edge); else notifications.show({ title: t('Not directly removable'), message: t('This comes from a shared group\'s Access list — remove one of them from that group instead.'), color: 'yellow' }); }}
                                    >
                                        {!removable && <title>{t('Via a shared group\'s Access list — not directly removable here')}</title>}
                                    </line>
                                    <text
                                        x={mx} y={my - 8}
                                        textAnchor="middle"
                                        fontSize={11}
                                        fontWeight={700}
                                        fill="var(--mantine-color-gray-3)"
                                        style={{ paintOrder: 'stroke', stroke: 'var(--mantine-color-dark-8)', strokeWidth: 4 }}
                                    >
                                        {(edge.type === 'solid' ? t('TWO-WAY') : t('ONE-WAY')) + (removable ? '' : ` (${t('via group')})`)}
                                    </text>
                                </g>
                            );
                        })}
                    </svg>
                )}

                {users.length === 0 && (
                    <Text pos="absolute" top="50%" left="50%" style={{ transform: 'translate(-50%, calc(-50% + 70px))' }} c="dimmed" size="sm">
                        {scopeToUsernames ? t('No members in this group yet — add some above first.') : t('No users yet.')}
                    </Text>
                )}
              </Box>
            </Box>

            <Group justify="center" gap="lg">
                <Group gap={6}><Box w={32} h={0} style={{ borderTop: '3px solid var(--mantine-color-gray-5)' }} /><Text size="sm">{t('Two-way — both send permitted TAK data (position, chat, and more) to each other')}</Text></Group>
                <Group gap={6}><Box w={32} h={0} style={{ borderTop: '3px dashed var(--mantine-color-gray-5)' }} /><Text size="sm">{t('One-way — the arrow points at the user who receives data')}</Text></Group>
            </Group>

            <Paper p="md" radius="md" className="raven-surface raven-surface--tile">
                <Text fw={700} size="sm" mb={6}>{t('What this means, plainly:')}</Text>
                {edges.length === 0 ? (
                    <Text size="sm" c="dimmed">{t('No connections yet. Click a user, then another, to connect them.')}</Text>
                ) : (
                    <Stack gap={4}>
                        {edges.map((edge, i) => (
                            <Group key={i} gap="xs" wrap="nowrap">
                                <Badge color={edge.type === 'solid' ? 'blue' : 'gray'} variant="light" style={{ flexShrink: 0 }}>
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
                                        <ActionIcon color="red" variant="subtle" style={{ flexShrink: 0 }} onClick={() => disconnect(edge)}>
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
                )}
            </Paper>

            <Text size="xs" c="dimmed" ta="center">
                {t('This diagram always reflects real permissions — connecting or disconnecting here immediately changes what each user can see and send.')}
            </Text>
        </Stack>
    );
}
