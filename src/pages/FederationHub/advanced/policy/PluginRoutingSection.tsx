import React from 'react';
import { ActionIcon, Autocomplete, Button, Group, Paper, SimpleGrid, Stack, Switch, TagsInput, Text, Tooltip } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { blankPluginRouting } from '../helpers';
import type { PolicyEntity, PolicyPluginRouting, RegisteredPlugin } from '../types';

/**
 * The policy's plugins[] routing (the native console's plugin policy): which
 * federates a plugin's data goes to and comes from. Part of the draft, saved
 * with the whole policy through "Save & apply".
 */
export default function PluginRoutingSection({ plugins, onChange, registered, entities }: {
    plugins: PolicyPluginRouting[];
    onChange: (plugins: PolicyPluginRouting[]) => void;
    registered: RegisteredPlugin[];
    entities: PolicyEntity[];
}) {
    const { t } = useTranslation();
    const nodeNames = Array.from(new Set(entities.map((e) => e.name).filter((n): n is string => !!n)));
    const pluginNames = Array.from(new Set(registered.map((p) => p.name).filter((n): n is string => !!n)));
    const set = (i: number, patch: Partial<PolicyPluginRouting>) => onChange(plugins.map((p, j) => (j === i ? { ...p, ...patch } : p)));
    const lists: { key: 'sendTo' | 'dontSend' | 'receiveFrom' | 'dontReceive'; label: string }[] = [
        { key: 'sendTo', label: t('Send to') },
        { key: 'dontSend', label: t('Never send to') },
        { key: 'receiveFrom', label: t('Receive from') },
        { key: 'dontReceive', label: t('Never receive from') },
    ];
    return (
        <Stack gap="sm">
            <Group justify="space-between" wrap="wrap">
                <div>
                    <Text fw={600}>{t('Plugin routing')}</Text>
                    <Text size="sm" c="dimmed">{t('Which federates each hub plugin\'s data goes to and comes from. Lists hold policy node names. Saved with the policy by "Save & apply".')}</Text>
                </div>
                <Button size="xs" radius="xl" variant="light" leftSection={<IconPlus size={14} />} onClick={() => onChange([...plugins, blankPluginRouting(pluginNames.find((n) => !plugins.some((p) => p.pluginName === n)) ?? '')])}>
                    {t('Add plugin routing')}
                </Button>
            </Group>
            {plugins.length === 0 && <Text size="sm" c="dimmed">{t('No plugin routing in this policy.')}</Text>}
            {plugins.map((p, i) => (
                <Paper key={i} p="sm" withBorder radius="md">
                    <Stack gap="xs">
                        <Group justify="space-between" wrap="nowrap" align="flex-end">
                            <Autocomplete
                                label={t('Plugin name')}
                                data={pluginNames}
                                value={p.pluginName ?? ''}
                                onChange={(pluginName) => set(i, { pluginName })}
                                style={{ flex: 1 }}
                                error={!(p.pluginName ?? '').trim() ? t('A plugin name is required') : undefined}
                            />
                            <Tooltip label={t('Remove from draft')}>
                                <ActionIcon color="red" variant="subtle" aria-label={t('Remove plugin routing')} onClick={() => onChange(plugins.filter((_, j) => j !== i))}>
                                    <IconTrash size={16} />
                                </ActionIcon>
                            </Tooltip>
                        </Group>
                        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                            {lists.map(({ key, label }) => (
                                <TagsInput
                                    key={key}
                                    label={label}
                                    data={nodeNames}
                                    value={p[key] ?? []}
                                    onChange={(v) => set(i, { [key]: v })}
                                    clearable
                                    comboboxProps={{ withinPortal: true }}
                                />
                            ))}
                        </SimpleGrid>
                        <Group gap="lg" wrap="wrap">
                            <Switch label={t('Send by default')} checked={p.sendByDefault !== false} onChange={(e) => set(i, { sendByDefault: e.currentTarget.checked })} />
                            <Switch label={t('Receive by default')} checked={p.receiveByDefault !== false} onChange={(e) => set(i, { receiveByDefault: e.currentTarget.checked })} />
                            <Switch label={t('Disabled')} checked={!!p.disabled} onChange={(e) => set(i, { disabled: e.currentTarget.checked })} />
                        </Group>
                    </Stack>
                </Paper>
            ))}
        </Stack>
    );
}
