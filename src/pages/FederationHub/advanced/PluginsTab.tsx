import React, { useEffect, useState } from 'react';
import { Badge, Code, Group, Stack, Table, Text, Title } from '@mantine/core';
import { IconPuzzle } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { EmptyState, formatDateTime } from '../../ServerRequests/shared';
import { fetchStoredActive } from './api';
import { entityLabel, normalizePolicy } from './helpers';
import { useHubData } from './shared';
import type { Federation } from './types';

export default function PluginsTab() {
    const { t } = useTranslation();
    const { plugins, federations } = useHubData();
    const [active, setActive] = useState<Federation | null>(null);
    useEffect(() => { fetchStoredActive().then(setActive).catch(() => setActive(null)); }, [federations]);
    const routing = active?.plugins ?? [];
    const entities = normalizePolicy(active?.policy).entities;
    const nodeNames = (ids?: string[]) => (ids ?? []).map((id) => entityLabel(entities.find((e) => e.id === id || e.name === id), id)).join(', ') || '—';

    return (
        <Stack gap="lg">
            <div>
                <Title order={5} mb={4}>{t('Registered plugins')}</Title>
                <Text size="sm" c="dimmed" mb="xs">{t('Plugins are separate programs built with the Federation Hub SDK. They register themselves when they start; nothing here starts or stops them.')}</Text>
                {plugins.length === 0 ? (
                    <EmptyState icon={<IconPuzzle size={26} />} title={t('No registered plugins')} />
                ) : (
                    <Table.ScrollContainer minWidth={800}>
                        <Table striped withTableBorder>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>{t('Name')}</Table.Th>
                                    <Table.Th>{t('Type')}</Table.Th>
                                    <Table.Th>{t('Version')}</Table.Th>
                                    <Table.Th>{t('Author')}</Table.Th>
                                    <Table.Th>{t('Description')}</Table.Th>
                                    <Table.Th>{t('Started')}</Table.Th>
                                    <Table.Th>{t('Start command')}</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {plugins.map((p, i) => (
                                    <Table.Tr key={`${p.name}-${i}`}>
                                        <Table.Td><Text size="sm" fw={600}>{p.name ?? '—'}</Text></Table.Td>
                                        <Table.Td>{p.type ? <Badge variant="light">{p.type}</Badge> : '—'}</Table.Td>
                                        <Table.Td>{p.version ?? '—'}</Table.Td>
                                        <Table.Td>{p.author ?? '—'}</Table.Td>
                                        <Table.Td><Text size="sm">{p.description ?? '—'}</Text></Table.Td>
                                        <Table.Td>{p.startTimeMillis ? formatDateTime(new Date(p.startTimeMillis)) : (p.startTime ?? '—')}</Table.Td>
                                        <Table.Td>{p.startCommand ? <Code>{p.startCommand}</Code> : '—'}</Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                )}
            </div>

            <div>
                <Title order={5} mb={4}>{t('Plugin routing in the active policy')}</Title>
                <Text size="sm" c="dimmed" mb="xs">{t('Read-only. Which nodes each plugin sends to and receives from.')}</Text>
                {routing.length === 0 ? (
                    <Text size="sm" c="dimmed">{t('No plugin routing in the active policy')}</Text>
                ) : (
                    <Table.ScrollContainer minWidth={800}>
                        <Table striped withTableBorder>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>{t('Plugin')}</Table.Th>
                                    <Table.Th>{t('Sends to')}</Table.Th>
                                    <Table.Th>{t('Never sends to')}</Table.Th>
                                    <Table.Th>{t('Receives from')}</Table.Th>
                                    <Table.Th>{t('Never receives from')}</Table.Th>
                                    <Table.Th>{t('Defaults')}</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {routing.map((r, i) => (
                                    <Table.Tr key={`${r.pluginName}-${i}`}>
                                        <Table.Td><Group gap={4}><Text size="sm" fw={600}>{r.pluginName ?? '—'}</Text>{r.disabled && <Badge size="xs" color="gray">{t('Disabled')}</Badge>}</Group></Table.Td>
                                        <Table.Td>{nodeNames(r.sendTo)}</Table.Td>
                                        <Table.Td>{nodeNames(r.dontSend)}</Table.Td>
                                        <Table.Td>{nodeNames(r.receiveFrom)}</Table.Td>
                                        <Table.Td>{nodeNames(r.dontReceive)}</Table.Td>
                                        <Table.Td>
                                            <Group gap={4}>
                                                <Badge size="xs" variant="light" color={r.sendByDefault ? 'green' : 'gray'}>{r.sendByDefault ? t('Sends by default') : t('Sends only when listed')}</Badge>
                                                <Badge size="xs" variant="light" color={r.receiveByDefault ? 'green' : 'gray'}>{r.receiveByDefault ? t('Receives by default') : t('Receives only when listed')}</Badge>
                                            </Group>
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                )}
            </div>
        </Stack>
    );
}
