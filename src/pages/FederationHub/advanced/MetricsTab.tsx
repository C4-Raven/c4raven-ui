import React from 'react';
import { Card, SimpleGrid, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { formatBytes, formatCount, formatPercent } from './helpers';
import { useHubData } from './shared';

function Tile({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
    const { t } = useTranslation();
    return (
        <Card className="raven-surface raven-surface--tile" p="sm">
            <Text size="xs" c="dimmed">{label}</Text>
            {value === null ? (
                <Tooltip label={hint ?? t('The hub does not report this value')}>
                    <Text size="lg" fw={700} c="dimmed">{t('Not reported')}</Text>
                </Tooltip>
            ) : (
                <Text size="xl" fw={700}>{value}</Text>
            )}
        </Card>
    );
}

export default function MetricsTab() {
    const { t } = useTranslation();
    const { metrics, connections, caGroups } = useHubData();
    const g = metrics?.global ?? {};
    const b = metrics?.broker ?? {};
    const channels = b.channelInfos ?? [];
    const perSec = (n: number | undefined) => {
        const v = formatCount(n, 1);
        return v === null ? null : `${v}/s`;
    };
    const bytesPerSec = (n: number | undefined) => {
        const v = formatBytes(n);
        return v === null ? null : `${v}/s`;
    };
    const idLabel = (id?: string, cert?: string) => {
        if (!id) { return '—'; }
        const conn = connections.find((c) => c.connectionId === id);
        const ca = caGroups.find((c) => c.uid === cert);
        return conn?.remoteServerId || ca?.nickname || id;
    };
    const notMeasured = t('The hub isn\'t measuring this (it reports -1)');

    return (
        <Stack gap="lg">
            <div>
                <Title order={5} mb="xs">{t('Hub process')}</Title>
                <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }}>
                    <Tile label={t('Connected clients')} value={formatCount(g.numConnectedClients)} />
                    <Tile label={t('CPU used')} value={formatPercent(g.cpuUtilized)} hint={notMeasured} />
                    <Tile label={t('CPU cores')} value={formatCount(g.cpuCores)} hint={notMeasured} />
                    <Tile label={t('Heap used')} value={formatPercent(g.heapUtilized)} hint={notMeasured} />
                    <Tile label={t('Heap allocated')} value={formatBytes(g.heapAllocated)} hint={notMeasured} />
                    <Tile label={t('Writes per second')} value={perSec(g.writesPerSecond)} />
                    <Tile label={t('Reads per second')} value={perSec(g.readsPerSecond)} />
                    <Tile label={t('Bytes written per second')} value={bytesPerSec(g.bytesWrittenPerSecond)} />
                    <Tile label={t('Bytes read per second')} value={bytesPerSec(g.bytesReadPerSecond)} />
                </SimpleGrid>
            </div>

            <div>
                <Title order={5} mb="xs">{t('Broker totals')}</Title>
                <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }}>
                    <Tile label={t('Messages written')} value={formatCount(b.totalWrites)} />
                    <Tile label={t('Messages read')} value={formatCount(b.totalReads)} />
                    <Tile label={t('Bytes written')} value={formatBytes(b.totalBytesWritten)} />
                    <Tile label={t('Bytes read')} value={formatBytes(b.totalBytesRead)} />
                    <Tile label={t('Messages dropped')} value={formatCount(b.totalMessagesDropped)} />
                </SimpleGrid>
            </div>

            <div>
                <Title order={5} mb={4}>{t('Channels')}</Title>
                <Text size="sm" c="dimmed" mb="xs">{t('One row per direction of traffic between two connections.')}</Text>
                <Table.ScrollContainer minWidth={900}>
                    <Table striped withTableBorder>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>{t('From')}</Table.Th>
                                <Table.Th>{t('To')}</Table.Th>
                                <Table.Th>{t('Target')}</Table.Th>
                                <Table.Th ta="right">{t('Messages written')}</Table.Th>
                                <Table.Th ta="right">{t('Messages read')}</Table.Th>
                                <Table.Th ta="right">{t('Total messages')}</Table.Th>
                                <Table.Th ta="right">{t('Bytes written')}</Table.Th>
                                <Table.Th ta="right">{t('Bytes read')}</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {channels.length === 0 && (
                                <Table.Tr>
                                    <Table.Td colSpan={8}><Text c="dimmed" ta="center" size="sm">{t('No traffic channels yet')}</Text></Table.Td>
                                </Table.Tr>
                            )}
                            {channels.map((c, i) => (
                                <Table.Tr key={`${c.sourceId}-${c.targetId}-${i}`}>
                                    <Table.Td><Tooltip label={c.sourceId ?? ''}><Text size="sm">{idLabel(c.sourceId, c.sourceCert)}</Text></Tooltip></Table.Td>
                                    <Table.Td><Tooltip label={c.targetId ?? ''}><Text size="sm">{idLabel(c.targetId, c.targetCert)}</Text></Tooltip></Table.Td>
                                    <Table.Td><Text size="sm">{c.target || '—'}</Text></Table.Td>
                                    <Table.Td ta="right">{formatCount(c.messagesWritten) ?? '—'}</Table.Td>
                                    <Table.Td ta="right">{formatCount(c.messagesRead) ?? '—'}</Table.Td>
                                    <Table.Td ta="right">{formatCount(c.totalMessages) ?? '—'}</Table.Td>
                                    <Table.Td ta="right">{formatBytes(c.bytesWritten) ?? '—'}</Table.Td>
                                    <Table.Td ta="right">{formatBytes(c.bytesRead) ?? '—'}</Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                </Table.ScrollContainer>
                <Text size="xs" c="dimmed" mt="xs">{t('Refreshes every 10 seconds while this section is open.')}</Text>
            </div>
        </Stack>
    );
}
