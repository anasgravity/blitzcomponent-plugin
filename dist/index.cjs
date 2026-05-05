'use strict';

const path = require('node:path');
const fs = require('node:fs');

function _interopDefaultCompat (e) { return e && typeof e === 'object' && 'default' in e ? e.default : e; }

const path__default = /*#__PURE__*/_interopDefaultCompat(path);
const fs__default = /*#__PURE__*/_interopDefaultCompat(fs);

function BlitzComponent() {
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
      namespace = path__default.basename(root);
      appName = path__default.basename(path__default.dirname(path__default.dirname(root)));
      outDir = config.build?.outDir ?? "dist";
      const base = `/apps/${appName}/@react/${namespace}/${outDir}/`;
      return { base };
    },
    configResolved(resolvedConfig) {
      projectRoot = resolvedConfig.root;
      outDir = resolvedConfig.build.outDir;
    },
    // ─── 3. Write/merge the component after the bundle is written to disk ─────
    closeBundle() {
      const assetsDir = path__default.join(projectRoot, outDir, "assets");
      const outputPath = path__default.join(projectRoot, "..", "..", `${namespace}.component.json`);
      const ownedPrefix = `apps/${appName}/@react/${namespace}`;
      let jsFiles = [];
      let cssFiles = [];
      if (fs__default.existsSync(assetsDir)) {
        const entries = fs__default.readdirSync(assetsDir);
        jsFiles = entries.filter((f) => f.endsWith(".js"));
        cssFiles = entries.filter((f) => f.endsWith(".css"));
      }
      const newJsEntries = Object.fromEntries(jsFiles.map((f) => [`${ownedPrefix}/${outDir}/assets/${f}`, ""]));
      const newCssEntries = Object.fromEntries(cssFiles.map((f) => [`${ownedPrefix}/${outDir}/assets/${f}`, ""]));
      let existing = {};
      if (fs__default.existsSync(outputPath)) {
        try {
          existing = JSON.parse(fs__default.readFileSync(outputPath, "utf-8"));
        } catch {
          console.warn(`[blitz-component] Could not parse existing JSON at ${outputPath} \u2014 overwriting.`);
        }
      }
      const stripOwned = (obj) => Object.fromEntries(
        Object.entries(obj ?? {}).filter(([k]) => !k.startsWith(ownedPrefix))
      );
      const component = {
        ...existing,
        javascriptsmodule: { ...stripOwned(existing.javascriptsmodule), ...newJsEntries },
        css: { ...stripOwned(existing.css), ...newCssEntries },
        view: {
          ...existing.view,
          html: existing.view?.html ?? '<div id="root"></div>'
        }
      };
      fs__default.writeFileSync(outputPath, JSON.stringify(component, null, 4), "utf-8");
      console.log(`
[blitz-component] Wrote component \u2192 ${outputPath}
`);
    }
  };
}

module.exports = BlitzComponent;
