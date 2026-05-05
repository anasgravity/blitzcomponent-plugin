import path from 'node:path';
import fs from 'node:fs';

function BlitzComponent(opts = {}) {
  const {
    javascripts4header = [],
    javascripts4footer = [],
    externalCss = [],
    html = '<div id="root"></div>'
  } = opts;
  let appName = "";
  let namespace = "";
  let outDir = "";
  let projectRoot = "";
  return {
    name: "blitz-component",
    // ─── 1. Set activation condition ──────────────────────
    apply(_, { command }) {
      return command === "build";
    },
    // ─── 2. Derive names & inject the correct base path ──────────────────────
    config(config) {
      const root = config.root ?? process.cwd();
      namespace = path.basename(root);
      appName = path.basename(path.dirname(path.dirname(root)));
      outDir = config.build?.outDir ?? "dist";
      const base = `/apps/${appName}/@react/${namespace}/${outDir}/`;
      return { base };
    },
    configResolved(resolvedConfig) {
      projectRoot = resolvedConfig.root;
      outDir = resolvedConfig.build.outDir;
    },
    // ─── 3. Write the component after the bundle is written to disk ────────────
    closeBundle() {
      const assetsDir = path.join(projectRoot, outDir, "assets");
      let jsFiles = [];
      let cssFiles = [];
      if (fs.existsSync(assetsDir)) {
        const entries = fs.readdirSync(assetsDir);
        jsFiles = entries.filter((f) => f.endsWith(".js"));
        cssFiles = entries.filter((f) => f.endsWith(".css"));
      }
      const javascriptsmodule = Object.fromEntries(
        jsFiles.map((f) => [
          `apps/${appName}/@react/${namespace}/${outDir}/assets/${f}`,
          ""
        ])
      );
      const header = Object.fromEntries(
        javascripts4header.map((url) => [url, ""])
      );
      const footer = Object.fromEntries(
        javascripts4footer.map((url) => [url, ""])
      );
      const css = {
        ...Object.fromEntries(
          cssFiles.map((f) => [
            `apps/${appName}/@react/${namespace}/${outDir}/assets/${f}`,
            ""
          ])
        ),
        ...Object.fromEntries(externalCss.map((url) => [url, ""]))
      };
      const component = {
        javascriptsmodule,
        javascripts4header: header,
        javascripts4footer: footer,
        css,
        view: {
          html
        }
      };
      const outputPath = path.join(projectRoot, "..", "..", `${namespace}.component.json`);
      fs.writeFileSync(
        outputPath,
        JSON.stringify(component, null, 4),
        "utf-8"
      );
      console.log(
        `
[blitz-component] Wrote component \u2192 ${path.resolve(outputPath)}
`
      );
    }
  };
}

export { BlitzComponent as default };
