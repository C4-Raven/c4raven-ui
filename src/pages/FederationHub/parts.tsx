/** Small building blocks shared by the Federation Hub page, cards and wizard. */
import React from 'react';
import { ActionIcon, Badge, Code, CopyButton, Group, Text, ThemeIcon, Tooltip } from '@mantine/core';
import { IconAffiliate, IconBuildingBroadcastTower, IconCheck, IconCopy, IconServer2 } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { PulseDot } from '../ServerRequests/shared';
import { formatFingerprint, kindLabel, shortFingerprint, statusView } from './helpers';
import type { PartnerKind, PartnerStatus } from './types';

export function CopyIcon({ value, label }: { value: string; label: string }) {
    const { t } = useTranslation();
    return (
        <CopyButton value={value} timeout={1500}>
            {({ copied, copy }) => (
                <Tooltip label={copied ? t('Copied') : label} withArrow>
                    <ActionIcon
                        variant="subtle"
                        color={copied ? 'teal' : 'gray'}
                        size="sm"
                        onClick={copy}
                        aria-label={label}
                    >
                        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    </ActionIcon>
                </Tooltip>
            )}
        </CopyButton>
    );
}

/**
 * SHA-256 fingerprint, shortened, with the full value on hover and a copy
 * button. Every Raven hub CA has the same name (G7), so this is the only
 * reliable way to tell certificates apart.
 */
export function Fingerprint({ sha256, label }: { sha256: string | null | undefined; label?: string }) {
    const { t } = useTranslation();
    if (!sha256) { return <Text size="xs" c="dimmed">{t('No certificate')}</Text>; }
    const full = formatFingerprint(sha256);
    return (
        <Group gap={4} wrap="nowrap" style={{ minWidth: 0 }}>
            {label && <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{label}</Text>}
            <Tooltip label={<span style={{ wordBreak: 'break-all' }}>{full}</span>} multiline maw={360} withArrow>
                <Code style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{shortFingerprint(sha256)}</Code>
            </Tooltip>
            <CopyIcon value={full} label={t('Copy SHA-256 fingerprint')} />
        </Group>
    );
}

/** host:port in monospace with a copy button. */
export function CopyAddress({ value }: { value: string }) {
    const { t } = useTranslation();
    return (
        <Group gap={4} wrap="nowrap">
            <Code style={{ fontSize: 13 }}>{value}</Code>
            <CopyIcon value={value} label={t('Copy address')} />
        </Group>
    );
}

export function KindIcon({ kind, size = 'lg' }: { kind: PartnerKind; size?: string }) {
    const { t } = useTranslation();
    const icon = kind === 'raven_hub'
        ? <IconAffiliate size={18} />
        : kind === 'tak_server'
            ? <IconBuildingBroadcastTower size={18} />
            : <IconServer2 size={18} />;
    return (
        <Tooltip label={kindLabel(kind, t)}>
            <ThemeIcon variant="light" radius="xl" size={size} color={kind === 'raven_hub' ? 'indigo' : kind === 'tak_server' ? 'cyan' : 'gray'} aria-label={kindLabel(kind, t)}>
                {icon}
            </ThemeIcon>
        </Tooltip>
    );
}

export function StatusBadge({ status }: { status: PartnerStatus }) {
    const { t } = useTranslation();
    const v = statusView(status, t);
    return (
        <Tooltip label={v.description} multiline maw={280}>
            <Badge
                variant="light"
                color={v.color}
                tt="none"
                leftSection={v.pulse
                    ? <PulseDot active color={`var(--mantine-color-${v.color}-5)`} />
                    : <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: `var(--mantine-color-${v.color}-6)` }} />}
            >
                {v.label}
            </Badge>
        </Tooltip>
    );
}
