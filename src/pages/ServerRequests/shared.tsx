import React from 'react';
import { Center, Paper, Stack, Text, ThemeIcon } from '@mantine/core';
import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';
import axios from '../../axios_config';

/** "delete_old_data" / "deleteOldData" -> "Delete old data". */
export function humanize(value: string | null | undefined): string {
    if (!value) { return ''; }
    const spaced = value
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_\-.]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function parseDate(value: string | null | undefined): Date | null {
    if (!value) { return null; }
    const d = parseISO(value);
    return isValid(d) ? d : null;
}

/** "Fri 31 Oct 2026, 14:05" in the browser's local time zone. */
export function formatDateTime(value: string | Date | null | undefined, withSeconds = false): string {
    const d = value instanceof Date ? value : parseDate(value);
    if (!d) { return '—'; }
    return format(d, withSeconds ? 'EEE d MMM yyyy, HH:mm:ss' : 'EEE d MMM yyyy, HH:mm');
}

/** "in 3 minutes" / "5 hours ago". */
export function formatRelative(value: string | Date | null | undefined): string {
    const d = value instanceof Date ? value : parseDate(value);
    if (!d) { return ''; }
    return formatDistanceToNowStrict(d, { addSuffix: true });
}

/** Pull a human-readable error out of an axios error, including blob bodies. */
export async function extractError(err: any): Promise<string | undefined> {
    const data = err?.response?.data;
    try {
        if (data instanceof Blob) {
            const text = await data.text();
            try {
                return JSON.parse(text)?.error ?? JSON.parse(text)?.message;
            } catch {
                return text.slice(0, 300) || undefined;
            }
        }
        return data?.error ?? data?.message ?? err?.message;
    } catch {
        return err?.message;
    }
}

function filenameFromDisposition(header: string | undefined): string | null {
    if (!header) { return null; }
    const star = /filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/.exec(header);
    if (star) {
        try {
            return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
        } catch {
            // fall through to the plain filename parameter
        }
    }
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
    return plain ? plain[1].trim() : null;
}

/**
 * Download through the shared axios instance (so the session cookie, CSRF
 * header and the 401 -> /login interceptor all apply) and hand the blob to
 * a temporary <a download>. Throws on failure; use extractError() on it.
 */
export async function downloadFile(url: string, params: Record<string, unknown>, fallbackName: string) {
    const r = await axios.get(url, { params, responseType: 'blob' });
    const name = filenameFromDisposition(r.headers['content-disposition']) ?? fallbackName;
    const href = URL.createObjectURL(r.data as Blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** Card surface matching the rest of the app (Dashboard, Users). */
export function Section({ title, description, actions, children, p = 'lg' }: {
    title?: React.ReactNode;
    description?: React.ReactNode;
    actions?: React.ReactNode;
    children: React.ReactNode;
    p?: string;
}) {
    return (
        <Paper p={p} className="raven-surface">
            {(title || actions) && (
                <Stack gap={2} mb="md">
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
                        {title && <Text fw={700} size="lg">{title}</Text>}
                        {actions}
                    </div>
                    {description && <Text size="sm" c="dimmed">{description}</Text>}
                </Stack>
            )}
            {children}
        </Paper>
    );
}

export function EmptyState({ icon, title, description, color = 'gray', action }: {
    icon: React.ReactNode;
    title: React.ReactNode;
    description?: React.ReactNode;
    color?: string;
    action?: React.ReactNode;
}) {
    return (
        <Center py={48} px="md">
            <Stack align="center" gap="xs" maw={460} ta="center">
                <ThemeIcon size={52} radius="xl" variant="light" color={color}>{icon}</ThemeIcon>
                <Text fw={600} mt="xs">{title}</Text>
                {description && <Text size="sm" c="dimmed">{description}</Text>}
                {action}
            </Stack>
        </Center>
    );
}

/** Small pulsing dot, same animation as the Live badge on Video Streams. */
export function PulseDot({ active, color = 'var(--mantine-color-green-5)' }: { active: boolean; color?: string }) {
    return (
        <span
            aria-hidden
            style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: active ? color : 'var(--mantine-color-gray-6)',
                boxShadow: active ? `0 0 0 3px color-mix(in srgb, ${color} 25%, transparent)` : undefined,
                animation: active ? 'raven-pulse 1.5s ease-in-out infinite' : undefined,
                flexShrink: 0,
            }}
        />
    );
}
