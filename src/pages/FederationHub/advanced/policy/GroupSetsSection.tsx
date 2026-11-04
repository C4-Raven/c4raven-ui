import React, { useState } from 'react';
import { ActionIcon, Badge, Button, Card, Group, Modal, SimpleGrid, Stack, TagsInput, Text, TextInput, Tooltip } from '@mantine/core';
import { IconEdit, IconPlus, IconTrash, IconUpload } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { randomId, removeGroupSet } from '../helpers';
import { ConfirmModal } from '../shared';
import type { CaGroup, GroupSet, PolicyCore } from '../types';

export default function GroupSetsSection({ policy, onChange, caGroups, canApplyNow, groupSetsDirty, applying, onApplyNow }: {
    policy: PolicyCore;
    onChange: (p: PolicyCore) => void;
    caGroups: CaGroup[];
    /** False for a policy that doesn't exist on the hub yet. */
    canApplyNow: boolean;
    groupSetsDirty: boolean;
    applying: boolean;
    /** Push only the group sets (updateConnectionGroupSets); live if the policy is active. */
    onApplyNow: () => void;
}) {
    const { t } = useTranslation();
    const [form, setForm] = useState<{ set: GroupSet; editing: boolean } | null>(null);
    const [toDelete, setToDelete] = useState<GroupSet | null>(null);
    const usedBy = (id: string) => policy.rules.filter((r) => (r.filter?.allowedGroups ?? []).includes(id) || (r.filter?.disallowedGroups ?? []).includes(id)).length;
    const nameTaken = !!form && policy.groupSets.some((s) => s.id !== form.set.id && s.name.trim().toLowerCase() === form.set.name.trim().toLowerCase());

    function save() {
        if (!form || !form.set.name.trim() || nameTaken) { return; }
        const set = { ...form.set, name: form.set.name.trim() };
        onChange({
            ...policy,
            groupSets: form.editing ? policy.groupSets.map((s) => (s.id === set.id ? set : s)) : [...policy.groupSets, set],
        });
        setForm(null);
    }

    return (
        <Stack gap="xs">
            <Group justify="space-between" wrap="wrap">
                <div>
                    <Text fw={600}>{t('Group sets')}</Text>
                    <Text size="sm" c="dimmed">{t('Named lists of groups you can pick in a rule\'s allowed or blocked groups instead of retyping them.')}</Text>
                </div>
                <Group gap="xs">
                    {canApplyNow && groupSetsDirty && (
                        <Tooltip label={t('Sends only the group sets to the hub now, without the other draft changes')} multiline maw={260}>
                            <Button size="xs" radius="xl" variant="default" leftSection={<IconUpload size={14} />} loading={applying} onClick={onApplyNow}>{t('Apply group sets only')}</Button>
                        </Tooltip>
                    )}
                    <Button size="xs" radius="xl" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setForm({ set: { id: randomId(), name: '', groups: [] }, editing: false })}>{t('Create group set')}</Button>
                </Group>
            </Group>
            {policy.groupSets.length === 0 ? (
                <Text size="sm" c="dimmed">{t('No group sets yet')}</Text>
            ) : (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
                    {policy.groupSets.map((set) => (
                        <Card key={set.id} p="sm" className="raven-surface raven-surface--tile">
                            <Group justify="space-between" wrap="nowrap" mb={4}>
                                <Text fw={600} size="sm" truncate>{set.name}</Text>
                                <Group gap={4} wrap="nowrap">
                                    <ActionIcon size="sm" variant="subtle" onClick={() => setForm({ set: { ...set, groups: [...set.groups] }, editing: true })} aria-label={t('Edit')}><IconEdit size={14} /></ActionIcon>
                                    <ActionIcon size="sm" color="red" variant="subtle" onClick={() => setToDelete(set)} aria-label={t('Delete')}><IconTrash size={14} /></ActionIcon>
                                </Group>
                            </Group>
                            {set.groups.length === 0 ? (
                                <Text size="xs" c="dimmed">{t('No groups in this set')}</Text>
                            ) : (
                                <Group gap={4}>{set.groups.map((g) => <Badge key={g} size="sm" variant="light" color="indigo">{g}</Badge>)}</Group>
                            )}
                            <Text size="xs" c="dimmed" mt={6}>{t('Used by {{count}} rule(s)', { count: usedBy(set.id), interpolation: { escapeValue: false } })}</Text>
                        </Card>
                    ))}
                </SimpleGrid>
            )}

            <Modal opened={form !== null} onClose={() => setForm(null)} title={<Text fw={700}>{form?.editing ? t('Edit group set') : t('Create group set')}</Text>} centered>
                {form && (
                    <Stack gap="sm">
                        <TextInput label={t('Name')} placeholder={t('e.g. Trusted Partners')} value={form.set.name} onChange={(e) => { const v = e.currentTarget.value; setForm((f) => (f ? { ...f, set: { ...f.set, name: v } } : f)); }} error={nameTaken ? t('Another group set has this name') : undefined} required />
                        <TagsInput label={t('Groups')} data={caGroups.map((c) => c.nickname || c.alias).filter(Boolean)} value={form.set.groups} onChange={(v) => setForm((f) => (f ? { ...f, set: { ...f.set, groups: v } } : f))} />
                    </Stack>
                )}
                <Group justify="flex-end" mt="lg" gap="sm">
                    <Button variant="default" radius="xl" onClick={() => setForm(null)}>{t('Cancel')}</Button>
                    <Button radius="xl" onClick={save} disabled={!form?.set.name.trim() || nameTaken}>{form?.editing ? t('Save to draft') : t('Add to draft')}</Button>
                </Group>
            </Modal>

            <ConfirmModal
                opened={toDelete !== null}
                onClose={() => setToDelete(null)}
                onConfirm={() => { if (toDelete) { onChange(removeGroupSet(policy, toDelete.id)); } setToDelete(null); }}
                title={t('Delete this group set?')}
                confirmLabel={t('Delete from draft')}
            >
                <Text size="sm">{t('"{{name}}" is removed from the draft and from the {{count}} rule filter(s) that use it.', { name: toDelete?.name ?? '', count: toDelete ? usedBy(toDelete.id) : 0, interpolation: { escapeValue: false } })}</Text>
            </ConfirmModal>
        </Stack>
    );
}
