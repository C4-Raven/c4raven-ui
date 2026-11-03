const mantine = require("eslint-config-mantine");
const tseslint = require("typescript-eslint");
const reactHooks = require("eslint-plugin-react-hooks");

module.exports = tseslint.config(
    ...mantine,
    {
        languageOptions: {
            parserOptions: {
                project: "./tsconfig.json",
                // typescript-eslint infers the root from the first
                // eslint.config.js on the call stack, which is
                // eslint-config-mantine's own file, not this one.
                tsconfigRootDir: __dirname,
            },
        },
    },
    {
        // eslint-config-mantine does not include the hooks plugin; the
        // source's eslint-disable comments for its rules need it loaded.
        plugins: { "react-hooks": reactHooks },
        rules: {
            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "warn",
        },
    },
    // Tooling configs are outside tsconfig.json's "include", so the
    // type-aware parser cannot load them.
    { ignores: ["**/*.{mjs,cjs,js,d.ts,d.mts}", ".storybook/**", "i18next.config.ts"] }
);
