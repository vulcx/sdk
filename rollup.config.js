import typescript from "@rollup/plugin-typescript";
import dts from "rollup-plugin-dts";

export default [
  {
    input: "src/index.ts",
    output: [
      { file: "dist/index.cjs.js", format: "cjs", sourcemap: true },
      { file: "dist/index.esm.js", format: "es", sourcemap: true },
      {
        file: "dist/index.umd.js",
        format: "umd",
        name: "VulcxSDK",
        sourcemap: true,
      },
    ],
    plugins: [typescript({ tsconfig: "./tsconfig.json" })],
  },
  {
    input: "src/index.ts",
    output: { file: "dist/index.d.ts", format: "es" },
    plugins: [dts()],
  },
];
