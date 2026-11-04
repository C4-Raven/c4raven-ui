import React, { useEffect, useState } from 'react';
import { Alert, Button, Group, NumberInput, Paper, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import { IconArrowDownLeft, IconArrowUpRight, IconCircleCheck, IconCircleX, IconInfoCircle, IconPlugConnected } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { extractError } from '../ServerRequests/shared';
import { testReachability } from './api';
import { validateHost, validatePort } from './helpers';
import { CopyAddress } from './parts';
import type { Direction, PartnerKind, Reachability } from './types';

/** Step "Who connects": used by the wizard and by the partner editor. */
export default function ConnectStep({
    kind, direction, onDirection, host, port, onHost, onPort, errors, ourAddress, partnerName,
}: {
    kind: PartnerKind;
    direction: Direction;
    /** Leave out to show the direction read-only (existing partners). */
    onDirection?: (d: Direction) => void;
    host: string;
    port: number | '';
    onHost: (v: string) => void;
    onPort: (v: number | '') => void;
    errors: { host?: string; port?: string };
    ourAddress: string;
    partnerName: string;
}) {
    const { t } = useTranslation();
    const [testing, setTesting] = useState(false);
    const [result, setResult] = useState<Reachability | null>(null);
    const [testError, setTestError] = useState<string>();
    const name = partnerName.trim() || t('the other server');

    // A result is only meaningful for the address it was run against.
    useEffect(() => { setResult(null); setTestError(undefined); }, [host, port]);

    async function test() {
        const hostErr = validateHost(host, t);
        const portErr = validatePort(port, t);
        if (hostErr || portErr) {
            setTestError(hostErr ?? portErr);
            return;
        }
        setTesting(true);
        setTestError(undefined);
        try {
            setResult(await testReachability(host.trim(), Number(port)));
        } catch (err) {
            setTestError(await extractError(err) ?? t('The test could not be run'));
        } finally {
            setTesting(false);
        }
    }

    return (
        <Stack gap="md">
            <Text size="sm" c="dimmed">
                {t('One server opens the connection and the other one accepts it. Pick whichever side can reach the other: the side that dials needs to reach the other server\'s federation port through any firewalls.')}
            </Text>
            <Alert variant="light" color="blue" icon={<IconInfoCircle size={16} />}>
                {t('Only one side should connect. If both servers dial each other, the hub sees two connections from the same partner and drops the duplicate, so the link keeps dropping.')}
            </Alert>

            {onDirection ? (
                <SegmentedControl
                    fullWidth
                    radius="xl"
                    value={direction}
                    onChange={(v) => onDirection(v as Direction)}
                    data={[
                        { value: 'we_dial', label: t('We connect to them') },
                        { value: 'they_dial', label: t('They connect to us') },
                    ]}
                    aria-label={t('Who connects')}
                />
            ) : (
                <Group gap={8}>
                    {direction === 'we_dial' ? <IconArrowUpRight size={16} /> : <IconArrowDownLeft size={16} />}
                    <Text size="sm" fw={600}>{direction === 'we_dial' ? t('We connect to them') : t('They connect to us')}</Text>
                    <Text size="xs" c="dimmed">{t('To swap who connects, remove this partner and connect it again.')}</Text>
                </Group>
            )}

            {direction === 'we_dial' ? (
                <Paper p="md" className="raven-surface raven-surface--tile">
                    <Stack gap="sm">
                        <Group grow align="flex-start" wrap="wrap" gap="sm">
                            <TextInput
                                label={t('Their address')}
                                description={t('Exactly the name or IP in their server certificate, without http://')}
                                placeholder={t('e.g. fed.example.org')}
                                value={host}
                                onChange={(e) => onHost(e.currentTarget.value)}
                                error={errors.host}
                                required
                                autoCapitalize="off"
                                autoCorrect="off"
                                spellCheck={false}
                                style={{ minWidth: 220 }}
                            />
                            <NumberInput
                                label={t('Port')}
                                description={kind === 'tak_server'
                                    ? t('A TAK Server\'s federation v2 port, usually 9001')
                                    : t('Federation v2 port, usually 9102')}
                                value={port}
                                onChange={(v) => onPort(typeof v === 'number' ? v : (v === '' ? '' : Number(v)))}
                                min={1}
                                max={65535}
                                allowDecimal={false}
                                allowNegative={false}
                                error={errors.port}
                                required
                                maw={200}
                            />
                        </Group>
                        <Group gap="sm" wrap="wrap">
                            <Button
                                variant="light"
                                radius="xl"
                                size="xs"
                                leftSection={<IconPlugConnected size={14} />}
                                loading={testing}
                                onClick={test}
                            >
                                {t('Test reachability')}
                            </Button>
                            <Text size="xs" c="dimmed">{t('Looks up the name and tries to open the port from this server. Nothing is changed.')}</Text>
                        </Group>
                        {testError && <Alert color="red" variant="light" py="xs">{testError}</Alert>}
                        {result && (
                            <Stack gap={4}>
                                <Group gap={6} wrap="nowrap">
                                    {result.dns_ok ? <IconCircleCheck size={16} color="var(--mantine-color-green-5)" /> : <IconCircleX size={16} color="var(--mantine-color-red-5)" />}
                                    <Text size="sm">
                                        {result.dns_ok
                                            ? t('Name found: {{addresses}}', { addresses: (result.addresses ?? []).join(', ') || host })
                                            : t('The name could not be found. Check the spelling.')}
                                    </Text>
                                </Group>
                                {result.dns_ok && (
                                    <Group gap={6} wrap="nowrap">
                                        {result.tcp_ok ? <IconCircleCheck size={16} color="var(--mantine-color-green-5)" /> : <IconCircleX size={16} color="var(--mantine-color-red-5)" />}
                                        <Text size="sm">
                                            {result.tcp_ok
                                                ? t('Port {{port}} is open', { port })
                                                : t('Port {{port}} did not answer. Their federation service may be off, or a firewall is blocking it.', { port })}
                                        </Text>
                                    </Group>
                                )}
                                {result.error && <Text size="xs" c="dimmed">{result.error}</Text>}
                            </Stack>
                        )}
                    </Stack>
                </Paper>
            ) : (
                <Paper p="md" className="raven-surface raven-surface--tile">
                    <Stack gap="xs">
                        <Text size="sm">
                            {t('Give {{name}}\'s admin this address. They set up an outgoing connection to it, using federation protocol v2.', { name, interpolation: { escapeValue: false } })}
                        </Text>
                        <CopyAddress value={ourAddress} />
                        <Text size="xs" c="dimmed">
                            {t('They must type it exactly like this, because it is the name on this hub\'s certificate. The port must be open to them through any firewall.')}
                        </Text>
                        <Text size="xs" c="dimmed">
                            {t('This hub won\'t dial them. If their side was already set to wait for you, change one side, or the link won\'t come up.')}
                        </Text>
                    </Stack>
                </Paper>
            )}
        </Stack>
    );
}
