import React, { useEffect, useMemo, useState } from 'react';
import {
    ActionIcon,
    Alert,
    Badge,
    Button,
    Group,
    Modal,
    MultiSelect,
    Select,
    Stack,
    Switch,
    Table,
    TagsInput,
    Text,
    TextInput,
    Tooltip,
} from '@mantine/core';
import { IconAlertTriangle, IconEdit, IconPlus, IconTrash } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import axios from '../../../../axios_config';
import { endpoints } from '../endpoints';
import {
    ALL_GROUPS,
    entityLabel,
    filterWarnings,
    groupLabel,
    makeRule,
    needsGroups,
    orphanRules,
    ravenNodeIds,
    randomId,
    splitGroups,
} from '../helpers';
import { ConfirmModal } from '../shared';
import type { CaGroup, FilterType, PolicyCore, PolicyRule } from '../types';

interface RuleForm {
    rule: PolicyRule;
    editing: boolean;
    bidirectional: boolean;
}

export function filterTypeLabel(type: FilterType | undefined, t: (k: string) => string): string {
    switch (type) {
        case 'allowed': return t('Only allowed groups');
        case 'disallowed': return t('All except blocked groups');
        case 'allowedAndDisallowed': return t('Allowed, except blocked');
        default: return t('All groups');
    }
}

export default function RulesSection({ policy, onChange, caGroups, ownCaUid }: {
    policy: PolicyCore;
    onChange: (p: PolicyCore) => void;
    caGroups: CaGroup[];
    ownCaUid: string | null;
}) {
    const { t } = useTranslation();
    const [form, setForm] = useState<RuleForm | null>(null);
    const [toDelete, setToDelete] = useState<PolicyRule | null>(null);
    const [knownGroups, setKnownGroups] = useState<string[]>([]);

    const warnings = useMemo(() => new Set(filterWarnings(policy, ownCaUid).map((r) => r.id)), [policy, ownCaUid]);
    const orphans = useMemo(() => new Set(orphanRules(policy).map((r) => r.id)), [policy]);
    const ravenIds = useMemo(() => ravenNodeIds(policy, ownCaUid), [policy, ownCaUid]);
    const label = (id: string) => entityLabel(policy.entities.find((e) => e.id === id), id);
    const nodeOptions = policy.entities.map((e) => ({ value: e.id, label: entityLabel(e) }));
    const setOptions = policy.groupSets.map((s) => ({ value: s.id, label: s.name }));

    // Groups the hub has seen advertised through the rule's source node (empty for Raven sources, G12).
    const sourceId = form?.rule.source;
    useEffect(() => {
        if (!sourceId) { setKnownGroups([]); return; }
        let cancelled = false;
        axios.get<string[]>(endpoints.knownGroups(sourceId))
            .then((r) => { if (!cancelled) { setKnownGroups(Array.isArray(r.data) ? r.data.map(String) : []); } })
            .catch(() => { if (!cancelled) { setKnownGroups([]); } });
        return () => { cancelled = true; };
    }, [sourceId]);

    const groupSuggestions = useMemo(() => Array.from(new Set([
        ...knownGroups,
        ...caGroups.map((c) => c.nickname || c.alias).filter(Boolean),
    ])), [knownGroups, caGroups]);

    function openAdd() {
        const first = policy.entities[0]?.id ?? '';
        const second = policy.entities[1]?.id ?? first;
        setForm({ rule: makeRule(first, second, `${label(first)} -> ${label(second)}`), editing: false, bidirectional: true });
    }

    function save() {
        if (!form) { return; }
        const rule = form.rule;
        if (form.editing) {
            onChange({ ...policy, rules: policy.rules.map((r) => (r.id === rule.id ? rule : r)) });
        } else {
            const added = [rule];
            if (form.bidirectional && rule.source !== rule.destination) {
                added.push({ ...rule, id: randomId(), name: `${label(rule.destination)} -> ${label(rule.source)}`, source: rule.destination, destination: rule.source });
            }
            onChange({ ...policy, rules: [...policy.rules, ...added] });
        }
        setForm(null);
    }

    function setRule(patch: Partial<PolicyRule>) {
        setForm((f) => (f ? { ...f, rule: { ...f.rule, ...patch } } : f));
    }
    function setGroups(which: 'allowedGroups' | 'disallowedGroups', setIds: string[] | null, plain: string[] | null) {
        setForm((f) => {
            if (!f) { return f; }
            const current = splitGroups(f.rule.filter[which] ?? [], policy.groupSets);
            const next = [...(setIds ?? current.setIds), ...(plain ?? current.plain)];
            return { ...f, rule: { ...f.rule, filter: { ...f.rule.filter, [which]: next } } };
        });
    }

    const filter = form?.rule.filter ?? ALL_GROUPS;
    const show = needsGroups(filter.groupsFilterType);
    const allowedSplit = splitGroups(filter.allowedGroups ?? [], policy.groupSets);
    const blockedSplit = splitGroups(filter.disallowedGroups ?? [], policy.groupSets);
    const formWarn = !!form && ravenIds.has(form.rule.source) && filter.groupsFilterType !== 'allGroups';

    return (
        <Stack gap="xs">
            <Group justify="space-between" wrap="wrap">
                <div>
                    <Text fw={600}>{t('Rules')}</Text>
                    <Text size="sm" c="dimmed">{t('Each rule lets data flow one way between two nodes. Two-way sharing needs two rules.')}</Text>
                </div>
                <Button size="xs" radius="xl" variant="light" leftSection={<IconPlus size={14} />} onClick={openAdd} disabled={policy.entities.length === 0}>{t('Add rule')}</Button>
            </Group>

            {warnings.size > 0 && (
                <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />} title={t('Some rules will silently drop Raven traffic')}>
                    {t('Raven doesn\'t tell the hub which groups its messages belong to, so rules leaving a Raven node must use "All groups". Change the marked rules, or nothing will flow along them.')}
                </Alert>
            )}

            <Table.ScrollContainer minWidth={820}>
                <Table striped withTableBorder>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>{t('Name')}</Table.Th>
                            <Table.Th>{t('From → To')}</Table.Th>
                            <Table.Th>{t('Filter')}</Table.Th>
                            <Table.Th>{t('Groups')}</Table.Th>
                            <Table.Th />
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {policy.rules.length === 0 && (
                            <Table.Tr><Table.Td colSpan={5}><Text c="dimmed" ta="center" size="sm">{t('No rules, so no data flows in this policy.')}</Text></Table.Td></Table.Tr>
                        )}
                        {policy.rules.map((r) => (
                            <Table.Tr key={r.id}>
                                <Table.Td>
                                    <Group gap={4} wrap="nowrap">
                                        <Text size="sm" fw={600}>{r.name}</Text>
                                        {warnings.has(r.id) && <Tooltip label={t('Must be "All groups" because the source is a Raven node')}><IconAlertTriangle size={16} color="var(--mantine-color-orange-5)" /></Tooltip>}
                                        {orphans.has(r.id) && <Badge size="xs" color="red" variant="light">{t('Points at a missing node')}</Badge>}
                                    </Group>
                                </Table.Td>
                                <Table.Td><Text size="sm">{label(r.source)} → {label(r.destination)}</Text></Table.Td>
                                <Table.Td><Badge variant="light" color={warnings.has(r.id) ? 'orange' : 'indigo'}>{filterTypeLabel(r.filter?.groupsFilterType, t)}</Badge></Table.Td>
                                <Table.Td>
                                    <Group gap={4}>
                                        {(r.filter?.allowedGroups ?? []).map((g) => <Badge key={`a-${g}`} size="sm" color="green" variant="outline">{groupLabel(g, policy.groupSets, caGroups)}</Badge>)}
                                        {(r.filter?.disallowedGroups ?? []).map((g) => <Badge key={`d-${g}`} size="sm" color="red" variant="outline">{t('not')} {groupLabel(g, policy.groupSets, caGroups)}</Badge>)}
                                    </Group>
                                </Table.Td>
                                <Table.Td>
                                    <Group gap={4} wrap="nowrap">
                                        <Tooltip label={t('Edit')}><ActionIcon variant="subtle" onClick={() => setForm({ rule: { ...r, filter: r.filter ?? { ...ALL_GROUPS } }, editing: true, bidirectional: false })} aria-label={t('Edit')}><IconEdit size={16} /></ActionIcon></Tooltip>
                                        <Tooltip label={t('Remove rule')}><ActionIcon color="red" variant="subtle" onClick={() => setToDelete(r)} aria-label={t('Remove rule')}><IconTrash size={16} /></ActionIcon></Tooltip>
                                    </Group>
                                </Table.Td>
                            </Table.Tr>
                        ))}
                    </Table.Tbody>
                </Table>
            </Table.ScrollContainer>

            <Modal opened={form !== null} onClose={() => setForm(null)} title={<Text fw={700}>{form?.editing ? t('Edit rule') : t('Add rule')}</Text>} centered size="lg">
                {form && (
                    <Stack gap="sm">
                        <TextInput label={t('Name')} value={form.rule.name} onChange={(e) => setRule({ name: e.currentTarget.value })} />
                        <Group grow>
                            <Select label={t('From')} data={nodeOptions} value={form.rule.source} onChange={(v) => v && setRule({ source: v })} allowDeselect={false} />
                            <Select label={t('To')} data={nodeOptions} value={form.rule.destination} onChange={(v) => v && setRule({ destination: v })} allowDeselect={false} />
                        </Group>
                        {!form.editing && (
                            <Switch
                                label={t('Also allow the reverse direction')}
                                description={t('Creates a second rule from destination to source with the same filter')}
                                checked={form.bidirectional}
                                onChange={(e) => { const v = e.currentTarget.checked; setForm((f) => (f ? { ...f, bidirectional: v } : f)); }}
                            />
                        )}
                        <Select
                            label={t('Group filter')}
                            value={filter.groupsFilterType}
                            onChange={(v) => setRule({ filter: { ...filter, groupsFilterType: (v as FilterType) || 'allGroups' } })}
                            allowDeselect={false}
                            data={[
                                { value: 'allGroups', label: t('All groups') },
                                { value: 'allowed', label: t('Only allowed groups') },
                                { value: 'disallowed', label: t('All except blocked groups') },
                                { value: 'allowedAndDisallowed', label: t('Allowed, except blocked') },
                            ]}
                        />
                        {formWarn && (
                            <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
                                {t('The source is a Raven node. Raven doesn\'t send group information, so with this filter nothing will flow. Use "All groups".')}
                            </Alert>
                        )}
                        {show.allowed && (
                            <>
                                {setOptions.length > 0 && (
                                    <MultiSelect label={t('Allowed group sets')} data={setOptions} value={allowedSplit.setIds} onChange={(v) => setGroups('allowedGroups', v, null)} clearable />
                                )}
                                <TagsInput label={t('Allowed groups')} data={groupSuggestions} value={allowedSplit.plain} onChange={(v) => setGroups('allowedGroups', null, v)} />
                            </>
                        )}
                        {show.disallowed && (
                            <>
                                {setOptions.length > 0 && (
                                    <MultiSelect label={t('Blocked group sets')} data={setOptions} value={blockedSplit.setIds} onChange={(v) => setGroups('disallowedGroups', v, null)} clearable />
                                )}
                                <TagsInput label={t('Blocked groups')} data={groupSuggestions} value={blockedSplit.plain} onChange={(v) => setGroups('disallowedGroups', null, v)} />
                            </>
                        )}
                        {(show.allowed || show.disallowed) && (
                            <Text size="xs" c="dimmed">
                                {knownGroups.length > 0
                                    ? t('Suggestions include the groups the hub has seen from the source node.')
                                    : t('The hub hasn\'t seen any groups from the source node, so filtering only works if that server maps its groups.')}
                            </Text>
                        )}
                    </Stack>
                )}
                <Group justify="flex-end" mt="lg" gap="sm">
                    <Button variant="default" radius="xl" onClick={() => setForm(null)}>{t('Cancel')}</Button>
                    <Button radius="xl" onClick={save} disabled={!form?.rule.source || !form?.rule.destination}>{form?.editing ? t('Save to draft') : t('Add to draft')}</Button>
                </Group>
            </Modal>

            <ConfirmModal
                opened={toDelete !== null}
                onClose={() => setToDelete(null)}
                onConfirm={() => { if (toDelete) { onChange({ ...policy, rules: policy.rules.filter((r) => r.id !== toDelete.id) }); } setToDelete(null); }}
                title={t('Remove this rule?')}
                confirmLabel={t('Remove from draft')}
            >
                <Text size="sm">{t('Data stops flowing from {{from}} to {{to}} once you save and apply.', { from: toDelete ? label(toDelete.source) : '', to: toDelete ? label(toDelete.destination) : '', interpolation: { escapeValue: false } })}</Text>
            </ConfirmModal>
        </Stack>
    );
}
