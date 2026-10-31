import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Button,
    Group,
    Modal,
    MultiSelect,
    Paper,
    Stack,
    Stepper,
    Switch,
    Text,
    Textarea,
    TextInput,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
    IconAlertCircle,
    IconArrowLeft,
    IconArrowRight,
    IconCheck,
    IconClockPlay,
    IconDeviceFloppy,
    IconInfoCircle,
    IconPlugConnected,
    IconQrcode,
    IconUsers,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import axios from '../../axios_config';
import { apiRoutes } from '../../apiRoutes';
import { extractError } from '../ServerRequests/shared';
import SettingsStep from './SettingsStep';
import { findSetting } from './settingsCatalog';
import { ON_CONNECT_KEY, type Profile, type ProfileInput, type TargetKind } from './types';

type StepKey = 'basics' | 'settings' | 'who' | 'when';
const STEPS: StepKey[] = ['basics', 'settings', 'who', 'when'];
type Errors = Partial<Record<'name' | 'settings' | 'who' | 'when', string>>;

interface Option { value: string; label: string }

/** Loads the pickers for "Who gets it" once per editor open. */
function useAudienceOptions(opened: boolean) {
    const [groups, setGroups] = useState<Option[]>([]);
    const [users, setUsers] = useState<Option[]>([]);
    const [devices, setDevices] = useState<Option[]>([]);

    useEffect(() => {
        if (!opened) { return; }
        axios.get(apiRoutes.allGroups)
            .then((r) => setGroups((r.data ?? []).map((g: any) => ({ value: g.name, label: g.name }))))
            .catch(() => setGroups([]));
        axios.get(apiRoutes.allUsers)
            .then((r) => setUsers((r.data ?? []).map((u: any) => ({ value: u.username, label: u.username }))))
            .catch(() => setUsers([]));
        axios.get(apiRoutes.eud, { params: { all: true } })
            .then((r) => {
                const rows = Array.isArray(r.data) ? r.data : (r.data?.results ?? []);
                setDevices(rows.map((d: any) => ({
                    value: d.uid,
                    label: d.callsign ? `${d.callsign}${d.username ? ` (${d.username})` : ''}` : d.uid,
                })));
            })
            .catch(() => setDevices([]));
    }, [opened]);

    return { groups, users, devices };
}

/** Make sure already-targeted values still show even if the lookup lists don't contain them. */
function withSelected(options: Option[], selected: string[], labels: Map<string, string>): Option[] {
    const known = new Set(options.map((o) => o.value));
    const extra = selected.filter((v) => !known.has(v)).map((v) => ({ value: v, label: labels.get(v) ?? v }));
    return [...options, ...extra];
}

export function validate(draft: ProfileInput, t: (k: string) => string): Errors {
    const errors: Errors = {};
    if (!draft.name.trim()) { errors.name = t('Give the profile a name so you can recognise it later'); }
    if (draft.settings.length === 0) { errors.settings = t('Add at least one setting'); }
    if (!draft.target_everyone && draft.targets.length === 0) {
        errors.who = t('Choose who gets this profile, or switch on "Everyone"');
    }
    if (!draft.apply_on_enrollment && !draft.apply_on_connection) {
        errors.when = t('Pick at least one moment for devices to receive this profile');
    }
    return errors;
}

function stepOf(errors: Errors): StepKey | null {
    if (errors.name) { return 'basics'; }
    if (errors.settings) { return 'settings'; }
    if (errors.who) { return 'who'; }
    if (errors.when) { return 'when'; }
    return null;
}

export default function ProfileEditor({ opened, onClose, profile, initial, onSaved }: {
    opened: boolean;
    onClose: () => void;
    /** Existing profile being edited, or null for a new one. */
    profile: Profile | null;
    /** Starting values (blank, a template, or the profile being edited). */
    initial: ProfileInput;
    onSaved: (profile: Profile) => void;
}) {
    const { t } = useTranslation();
    const isPhone = useMediaQuery('(max-width: 48em)');
    const [draft, setDraft] = useState<ProfileInput>(initial);
    const [active, setActive] = useState(0);
    const [errors, setErrors] = useState<Errors>({});
    const [attempted, setAttempted] = useState(false);
    const [saving, setSaving] = useState(false);
    const [serverError, setServerError] = useState<string>();
    const { groups, users, devices } = useAudienceOptions(opened);

    useEffect(() => {
        if (opened) {
            setDraft(initial);
            setActive(0);
            setErrors({});
            setAttempted(false);
            setServerError(undefined);
        }
    }, [opened, initial]);

    // Once the admin has tried to save, keep the inline errors live as they fix things.
    useEffect(() => {
        if (attempted) { setErrors(validate(draft, t)); }
    }, [draft, attempted, t]);

    const targetLabels = useMemo(() => {
        const m = new Map<string, string>();
        for (const tg of profile?.targets ?? []) { if (tg.label) { m.set(tg.value, tg.label); } }
        return m;
    }, [profile]);

    function patch(change: Partial<ProfileInput>) {
        setDraft((d) => ({ ...d, ...change }));
    }

    function targetsOf(kind: TargetKind) {
        return draft.targets.filter((tg) => tg.kind === kind).map((tg) => tg.value);
    }

    function setTargets(kind: TargetKind, values: string[]) {
        patch({ targets: [...draft.targets.filter((tg) => tg.kind !== kind), ...values.map((value) => ({ kind, value }))] });
    }

    async function save() {
        setAttempted(true);
        const errs = validate(draft, t);
        setErrors(errs);
        const bad = stepOf(errs);
        if (bad) {
            setActive(STEPS.indexOf(bad));
            return;
        }
        setSaving(true);
        setServerError(undefined);
        const body: ProfileInput = {
            ...draft,
            name: draft.name.trim(),
            description: draft.description.trim(),
            targets: draft.target_everyone ? [] : draft.targets,
        };
        try {
            const r = profile
                ? await axios.put(`${apiRoutes.deviceProfileSets}/${profile.id}`, body)
                : await axios.post(apiRoutes.deviceProfileSets, body);
            if (r.data?.success === false) {
                setServerError(r.data?.error ?? t('The server rejected the profile'));
                return;
            }
            notifications.show({
                color: 'green',
                icon: <IconCheck size={16} />,
                title: profile ? t('Profile saved') : t('Profile created'),
                message: body.name,
            });
            onSaved(r.data?.profile);
        } catch (err) {
            setServerError(await extractError(err) ?? t('The server rejected the profile'));
        } finally {
            setSaving(false);
        }
    }

    const stepError = (key: StepKey) => {
        if (key === 'basics') { return errors.name; }
        return errors[key as keyof Errors];
    };

    const isLast = active === STEPS.length - 1;
    const stepDescription = (key: StepKey, text: string) => {
        if (isPhone) { return undefined; }
        if (stepError(key)) { return <Text span size="xs" c="red">{t('Needs attention')}</Text>; }
        return text;
    };
    const onConnectLabel = findSetting(ON_CONNECT_KEY)?.label ?? t('Apply server profile updates on connect');

    return (
        <Modal
            opened={opened}
            onClose={onClose}
            size="xl"
            fullScreen={isPhone}
            radius={isPhone ? 0 : 'lg'}
            title={<Text fw={700} size="lg">{profile ? t('Edit profile') : t('New profile')}</Text>}
            closeOnClickOutside={false}
        >
            <Stepper
                active={active}
                onStepClick={setActive}
                allowNextStepsSelect
                size="sm"
                mb="lg"
                orientation="horizontal"
                styles={{ steps: { flexWrap: 'wrap', rowGap: 8 } }}
            >
                <Stepper.Step
                    label={isPhone ? undefined : t('Basics')}
                    aria-label={t('Basics')}
                    description={stepDescription('basics', t('Name it'))}
                    color={stepError('basics') ? 'red' : undefined}
                    icon={stepError('basics') ? <IconAlertCircle size={16} color="var(--mantine-color-red-5)" /> : undefined}
                />
                <Stepper.Step
                    label={isPhone ? undefined : t('Settings')}
                    aria-label={t('Settings')}
                    description={stepDescription('settings', t('What changes'))}
                    color={stepError('settings') ? 'red' : undefined}
                    icon={stepError('settings') ? <IconAlertCircle size={16} color="var(--mantine-color-red-5)" /> : undefined}
                />
                <Stepper.Step
                    label={isPhone ? undefined : t('Who')}
                    aria-label={t('Who')}
                    description={stepDescription('who', t('Which devices'))}
                    color={stepError('who') ? 'red' : undefined}
                    icon={stepError('who') ? <IconAlertCircle size={16} color="var(--mantine-color-red-5)" /> : undefined}
                />
                <Stepper.Step
                    label={isPhone ? undefined : t('When')}
                    aria-label={t('When')}
                    description={stepDescription('when', t('When it is sent'))}
                    color={stepError('when') ? 'red' : undefined}
                    icon={stepError('when') ? <IconAlertCircle size={16} color="var(--mantine-color-red-5)" /> : undefined}
                />
            </Stepper>
            {isPhone && (
                <Text size="sm" fw={600} mt={-8} mb="md">
                    {t('Step {{n}} of 4', { n: active + 1 })} · {[t('Basics'), t('Settings'), t('Who gets it'), t('When it is sent')][active]}
                </Text>
            )}

            {active === 0 && (
                <Stack gap="md">
                    <TextInput
                        label={t('Profile name')}
                        description={t('Shown only to admins, e.g. "Field team defaults"')}
                        placeholder={t('e.g. Field team defaults')}
                        value={draft.name}
                        onChange={(e) => patch({ name: e.currentTarget.value })}
                        error={errors.name}
                        required
                        data-autofocus
                    />
                    <Textarea
                        label={t('Description')}
                        description={t('Optional. A note for other admins about what this profile is for.')}
                        autosize
                        minRows={2}
                        maxRows={6}
                        value={draft.description}
                        onChange={(e) => patch({ description: e.currentTarget.value })}
                    />
                    <Paper p="md" className="raven-surface raven-surface--tile">
                        <Switch
                            label={t('Enabled')}
                            description={t('Turn off to stop sending this profile without deleting it.')}
                            checked={draft.enabled}
                            onChange={(e) => patch({ enabled: e.currentTarget.checked })}
                        />
                    </Paper>
                </Stack>
            )}

            {active === 1 && (
                <SettingsStep
                    settings={draft.settings}
                    onChange={(settings) => patch({ settings })}
                    error={errors.settings}
                />
            )}

            {active === 2 && (
                <Stack gap="md">
                    <Text size="sm" c="dimmed">
                        {t('Choose which devices receive this profile. You can mix groups, users and individual devices.')}
                    </Text>
                    {errors.who && (
                        <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />} py="xs">{errors.who}</Alert>
                    )}
                    <Paper p="md" className="raven-surface raven-surface--tile">
                        <Switch
                            size="md"
                            label={t('Everyone on this server')}
                            description={t('Every user and device gets this profile.')}
                            checked={draft.target_everyone}
                            onChange={(e) => patch({ target_everyone: e.currentTarget.checked })}
                            thumbIcon={draft.target_everyone ? <IconUsers size={10} /> : undefined}
                        />
                    </Paper>
                    {!draft.target_everyone && (
                        <Stack gap="sm">
                            <MultiSelect
                                label={t('Groups')}
                                description={t('Everyone who is a member of these groups')}
                                placeholder={targetsOf('group').length ? undefined : t('Pick groups')}
                                data={withSelected(groups, targetsOf('group'), targetLabels)}
                                value={targetsOf('group')}
                                onChange={(v) => setTargets('group', v)}
                                searchable
                                clearable
                                nothingFoundMessage={t('No matching groups')}
                                comboboxProps={{ withinPortal: true }}
                            />
                            <MultiSelect
                                label={t('Users')}
                                description={t('Any device these users sign in on')}
                                placeholder={targetsOf('user').length ? undefined : t('Pick users')}
                                data={withSelected(users, targetsOf('user'), targetLabels)}
                                value={targetsOf('user')}
                                onChange={(v) => setTargets('user', v)}
                                searchable
                                clearable
                                nothingFoundMessage={t('No matching users')}
                                comboboxProps={{ withinPortal: true }}
                            />
                            <MultiSelect
                                label={t('Devices')}
                                description={t('Specific devices, by callsign. Devices appear here after they have connected once.')}
                                placeholder={targetsOf('device').length ? undefined : t('Pick devices')}
                                data={withSelected(devices, targetsOf('device'), targetLabels)}
                                value={targetsOf('device')}
                                onChange={(v) => setTargets('device', v)}
                                searchable
                                clearable
                                nothingFoundMessage={t('No matching devices')}
                                comboboxProps={{ withinPortal: true }}
                            />
                        </Stack>
                    )}
                    <Alert variant="light" color="blue" icon={<IconInfoCircle size={16} />}>
                        {t('If two profiles change the same setting, the more specific one wins. A device profile beats a user profile, which beats a group profile, which beats an "Everyone" profile.')}
                    </Alert>
                </Stack>
            )}

            {active === 3 && (
                <Stack gap="md">
                    <Text size="sm" c="dimmed">
                        {t('Choose when devices pick up this profile. Most profiles use both.')}
                    </Text>
                    {errors.when && (
                        <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />} py="xs">{errors.when}</Alert>
                    )}
                    <Paper p="md" className="raven-surface raven-surface--tile">
                        <Group gap="md" wrap="nowrap" align="flex-start">
                            <IconQrcode size={22} style={{ flexShrink: 0, marginTop: 2, opacity: 0.8 }} />
                            <Switch
                                size="md"
                                label={t('When a device is enrolled')}
                                description={t('Sent once, when someone first signs in to this server in ATAK (including scanning an enrollment QR code). Good for initial setup.')}
                                checked={draft.apply_on_enrollment}
                                onChange={(e) => patch({ apply_on_enrollment: e.currentTarget.checked })}
                            />
                        </Group>
                    </Paper>
                    <Paper p="md" className="raven-surface raven-surface--tile">
                        <Group gap="md" wrap="nowrap" align="flex-start">
                            <IconPlugConnected size={22} style={{ flexShrink: 0, marginTop: 2, opacity: 0.8 }} />
                            <Switch
                                size="md"
                                label={t('Every time ATAK connects')}
                                description={t('Sent when the app connects, so changes you make here reach devices that are already set up. Each device downloads it once, then again only after you change this profile. Devices enrolled through this server have "{{setting}}" switched on automatically; devices set up by hand need it turned on in ATAK.', { setting: onConnectLabel, interpolation: { escapeValue: false } })}
                                checked={draft.apply_on_connection}
                                onChange={(e) => patch({ apply_on_connection: e.currentTarget.checked })}
                            />
                        </Group>
                    </Paper>
                    <Alert variant="light" color="gray" icon={<IconClockPlay size={16} />}>
                        {t('Settings sent on connect overwrite whatever the user changed on their device each time you save this profile. Use it for things that must stay the same.')}
                    </Alert>
                </Stack>
            )}

            {serverError && (
                <Alert mt="lg" color="red" variant="light" icon={<IconAlertCircle size={16} />} title={t("Couldn't save the profile")}>
                    {serverError}
                </Alert>
            )}
            {attempted && stepOf(errors) && (
                <Text mt="md" size="sm" c="red">{t('Some steps need attention before you can save. They are marked in red above.')}</Text>
            )}

            <Group justify="space-between" mt="xl" gap="sm" wrap="wrap">
                <Button
                    variant="default"
                    radius="xl"
                    leftSection={<IconArrowLeft size={16} />}
                    onClick={() => (active === 0 ? onClose() : setActive((a) => a - 1))}
                >
                    {active === 0 ? t('Cancel') : t('Back')}
                </Button>
                <Group gap="sm" wrap="wrap">
                    {(profile || isLast) && (
                        <Button
                            radius="xl"
                            className="raven-cta"
                            leftSection={<IconDeviceFloppy size={16} />}
                            loading={saving}
                            onClick={save}
                        >
                            {profile ? t('Save changes') : t('Create profile')}
                        </Button>
                    )}
                    {!isLast && (
                        <Button
                            radius="xl"
                            variant={profile ? 'light' : 'filled'}
                            rightSection={<IconArrowRight size={16} />}
                            onClick={() => setActive((a) => a + 1)}
                        >
                            {t('Next')}
                        </Button>
                    )}
                </Group>
            </Group>
        </Modal>
    );
}
