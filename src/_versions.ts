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
    versionDate: '2026-08-28T09:00:17.877Z',
    gitCommitHash: '5f6e8d1',
    versionLong: '0.0.0-5f6e8d1',
};
export default versions;
