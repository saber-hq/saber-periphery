"use strict";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
require("@rushstack/eslint-patch/modern-module-resolution");

/** @type import('eslint').Linter.Config */
module.exports = {
  root: true,
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: "tsconfig.json",
  },
  extends: ["@saberhq"],
};
