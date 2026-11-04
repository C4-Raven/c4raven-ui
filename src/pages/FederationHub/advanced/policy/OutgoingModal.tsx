import React, { useEffect, useState } from 'react';
import { Alert, Button, Group, Modal, NumberInput, PasswordInput, Stack, Switch, Text, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { outgoingEntity, validateOutgoing, type OutgoingForm } from '../helpers';
import type { PolicyEntity } from '../types';

export default function OutgoingModal({ opened, initial, previous, editing, incomingFromSameHost, onClose, onSave }: {
    opened: boolean;
    initial: OutgoingForm;
    /** The entity being edited: its description (Raven's partner metadata) and unknown fields are kept. */
    previous?: PolicyEntity | null;
    editing: boolean;
    /** Live incoming connection already coming from this host (G6: only one side may dial). */
    incomingFromSameHost: (host: string) => boolean;
    onClose: () => void;
    onSave: (entity: PolicyEntity) => void;
}) {
    const { t } = useTranslation();
    const [form, setForm] = useState<OutgoingForm>(initial);
    const [tried, setTried] = useState(false);
    useEffect(() => { if (opened) { setForm(initial); setTried(false); } }, [opened, initial]);

    const errors = validateOutgoing(form);
    const show = (k: keyof typeof errors) => (tried && errors[k] ? t(errors[k] as string) : undefined);
    const set = (patch: Partial<OutgoingForm>) => setForm((f) => ({ ...f, ...patch }));

    function save() {
        setTried(true);
        if (Object.keys(errors).length > 0) { return; }
        onSave(outgoingEntity(form, previous));
    }

    return (
        <Modal opened={opened} onClose={onClose} title={<Text fw={700}>{editing ? t('Edit outgoing connection') : t('Add outgoing connection')}</Text>} centered>
            <Stack gap="sm">
                <Text size="sm" c="dimmed">{t('This hub dials the other server. Only one side should dial, so don\'t add this if they already connect to us.')}</Text>
                <TextInput label={t('Display name')} placeholder={t('e.g. Partner Org Hub')} value={form.displayName} onChange={(e) => set({ displayName: e.currentTarget.value })} error={show('displayName')} required />
                <TextInput
                    label={t('Host')}
                    description={t('Exactly the name or IP in the other server\'s certificate')}
                    placeholder="fedhub.partner.example.com"
                    value={form.host}
                    onChange={(e) => set({ host: e.currentTarget.value })}
                    error={show('host')}
                    required
                />
                {form.host.trim() && incomingFromSameHost(form.host.trim()) && (
                    <Alert color="orange" variant="light">{t('A connection from this host is already coming in. If both sides dial, the hub refuses the duplicate and the link flaps.')}</Alert>
                )}
                <NumberInput
                    label={t('Port')}
                    description={t('9102 for another Federation Hub (v2). A TAK Server\'s v2 federation port is usually 9001.')}
                    value={form.port}
                    onChange={(v) => set({ port: Number(v) || 0 })}
                    min={1}
                    max={65535}
                    error={show('port')}
                />
                <Switch label={t('Use TLS')} checked={form.tls} onChange={(e) => set({ tls: e.currentTarget.checked })} />
                <Switch label={t('Enabled')} checked={form.enabled} onChange={(e) => set({ enabled: e.currentTarget.checked })} />
                <Switch
                    label={t('Use token authentication')}
                    description={t('Only when the other side gave you a federation token and runs a token port')}
                    checked={form.useToken}
                    onChange={(e) => set({ useToken: e.currentTarget.checked })}
                />
                {form.useToken && (
                    <>
                        <TextInput label={t('Token type')} value={form.tokenType} onChange={(e) => set({ tokenType: e.currentTarget.value })} />
                        <PasswordInput label={t('Token')} value={form.token} onChange={(e) => set({ token: e.currentTarget.value })} error={show('token')} autoComplete="off" />
                        <Text size="xs" c="dimmed">{t('The hub stores this token in plain text inside the policy.')}</Text>
                    </>
                )}
            </Stack>
            <Group justify="flex-end" mt="lg" gap="sm">
                <Button variant="default" radius="xl" onClick={onClose}>{t('Cancel')}</Button>
                <Button radius="xl" onClick={save}>{editing ? t('Save to draft') : t('Add to draft')}</Button>
            </Group>
        </Modal>
    );
}
