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
    name: 'c4raven-ui',
    versionDate: '2026-11-03T03:47:25.035Z',
    gitCommitHash: '58d2336',
    versionLong: '0.0.0-58d2336',
};
export default versions;
