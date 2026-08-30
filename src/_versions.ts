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
    versionDate: '2026-08-30T05:38:32.970Z',
    gitCommitHash: '35f51f6',
    versionLong: '0.0.0-35f51f6',
};
export default versions;
