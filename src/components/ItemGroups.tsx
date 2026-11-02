import React, { useEffect, useState } from 'react';
import { ActionIcon, Badge, Button, Group, Modal, MultiSelect, Text, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconPencil, IconX } from '@tabler/icons-react';
import { t } from 'i18next';
import axios from '@/axios_config';
import { apiRoutes } from '@/apiRoutes';

// Groups a data package / video stream is limited to (server: raven/group_isolation.py).
// No groups means everyone can see it.

export function ItemGroupBadges({ groups, onEdit }: { groups: string[] | undefined; onEdit?: () => void }) {
    const names = groups ?? [];
    return (
        <Group gap={4} wrap="wrap">
            {names.length === 0
                ? <Badge color="gray" variant="light">{t('Everyone')}</Badge>
                : names.map((name) => <Badge key={name} variant="light">{name}</Badge>)}
            {onEdit && (
                <Tooltip label={t('Edit groups')}>
                    <ActionIcon variant="subtle" size="sm" onClick={onEdit} aria-label={t('Edit groups')}>
                        <IconPencil size={14} />
                    </ActionIcon>
                </Tooltip>
            )}
        </Group>
    );
}

interface ItemGroupsModalProps {
    opened: boolean;
    onClose: () => void;
    title: string;
    // PATCH endpoint and the body fields identifying the item (hash / path)
    endpoint: string;
    identifier: Record<string, string>;
    groups: string[];
    onSaved: () => void;
}

export function ItemGroupsModal({ opened, onClose, title, endpoint, identifier, groups, onSaved }: ItemGroupsModalProps) {
    const [allGroups, setAllGroups] = useState<string[]>([]);
    const [selected, setSelected] = useState<string[]>(groups);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!opened) {
            return;
        }
        setSelected(groups);
        axios.get(apiRoutes.allGroups)
            .then((r) => setAllGroups((r.data ?? []).map((g: any) => g.name)))
            .catch(() => setAllGroups([]));
    }, [opened]);

    function save() {
        setSaving(true);
        axios.patch(endpoint, { ...identifier, groups: selected })
            .then(() => {
                notifications.show({ message: t('Groups updated'), icon: <IconCheck />, color: 'green' });
                onSaved();
                onClose();
            })
            .catch((err) => {
                notifications.show({
                    title: t('Failed to update groups'),
                    message: err.response?.data?.error,
                    icon: <IconX />,
                    color: 'red',
                });
            })
            .finally(() => setSaving(false));
    }

    // Keep groups the item already has selectable even if the list doesn't include them
    const data = Array.from(new Set([...allGroups, ...groups])).sort();

    return (
        <Modal opened={opened} onClose={onClose} title={title}>
            <Text size="sm" c="dimmed" mb="sm">
                {t('Only members who receive from one of these groups can see it. Leave empty to make it visible to everyone.')}
            </Text>
            <MultiSelect
                label={t('Groups')}
                placeholder={selected.length ? undefined : t('Everyone')}
                searchable
                clearable
                nothingFoundMessage={t('Nothing found...')}
                data={data}
                value={selected}
                onChange={setSelected}
                comboboxProps={{ withinPortal: true }}
            />
            <Group justify="flex-end" mt="md">
                <Button variant="default" onClick={onClose}>{t('Cancel')}</Button>
                <Button onClick={save} loading={saving}>{t('Save')}</Button>
            </Group>
        </Modal>
    );
}
