import React, { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Code, Group, Loader, Stack, Table, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconRefresh, IconServerBolt } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import axios from '../../../axios_config';
import { humanize } from '../../ServerRequests/shared';
import { endpoints } from './endpoints';
import { errorText, waitForHub } from './api';
import { isSecretKey } from './helpers';
import { ConfirmModal, notifyFail, notifyOk, useHubData } from './shared';

function renderValue(key: string, value: unknown, hidden: string) {
    if (isSecretKey(key)) { return <Text size="sm" c="dimmed" fs="italic">{hidden}</Text>; }
    if (value === null || value === undefined || value === '') { return <Text size="sm" c="dimmed">—</Text>; }
    if (typeof value === 'boolean') { return <Badge size="sm" variant="light" color={value ? 'green' : 'gray'}>{String(value)}</Badge>; }
    if (typeof value === 'object') { return <Code block>{JSON.stringify(value, null, 2)}</Code>; }
    return <Text size="sm" ff="monospace" style={{ wordBreak: 'break-all' }}>{String(value)}</Text>;
}

export default function BrokerTab() {
    const { t } = useTranslation();
    const { reload } = useHubData();
    const [config, setConfig] = useState<Record<string, unknown> | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [confirm, setConfirm] = useState(false);
    const [phase, setPhase] = useState<'idle' | 'restarting' | 'waiting'>('idle');
    const cancelled = useRef(false);
    useEffect(() => () => { cancelled.current = true; }, []);

    function loadConfig() {
        axios.get(endpoints.brokerConfig)
            .then((r) => { setConfig(r.data && typeof r.data === 'object' ? r.data : null); setError(null); })
            .catch(async (err) => setError(await errorText(err)));
    }
    useEffect(() => { loadConfig(); }, []);

    async function restart() {
        setConfirm(false);
        setPhase('restarting');
        try {
            await axios.post(endpoints.restartBroker, undefined, { timeout: 120000 });
        } catch (err: any) {
            // With the supervised unit the whole hub restarts and this call can drop (G9); keep waiting.
            if (err?.response && err.response.status < 500) {
                notifyFail(t('Failed to restart broker'), err);
                setPhase('idle');
                return;
            }
        }
        setPhase('waiting');
        const ok = await waitForHub(() => cancelled.current);
        if (cancelled.current) { return; }
        setPhase('idle');
        if (ok) {
            notifyOk(t('Broker is back'), t('Partners reconnect over the next few seconds.'));
            reload();
            loadConfig();
        } else {
            notifyFail(t('The hub hasn\'t come back yet'), t('Check the federation-hub service on the server.'));
        }
    }

    const entries = config ? Object.entries(config).sort(([a], [b]) => a.localeCompare(b)) : [];
    const timeout = typeof config?.clientTimeoutTime === 'number' ? config.clientTimeoutTime : null;

    return (
        <Stack gap="md">
            <Group justify="space-between" wrap="wrap" gap="sm">
                <Text size="sm" c="dimmed" maw={680}>
                    {t('The broker carries federation traffic. Its settings are shown read-only. Changing them means editing federation-hub-broker.yml on the server and restarting.')}
                </Text>
                <Group gap="xs">
                    <Button size="xs" radius="xl" variant="default" leftSection={<IconRefresh size={14} />} onClick={loadConfig}>{t('Refresh')}</Button>
                    <Button size="xs" radius="xl" color="red" variant="light" leftSection={<IconServerBolt size={14} />} loading={phase !== 'idle'} onClick={() => setConfirm(true)}>{t('Restart broker')}</Button>
                </Group>
            </Group>

            {phase !== 'idle' && (
                <Alert color="blue" variant="light" icon={<Loader size={16} />}>
                    {phase === 'restarting' ? t('Restarting the broker…') : t('Waiting for the hub to answer again. This can take a minute.')}
                </Alert>
            )}
            {error && <Alert color="red" variant="light">{error}</Alert>}
            {timeout !== null && timeout <= 15 && (
                <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
                    {t('clientTimeoutTime is {{n}} seconds, so quiet federation links will be dropped. Raven\'s installer sets 3600.', { n: timeout })}
                </Alert>
            )}

            {config && (
                <div>
                    <Title order={5} mb="xs">{t('Broker configuration')}</Title>
                    <Table.ScrollContainer minWidth={600}>
                        <Table striped withTableBorder>
                            <Table.Tbody>
                                {entries.map(([k, v]) => (
                                    <Table.Tr key={k}>
                                        <Table.Td w={280}><Text size="sm" fw={600}>{humanize(k)}</Text><Text size="xs" c="dimmed" ff="monospace">{k}</Text></Table.Td>
                                        <Table.Td>{renderValue(k, v, t('hidden'))}</Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                </div>
            )}

            <ConfirmModal opened={confirm} onClose={() => setConfirm(false)} onConfirm={restart} title={t('Restart the broker?')} confirmLabel={t('Restart')}>
                <Text size="sm">{t('Every federation partner and this Raven\'s bridge disconnect until the broker is back, usually within a minute.')}</Text>
                <Text size="sm" c="dimmed">{t('Depending on how the hub service is installed, this can restart the whole Federation Hub, including its admin interface. This page waits until it answers again.')}</Text>
            </ConfirmModal>
        </Stack>
    );
}
