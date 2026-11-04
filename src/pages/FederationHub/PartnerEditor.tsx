import React, { useEffect, useState } from 'react';
import { Button, Group, Modal, Stack, Stepper, Text, TextInput } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconCircleCheck, IconDeviceFloppy } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { knownGroups, patchPartner } from './api';
import ConnectStep from './ConnectStep';
import { cleanFilter, explainError, ourAddressOf, outgoingClash, validateFilter, validateHost, validateName, validatePort, type PartnerErrorView } from './helpers';
import { ServerErrorAlert } from './parts';
import ShareStep from './ShareStep';
import type { Overview, Partner, PatchPartnerInput, ShareFilter } from './types';

interface EditDraft {
    name: string;
    host: string;
    port: number | '';
    share: ShareFilter;
    receive: ShareFilter;
    interconnected: boolean;
}

type EditErrors = Partial<Record<'name' | 'host' | 'port' | 'share' | 'receive', string>>;

function draftOf(p: Partner): EditDraft {
    return {
        name: p.name,
        host: p.outgoing?.host ?? '',
        port: p.outgoing?.port ?? 9102,
        share: { ...p.share, allowed: [...(p.share?.allowed ?? [])], disallowed: [...(p.share?.disallowed ?? [])] },
        receive: { ...p.receive, allowed: [...(p.receive?.allowed ?? [])], disallowed: [...(p.receive?.disallowed ?? [])] },
        interconnected: p.interconnected,
    };
}

const sameFilter = (a: ShareFilter, b: ShareFilter) => JSON.stringify(cleanFilter(a)) === JSON.stringify(cleanFilter(b));

/** Edits steps 3 and 4 of the wizard for an existing partner (PATCH, applied on the hub). */
export default function PartnerEditor({ partner, overview, onClose, onSaved, onOpenPartner }: {
    partner: Partner | null;
    overview: Overview | null;
    onClose: () => void;
    onSaved: (p: Partner) => void;
    onOpenPartner?: (id: string) => void;
}) {
    const { t } = useTranslation();
    const isPhone = useMediaQuery('(max-width: 48em)');
    const [draft, setDraft] = useState<EditDraft | null>(null);
    const [active, setActive] = useState(0);
    const [errors, setErrors] = useState<EditErrors>({});
    const [saving, setSaving] = useState(false);
    const [serverError, setServerError] = useState<PartnerErrorView>();
    const [suggestions, setSuggestions] = useState<string[]>([]);

    useEffect(() => {
        if (!partner) { return; }
        setDraft(draftOf(partner));
        setActive(0);
        setErrors({});
        setServerError(undefined);
        knownGroups(partner.id).then(setSuggestions).catch(() => setSuggestions([]));
    }, [partner]);

    if (!partner || !draft) {
        return <Modal opened={false} onClose={onClose}>{null}</Modal>;
    }
    const others = (overview?.partners ?? []).filter((p) => p.id !== partner.id);
    const ourAddress = ourAddressOf(overview?.hub);

    function patch(change: Partial<EditDraft>) {
        setDraft((d) => (d ? { ...d, ...change } : d));
    }

    function validate(d: EditDraft): EditErrors {
        const e: EditErrors = {};
        const nameErr = validateName(d.name, others.map((p) => p.name), t);
        if (nameErr) { e.name = nameErr; }
        if (partner!.direction === 'we_dial') {
            const h = validateHost(d.host, t);
            const p = validatePort(d.port, t);
            if (h) { e.host = h; }
            if (p) { e.port = p; }
            if (!h && !p) {
                const clash = outgoingClash(d.host, Number(d.port), others);
                if (clash) { e.host = t('The partner "{{name}}" already connects to this address', { name: clash.name, interpolation: { escapeValue: false } }); }
            }
        }
        const s = validateFilter(d.share, t);
        const r = validateFilter(d.receive, t);
        if (s) { e.share = s; }
        if (r) { e.receive = r; }
        return e;
    }

    async function save() {
        const d = draft!;
        const errs = validate(d);
        setErrors(errs);
        if (errs.name || errs.host || errs.port) { setActive(0); return; }
        if (errs.share || errs.receive) { setActive(1); return; }
        const body: PatchPartnerInput = {};
        if (d.name.trim() !== partner!.name) { body.name = d.name.trim(); }
        if (partner!.direction === 'we_dial' && partner!.outgoing) {
            if (d.host.trim() !== partner!.outgoing.host) { body.host = d.host.trim(); }
            if (Number(d.port) !== partner!.outgoing.port) { body.port = Number(d.port); }
        }
        if (!sameFilter(d.share, partner!.share)) { body.share = cleanFilter(d.share); }
        if (!sameFilter(d.receive, partner!.receive)) { body.receive = cleanFilter(d.receive); }
        if (d.interconnected !== partner!.interconnected) { body.interconnected = d.interconnected; }
        if (Object.keys(body).length === 0) { onClose(); return; }
        setSaving(true);
        setServerError(undefined);
        try {
            const saved = await patchPartner(partner!.id, body);
            notifications.show({ color: 'green', icon: <IconCircleCheck size={16} />, title: t('Changes applied on the hub'), message: saved?.name ?? d.name });
            onSaved(saved);
        } catch (err) {
            setServerError(await explainError(err, overview?.partners ?? [], t, t('The hub rejected the change')));
        } finally {
            setSaving(false);
        }
    }

    const bad0 = !!(errors.name || errors.host || errors.port);
    const bad1 = !!(errors.share || errors.receive);

    return (
        <Modal
            opened
            onClose={onClose}
            size="xl"
            fullScreen={isPhone}
            radius={isPhone ? 0 : 'lg'}
            title={<Text fw={700} size="lg">{t('Edit {{name}}', { name: partner.name, interpolation: { escapeValue: false } })}</Text>}
            closeOnClickOutside={false}
        >
            <Stepper active={active} onStepClick={setActive} allowNextStepsSelect size="sm" mb="lg">
                <Stepper.Step
                    label={t('Who connects')}
                    aria-label={t('Who connects')}
                    color={bad0 ? 'red' : undefined}
                    icon={bad0 ? <IconAlertCircle size={16} color="var(--mantine-color-red-5)" /> : undefined}
                />
                <Stepper.Step
                    label={t('What to share')}
                    aria-label={t('What to share')}
                    color={bad1 ? 'red' : undefined}
                    icon={bad1 ? <IconAlertCircle size={16} color="var(--mantine-color-red-5)" /> : undefined}
                />
            </Stepper>

            {active === 0 && (
                <Stack gap="md">
                    <TextInput
                        label={t('Partner name')}
                        description={t('Renaming also renames their certificate on the hub.')}
                        value={draft.name}
                        onChange={(e) => patch({ name: e.currentTarget.value })}
                        error={errors.name}
                        required
                    />
                    <ConnectStep
                        kind={partner.kind}
                        direction={partner.direction}
                        host={draft.host}
                        port={draft.port}
                        onHost={(host) => patch({ host })}
                        onPort={(port) => patch({ port })}
                        errors={errors}
                        ourAddress={ourAddress}
                        partnerName={draft.name}
                    />
                </Stack>
            )}
            {active === 1 && (
                <ShareStep
                    kind={partner.kind}
                    share={draft.share}
                    receive={draft.receive}
                    onShare={(share) => patch({ share })}
                    onReceive={(receive) => patch({ receive })}
                    interconnected={draft.interconnected}
                    onInterconnected={(interconnected) => patch({ interconnected })}
                    suggestions={suggestions}
                    errors={errors}
                />
            )}

            {serverError && (
                <Stack mt="lg">
                    <ServerErrorAlert
                        view={serverError}
                        title={t('Couldn\'t save the changes')}
                        onOpenPartner={onOpenPartner && serverError.existingPartnerId !== partner.id ? onOpenPartner : undefined}
                        onRetry={save}
                    />
                </Stack>
            )}

            <Group justify="space-between" mt="xl" gap="sm" wrap="wrap">
                <Button variant="default" radius="xl" onClick={onClose}>{t('Cancel')}</Button>
                <Group gap="sm">
                    {active === 0 && <Button radius="xl" variant="light" onClick={() => setActive(1)}>{t('Next')}</Button>}
                    <Button radius="xl" className="raven-cta" leftSection={<IconDeviceFloppy size={16} />} loading={saving} onClick={save}>
                        {t('Save & apply')}
                    </Button>
                </Group>
            </Group>
        </Modal>
    );
}
