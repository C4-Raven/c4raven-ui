import { findSetting, type SettingDef, type ValueClass } from './settingsCatalog';

/**
 * ATAK only fetches "every connection" profiles when this device preference
 * is on. The server switches it on itself during enrollment; the UI only
 * names it in explanations.
 */
export const ON_CONNECT_KEY = 'deviceProfileEnableOnConnect';

export type TargetKind = 'group' | 'user' | 'device';

export interface ProfileTarget {
    kind: TargetKind;
    value: string;
    label?: string;
}

export interface ProfileSetting {
    key: string;
    value: string;
    value_class: string;
}

export interface Profile {
    id: number;
    name: string;
    description: string;
    enabled: boolean;
    apply_on_enrollment: boolean;
    apply_on_connection: boolean;
    target_everyone: boolean;
    targets: ProfileTarget[];
    settings: ProfileSetting[];
    created_at?: string;
    updated_at?: string;
}

export type ProfileInput = Omit<Profile, 'id' | 'created_at' | 'updated_at' | 'targets'> & {
    targets: { kind: TargetKind; value: string }[];
};

export interface ExtraItem {
    name: string;
    install_on_enrollment: boolean;
    install_on_connection: boolean;
}

export interface Extras {
    data_packages: ExtraItem[];
    plugins: ExtraItem[];
}

export const VALUE_CLASSES: ValueClass[] = [
    'class java.lang.String',
    'class java.lang.Boolean',
    'class java.lang.Integer',
    'class java.lang.Long',
    'class java.lang.Float',
];

/** Plain-English names for ATAK's Java value classes (pass through t()). */
export const VALUE_CLASS_LABELS: Record<string, string> = {
    'class java.lang.String': 'Text (most settings)',
    'class java.lang.Boolean': 'On / off',
    'class java.lang.Integer': 'Whole number',
    'class java.lang.Long': 'Large whole number',
    'class java.lang.Float': 'Decimal number',
};

/** Accepts "Boolean" / "java.lang.Boolean" / "class java.lang.Boolean". */
export function normalizeValueClass(value: string | null | undefined): string {
    if (!value) { return 'class java.lang.String'; }
    const short = value.replace(/^class\s+/, '').replace(/^java\.lang\./, '');
    const full = `class java.lang.${short}`;
    return VALUE_CLASSES.includes(full as ValueClass) ? full : 'class java.lang.String';
}

export function blankProfile(): ProfileInput {
    return {
        name: '',
        description: '',
        enabled: true,
        apply_on_enrollment: true,
        apply_on_connection: false,
        target_everyone: true,
        targets: [],
        settings: [],
    };
}

export function toInput(profile: Profile): ProfileInput {
    return {
        name: profile.name,
        description: profile.description ?? '',
        enabled: profile.enabled,
        apply_on_enrollment: profile.apply_on_enrollment,
        apply_on_connection: profile.apply_on_connection,
        target_everyone: profile.target_everyone,
        targets: (profile.targets ?? []).map(({ kind, value }) => ({ kind, value })),
        settings: (profile.settings ?? []).map(({ key, value, value_class }) => ({ key, value, value_class })),
    };
}

/** A sensible starting value when a catalog setting is first added. */
export function initialValue(def: SettingDef): string {
    if (def.defaultValue !== undefined && def.defaultValue !== null) { return String(def.defaultValue); }
    if (def.input === 'toggle') { return 'false'; }
    if (def.input === 'select' && def.options?.length) { return def.options[0].value; }
    if (def.input === 'number' && def.min !== undefined) { return String(def.min); }
    return '';
}

export function settingFromDef(def: SettingDef, value?: string): ProfileSetting {
    return { key: def.key, value: value ?? initialValue(def), value_class: def.valueClass };
}

export function settingLabel(key: string): string {
    return findSetting(key)?.label ?? key;
}

/**
 * Add or replace settings by key. Returns the merged list plus how many keys
 * were new vs. replaced, so callers can tell the admin what happened.
 */
export function mergeSettings(current: ProfileSetting[], incoming: ProfileSetting[]) {
    const merged = [...current];
    let added = 0;
    let replaced = 0;
    for (const raw of incoming) {
        const key = raw.key.trim();
        if (!key) { continue; }
        const def = findSetting(key);
        const next: ProfileSetting = {
            key,
            value: raw.value ?? '',
            value_class: def?.valueClass ?? normalizeValueClass(raw.value_class),
        };
        const at = merged.findIndex((s) => s.key === key);
        if (at >= 0) {
            merged[at] = next;
            replaced += 1;
        } else {
            merged.push(next);
            added += 1;
        }
    }
    return { settings: merged, added, replaced };
}

export interface StarterTemplate {
    id: string;
    name: string;
    description: string;
    settings: ProfileSetting[];
}

/**
 * One-click starters. Each lists candidate ATAK keys; only keys that the
 * catalog actually knows are used, and a template with none is dropped, so
 * we never ship a key that hasn't been verified.
 */
const TEMPLATE_CANDIDATES: { id: string; name: string; description: string; keys: { key: string; value?: string }[] }[] = [
    {
        id: 'team',
        name: 'Team defaults',
        description: 'Give everyone the same team colour and role when they first sign in.',
        keys: [
            { key: 'locationTeam', value: 'Cyan' },
            { key: 'atakRoleType', value: 'Team Member' },
        ],
    },
    {
        id: 'map',
        name: 'Map defaults',
        description: 'Use the same coordinate format and units on every device.',
        keys: [
            { key: 'coord_display_pref' },
            { key: 'alt_unit_pref' },
            { key: 'speed_unit_pref' },
            { key: 'rab_rng_units_pref' },
            { key: 'rab_brg_units_pref' },
        ],
    },
    {
        id: 'reporting',
        name: 'Location reporting',
        description: 'Control how often devices send their position to the server.',
        keys: [
            { key: 'locationReportingStrategy' },
            { key: 'dynamicReportingRateStationaryUnreliable' },
            { key: 'constantReportingRateUnreliable' },
        ],
    },
];

export function starterTemplates(): StarterTemplate[] {
    const out: StarterTemplate[] = [];
    for (const tpl of TEMPLATE_CANDIDATES) {
        const settings: ProfileSetting[] = [];
        for (const { key, value } of tpl.keys) {
            const def = findSetting(key);
            if (!def) { continue; }
            let v = value;
            // Only keep a suggested value if it's valid for this control.
            if (v !== undefined && def.input === 'select' && def.options && !def.options.some((o) => o.value === v)) {
                v = undefined;
            }
            settings.push(settingFromDef(def, v));
        }
        if (settings.length) {
            out.push({ id: tpl.id, name: tpl.name, description: tpl.description, settings });
        }
    }
    return out;
}

