import React, { useState } from 'react';
import { ActionIcon, Badge, Group, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconPlugConnectedX, IconPlugOff } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import axios from '../../../axios_config';
import { EmptyState, humanize } from '../../ServerRequests/shared';
import { endpoints } from './endpoints';
import { connectionDirection, isBridgeConnection, shortFingerprint } from './helpers';
import { ConfirmModal, CopyValue, notifyFail, notifyOk, useHubData } from './shared';
import type { HubConnection } from './types';

export default function ConnectionsTab() {
    const { t } = useTranslation();
    const { connections, caGroups, reload } = useHubData();
    const [toDisconnect, setToDisconnect] = useState<HubConnection | null>(null);
    const [busy, setBusy] = useState(false);

    function groupName(uid: string) {
        const ca = caGroups.find((c) => c.uid === uid);
        return ca ? (ca.nickname || shortFingerprint(ca.alias)) : uid;
    }

    async function disconnect() {
        if (!toDisconnect) { return; }
        setBusy(true);
        try {
            await axios.delete(endpoints.connection(toDisconnect.connectionId));
            notifyOk(t('Disconnected'), t('The other side will usually reconnect within a few seconds.'));
            setToDisconnect(null);
            reload();
        } catch (err) {
            notifyFail(t('Failed to disconnect'), err);
        } finally {
            setBusy(false);
        }
    }

    if (connections.length === 0) {
        return (
            <EmptyState
                icon={<IconPlugOff size={26} />}
                title={t('No active connections')}
                description={t('Nothing is connected to the hub right now. Partners appear here as soon as they connect.')}
            />
        );
    }

    return (
        <Stack gap="sm">
            <Table.ScrollContainer minWidth={900}>
                <Table striped highlightOnHover withTableBorder>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>{t('Federate')}</Table.Th>
                            <Table.Th>{t('Remote address')}</Table.Th>
                            <Table.Th>{t('Direction')}</Table.Th>
                            <Table.Th>{t('Remote type')}</Table.Th>
                            <Table.Th>{t('Protocol')}</Table.Th>
                            <Table.Th>{t('Groups (CA)')}</Table.Th>
                            <Table.Th />
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {connections.map((c) => {
                            const bridge = isBridgeConnection(c);
                            const dir = connectionDirection(c);
                            return (
                                <Table.Tr key={c.connectionId}>
                                    <Table.Td>
                                        <Stack gap={0}>
                                            <Group gap={6} wrap="nowrap">
                                                <Text size="sm" fw={600}>{c.remoteServerId || c.connectionId}</Text>
                                                {bridge && <Badge size="xs" color="grape" variant="light">{t('This Raven')}</Badge>}
                                            </Group>
                                            <Group gap={2} wrap="nowrap">
                                                <Text size="xs" c="dimmed" ff="monospace" truncate maw={320}>{c.connectionId}</Text>
                                                <CopyValue value={c.connectionId} label={t('Copy connection id')} />
                                            </Group>
                                        </Stack>
                                    </Table.Td>
                                    <Table.Td>{c.remoteAddress ?? '—'}</Table.Td>
                                    <Table.Td>
                                        <Badge variant="light" color={dir === 'outgoing' ? 'indigo' : 'blue'}>
                                            {dir === 'outgoing' ? t('We dialled') : t('They dialled')}
                                        </Badge>
                                    </Table.Td>
                                    <Table.Td>
                                        <Tooltip label={c.remoteConnectionType ?? ''} disabled={!c.remoteConnectionType}>
                                            <Text size="sm">{c.remoteConnectionType ? humanize(c.remoteConnectionType) : '—'}</Text>
                                        </Tooltip>
                                    </Table.Td>
                                    <Table.Td>{c.federationProtocolVersion != null ? `v${c.federationProtocolVersion}` : '—'}</Table.Td>
                                    <Table.Td>
                                        <Group gap={4}>
                                            {(c.groupIdentities ?? []).length === 0 && <Text size="sm" c="dimmed">—</Text>}
                                            {(c.groupIdentities ?? []).map((g) => (
                                                <Tooltip key={g} label={g} multiline maw={420}>
                                                    <Badge size="sm" variant="outline">{groupName(g)}</Badge>
                                                </Tooltip>
                                            ))}
                                        </Group>
                                    </Table.Td>
                                    <Table.Td>
                                        <Tooltip label={t('Disconnect')}>
                                            <ActionIcon color="red" variant="subtle" onClick={() => setToDisconnect(c)} aria-label={t('Disconnect')}>
                                                <IconPlugConnectedX size={16} />
                                            </ActionIcon>
                                        </Tooltip>
                                    </Table.Td>
                                </Table.Tr>
                            );
                        })}
                    </Table.Tbody>
                </Table>
            </Table.ScrollContainer>
            <Text size="xs" c="dimmed">
                {t('This hub version doesn\'t report message counts per connection. See the Metrics tab for per-channel traffic.')}
            </Text>

            <ConfirmModal
                opened={toDisconnect !== null}
                onClose={() => setToDisconnect(null)}
                onConfirm={disconnect}
                loading={busy}
                title={t('Disconnect this federate?')}
                confirmLabel={t('Disconnect')}
            >
                <Text size="sm">
                    {t('"{{name}}" is dropped now. It normally reconnects by itself within a few seconds; to stop it for good, disable or remove the partner instead.', { name: toDisconnect?.remoteServerId || toDisconnect?.connectionId || '', interpolation: { escapeValue: false } })}
                </Text>
                {toDisconnect && isBridgeConnection(toDisconnect) && (
                    <Text size="sm" c="orange">{t('This is this Raven server\'s own bridge. Federation stops for everyone here until it reconnects.')}</Text>
                )}
            </ConfirmModal>
        </Stack>
    );
}
