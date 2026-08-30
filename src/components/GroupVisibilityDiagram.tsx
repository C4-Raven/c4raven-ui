import React, { useEffect, useRef, useState } from 'react';
import { Badge, Box, Button, Group, Paper, SegmentedControl, Stack, Text, ThemeIcon, Tooltip } from '@mantine/core';
import { IconDeviceDesktop, IconX } from '@tabler/icons-react';
import axios from '../axios_config';
import { apiRoutes } from '../apiRoutes';
import { notifications } from '@mantine/notifications';
import { t } from 'i18next';

interface Edge {
    source: string;
    target: string;
    type: 'solid' | 'dotted';
}

interface XY { x: number; y: number; }

const BOARD_WIDTH = 880;
const BOARD_HEIGHT = 560;
const NODE_WIDTH = 168;
const NODE_HEIGHT = 60;
const HUB_SIZE = 110;

function layoutPositions(names: string[]): Record<string, XY> {
    const cx = BOARD_WIDTH / 2;
    const cy = BOARD_HEIGHT / 2;
    const radius = Math.min(BOARD_WIDTH, BOARD_HEIGHT) / 2 - 95;
    const positions: Record<string, XY> = {};
    names.forEach((name, i) => {
        const angle = (2 * Math.PI * i) / Math.max(names.length, 1) - Math.PI / 2;
        positions[name] = {
            x: cx + radius * Math.cos(angle) - NODE_WIDTH / 2,
            y: cy + radius * Math.sin(angle) - NODE_HEIGHT / 2,
        };
    });
    return positions;
}

export default function GroupVisibilityDiagram() {
    const [groups, setGroups] = useState<string[]>([]);
    const [edges, setEdges] = useState<Edge[]>([]);
    const [positions, setPositions] = useState<Record<string, XY>>({});
    const [selected, setSelected] = useState<string | null>(null);
    const [mode, setMode] = useState<'solid' | 'dotted'>('solid');
    const [loading, setLoading] = useState(false);

    const boardRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ name: string; offsetX: number; offsetY: number } | null>(null);
    const positionsRef = useRef(positions);
    positionsRef.current = positions;

    function loadGroups() {
        axios.get(apiRoutes.allGroups).then((r) => {
            const names = r.data.map((g: any) => g.name).filter((n: string) => n !== '__ANON__');
            setGroups(names);
            setPositions((prev) => {
                const next = layoutPositions(names);
                names.forEach((n: string) => { if (prev[n]) next[n] = prev[n]; });
                return next;
            });
        }).catch((err) => {
            notifications.show({ title: t('Failed to load groups'), message: err.response?.data?.error, icon: <IconX />, color: 'red' });
        });
    }

    function loadEdges() {
        setLoading(true);
        axios.get(apiRoutes.groupVisibility).then((r) => {
            setLoading(false);
            setEdges(r.data);
        }).catch((err) => {
            setLoading(false);
            notifications.show({ title: t('Failed to load group visibility'), message: err.response?.data?.error, icon: <IconX />, color: 'red' });
        });
    }

    useEffect(() => { loadGroups(); loadEdges(); }, []);

    function connect(source: string, target: string) {
        setLoading(true);
        axios.put(apiRoutes.groupVisibility, { source, target, type: mode }).then(() => {
            loadEdges();
        }).catch((err) => {
            setLoading(false);
            notifications.show({ title: t('Failed to connect groups'), message: err.response?.data?.error, icon: <IconX />, color: 'red' });
        });
    }

    function disconnect(edge: Edge) {
        setLoading(true);
        axios.delete(apiRoutes.groupVisibility, { params: { source: edge.source, target: edge.target, type: edge.type } }).then(() => {
            loadEdges();
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
        dragRef.current = {
            name,
            offsetX: e.clientX - boardRect.left - pos.x,
            offsetY: e.clientY - boardRect.top - pos.y,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
        if (!dragRef.current || !boardRef.current) return;
        const boardRect = boardRef.current.getBoundingClientRect();
        const { name, offsetX, offsetY } = dragRef.current;
        const x = Math.max(0, Math.min(BOARD_WIDTH - NODE_WIDTH, e.clientX - boardRect.left - offsetX));
        const y = Math.max(0, Math.min(BOARD_HEIGHT - NODE_HEIGHT, e.clientY - boardRect.top - offsetY));
        setPositions((prev) => ({ ...prev, [name]: { x, y } }));
    }

    function onPointerUp() {
        dragRef.current = null;
    }

    function center(name: string): XY {
        const p = positions[name];
        if (!p) return { x: BOARD_WIDTH / 2, y: BOARD_HEIGHT / 2 };
        return { x: p.x + NODE_WIDTH / 2, y: p.y + NODE_HEIGHT / 2 };
    }

    const missingPositions = groups.some((g) => !positions[g]);

    return (
        <Stack gap="md">
            <Group justify="center" gap="xs">
                <Text size="sm" c="dimmed">{t('Click a group, choose a connection type, then click another group:')}</Text>
                <SegmentedControl
                    value={mode}
                    onChange={(v) => setMode(v as 'solid' | 'dotted')}
                    data={[
                        { label: t('— See + Message'), value: 'solid' },
                        { label: t('┄ Receive Only'), value: 'dotted' },
                    ]}
                />
            </Group>

            <Box
                ref={boardRef}
                pos="relative"
                w="100%"
                h={BOARD_HEIGHT}
                bg="dark.8"
                style={{ borderRadius: 16, border: '1px solid var(--mantine-color-dark-4)', overflow: 'hidden', touchAction: 'none' }}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}
            >
                {!missingPositions && (
                    <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                        <defs>
                            <marker id="rvArrow" markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto">
                                <path d="M0,0 L0,7 L8,3.5 z" fill="var(--mantine-color-gray-4)" />
                            </marker>
                        </defs>
                        {edges.map((edge, i) => {
                            const a = center(edge.source);
                            const b = center(edge.target);
                            const mx = (a.x + b.x) / 2;
                            const my = (a.y + b.y) / 2;
                            return (
                                <g key={`${edge.source}-${edge.target}-${edge.type}-${i}`}>
                                    <line
                                        x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                                        stroke="var(--mantine-color-gray-5)"
                                        strokeWidth={4}
                                        strokeDasharray={edge.type === 'dotted' ? '7 8' : undefined}
                                        markerEnd={edge.type === 'dotted' ? 'url(#rvArrow)' : undefined}
                                        pointerEvents="stroke"
                                        style={{ cursor: 'pointer' }}
                                        onClick={() => disconnect(edge)}
                                    />
                                    <text
                                        x={mx} y={my - 8}
                                        textAnchor="middle"
                                        fontSize={11}
                                        fontWeight={700}
                                        fill="var(--mantine-color-gray-3)"
                                        style={{ paintOrder: 'stroke', stroke: 'var(--mantine-color-dark-8)', strokeWidth: 4 }}
                                    >
                                        {edge.type === 'solid' ? t('SEE + MESSAGE') : t('RECEIVE ONLY')}
                                    </text>
                                </g>
                            );
                        })}
                    </svg>
                )}

                <Stack
                    align="center"
                    gap={2}
                    pos="absolute"
                    left={BOARD_WIDTH / 2 - HUB_SIZE / 2}
                    top={BOARD_HEIGHT / 2 - HUB_SIZE / 2}
                    w={HUB_SIZE}
                    style={{ pointerEvents: 'none' }}
                >
                    <ThemeIcon size={40} radius="md" variant="light" color="blue"><IconDeviceDesktop size={22} /></ThemeIcon>
                    <Text size="xs" fw={700} ta="center">{t('C4 RAVEN')}</Text>
                </Stack>

                {groups.map((name) => {
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

                {groups.length === 0 && (
                    <Text pos="absolute" top="50%" left="50%" style={{ transform: 'translate(-50%, calc(-50% + 70px))' }} c="dimmed" size="sm">
                        {t('No groups yet — create some on the Groups page first.')}
                    </Text>
                )}
            </Box>

            <Group justify="center" gap="lg">
                <Group gap={6}><Box w={32} h={0} style={{ borderTop: '3px solid var(--mantine-color-gray-5)' }} /><Text size="sm">{t('Solid = both groups can see each other and message each other')}</Text></Group>
                <Group gap={6}><Box w={32} h={0} style={{ borderTop: '3px dashed var(--mantine-color-gray-5)' }} /><Text size="sm">{t('Dotted + arrow = one-way, receive only')}</Text></Group>
            </Group>

            <Paper withBorder p="md" radius="md" bg="dark.7">
                <Text fw={700} size="sm" mb={6}>{t('What this means, plainly:')}</Text>
                {edges.length === 0 ? (
                    <Text size="sm" c="dimmed">{t('No connections yet. Click a group, then another, to connect them.')}</Text>
                ) : (
                    <Stack gap={4}>
                        {edges.map((edge, i) => (
                            <Group key={i} gap="xs" wrap="nowrap">
                                <Badge color={edge.type === 'solid' ? 'blue' : 'gray'} variant="light" style={{ flexShrink: 0 }}>
                                    {edge.type === 'solid' ? t('MUTUAL') : t('ONE-WAY')}
                                </Badge>
                                <Text size="sm">
                                    {edge.type === 'solid'
                                        ? t('{{a}} and {{b}} can see each other\'s data and message each other.', { a: edge.source, b: edge.target })
                                        : t('{{b}} receives {{a}}\'s data, but {{a}} does not receive {{b}}\'s.', { a: edge.source, b: edge.target })}
                                </Text>
                                <Tooltip label={t('Click the line on the diagram to remove this connection')}>
                                    <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>({t('click line to remove')})</Text>
                                </Tooltip>
                            </Group>
                        ))}
                    </Stack>
                )}
            </Paper>

            <Text size="xs" c="dimmed" ta="center">
                {t('This diagram always reflects your real group permissions — connecting or disconnecting here immediately changes what users in those groups can see.')}
            </Text>
        </Stack>
    );
}
