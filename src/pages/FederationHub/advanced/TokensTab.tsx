import React, { useCallback, useEffect, useState } from 'react';
import { ActionIcon, Alert, Button, Card, Group, Modal, Stack, Switch, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { IconAlertTriangle, IconKey, IconPlus, IconTrash } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import axios from '../../../axios_config';
import { EmptyState, formatDateTime } from '../../ServerRequests/shared';
import { endpoints } from './endpoints';
import { fetchStoredActive, generateToken, savePolicy } from './api';
import { entityLabel, normalizePolicy, tokenEntries, tokenFingerprint, upsertEntity, withToken, withoutToken } from './helpers';
import { ConfirmModal, CopyValue, SecretText, notifyFail, notifyOk, useHubData } from './shared';
import type { Federation, PolicyEntity, TokenEntry } from './types';

function expiryText(ms: number, t: (k: string) => string) {
    return ms < 0 ? t('Never') : formatDateTime(new Date(ms));
}

export default function TokensTab() {
    const { t } = useTranslation();
    const { federations } = useHubData();
    const [active, setActive] = useState<Federation | null>(null);
    const [tokenPorts, setTokenPorts] = useState<number | null>(null);
    const [genFor, setGenFor] = useState<PolicyEntity | null>(null);
    const [label, setLabel] = useState('');
    const [never, setNever] = useState(true);
    const [expires, setExpires] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [created, setCreated] = useState<TokenEntry | null>(null);
    const [toRevoke, setToRevoke] = useState<{ node: PolicyEntity; token: string } | null>(null);

    const load = useCallback(() => {
        fetchStoredActive().then(setActive).catch(() => setActive(null));
        axios.get(endpoints.brokerConfig)
            .then((r) => setTokenPorts(Array.isArray(r.data?.federationTokenAuthServers) ? r.data.federationTokenAuthServers.length : 0))
            .catch(() => setTokenPorts(null));
    }, []);
    useEffect(() => { load(); }, [load, federations]);

    const policy = active ? normalizePolicy(active.policy) : null;
    const groups = policy ? policy.entities.filter((e) => e.type === 'FederationTokenGroup') : [];

    async function persist(node: PolicyEntity) {
        if (!active || !policy) { return; }
        await savePolicy(active, upsertEntity(policy, node), true);
    }

    async function generate() {
        if (!genFor) { return; }
        setBusy(true);
        try {
            const expiration = never || !expires ? -1 : new Date(expires.replace(' ', 'T')).getTime();
            const tok = await generateToken({
                clientFingerprint: tokenFingerprint(label || entityLabel(genFor), Date.now()),
                clientGroup: genFor.name ?? '',
                expiration,
            });
            await persist(withToken(genFor, { token: tok.token, expiration: tok.expiration ?? expiration }));
            setCreated(tok);
            setGenFor(null);
            notifyOk(t('Token created and policy applied'));
            load();
        } catch (err) {
            notifyFail(t('Failed to create token'), err);
        } finally {
            setBusy(false);
        }
    }

    async function revoke() {
        if (!toRevoke) { return; }
        setBusy(true);
        try {
            await persist(withoutToken(toRevoke.node, toRevoke.token));
            notifyOk(t('Token revoked and policy applied'));
            setToRevoke(null);
            load();
        } catch (err) {
            notifyFail(t('Failed to revoke token'), err);
        } finally {
            setBusy(false);
        }
    }

    return (
        <Stack gap="md">
            <Text size="sm" c="dimmed" maw={720}>
                {t('Tokens let a server that can\'t do mutual TLS federate. It pastes the token into its outgoing connection to this hub. Tokens belong to a token group node in the active policy; add one in the Policy editor.')}
            </Text>
            {tokenPorts === 0 && (
                <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
                    {t('The broker has no token port configured, so tokens are not accepted yet. That needs a change to the broker configuration on the server and a broker restart.')}
                </Alert>
            )}
            {!active && <Alert color="red" variant="light">{t('No active policy.')}</Alert>}
            {active && groups.length === 0 && (
                <EmptyState icon={<IconKey size={26} />} title={t('No token groups')} description={t('The active policy "{{name}}" has no token group nodes.', { name: active.name, interpolation: { escapeValue: false } })} />
            )}
            {groups.map((g) => {
                const tokens = tokenEntries(g);
                return (
                    <Card key={g.id} className="raven-surface" p="md">
                        <Group justify="space-between" mb="xs">
                            <div>
                                <Text fw={600}>{entityLabel(g)}</Text>
                                <Text size="xs" c="dimmed">{t('Token group claim')} <Text span ff="monospace">{g.name}</Text></Text>
                            </div>
                            <Button size="xs" radius="xl" variant="light" leftSection={<IconPlus size={14} />} onClick={() => { setGenFor(g); setLabel(''); setNever(true); setExpires(null); }}>{t('Generate token')}</Button>
                        </Group>
                        <Table.ScrollContainer minWidth={560}>
                            <Table withTableBorder>
                                <Table.Thead><Table.Tr><Table.Th>{t('Token')}</Table.Th><Table.Th>{t('Expires')}</Table.Th><Table.Th /></Table.Tr></Table.Thead>
                                <Table.Tbody>
                                    {tokens.length === 0 && <Table.Tr><Table.Td colSpan={3}><Text size="sm" c="dimmed" ta="center">{t('No tokens yet')}</Text></Table.Td></Table.Tr>}
                                    {tokens.map((tk) => (
                                        <Table.Tr key={tk.token}>
                                            <Table.Td><SecretText value={tk.token} /></Table.Td>
                                            <Table.Td>{expiryText(tk.expiration, t)}</Table.Td>
                                            <Table.Td>
                                                <Tooltip label={t('Revoke')}>
                                                    <ActionIcon color="red" variant="subtle" onClick={() => setToRevoke({ node: g, token: tk.token })} aria-label={t('Revoke')}><IconTrash size={16} /></ActionIcon>
                                                </Tooltip>
                                            </Table.Td>
                                        </Table.Tr>
                                    ))}
                                </Table.Tbody>
                            </Table>
                        </Table.ScrollContainer>
                    </Card>
                );
            })}

            <Modal opened={genFor !== null} onClose={() => setGenFor(null)} title={<Text fw={700}>{t('Generate a token')}</Text>} centered>
                <Stack gap="sm">
                    <TextInput label={t('Who is it for?')} description={t('A label for your own records, e.g. the other server\'s name')} value={label} onChange={(e) => setLabel(e.currentTarget.value)} />
                    <Switch label={t('Never expires')} checked={never} onChange={(e) => setNever(e.currentTarget.checked)} />
                    {!never && <DateTimePicker label={t('Expires')} value={expires} onChange={(v) => setExpires(v ? String(v) : null)} minDate={new Date()} />}
                    <Text size="xs" c="dimmed">{t('The token is added to the active policy, which is then saved and applied.')}</Text>
                </Stack>
                <Group justify="flex-end" mt="lg" gap="sm">
                    <Button variant="default" radius="xl" onClick={() => setGenFor(null)}>{t('Cancel')}</Button>
                    <Button radius="xl" loading={busy} disabled={!never && !expires} onClick={generate}>{t('Generate')}</Button>
                </Group>
            </Modal>

            <Modal opened={created !== null} onClose={() => setCreated(null)} title={<Text fw={700}>{t('Token created')}</Text>} centered>
                <Stack gap="sm">
                    <Text size="sm">{t('Send this to the other admin over a secure channel. Anyone holding it can federate as this token group.')}</Text>
                    <Group gap={4} wrap="nowrap" align="flex-start">
                        <Text size="xs" ff="monospace" style={{ wordBreak: 'break-all', flex: 1 }}>{created?.token}</Text>
                        <CopyValue value={created?.token ?? ''} />
                    </Group>
                </Stack>
                <Group justify="flex-end" mt="lg"><Button radius="xl" onClick={() => setCreated(null)}>{t('Done')}</Button></Group>
            </Modal>

            <ConfirmModal opened={toRevoke !== null} onClose={() => setToRevoke(null)} onConfirm={revoke} loading={busy} title={t('Revoke this token?')} confirmLabel={t('Revoke')}>
                <Text size="sm">{t('The token is removed from the active policy and the policy is applied. A server using it can no longer connect.')}</Text>
            </ConfirmModal>
        </Stack>
    );
}
