import React, { useMemo, useRef, useState } from 'react';
import {
    Alert,
    Badge,
    Button,
    Checkbox,
    Code,
    Group,
    Modal,
    Stack,
    Table,
    Text,
    Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconFileImport, IconInfoCircle } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import axios from '../../axios_config';
import { findSetting } from './settingsCatalog';

/** POST multipart `file` → {settings, skipped}. Parses only; nothing is saved. */
export const DEVICE_PROFILE_IMPORT_URL = '/api/device-profiles/import';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export interface ImportedSetting {
    key: string;
    value: string;
    value_class: string;
}

interface SkippedSetting {
    key: string;
    reason: string;
}

interface ImportResponse {
    settings: ImportedSetting[];
    skipped: SkippedSetting[];
}

function shortClass(valueClass: string): string {
    return valueClass.replace(/^class\s+java\.lang\./, '');
}

function displayValue(setting: ImportedSetting, sensitive: boolean): string {
    if (sensitive) { return '••••••'; }
    if (setting.value_class === 'class java.lang.Boolean') {
        return setting.value === 'true' ? 'On' : 'Off';
    }
    return setting.value === '' ? '—' : setting.value;
}

function errorMessage(err: any): string | undefined {
    const data = err?.response?.data;
    return data?.error ?? data?.message ?? err?.message;
}

export default function ImportPrefsButton({ onImported }: {
    onImported: (settings: { key: string; value: string; value_class: string }[]) => void;
}) {
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [result, setResult] = useState<(ImportResponse & { fileName: string }) | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());

    const rows = useMemo(() => (result?.settings ?? []).map((s) => ({ setting: s, def: findSetting(s.key) })), [result]);

    async function upload(file: File) {
        if (file.size > MAX_UPLOAD_BYTES) {
            notifications.show({ color: 'red', title: t('File too large'), message: t('Preference files must be 5 MB or smaller.') });
            return;
        }
        const form = new FormData();
        form.append('file', file);
        setUploading(true);
        try {
            const r = await axios.post<ImportResponse>(DEVICE_PROFILE_IMPORT_URL, form, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            const settings = r.data?.settings ?? [];
            const skipped = r.data?.skipped ?? [];
            if (!settings.length && !skipped.length) {
                notifications.show({ color: 'yellow', title: t('Nothing to import'), message: t('That file has no settings in it.') });
                return;
            }
            setResult({ settings, skipped, fileName: file.name });
            setSelected(new Set(settings.map((s) => s.key)));
        } catch (err: any) {
            notifications.show({
                color: 'red',
                title: t('Could not import file'),
                message: errorMessage(err) ?? t('The server could not read that file.'),
            });
        } finally {
            setUploading(false);
        }
    }

    function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.currentTarget.files?.[0];
        // Reset so choosing the same file again still fires onChange
        e.currentTarget.value = '';
        if (file) { void upload(file); }
    }

    function toggle(key: string, checked: boolean) {
        setSelected((prev) => {
            const next = new Set(prev);
            if (checked) { next.add(key); } else { next.delete(key); }
            return next;
        });
    }

    function close() {
        setResult(null);
        setSelected(new Set());
    }

    function confirm() {
        if (!result) { return; }
        const chosen = result.settings
            .filter((s) => selected.has(s.key))
            .map(({ key, value, value_class }) => ({ key, value, value_class }));
        onImported(chosen);
        close();
    }

    const total = result?.settings.length ?? 0;
    const allChecked = total > 0 && selected.size === total;
    const someChecked = selected.size > 0 && !allChecked;

    return (
        <>
            <input
                ref={inputRef}
                type="file"
                accept=".pref,.xml,.zip"
                style={{ display: 'none' }}
                onChange={onFileChosen}
            />
            <Tooltip label={t('Copy settings from an ATAK preference file (.pref) or a data package (.zip)')} withArrow>
                <Button
                    variant="light"
                    leftSection={<IconFileImport size={16} />}
                    loading={uploading}
                    onClick={() => inputRef.current?.click()}
                >
                    {t('Import from ATAK file')}
                </Button>
            </Tooltip>

            <Modal
                opened={result !== null}
                onClose={close}
                title={<Text fw={700}>{t('Import settings')}</Text>}
                size="lg"
            >
                {result && (
                    <Stack gap="md">
                        <Text size="sm" c="dimmed">
                            {t('Found {{count}} settings in', { count: total })} <Code>{result.fileName}</Code>.{' '}
                            {t('Untick anything you don\'t want, then add them to the profile. Settings already in the profile with the same name are replaced.')}
                        </Text>

                        {total > 0 ? (
                            <Table verticalSpacing="xs" highlightOnHover>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th w={36}>
                                            <Checkbox
                                                aria-label={t('Select all')}
                                                checked={allChecked}
                                                indeterminate={someChecked}
                                                onChange={(e) => setSelected(e.currentTarget.checked ? new Set(result.settings.map((s) => s.key)) : new Set())}
                                            />
                                        </Table.Th>
                                        <Table.Th>{t('Setting')}</Table.Th>
                                        <Table.Th>{t('Value')}</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {rows.map(({ setting, def }) => (
                                        <Table.Tr key={setting.key}>
                                            <Table.Td>
                                                <Checkbox
                                                    aria-label={def?.label ?? setting.key}
                                                    checked={selected.has(setting.key)}
                                                    onChange={(e) => toggle(setting.key, e.currentTarget.checked)}
                                                />
                                            </Table.Td>
                                            <Table.Td>
                                                <Stack gap={0}>
                                                    <Group gap={6} wrap="wrap">
                                                        <Text size="sm" fw={500} style={{ wordBreak: 'break-word' }}>{def?.label ?? setting.key}</Text>
                                                        {!def && <Badge size="xs" variant="light" color="gray">{t('Custom')}</Badge>}
                                                    </Group>
                                                    {def && <Text size="xs" c="dimmed" ff="monospace">{setting.key}</Text>}
                                                </Stack>
                                            </Table.Td>
                                            <Table.Td>
                                                <Group gap={6} wrap="wrap">
                                                    <Text size="sm" style={{ wordBreak: 'break-word' }}>
                                                        {displayValue(setting, !!def?.sensitive)}
                                                    </Text>
                                                    <Badge size="xs" variant="outline" color="gray" style={{ flexShrink: 0 }}>{shortClass(setting.value_class)}</Badge>
                                                </Group>
                                            </Table.Td>
                                        </Table.Tr>
                                    ))}
                                </Table.Tbody>
                            </Table>
                        ) : (
                            <Alert color="yellow" icon={<IconInfoCircle size={18} />}>
                                {t('There are no settings in this file that can be put in a profile.')}
                            </Alert>
                        )}

                        {result.skipped.length > 0 && (
                            <Alert
                                color="orange"
                                variant="light"
                                icon={<IconAlertTriangle size={18} />}
                                title={t('{{count}} settings left out', { count: result.skipped.length })}
                            >
                                <Text size="sm" mb="xs">
                                    {t('These can\'t go into a profile: they are passwords or certificates, specific to the device they came from, set by this server itself, or not valid. The reason is shown next to each one.')}
                                </Text>
                                <Stack gap={4}>
                                    {result.skipped.map((s) => (
                                        <Group key={s.key} gap={8} wrap="wrap" align="baseline" style={{ rowGap: 0 }}>
                                            <Text size="xs" ff="monospace" style={{ wordBreak: 'break-all' }}>{s.key}</Text>
                                            <Text size="xs" c="dimmed">— {t(s.reason)}</Text>
                                        </Group>
                                    ))}
                                </Stack>
                            </Alert>
                        )}

                        <Group justify="flex-end" gap="sm">
                            <Button variant="default" onClick={close}>{t('Cancel')}</Button>
                            <Button onClick={confirm} disabled={selected.size === 0}>
                                {t('Add {{count}} settings', { count: selected.size })}
                            </Button>
                        </Group>
                    </Stack>
                )}
            </Modal>
        </>
    );
}
