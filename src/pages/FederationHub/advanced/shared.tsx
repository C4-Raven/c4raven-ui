import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Group, Modal, Stack, Text, TextInput, Tooltip, ActionIcon, CopyButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconCopy, IconEye, IconEyeOff, IconX } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import axios from '../../../axios_config';
import { endpoints } from './endpoints';
import { errorText, fetchActivePolicy } from './api';
import type { CaGroup, Federation, HubConnection, MetricsResponse, RegisteredPlugin } from './types';
import { maskSecret } from './helpers';

/* ------------------------------------------------------------ toasts */

export function notifyOk(title: string, message = '') {
    notifications.show({ title, message, icon: <IconCheck />, color: 'green' });
}

export async function notifyFail(title: string, err: unknown) {
    notifications.show({ title, message: await errorText(err), icon: <IconX />, color: 'red' });
}

/* ------------------------------------------------------- shared data */

export interface HubData {
    connections: HubConnection[];
    metrics: MetricsResponse | null;
    plugins: RegisteredPlugin[];
    caGroups: CaGroup[];
    federations: Federation[];
    activeName: string | null;
    loading: boolean;
    /** Last error from loading or the background poll (null when the hub answered). */
    error: string | null;
    reload: () => Promise<void>;
}

const HubDataContext = createContext<HubData | null>(null);

export function useHubData(): HubData {
    const ctx = useContext(HubDataContext);
    if (!ctx) { throw new Error('useHubData outside HubDataProvider'); }
    return ctx;
}

export function HubDataProvider({ children, active }: { children: React.ReactNode; active: boolean }) {
    const [connections, setConnections] = useState<HubConnection[]>([]);
    const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
    const [plugins, setPlugins] = useState<RegisteredPlugin[]>([]);
    const [caGroups, setCaGroups] = useState<CaGroup[]>([]);
    const [federations, setFederations] = useState<Federation[]>([]);
    const [activeName, setActiveName] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    // Kept apart so the 10 s poll only clears its own error, never a failed full load's.
    const [loadError, setLoadError] = useState<string | null>(null);
    const [pollError, setPollError] = useState<string | null>(null);
    const error = loadError && pollError && loadError !== pollError ? `${loadError} · ${pollError}` : (loadError ?? pollError);
    const mounted = useRef(true);

    useEffect(() => () => { mounted.current = false; }, []);

    const reload = useCallback(async () => {
        setLoading(true);
        const results = await Promise.allSettled([
            axios.get<HubConnection[]>(endpoints.connections),
            axios.get<MetricsResponse>(endpoints.metrics),
            axios.get<RegisteredPlugin[]>(endpoints.plugins),
            axios.get<CaGroup[]>(endpoints.caGroups),
            axios.get<Federation[]>(endpoints.federations),
            fetchActivePolicy(),
        ]);
        if (!mounted.current) { return; }
        const [conn, met, plug, ca, feds, act] = results;
        if (conn.status === 'fulfilled') { setConnections(Array.isArray(conn.value.data) ? conn.value.data : []); }
        if (met.status === 'fulfilled') { setMetrics(met.value.data ?? null); }
        if (plug.status === 'fulfilled') { setPlugins(Array.isArray(plug.value.data) ? plug.value.data : []); }
        if (ca.status === 'fulfilled') { setCaGroups(Array.isArray(ca.value.data) ? ca.value.data : []); }
        if (feds.status === 'fulfilled') { setFederations(Array.isArray(feds.value.data) ? feds.value.data : []); }
        if (act.status === 'fulfilled') { setActiveName(act.value?.name ?? null); }
        const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (failures.length > 0) {
            const msgs = await Promise.all(failures.map((f) => errorText(f.reason)));
            setLoadError(Array.from(new Set(msgs)).join(' · '));
        } else {
            setLoadError(null);
            setPollError(null);
        }
        setLoading(false);
    }, []);

    // Load when first expanded; then poll the live parts every 10 s while open.
    useEffect(() => {
        if (!active) { return undefined; }
        reload();
        const timer = setInterval(() => {
            Promise.all([
                axios.get<HubConnection[]>(endpoints.connections),
                axios.get<MetricsResponse>(endpoints.metrics),
            ]).then(([c, m]) => {
                if (!mounted.current) { return; }
                setConnections(Array.isArray(c.data) ? c.data : []);
                setMetrics(m.data ?? null);
                setPollError(null);
            }).catch(async (err) => {
                if (mounted.current) { setPollError(await errorText(err)); }
            });
        }, 10000);
        return () => clearInterval(timer);
    }, [active, reload]);

    return (
        <HubDataContext.Provider value={{ connections, metrics, plugins, caGroups, federations, activeName, loading, error, reload }}>
            {children}
        </HubDataContext.Provider>
    );
}

/* --------------------------------------------------------- confirm */

export function ConfirmModal({ opened, onClose, onConfirm, title, children, confirmLabel, color = 'red', loading = false, requireText }: {
    opened: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: React.ReactNode;
    children: React.ReactNode;
    confirmLabel: string;
    color?: string;
    loading?: boolean;
    /** Strong confirm: the button stays disabled until this exact text is typed. */
    requireText?: string;
}) {
    const { t } = useTranslation();
    const [typed, setTyped] = useState('');
    useEffect(() => { if (opened) { setTyped(''); } }, [opened]);
    const blocked = !!requireText && typed.trim() !== requireText;
    return (
        <Modal opened={opened} onClose={onClose} title={<Text fw={700}>{title}</Text>} centered>
            <Stack gap="sm">
                {children}
                {requireText && (
                    <TextInput
                        label={t('Type "{{text}}" to confirm', { text: requireText, interpolation: { escapeValue: false } })}
                        value={typed}
                        onChange={(e) => setTyped(e.currentTarget.value)}
                        data-autofocus
                    />
                )}
            </Stack>
            <Group justify="flex-end" mt="lg" gap="sm">
                <Button variant="default" radius="xl" onClick={onClose}>{t('Cancel')}</Button>
                <Button color={color} radius="xl" loading={loading} disabled={blocked} onClick={onConfirm}>{confirmLabel}</Button>
            </Group>
        </Modal>
    );
}

/* ------------------------------------------------------ secrets/ids */

/** Masked secret with reveal + copy. */
export function SecretText({ value }: { value: string }) {
    const { t } = useTranslation();
    const [shown, setShown] = useState(false);
    if (!value) { return <Text size="sm" c="dimmed">—</Text>; }
    return (
        <Group gap={4} wrap="nowrap">
            <Text size="sm" ff="monospace" style={{ wordBreak: 'break-all' }}>{shown ? value : maskSecret(value)}</Text>
            <Tooltip label={shown ? t('Hide') : t('Reveal')}>
                <ActionIcon size="sm" variant="subtle" onClick={() => setShown((s) => !s)} aria-label={shown ? t('Hide') : t('Reveal')}>
                    {shown ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                </ActionIcon>
            </Tooltip>
            <CopyValue value={value} />
        </Group>
    );
}

export function CopyValue({ value, label }: { value: string; label?: string }) {
    const { t } = useTranslation();
    return (
        <CopyButton value={value}>
            {({ copied, copy }) => (
                <Tooltip label={copied ? t('Copied') : (label ?? t('Copy'))}>
                    <ActionIcon size="sm" variant="subtle" color={copied ? 'green' : 'gray'} onClick={copy} aria-label={label ?? t('Copy')}>
                        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    </ActionIcon>
                </Tooltip>
            )}
        </CopyButton>
    );
}

export function HubErrorAlert() {
    const { t } = useTranslation();
    const { error, reload } = useHubData();
    if (!error) { return null; }
    return (
        <Alert color="red" variant="light" title={t('The Federation Hub is not answering')} mb="md">
            <Group justify="space-between" wrap="wrap" gap="xs">
                <Text size="sm">{error}</Text>
                <Button size="xs" variant="light" color="red" radius="xl" onClick={() => reload()}>{t('Retry')}</Button>
            </Group>
        </Alert>
    );
}

export function ActiveBadge({ active }: { active: boolean }) {
    const { t } = useTranslation();
    return active
        ? <Badge color="green" variant="light">{t('Active')}</Badge>
        : <Badge color="gray" variant="light">{t('Not active')}</Badge>;
}
