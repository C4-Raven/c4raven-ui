import React from 'react';
import { Alert, Paper, Select, Stack, Switch, TagsInput, Text } from '@mantine/core';
import { IconAlertTriangle, IconArrowDownLeft, IconArrowUpRight } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { filterWarnings } from './helpers';
import { EVERYTHING, type FilterType, type PartnerKind, type ShareFilter } from './types';

function FilterEditor({ title, description, icon, value, onChange, error, suggestions, warn }: {
    title: string;
    description: string;
    icon: React.ReactNode;
    value: ShareFilter;
    onChange: (f: ShareFilter) => void;
    error?: string;
    suggestions: string[];
    warn: boolean;
}) {
    const { t } = useTranslation();
    const limited = value.type !== 'allGroups';
    const showAllowed = value.type === 'allowed' || value.type === 'allowedAndDisallowed';
    const showBlocked = value.type === 'disallowed' || value.type === 'allowedAndDisallowed';
    return (
        <Paper p="md" className="raven-surface raven-surface--tile">
            <Stack gap="sm">
                <div>
                    <Text fw={600} size="sm" component="div" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {icon}{title}
                    </Text>
                    <Text size="xs" c="dimmed">{description}</Text>
                </div>
                <Switch
                    label={limited ? t('Only some groups') : t('Everything')}
                    description={limited
                        ? t('Turn off to share every group again (recommended).')
                        : t('Every group is shared. Turn on to limit it by group (advanced).')}
                    checked={limited}
                    onChange={(e) => onChange(e.currentTarget.checked
                        ? { type: 'allowed', allowed: value.allowed, disallowed: value.disallowed }
                        : { ...EVERYTHING })}
                />
                {limited && (
                    <>
                        <Select
                            label={t('How to limit it')}
                            value={value.type}
                            onChange={(v) => onChange({ ...value, type: (v as FilterType) || 'allowed' })}
                            data={[
                                { value: 'allowed', label: t('Only the groups I list') },
                                { value: 'disallowed', label: t('Everything except the groups I list') },
                                { value: 'allowedAndDisallowed', label: t('Only listed groups, minus blocked ones') },
                            ]}
                            allowDeselect={false}
                            comboboxProps={{ withinPortal: true }}
                        />
                        {showAllowed && (
                            <TagsInput
                                label={t('Allowed groups')}
                                description={t('Type a group name and press Enter')}
                                data={suggestions}
                                value={value.allowed}
                                onChange={(allowed) => onChange({ ...value, allowed })}
                                clearable
                                comboboxProps={{ withinPortal: true }}
                            />
                        )}
                        {showBlocked && (
                            <TagsInput
                                label={t('Blocked groups')}
                                description={t('Type a group name and press Enter')}
                                data={suggestions}
                                value={value.disallowed}
                                onChange={(disallowed) => onChange({ ...value, disallowed })}
                                clearable
                                comboboxProps={{ withinPortal: true }}
                            />
                        )}
                    </>
                )}
                {error && <Text size="sm" c="red">{error}</Text>}
                {warn && (
                    <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />} py="xs">
                        {t('Raven servers don\'t label their traffic with federation groups, so a group filter on traffic coming from a Raven lets nothing through. Choose Everything here, and control what leaves this server with its own Groups page.')}
                    </Alert>
                )}
            </Stack>
        </Paper>
    );
}

/** Step "What to share": used by the wizard and by the partner editor. */
export default function ShareStep({
    kind, share, receive, onShare, onReceive, interconnected, onInterconnected, suggestions, errors,
}: {
    kind: PartnerKind;
    share: ShareFilter;
    receive: ShareFilter;
    onShare: (f: ShareFilter) => void;
    onReceive: (f: ShareFilter) => void;
    interconnected: boolean;
    onInterconnected: (v: boolean) => void;
    suggestions: string[];
    errors: { share?: string; receive?: string };
}) {
    const { t } = useTranslation();
    const warn = filterWarnings(kind, share, receive);
    return (
        <Stack gap="md">
            <Text size="sm" c="dimmed">
                {t('Choose what flows each way. "Everything" is right for almost every setup; this server\'s Groups page already decides which groups leave it.')}
            </Text>
            <FilterEditor
                title={t('What we send them')}
                description={t('Traffic from this Raven that the hub passes on to them.')}
                icon={<IconArrowUpRight size={16} />}
                value={share}
                onChange={onShare}
                error={errors.share}
                suggestions={suggestions}
                warn={warn.share}
            />
            <FilterEditor
                title={t('What we accept from them')}
                description={t('Traffic from them that the hub lets through to this Raven.')}
                icon={<IconArrowDownLeft size={16} />}
                value={receive}
                onChange={onReceive}
                error={errors.receive}
                suggestions={suggestions}
                warn={warn.receive}
            />
            <Paper p="md" className="raven-surface raven-surface--tile">
                <Switch
                    label={t('Let servers under their certificate authority talk to each other')}
                    description={t('Only needed when several servers connect with certificates from the same authority (for example two Ravens both using their hub\'s certificates) and those servers should see each other. Leave off otherwise.')}
                    checked={interconnected}
                    onChange={(e) => onInterconnected(e.currentTarget.checked)}
                />
            </Paper>
        </Stack>
    );
}
