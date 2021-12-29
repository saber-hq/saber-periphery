require("@rushstack/eslint-patch/modern-module-resolution");

module.exports = {
  root: true,
  ignorePatterns: ["target/"],
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: "tsconfig.json",
  },
  extends: ["@saberhq"],
};
