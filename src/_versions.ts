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
    versionDate: '2026-09-09T09:22:21.184Z',
    gitCommitHash: '8f034de',
    versionLong: '0.0.0-8f034de',
};
export default versions;
