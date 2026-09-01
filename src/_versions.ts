export interface TsAppVersion {
    version: string;
    name: string;
    description?: string;
    versionLong?: string;
    versionDate: string;
    gitCommitHash?: string;
    gitCommitDate?: string;
    gitTag?: string;
};
export const versions: TsAppVersion = {
    version: '0.0.0',
    name: 'opentakserver-ui',
    versionDate: '2026-09-01T03:51:42.020Z',
    gitCommitHash: '1aa8d63',
    versionLong: '0.0.0-1aa8d63',
};
export default versions;
