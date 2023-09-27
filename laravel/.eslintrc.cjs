module.exports = {
    env: {
        browser: true,
        es2021: true,
    },
    // extends: [
    //   'standard',
    //   'plugin:vue/vue3-essential'
    // ],
    // extends: ["plugin:prettier/recommended"],
    extends: ["eslint:recommended", "plugin:vue/vue3-recommended", "prettier"],
    overrides: [
        {
            env: {
                node: true,
            },
            files: [".eslintrc.{js,cjs}"],
            parserOptions: {
                sourceType: "script",
            },
        },
    ],
    parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
    },
    plugins: ["vue"],
    rules: {},
};
