import React from 'react';
import { ActionIcon, Alert, Badge, Button, Group, Menu, Paper, SimpleGrid, Stack, Switch, Text, Tooltip } from '@mantine/core';
import {
    IconAlertTriangle,
    IconArrowDownLeft,
    IconArrowUpRight,
    IconInfoCircle,
    IconPlugConnectedX,
    IconDots,
    IconPencil,
    IconRefresh,
    IconStethoscope,
    IconTrash,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { directionLabel, formatBytes, formatCount, isUnlinkedOutgoing, problemColor, problemText, shareSummary, unlinkedOutgoingHint } from './helpers';
import { Fingerprint, KindIcon, StatusBadge } from './parts';
import type { Partner } from './types';

export default function PartnerCard({ partner, busy, onEdit, onCheck, onReconnect, onRemove, onToggle, onStopDialling }: {
    partner: Partner;
    busy?: boolean;
    onEdit: () => void;
    onCheck: () => void;
    onReconnect: () => void;
    onRemove: () => void;
    onToggle: (enabled: boolean) => void;
    /**
     * Both sides dial: drop OUR outgoing connection. For an outgoing-only
     * partner that removes it (keeping any CA); for a CA partner it switches
     * to "They connect to us".
     */
    onStopDialling?: () => void;
}) {
    const { t } = useTranslation();
    const share = shareSummary(partner.share, t);
    const receive = shareSummary(partner.receive, t);
    const traffic = partner.traffic ?? { msgs_out: 0, msgs_in: 0, bytes_out: 0, bytes_in: 0 };
    const unlinked = isUnlinkedOutgoing(partner);
    const bothDial = partner.problems?.includes('both_sides_dial');
    const otherProblems = (partner.problems ?? []).filter((code) => code !== 'both_sides_dial');

    return (
        <Paper
            p="lg"
            className="raven-surface"
            radius="lg"
            style={{ opacity: partner.enabled ? 1 : 0.72, display: 'flex', flexDirection: 'column', gap: 12 }}
        >
            <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
                <Group gap="sm" wrap="nowrap" align="flex-start" style={{ minWidth: 0 }}>
                    <KindIcon kind={partner.kind} />
                    <Stack gap={4} style={{ minWidth: 0 }}>
                        <Text fw={700} size="lg" style={{ wordBreak: 'break-word', lineHeight: 1.2 }}>{partner.name}</Text>
                        <Group gap={6} wrap="wrap">
                            <StatusBadge status={partner.status} />
                            <Badge
                                variant="light"
                                color={partner.direction === 'we_dial' ? 'indigo' : 'grape'}
                                tt="none"
                                leftSection={partner.direction === 'we_dial' ? <IconArrowUpRight size={12} /> : <IconArrowDownLeft size={12} />}
                                maw={260}
                            >
                                {directionLabel(partner, t)}
                            </Badge>
                        </Group>
                    </Stack>
                </Group>
                <Tooltip label={partner.enabled ? t('On. Click to pause this partner.') : t('Paused. Click to turn it back on.')}>
                    <div>
                        <Switch
                            checked={partner.enabled}
                            disabled={busy}
                            onChange={(e) => onToggle(e.currentTarget.checked)}
                            aria-label={t('Enable {{name}}', { name: partner.name })}
                            size="md"
                        />
                    </div>
                </Tooltip>
            </Group>

            {partner.ca
                ? <Fingerprint sha256={partner.ca.sha256} label={t('Certificate')} />
                : <Text size="xs" c="dimmed">{t('Not linked to a trusted certificate')}</Text>}

            <Stack gap={6}>
                <Group gap={6} wrap="wrap">
                    <Text size="xs" c="dimmed" w={70}>{t('We send')}</Text>
                    <Tooltip label={share.detail} multiline maw={300}>
                        <Badge variant="light" color={share.color} tt="none">{share.label}</Badge>
                    </Tooltip>
                </Group>
                <Group gap={6} wrap="wrap">
                    <Text size="xs" c="dimmed" w={70}>{t('We accept')}</Text>
                    <Tooltip label={receive.detail} multiline maw={300}>
                        <Badge variant="light" color={receive.color} tt="none">{receive.label}</Badge>
                    </Tooltip>
                    {partner.interconnected && (
                        <Tooltip label={t('Servers under this partner\'s certificate authority can also talk to each other.')} multiline maw={280}>
                            <Badge variant="light" color="gray" tt="none">{t('Interconnected')}</Badge>
                        </Tooltip>
                    )}
                </Group>
            </Stack>

            <SimpleGrid cols={2} spacing="xs">
                <div>
                    <Text size="xs" c="dimmed">{t('Sent')}</Text>
                    <Text size="sm" fw={600}>
                        {t('{{count}} messages', { count: formatCount(traffic.msgs_out) })}
                        <Text span size="xs" c="dimmed"> · {formatBytes(traffic.bytes_out)}</Text>
                    </Text>
                </div>
                <div>
                    <Text size="xs" c="dimmed">{t('Received')}</Text>
                    <Text size="sm" fw={600}>
                        {t('{{count}} messages', { count: formatCount(traffic.msgs_in) })}
                        <Text span size="xs" c="dimmed"> · {formatBytes(traffic.bytes_in)}</Text>
                    </Text>
                </div>
            </SimpleGrid>

            {bothDial && (
                <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} py="xs">
                    <Stack gap={6}>
                        <Text size="xs">{problemText('both_sides_dial', t)}</Text>
                        {partner.direction === 'we_dial' && onStopDialling && (
                            <Group>
                                <Button size="xs" radius="xl" color="red" variant="light" leftSection={<IconPlugConnectedX size={14} />} disabled={busy} onClick={onStopDialling}>
                                    {unlinked ? t('Remove this outgoing connection') : t('Stop connecting to them')}
                                </Button>
                            </Group>
                        )}
                    </Stack>
                </Alert>
            )}

            {unlinked && (
                <Alert color="yellow" variant="light" icon={<IconInfoCircle size={16} />} py="xs">
                    <Text size="xs">{unlinkedOutgoingHint(t)}</Text>
                </Alert>
            )}

            {otherProblems.length > 0 && (
                <Stack gap={4}>
                    {otherProblems.map((code) => (
                        <Text key={code} size="xs" c={problemColor(code) === 'red' ? 'red' : 'yellow.8'}>{problemText(code, t)}</Text>
                    ))}
                </Stack>
            )}

            <Group justify="space-between" align="center" mt="auto" gap="xs" wrap="nowrap">
                <Text size="xs" c="dimmed">
                    {partner.connections?.length
                        ? t('{{count}} live connections', { count: partner.connections.length })
                        : t('No live connection')}
                </Text>
                <Group gap={6} wrap="nowrap">
                    <Tooltip label={t('Check connection')}>
                        <ActionIcon variant="light" size="lg" radius="xl" aria-label={t('Check connection to {{name}}', { name: partner.name })} onClick={onCheck}>
                            <IconStethoscope size={16} />
                        </ActionIcon>
                    </Tooltip>
                    <Tooltip label={t('Edit')}>
                        <ActionIcon variant="light" size="lg" radius="xl" aria-label={t('Edit {{name}}', { name: partner.name })} onClick={onEdit}>
                            <IconPencil size={16} />
                        </ActionIcon>
                    </Tooltip>
                    <Menu position="bottom-end" withinPortal>
                        <Menu.Target>
                            <ActionIcon variant="light" size="lg" radius="xl" aria-label={t('More actions')}>
                                <IconDots size={16} />
                            </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                            <Menu.Item leftSection={<IconRefresh size={14} />} onClick={onReconnect} disabled={busy}>
                                {t('Reconnect')}
                            </Menu.Item>
                            <Menu.Divider />
                            <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={onRemove}>{t('Remove')}</Menu.Item>
                        </Menu.Dropdown>
                    </Menu>
                </Group>
            </Group>
        </Paper>
    );
}
