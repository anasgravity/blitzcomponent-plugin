import path from "node:path";
import fs from "node:fs";

/**
 * Vite plugin – Blitz component generator
 *
 * Generates or updates `<namespace>.component.json` in the root app path after every build.
 * Merges with existing component JSON if present.
 *
 * Asset paths owned by this namespace are replaced on every build.
 * All other keys in the existing JSON are preserved.
 *
 * The <namespace> is derived from the current directory name
 * (e.g. /server/apps/my-app/@react/my-namespace → namespace = "my-namespace")
 */
export default function BlitzComponent() {
	/** Resolved at configResolved time */
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

			// Set the public base so that bundled assets resolve correctly at runtime
			const base = `/apps/${appName}/@react/${namespace}/${outDir}/`;
			return { base };
		},

		configResolved(resolvedConfig) {
			projectRoot = resolvedConfig.root;
			outDir = resolvedConfig.build.outDir; // may have been normalised
		},

		// ─── 3. Write/merge the component after the bundle is written to disk ─────
		closeBundle() {
			const assetsDir = path.join(projectRoot, outDir, "assets");
			const outputPath = path.join(projectRoot, "..", "..", `${namespace}.component.json`);
			const ownedPrefix = `apps/${appName}/@react/${namespace}`;

			// ── Collect freshly bundled files ────────────────────────────────────
			let jsFiles = [];
			let cssFiles = [];

			if (fs.existsSync(assetsDir)) {
				const entries = fs.readdirSync(assetsDir);
				jsFiles = entries.filter((f) => f.endsWith(".js"));
				cssFiles = entries.filter((f) => f.endsWith(".css"));
			}

			const newJsEntries = Object.fromEntries(jsFiles.map((f) => [`${ownedPrefix}/${outDir}/assets/${f}`, ""]));
			const newCssEntries = Object.fromEntries(cssFiles.map((f) => [`${ownedPrefix}/${outDir}/assets/${f}`, ""]));

			// ── Load existing component or start from scratch ─────────────────────
			let existing = {};
			if (fs.existsSync(outputPath)) {
				try {
					existing = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
				} catch {
					console.warn(`[blitz-component] Could not parse existing JSON at ${outputPath} — overwriting.`);
				}
			}

			// ── Merge: strip owned assets, inject fresh ones ──────────────────────
			const stripOwned = (obj) =>
				Object.fromEntries(
					Object.entries(obj ?? {}).filter(([k]) => !k.startsWith(ownedPrefix))
				);

			const component = {
				...existing,
				javascriptsmodule: { ...stripOwned(existing.javascriptsmodule), ...newJsEntries },
				css:               { ...stripOwned(existing.css),               ...newCssEntries },
				view: {
					...existing.view,
					html: existing.view?.html ?? '<div id="root"></div>'
				}
			};

			fs.writeFileSync(outputPath, JSON.stringify(component, null, 4), "utf-8");

			console.log(`\n[blitz-component] Wrote component → ${outputPath}\n`);
		}
	};
}
