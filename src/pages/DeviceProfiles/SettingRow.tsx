import React from 'react';
import {
    ActionIcon,
    Badge,
    Group,
    NumberInput,
    Paper,
    PasswordInput,
    Select,
    Stack,
    Switch,
    Text,
    TextInput,
    Tooltip,
} from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { findSetting, type SettingDef } from './settingsCatalog';
import { VALUE_CLASS_LABELS, VALUE_CLASSES, type ProfileSetting } from './types';

/** The friendly control for one value: switch, dropdown, number, password or text. */
export function SettingValueInput({ def, valueClass, value, onChange, label, error }: {
    def?: SettingDef;
    valueClass: string;
    value: string;
    onChange: (value: string) => void;
    label?: string;
    error?: string;
}) {
    const { t } = useTranslation();
    const input = def?.input
        ?? (valueClass === 'class java.lang.Boolean' ? 'toggle'
            : ['class java.lang.Integer', 'class java.lang.Long', 'class java.lang.Float'].includes(valueClass) ? 'number'
                : 'text');
    const aria = label ?? def?.label ?? t('Value');

    if (input === 'toggle') {
        const on = value === 'true';
        return (
            <Switch
                aria-label={aria}
                label={label ?? (on ? t('On') : t('Off'))}
                checked={on}
                onChange={(e) => onChange(e.currentTarget.checked ? 'true' : 'false')}
                error={error}
            />
        );
    }
    if (input === 'select') {
        const options = def?.options ?? [];
        // Keep an imported value that isn't in the list selectable instead of blanking it.
        const data = options.some((o) => o.value === value) || !value
            ? options
            : [...options, { value, label: value }];
        return (
            <Select
                aria-label={aria}
                label={label}
                data={data}
                value={value || null}
                onChange={(v) => onChange(v ?? '')}
                allowDeselect={false}
                searchable={data.length > 8}
                error={error}
                comboboxProps={{ withinPortal: true }}
            />
        );
    }
    if (input === 'number') {
        // Catalog numbers are usually sent as class java.lang.String (ATAK reads
        // them with getString), so only the Java class rules out decimals.
        const isDecimal = !['class java.lang.Integer', 'class java.lang.Long'].includes(valueClass);
        return (
            <NumberInput
                aria-label={aria}
                label={label}
                value={value === '' ? '' : Number(value)}
                onChange={(v) => onChange(v === '' || v === undefined ? '' : String(v))}
                min={def?.min}
                max={def?.max}
                allowDecimal={isDecimal}
                placeholder={def?.placeholder}
                rightSection={def?.unit ? <Text size="xs" c="dimmed" pr={6}>{def.unit}</Text> : undefined}
                rightSectionWidth={def?.unit ? Math.max(36, def.unit.length * 8 + 16) : undefined}
                error={error}
            />
        );
    }
    if (input === 'password' || def?.sensitive) {
        return (
            <PasswordInput
                aria-label={aria}
                label={label}
                value={value}
                onChange={(e) => onChange(e.currentTarget.value)}
                placeholder={def?.placeholder}
                error={error}
            />
        );
    }
    return (
        <TextInput
            aria-label={aria}
            label={label}
            value={value}
            onChange={(e) => onChange(e.currentTarget.value)}
            placeholder={def?.placeholder}
            error={error}
        />
    );
}

export default function SettingRow({ setting, onChange, onRemove }: {
    setting: ProfileSetting;
    onChange: (next: ProfileSetting) => void;
    onRemove: () => void;
}) {
    const { t } = useTranslation();
    const def = findSetting(setting.key);
    const title = def?.label ?? setting.key;

    return (
        <Paper p="sm" className="raven-surface raven-surface--tile">
            <Group align="flex-start" justify="space-between" wrap="nowrap" gap="sm">
                <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                    <Group gap={6} wrap="wrap">
                        <Text fw={600} size="sm" ff={def ? undefined : 'monospace'} style={{ wordBreak: 'break-all' }}>{title}</Text>
                        {!def && <Badge size="xs" variant="light" color="orange" tt="none">{t('Custom setting')}</Badge>}
                    </Group>
                    {def?.description && <Text size="xs" c="dimmed">{def.description}</Text>}
                    {def ? (
                        <Text size="xs" c="dimmed" ff="monospace" style={{ wordBreak: 'break-all', opacity: 0.75 }}>
                            {setting.key}
                        </Text>
                    ) : (
                        <Text size="xs" c="dimmed">{t('Not in the settings list, so it is sent exactly as entered.')}</Text>
                    )}
                </Stack>
                <Tooltip label={t('Remove from this profile')}>
                    <ActionIcon
                        variant="light"
                        color="red"
                        aria-label={t('Remove {{name}}', { name: title })}
                        onClick={onRemove}
                    >
                        <IconTrash size={16} />
                    </ActionIcon>
                </Tooltip>
            </Group>
            <Group mt="xs" gap="sm" align="flex-end" wrap="wrap">
                {!def && (
                    <Select
                        aria-label={t('Value type')}
                        w={180}
                        data={VALUE_CLASSES.map((v) => ({ value: v, label: t(VALUE_CLASS_LABELS[v]) }))}
                        value={setting.value_class}
                        onChange={(v) => v && onChange({
                            ...setting,
                            value_class: v,
                            value: v === 'class java.lang.Boolean' ? (setting.value === 'true' ? 'true' : 'false') : setting.value,
                        })}
                        allowDeselect={false}
                        comboboxProps={{ withinPortal: true }}
                    />
                )}
                <div style={{ flex: 1, minWidth: 180, maxWidth: 420 }}>
                    <SettingValueInput
                        def={def}
                        valueClass={setting.value_class}
                        value={setting.value}
                        onChange={(value) => onChange({ ...setting, value })}
                    />
                </div>
            </Group>
            {!def && ['class java.lang.Integer', 'class java.lang.Long', 'class java.lang.Float'].includes(setting.value_class) && (
                <Text size="xs" c="yellow" mt={6}>
                    {t('Most ATAK number settings are stored as Text. Keep this number type only if you know the key needs it.')}
                </Text>
            )}
        </Paper>
    );
}
