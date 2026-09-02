import React, { useRef, useState } from 'react';
import {
    ActionIcon,
    Badge,
    Box,
    Group,
    Modal,
    Paper,
    Select,
    Stack,
    Text,
    TextInput,
    Tooltip,
    Button,
    TagsInput,
    Switch,
} from '@mantine/core';
import { IconArrowsExchange, IconServer2, IconTrash, IconZoomIn, IconZoomOut, IconZoomReset } from '@tabler/icons-react';
import { t } from 'i18next';

export interface DiagramEntity {
    id: string;
    type: string;
    displayName?: string;
    name?: string;
    config?: Record<string, any>;
}

// Matches Federation Hub's actual GroupsFilterType enum values exactly (decompiled
// from the native admin panel's JS bundle) -- these are NOT the same casing/words
// as anywhere else in this app, and a mismatched value here is silently ignored by
// the broker rather than erroring, so a rule can look configured in this UI while
// doing nothing (or the wrong thing) for real traffic.
export interface DiagramRuleFilter {
    groupsFilterType: 'allGroups' | 'allowed' | 'disallowed' | 'allowedAndDisallowed';
    allowedGroups: string[];
    disallowedGroups: string[];
}

export interface DiagramRule {
    id: string;
    name: string;
    source: string;
    destination: string;
    filter: DiagramRuleFilter;
}

interface XY { x: number; y: number; }

// "nodes" is typed loosely on purpose -- Federation Hub stores this as an
// arbitrary blob and doesn't reliably hand back an array (see viewNodesArray).
interface GraphView { nodes?: unknown; settings?: { zoom?: number; canvas_x?: number; canvas_y?: number } }

const VIEWPORT_WIDTH = 1250;
const VIEWPORT_HEIGHT = 560;
const NODE_WIDTH = 170;
const NODE_HEIGHT = 60;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;

function defaultLayout(entities: DiagramEntity[]): Record<string, XY> {
    const cx = VIEWPORT_WIDTH / 2;
    const cy = VIEWPORT_HEIGHT / 2;
    const radius = Math.max(160, (entities.length * (NODE_WIDTH + 20)) / (2 * Math.PI));
    const positions: Record<string, XY> = {};
    entities.forEach((e, i) => {
        const angle = (2 * Math.PI * i) / Math.max(entities.length, 1) - Math.PI / 2;
        positions[e.id] = {
            x: cx + radius * Math.cos(angle) - NODE_WIDTH / 2,
            y: cy + radius * Math.sin(angle) - NODE_HEIGHT / 2,
        };
    });
    return positions;
}

const EMPTY_FILTER: DiagramRuleFilter = { groupsFilterType: 'allGroups', allowedGroups: [], disallowedGroups: [] };

// bidirectional is a UI-only convenience on the add-rule form -- it isn't a
// real field in the saved rule, saving with it checked just creates a second
// mirrored rule alongside the first.
type RuleFormState = DiagramRule & { bidirectional?: boolean };

function filterTypeLabel(type: DiagramRuleFilter['groupsFilterType']): string {
    switch (type) {
        case 'allowed': return t('Allowed only');
        case 'disallowed': return t('Except disallowed');
        case 'allowedAndDisallowed': return t('Allowed, except disallowed');
        default: return t('All');
    }
}

// Federation Hub stores "views" as an arbitrary JsonNode blob and appears to
// normalize an empty array to `{}` on its own round-trip (confirmed live: we
// saved nodes: [] and a subsequent GET came back with nodes: {}) -- so never
// assume it's still an array on the way back in.
function viewNodesArray(nodes: unknown): { id: string; x: number; y: number }[] {
    return Array.isArray(nodes) ? nodes : [];
}

interface Props {
    entities: DiagramEntity[];
    rules: DiagramRule[];
    views?: GraphView;
    knownGroups: string[];
    onRulesChange: (rules: DiagramRule[]) => void;
    onViewsChange: (views: GraphView) => void;
}

export default function FederationPolicyDiagram({ entities, rules, views, knownGroups, onRulesChange, onViewsChange }: Props) {
    const [positions, setPositions] = useState<Record<string, XY>>(() => {
        const stored: Record<string, XY> = {};
        viewNodesArray(views?.nodes).forEach((n) => { stored[n.id] = { x: n.x, y: n.y }; });
        return { ...defaultLayout(entities), ...stored };
    });

    // Entities can be added/removed after mount (e.g. a new outgoing
    // connection) -- backfill a default position for any that don't have
    // one yet instead of only laying out once at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const entityIds = entities.map((e) => e.id).join(',');
    React.useEffect(() => {
        setPositions((prev) => {
            const missing = entities.filter((e) => !prev[e.id]);
            if (missing.length === 0) {
                return prev;
            }
            const stored: Record<string, XY> = {};
            viewNodesArray(views?.nodes).forEach((n) => { stored[n.id] = { x: n.x, y: n.y }; });
            const next = { ...prev };
            const existingCount = Object.keys(prev).length;
            const totalCount = existingCount + missing.length;
            missing.forEach((e, i) => {
                if (stored[e.id]) {
                    next[e.id] = stored[e.id];
                    return;
                }
                // Spread every node (existing + new) evenly around the circle
                // by total count, continuing from where existing ones left
                // off -- angling purely by the new batch's own index would
                // put every lone addition at the same angle as the last one.
                const angle = (2 * Math.PI * (existingCount + i)) / Math.max(totalCount, 1);
                const radius = Math.max(160, (totalCount * (NODE_WIDTH + 20)) / (2 * Math.PI));
                next[e.id] = {
                    x: VIEWPORT_WIDTH / 2 + radius * Math.cos(angle) - NODE_WIDTH / 2,
                    y: VIEWPORT_HEIGHT / 2 + radius * Math.sin(angle) - NODE_HEIGHT / 2,
                };
            });
            return next;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entityIds]);

    const [zoom, setZoom] = useState(views?.settings?.zoom || 1);
    const [pan, setPan] = useState<XY>({ x: views?.settings?.canvas_x || 0, y: views?.settings?.canvas_y || 0 });
    const [selectedNode, setSelectedNode] = useState<string | null>(null);

    const [showRuleModal, setShowRuleModal] = useState(false);
    const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
    const [ruleForm, setRuleForm] = useState<RuleFormState>({ id: '', name: '', source: '', destination: '', filter: EMPTY_FILTER, bidirectional: false });

    const boardRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
    const panDragRef = useRef<{ startClientX: number; startClientY: number; startPanX: number; startPanY: number } | null>(null);
    const positionsRef = useRef(positions);
    positionsRef.current = positions;
    const panRef = useRef(pan);
    panRef.current = pan;
    const zoomRef = useRef(zoom);
    zoomRef.current = zoom;

    function persistViews(nextPositions: Record<string, XY>, nextZoom: number, nextPan: XY) {
        onViewsChange({
            nodes: entities.map((e) => ({ id: e.id, x: nextPositions[e.id]?.x ?? 0, y: nextPositions[e.id]?.y ?? 0 })),
            settings: { zoom: nextZoom, canvas_x: nextPan.x, canvas_y: nextPan.y },
        });
    }

    function onNodePointerDown(e: React.PointerEvent<HTMLDivElement>, id: string) {
        const board = boardRef.current;
        if (!board) return;
        const rect = board.getBoundingClientRect();
        const pos = positionsRef.current[id];
        if (!pos) return;
        const p = panRef.current;
        dragRef.current = {
            id,
            offsetX: (e.clientX - rect.left - p.x) / zoomRef.current - pos.x,
            offsetY: (e.clientY - rect.top - p.y) / zoomRef.current - pos.y,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.stopPropagation();
    }

    function onBackgroundPointerDown(e: React.PointerEvent<HTMLDivElement>) {
        if (e.target !== e.currentTarget) return;
        panDragRef.current = { startClientX: e.clientX, startClientY: e.clientY, startPanX: panRef.current.x, startPanY: panRef.current.y };
        e.currentTarget.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
        if (dragRef.current && boardRef.current) {
            const rect = boardRef.current.getBoundingClientRect();
            const { id, offsetX, offsetY } = dragRef.current;
            const p = panRef.current;
            const x = (e.clientX - rect.left - p.x) / zoomRef.current - offsetX;
            const y = (e.clientY - rect.top - p.y) / zoomRef.current - offsetY;
            setPositions((prev) => ({ ...prev, [id]: { x, y } }));
            return;
        }
        if (panDragRef.current) {
            const { startClientX, startClientY, startPanX, startPanY } = panDragRef.current;
            setPan({ x: startPanX + (e.clientX - startClientX), y: startPanY + (e.clientY - startClientY) });
        }
    }

    function onPointerUp() {
        if (dragRef.current) {
            dragRef.current = null;
            persistViews(positionsRef.current, zoomRef.current, panRef.current);
        }
        panDragRef.current = null;
    }

    function zoomBy(delta: number) {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((zoomRef.current + delta) * 20) / 20));
        setZoom(next);
        persistViews(positionsRef.current, next, panRef.current);
    }

    function center(id: string): XY {
        const p = positions[id];
        if (!p) return { x: VIEWPORT_WIDTH / 2, y: VIEWPORT_HEIGHT / 2 };
        return { x: p.x + NODE_WIDTH / 2, y: p.y + NODE_HEIGHT / 2 };
    }

    function edgePoint(nodeCenter: XY, dx: number, dy: number): XY {
        if (dx === 0 && dy === 0) return nodeCenter;
        const halfW = NODE_WIDTH / 2;
        const halfH = NODE_HEIGHT / 2;
        const scaleX = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
        const scaleY = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
        const scale = Math.min(scaleX, scaleY);
        return { x: nodeCenter.x + dx * scale, y: nodeCenter.y + dy * scale };
    }

    function entityLabel(id: string): string {
        const e = entities.find((x) => x.id === id);
        return e ? (e.displayName || e.name || id) : id;
    }

    function handleNodeClick(id: string) {
        if (!selectedNode) {
            setSelectedNode(id);
            return;
        }
        if (selectedNode === id) {
            setSelectedNode(null);
            return;
        }
        const source = selectedNode;
        setSelectedNode(null);
        openAddRule(source, id);
    }

    function openAddRule(source: string, destination: string) {
        setRuleForm({
            id: crypto.randomUUID(),
            name: `${entityLabel(source)} -> ${entityLabel(destination)}`,
            source,
            destination,
            filter: { ...EMPTY_FILTER },
            bidirectional: false,
        });
        setEditingRuleId(null);
        setShowRuleModal(true);
    }

    function openEditRule(rule: DiagramRule) {
        setRuleForm({ ...rule, filter: rule.filter || { ...EMPTY_FILTER }, bidirectional: false });
        setEditingRuleId(rule.id);
        setShowRuleModal(true);
    }

    function saveRule() {
        const { bidirectional, ...rule } = ruleForm;
        if (editingRuleId) {
            onRulesChange(rules.map((r) => (r.id === rule.id ? rule : r)));
        } else if (bidirectional) {
            const reverse: DiagramRule = {
                ...rule,
                id: crypto.randomUUID(),
                name: `${entityLabel(rule.destination)} -> ${entityLabel(rule.source)}`,
                source: rule.destination,
                destination: rule.source,
            };
            onRulesChange([...rules, rule, reverse]);
        } else {
            onRulesChange([...rules, rule]);
        }
        setShowRuleModal(false);
    }

    function deleteRule(id: string) {
        onRulesChange(rules.filter((r) => r.id !== id));
    }

    const showAllowed = ruleForm.filter.groupsFilterType === 'allowed' || ruleForm.filter.groupsFilterType === 'allowedAndDisallowed';
    const showDisallowed = ruleForm.filter.groupsFilterType === 'disallowed' || ruleForm.filter.groupsFilterType === 'allowedAndDisallowed';

    return (
        <Stack gap="md">
            <Group justify="space-between" wrap="nowrap">
                <Group gap="lg" wrap="wrap">
                    <Text size="sm" c="dimmed">{t('Click two partners to draw a federation rule between them.')}</Text>
                    <Group gap="md">
                        <Group gap={6}>
                            <Box style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--mantine-color-indigo-7)' }} />
                            <Text size="xs" c="dimmed">{t('Outgoing connection')}</Text>
                        </Group>
                        <Group gap={6}>
                            <Box style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--mantine-color-dark-4)' }} />
                            <Text size="xs" c="dimmed">{t('CA group')}</Text>
                        </Group>
                    </Group>
                </Group>
                <Group gap="xs">
                    <Tooltip label={t('Zoom out')}>
                        <ActionIcon variant="light" onClick={() => zoomBy(-0.1)}><IconZoomOut size={16} /></ActionIcon>
                    </Tooltip>
                    <Text size="xs" c="dimmed" w={40} ta="center">{Math.round(zoom * 100)}%</Text>
                    <Tooltip label={t('Zoom in')}>
                        <ActionIcon variant="light" onClick={() => zoomBy(0.1)}><IconZoomIn size={16} /></ActionIcon>
                    </Tooltip>
                    <Tooltip label={t('Reset view')}>
                        <ActionIcon variant="light" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); persistViews(positionsRef.current, 1, { x: 0, y: 0 }); }}>
                            <IconZoomReset size={16} />
                        </ActionIcon>
                    </Tooltip>
                </Group>
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
                onClick={(e) => { if (e.target === e.currentTarget) setSelectedNode(null); }}
            >
                <Box
                    pos="absolute"
                    left={0}
                    top={0}
                    w={VIEWPORT_WIDTH * 2}
                    h={VIEWPORT_HEIGHT * 2}
                    style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
                    onPointerDown={onBackgroundPointerDown}
                    onClick={(e) => { if (e.target === e.currentTarget) setSelectedNode(null); }}
                >
                    <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                        <defs>
                            <marker id="fpArrowEnd" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto-start-reverse">
                                <path d="M0,0 L9,4.5 L0,9 L2.5,4.5 z" fill="var(--mantine-color-indigo-4)" />
                            </marker>
                        </defs>
                        {rules.map((rule) => {
                            if (!positions[rule.source] || !positions[rule.destination]) return null;
                            const aCenter = center(rule.source);
                            const bCenter = center(rule.destination);
                            const dx = bCenter.x - aCenter.x;
                            const dy = bCenter.y - aCenter.y;
                            const a = edgePoint(aCenter, dx, dy);
                            const b = edgePoint(bCenter, -dx, -dy);
                            // Bow the connector perpendicular to its own direction so
                            // parallel/overlapping rules between the same two nodes fan
                            // out instead of drawing exactly on top of each other.
                            const dist = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1);
                            const nx = -(b.y - a.y) / dist;
                            const ny = (b.x - a.x) / dist;
                            const bow = Math.min(40, dist * 0.18);
                            const cx = (a.x + b.x) / 2 + nx * bow;
                            const cy = (a.y + b.y) / 2 + ny * bow;
                            const labelX = 0.25 * a.x + 0.5 * cx + 0.25 * b.x;
                            const labelY = 0.25 * a.y + 0.5 * cy + 0.25 * b.y;
                            return (
                                <g key={rule.id}>
                                    <path
                                        d={`M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`}
                                        fill="none"
                                        stroke="var(--mantine-color-indigo-5)"
                                        strokeWidth={3}
                                        strokeLinecap="round"
                                        markerEnd="url(#fpArrowEnd)"
                                        pointerEvents="stroke"
                                        style={{ cursor: 'pointer' }}
                                        onClick={() => openEditRule(rule)}
                                    />
                                    <path
                                        d={`M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`}
                                        fill="none"
                                        stroke="var(--mantine-color-indigo-2)"
                                        strokeWidth={1.5}
                                        strokeDasharray="1 7"
                                        strokeLinecap="round"
                                        opacity={0.9}
                                        pointerEvents="none"
                                    >
                                        <animate attributeName="stroke-dashoffset" from="16" to="0" dur="0.6s" repeatCount="indefinite" />
                                    </path>
                                    <rect
                                        x={labelX - (rule.name.length * 3.4 + 10)} y={labelY - 11}
                                        width={rule.name.length * 6.8 + 20} height={20}
                                        rx={10}
                                        fill="var(--mantine-color-dark-7)"
                                        stroke="var(--mantine-color-dark-4)"
                                        style={{ pointerEvents: 'all', cursor: 'pointer' }}
                                        onClick={() => openEditRule(rule)}
                                    />
                                    <text
                                        x={labelX} y={labelY + 4}
                                        textAnchor="middle"
                                        fontSize={11}
                                        fontWeight={600}
                                        fill="var(--mantine-color-gray-2)"
                                        style={{ pointerEvents: 'all', cursor: 'pointer' }}
                                        onClick={() => openEditRule(rule)}
                                    >
                                        {rule.name}
                                    </text>
                                </g>
                            );
                        })}
                    </svg>

                    {entities.map((e) => {
                        const pos = positions[e.id];
                        if (!pos) return null;
                        const isSelected = selectedNode === e.id;
                        const isOutgoing = e.type === 'FederationOutgoing';
                        return (
                            <Paper
                                key={e.id}
                                pos="absolute"
                                left={pos.x}
                                top={pos.y}
                                w={NODE_WIDTH}
                                h={NODE_HEIGHT}
                                px="sm"
                                radius="lg"
                                shadow={isSelected ? 'xl' : 'md'}
                                withBorder
                                bg={isSelected ? 'blue.9' : isOutgoing ? 'indigo.9' : 'dark.6'}
                                style={{
                                    cursor: 'grab',
                                    userSelect: 'none',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    borderColor: isSelected
                                        ? 'var(--mantine-color-blue-4)'
                                        : isOutgoing
                                            ? 'var(--mantine-color-indigo-5)'
                                            : 'var(--mantine-color-dark-3)',
                                    borderWidth: isSelected ? 2 : 1,
                                    transition: 'box-shadow 120ms ease, border-color 120ms ease',
                                }}
                                onPointerDown={(ev) => onNodePointerDown(ev, e.id)}
                                onClick={(ev) => { ev.stopPropagation(); handleNodeClick(e.id); }}
                            >
                                <Box
                                    style={{
                                        flexShrink: 0,
                                        width: 26,
                                        height: 26,
                                        borderRadius: '50%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        background: isOutgoing ? 'var(--mantine-color-indigo-7)' : 'var(--mantine-color-dark-4)',
                                    }}
                                >
                                    {isOutgoing ? <IconArrowsExchange size={15} /> : <IconServer2 size={15} />}
                                </Box>
                                <Stack gap={0} style={{ minWidth: 0 }}>
                                    <Text size="sm" fw={700} truncate style={{ lineHeight: 1.2 }}>
                                        {e.displayName || e.name}
                                    </Text>
                                    <Text size="10px" c={isSelected || isOutgoing ? 'gray.4' : 'dimmed'} truncate>
                                        {isOutgoing ? t('Outgoing connection') : t('CA group')}
                                    </Text>
                                </Stack>
                            </Paper>
                        );
                    })}

                    {entities.length === 0 && (
                        <Text pos="absolute" top="50%" left="50%" style={{ transform: 'translate(-50%, -50%)' }} c="dimmed" size="sm">
                            {t('No federation partners yet — add a CA group or an outgoing connection to see them mapped out here.')}
                        </Text>
                    )}
                </Box>
            </Box>

            <Stack gap={6}>
                <Text size="sm" fw={600} c="dimmed">{t('Federation Rules')} {rules.length > 0 && `(${rules.length})`}</Text>
                {rules.length === 0 ? (
                    <Text size="sm" c="dimmed">{t('No rules yet — connect two partners above to allow data to flow between them.')}</Text>
                ) : (
                    rules.map((rule) => (
                        <Paper key={rule.id} p="xs" radius="md" withBorder bg="dark.7">
                            <Group gap="xs" wrap="nowrap">
                                <Badge color="indigo" variant="light" style={{ flexShrink: 0 }}>
                                    {filterTypeLabel(rule.filter?.groupsFilterType || 'allGroups')}
                                </Badge>
                                <Group gap={6} style={{ flex: 1, cursor: 'pointer', minWidth: 0 }} onClick={() => openEditRule(rule)}>
                                    <Text size="sm" fw={600} truncate>{rule.name}</Text>
                                    <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                                        {entityLabel(rule.source)} &rarr; {entityLabel(rule.destination)}
                                    </Text>
                                </Group>
                                <Tooltip label={t('Remove rule')}>
                                    <ActionIcon color="red" variant="subtle" onClick={() => deleteRule(rule.id)}>
                                        <IconTrash size={16} />
                                    </ActionIcon>
                                </Tooltip>
                            </Group>
                        </Paper>
                    ))
                )}
            </Stack>

            <Modal opened={showRuleModal} onClose={() => setShowRuleModal(false)} title={editingRuleId ? t('Edit Rule') : t('Add Rule')}>
                <Stack gap="sm">
                    <Text size="sm" c="dimmed">
                        {entityLabel(ruleForm.source)} &rarr; {entityLabel(ruleForm.destination)}
                    </Text>
                    <TextInput
                        label={t('Name')}
                        value={ruleForm.name}
                        onChange={(e) => setRuleForm({ ...ruleForm, name: e.currentTarget.value })}
                    />
                    <Select
                        label={t('Group Filter')}
                        value={ruleForm.filter.groupsFilterType}
                        onChange={(v) => setRuleForm({ ...ruleForm, filter: { ...ruleForm.filter, groupsFilterType: (v as any) || 'allGroups' } })}
                        data={[
                            { value: 'allGroups', label: t('All groups') },
                            { value: 'allowed', label: t('Only allowed groups') },
                            { value: 'disallowed', label: t('All except disallowed groups') },
                            { value: 'allowedAndDisallowed', label: t('Allowed, except disallowed') },
                        ]}
                    />
                    {!editingRuleId && (
                        <Switch
                            label={t('Also allow the reverse direction')}
                            description={t('Creates a second rule for destination -> source with the same filter')}
                            checked={ruleForm.bidirectional}
                            onChange={(e) => setRuleForm({ ...ruleForm, bidirectional: e.currentTarget.checked })}
                        />
                    )}
                    {showAllowed && (
                        <TagsInput
                            label={t('Allowed Groups')}
                            data={knownGroups}
                            value={ruleForm.filter.allowedGroups}
                            onChange={(v) => setRuleForm({ ...ruleForm, filter: { ...ruleForm.filter, allowedGroups: v } })}
                        />
                    )}
                    {showDisallowed && (
                        <TagsInput
                            label={t('Disallowed Groups')}
                            data={knownGroups}
                            value={ruleForm.filter.disallowedGroups}
                            onChange={(v) => setRuleForm({ ...ruleForm, filter: { ...ruleForm.filter, disallowedGroups: v } })}
                        />
                    )}
                </Stack>
                <Group justify="space-between" mt="md">
                    {editingRuleId ? (
                        <Button color="red" variant="subtle" onClick={() => { deleteRule(ruleForm.id); setShowRuleModal(false); }}>
                            {t('Delete Rule')}
                        </Button>
                    ) : <div />}
                    <Group>
                        <Button variant="default" onClick={() => setShowRuleModal(false)}>{t('Cancel')}</Button>
                        <Button onClick={saveRule}>{t('Save')}</Button>
                    </Group>
                </Group>
            </Modal>
        </Stack>
    );
}
