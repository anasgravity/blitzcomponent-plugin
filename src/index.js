import path from "node:path";
import fs from "node:fs";

/**
 * Vite plugin – Blitz component generator
 *
 * Generates `<namespace>.component.json` in the root app path after
 * every build and wires up the correct public base path so that bundled
 * assets are served from:
 *   /apps/<app_name>/@react/<namespace>/<outDir>/assets/*
 *
 * The <namespace> is derived from the current directory name
 * (e.g. /server/apps/my-app/@react/my-namespace → namespace = "my-namespace")
 *
 * @param {object}   opts
 * @param {string[]} [opts.javascripts4header=[]]  External JS URLs (header)
 * @param {string[]} [opts.javascripts4footer=[]]  External JS URLs (footer)
 * @param {string[]} [opts.externalCss=[]]         External CSS URLs
 * @param {string}   [opts.html]                   Custom HTML for the root mount point
 * 												   (default: `<div id="root"></div>`)
 *
 */
export default function BlitzComponent(opts = {}) {
	const {
		javascripts4header = [],
		javascripts4footer = [],
		externalCss = [],
		html = '<div id="root"></div>'
	} = opts;

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
			// project root → e.g. /server/apps/my-app/@react/my-namespace
			// grandparent  → e.g. /server/apps/my-app  → appName    = "my-app"
			// basename     → e.g. my-namespace          → namespace  = "my-namespace"
			const root = config.root ?? process.cwd();
			namespace = path.basename(root);
			appName = path.basename(path.dirname(path.dirname(root)));

			// outDir defaults to "dist" in Vite
			outDir = config.build?.outDir ?? "dist";

			// Set the public base so that bundled assets resolve correctly at runtime
			const base = `/apps/${appName}/@react/${namespace}/${outDir}/`;
			return { base };
		},

		configResolved(resolvedConfig) {
			projectRoot = resolvedConfig.root;
			outDir = resolvedConfig.build.outDir; // may have been normalised
		},

		// ─── 3. Write the component after the bundle is written to disk ────────────
		closeBundle() {
			const assetsDir = path.join(projectRoot, outDir, "assets");

			// Collect bundled files (may not exist if build failed)
			let jsFiles = [];
			let cssFiles = [];

			if (fs.existsSync(assetsDir)) {
				const entries = fs.readdirSync(assetsDir);
				jsFiles = entries.filter((f) => f.endsWith(".js"));
				cssFiles = entries.filter((f) => f.endsWith(".css"));
			}

			// ── javascriptmodule ────────────────────────────────────────────────────
			const javascriptsmodule = Object.fromEntries(
				jsFiles.map((f) => [
					`apps/${appName}/@react/${namespace}/${outDir}/assets/${f}`,
					""
				])
			);

			// ── javascripts4header ──────────────────────────────────────────────────
			const header = Object.fromEntries(
				javascripts4header.map((url) => [url, ""])
			);

			// ── javascripts4footer ──────────────────────────────────────────────────
			const footer = Object.fromEntries(
				javascripts4footer.map((url) => [url, ""])
			);

			// ── css (bundled + external) ─────────────────────────────────────────────
			const css = {
				...Object.fromEntries(
					cssFiles.map((f) => [
						`apps/${appName}/@react/${namespace}/${outDir}/assets/${f}`,
						""
					])
				),
				...Object.fromEntries(externalCss.map((url) => [url, ""]))
			};

			// ── component ────────────────────────────────────────────────────────
			const component = {
				javascriptsmodule,
				javascripts4header: header,
				javascripts4footer: footer,
				css,
				view: {
					html
				}
			};

			// Write to the root app path /apps/<app_name>/, skipping @react
			const outputPath = path.join(projectRoot, "..", "..", `${namespace}.component.json`);

			fs.writeFileSync(
				outputPath,
				JSON.stringify(component, null, 4),
				"utf-8"
			);

			console.log(
				`\n[blitz-component] Wrote component → ${path.resolve(outputPath)}\n`
			);
		}
	};
}
