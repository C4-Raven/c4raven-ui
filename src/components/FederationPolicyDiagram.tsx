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
} from '@mantine/core';
import { IconTrash, IconZoomIn, IconZoomOut, IconZoomReset } from '@tabler/icons-react';
import { t } from 'i18next';

export interface DiagramEntity {
    id: string;
    type: string;
    displayName?: string;
    name?: string;
    config?: Record<string, any>;
}

export interface DiagramRuleFilter {
    groupsFilterType: 'ALL' | 'ALLOWED' | 'DISALLOWED' | 'ALLOWED_AND_DISALLOWED';
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

const EMPTY_FILTER: DiagramRuleFilter = { groupsFilterType: 'ALL', allowedGroups: [], disallowedGroups: [] };

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
    const [ruleForm, setRuleForm] = useState<DiagramRule>({ id: '', name: '', source: '', destination: '', filter: EMPTY_FILTER });

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
        });
        setEditingRuleId(null);
        setShowRuleModal(true);
    }

    function openEditRule(rule: DiagramRule) {
        setRuleForm({ ...rule, filter: rule.filter || { ...EMPTY_FILTER } });
        setEditingRuleId(rule.id);
        setShowRuleModal(true);
    }

    function saveRule() {
        const next = editingRuleId ? rules.map((r) => (r.id === ruleForm.id ? ruleForm : r)) : [...rules, ruleForm];
        onRulesChange(next);
        setShowRuleModal(false);
    }

    function deleteRule(id: string) {
        onRulesChange(rules.filter((r) => r.id !== id));
    }

    const showAllowed = ruleForm.filter.groupsFilterType === 'ALLOWED' || ruleForm.filter.groupsFilterType === 'ALLOWED_AND_DISALLOWED';
    const showDisallowed = ruleForm.filter.groupsFilterType === 'DISALLOWED' || ruleForm.filter.groupsFilterType === 'ALLOWED_AND_DISALLOWED';

    return (
        <Stack gap="md">
            <Group justify="space-between">
                <Text size="sm" c="dimmed">{t('Click a partner, then click another, to draw a rule allowing data between them.')}</Text>
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
                            <marker id="fpArrowEnd" markerWidth="4" markerHeight="3" refX="2.7" refY="1.35" orient="auto">
                                <path d="M0,0 L0,2.7 L3,1.35 z" fill="var(--mantine-color-grape-4)" />
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
                            const mx = (a.x + b.x) / 2;
                            const my = (a.y + b.y) / 2;
                            return (
                                <g key={rule.id}>
                                    <line
                                        x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                                        stroke="var(--mantine-color-grape-4)"
                                        strokeWidth={3}
                                        markerEnd="url(#fpArrowEnd)"
                                        pointerEvents="stroke"
                                        style={{ cursor: 'pointer' }}
                                        onClick={() => openEditRule(rule)}
                                    />
                                    <text
                                        x={mx} y={my - 8}
                                        textAnchor="middle"
                                        fontSize={11}
                                        fontWeight={700}
                                        fill="var(--mantine-color-gray-3)"
                                        style={{ paintOrder: 'stroke', stroke: 'var(--mantine-color-dark-8)', strokeWidth: 4, pointerEvents: 'all', cursor: 'pointer' }}
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
                                p="xs"
                                radius="md"
                                shadow="md"
                                withBorder
                                bg={isSelected ? 'blue.9' : isOutgoing ? 'grape.9' : 'dark.6'}
                                style={{
                                    cursor: 'grab',
                                    userSelect: 'none',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderColor: isSelected ? 'var(--mantine-color-blue-4)' : undefined,
                                    borderWidth: isSelected ? 2 : 1,
                                }}
                                onPointerDown={(ev) => onNodePointerDown(ev, e.id)}
                                onClick={(ev) => { ev.stopPropagation(); handleNodeClick(e.id); }}
                            >
                                <Text size="sm" fw={700} ta="center" style={{ overflowWrap: 'anywhere' }}>
                                    {e.displayName || e.name}
                                </Text>
                            </Paper>
                        );
                    })}

                    {entities.length === 0 && (
                        <Text pos="absolute" top="50%" left="50%" style={{ transform: 'translate(-50%, -50%)' }} c="dimmed" size="sm">
                            {t('No partners yet — add a CA group or outgoing connection first.')}
                        </Text>
                    )}
                </Box>
            </Box>

            <Stack gap={4}>
                {rules.length === 0 ? (
                    <Text size="sm" c="dimmed">{t('No rules yet. Click two partners in the diagram to connect them.')}</Text>
                ) : (
                    rules.map((rule) => (
                        <Group key={rule.id} gap="xs" wrap="nowrap">
                            <Badge color="grape" variant="light" style={{ flexShrink: 0 }}>{rule.filter?.groupsFilterType || 'ALL'}</Badge>
                            <Text size="sm" style={{ flex: 1, cursor: 'pointer' }} onClick={() => openEditRule(rule)}>
                                {rule.name} ({entityLabel(rule.source)} &rarr; {entityLabel(rule.destination)})
                            </Text>
                            <Tooltip label={t('Remove rule')}>
                                <ActionIcon color="red" variant="subtle" onClick={() => deleteRule(rule.id)}>
                                    <IconTrash size={16} />
                                </ActionIcon>
                            </Tooltip>
                        </Group>
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
                        onChange={(v) => setRuleForm({ ...ruleForm, filter: { ...ruleForm.filter, groupsFilterType: (v as any) || 'ALL' } })}
                        data={[
                            { value: 'ALL', label: t('All groups') },
                            { value: 'ALLOWED', label: t('Only allowed groups') },
                            { value: 'DISALLOWED', label: t('All except disallowed groups') },
                            { value: 'ALLOWED_AND_DISALLOWED', label: t('Allowed, except disallowed') },
                        ]}
                    />
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
