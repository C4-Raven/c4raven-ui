import React, { useState } from 'react';
import { Group, Stack, Tabs, Text, Title } from '@mantine/core';
import { IconBug, IconCalendarDue, IconClipboardList, IconShieldLock } from '@tabler/icons-react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import ScheduledJobsTab from './ScheduledJobsTab';
import SecurityAuditTab from './SecurityAuditTab';
import AdminActionsTab from './AdminActionsTab';
import ErrorLogTab from './ErrorLogTab';

const TABS = ['jobs', 'audit', 'admin', 'errors'] as const;
type TabValue = (typeof TABS)[number];

function isTab(value: string | null): value is TabValue {
    return value !== null && (TABS as readonly string[]).includes(value);
}

export default function ServerRequests() {
    const { t } = useTranslation();
    const [searchParams, setSearchParams] = useSearchParams();
    const requested = searchParams.get('tab');
    const tab: TabValue = isTab(requested) ? requested : 'jobs';
    // Mount each tab the first time it is opened, then keep it mounted so
    // filters, loaded data and the error-log buffer survive tab switches.
    const [visited, setVisited] = useState<Set<TabValue>>(() => new Set([tab]));

    function changeTab(value: string | null) {
        if (!isTab(value)) { return; }
        setVisited((prev) => (prev.has(value) ? prev : new Set(prev).add(value)));
        setSearchParams(value === 'jobs' ? {} : { tab: value }, { replace: true });
    }

    return (
        <Stack gap="lg">
            <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
                <div>
                    <Title order={2}>{t('Server Requests')}</Title>
                    <Text size="sm" c="dimmed">
                        {t('Background jobs, sign-in and enrollment audit, admin actions, and the server error log')}
                    </Text>
                </div>
            </Group>

            <Tabs value={tab} onChange={changeTab} variant="pills" radius="xl">
                <Tabs.List mb="lg">
                    <Tabs.Tab value="jobs" leftSection={<IconCalendarDue size={16} />}>{t('Scheduled Jobs')}</Tabs.Tab>
                    <Tabs.Tab value="audit" leftSection={<IconShieldLock size={16} />}>{t('Security Audit')}</Tabs.Tab>
                    <Tabs.Tab value="admin" leftSection={<IconClipboardList size={16} />}>{t('Admin Actions')}</Tabs.Tab>
                    <Tabs.Tab value="errors" leftSection={<IconBug size={16} />}>{t('Error Log')}</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="jobs">{visited.has('jobs') && <ScheduledJobsTab />}</Tabs.Panel>
                <Tabs.Panel value="audit">{visited.has('audit') && <SecurityAuditTab />}</Tabs.Panel>
                <Tabs.Panel value="admin">{visited.has('admin') && <AdminActionsTab />}</Tabs.Panel>
                <Tabs.Panel value="errors">{visited.has('errors') && <ErrorLogTab active={tab === 'errors'} />}</Tabs.Panel>
            </Tabs>
        </Stack>
    );
}
