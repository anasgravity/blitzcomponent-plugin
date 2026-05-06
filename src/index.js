import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";

const VIRTUAL_ID = "virtual:blitz-router";
const RESOLVED_ID = "\0" + VIRTUAL_ID;
const PAGE_EXTS = [".tsx", ".jsx", ".ts", ".js"];

/**
 * Vite plugin – Blitz component generator + file-system router.
 *
 * Component JSON (build only):
 *   Generates/updates `<namespace>.component.json` two levels above the project root.
 *   Asset paths owned by this namespace are replaced; other keys preserved.
 *
 * File-system routing (dev + build):
 *   Mirrors the pages/ directory into a react-router route tree, exposed via a
 *   virtual entry module that becomes the app's entry point.
 *
 *   Conventions:
 *     index.tsx        → { index: true }
 *     about.tsx        → path "about"
 *     [id].tsx         → path ":id"
 *     layout.tsx       → wraps that level's children
 *     _app.tsx         → top-level wrapper; receives `data` (loader result) and `children`
 *     _error.tsx       → router errorElement
 *     _404.tsx         → catch-all path "*"
 *     _loader.ts       → async loader (default export: () => Promise<any>); resolved before mount, passed as `data` prop to _app
 *
 *   Pages directory: auto-detected as `src/pages` or `pages`.
 *   Special files (_app, _error, _404, _loader) are looked up in `pages/` first, then `src/` (or root).
 *
 *   Router basename: auto-set to `/<appName>/<namespace>` in build, omitted in dev.
 */
export default function BlitzComponent() {

	let appName = "";
	let namespace = "";
	let outDir = "";
	let projectRoot = "";
	let pagesDir = null;
	let isBuild = false;

	return {
		name: "blitz-component",

		config(config, { command }) {
			const root = config.root ?? process.cwd();
			namespace = path.basename(root);
			appName = path.basename(path.dirname(path.dirname(root)));
			outDir = config.build?.outDir ?? "dist";
			isBuild = command === "build";

			const patch = {};
			if (isBuild) {
				patch.base = `/apps/${appName}/@react/${namespace}/${outDir}/`;
				patch.build = {
					rollupOptions: {
						input: VIRTUAL_ID,
						output: {
							entryFileNames: (chunk) =>
								chunk.facadeModuleId === RESOLVED_ID
									? `assets/${namespace}-[hash].js`
									: "assets/[name]-[hash].js",
							chunkFileNames: "assets/[name]-[hash].js",
							assetFileNames: `assets/${namespace}-[hash][extname]`
						}
					}
				};
			}
			return patch;
		},

		configResolved(resolved) {
			projectRoot = resolved.root;
			outDir = resolved.build.outDir;

			for (const candidate of ["src/pages", "pages"]) {
				const full = path.join(projectRoot, candidate);
				if (fs.existsSync(full)) {
					pagesDir = full;
					break;
				}
			}
			if (!pagesDir) {
				throw new Error(
					"[blitz-component] no pages directory found (looked for src/pages and pages)"
				);
			}

			const req = createRequire(path.join(projectRoot, "package.json"));
			try {
				req.resolve("react-router-dom");
			} catch {
				throw new Error(
					"[blitz-component] react-router-dom is required but not installed. Run: npm install react-router-dom"
				);
			}
		},

		resolveId(id) {
			if (id === VIRTUAL_ID) return RESOLVED_ID;
			return null;
		},

		load(id) {
			if (id !== RESOLVED_ID) return null;
			const basename = isBuild ? `/${appName}/${namespace}` : null;
			return generateEntry(projectRoot, pagesDir, { basename });
		},

		// Dev only: there's no rollup entry resolution in dev, so we have to
		// inject the script tag ourselves. In build, Rollup handles it.
		transformIndexHtml: {
			order: "pre",
			handler(html, ctx) {
				if (ctx.server) {
					const tag = `<script type="module" src="/@id/__x00__${VIRTUAL_ID}"></script>`;
					if (html.includes("</body>")) {
						return html.replace("</body>", `${tag}\n</body>`);
					}
					return html + tag;
				}
				return html;
			}
		},

		closeBundle() {
			if (!isBuild || !projectRoot) return;

			const assetsDir = path.join(projectRoot, outDir, "assets");
			const outputPath = path.join(projectRoot, "..", "..", `${namespace}.component.json`);
			const ownedPrefix = `apps/${appName}/@react/${namespace}`;

			let jsFiles = [];
			let cssFiles = [];
			if (fs.existsSync(assetsDir)) {
				const entries = fs.readdirSync(assetsDir);
				jsFiles = entries.filter((f) => f.endsWith(".js"));
				cssFiles = entries.filter((f) => f.endsWith(".css"));
			}

			const newJs = Object.fromEntries(jsFiles.map((f) => [`${ownedPrefix}/${outDir}/assets/${f}`, ""]));
			const newCss = Object.fromEntries(cssFiles.map((f) => [`${ownedPrefix}/${outDir}/assets/${f}`, ""]));

			let existing = {};
			if (fs.existsSync(outputPath)) {
				try {
					existing = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
				} catch {
					console.warn(`[blitz-component] Could not parse existing JSON at ${outputPath} — overwriting.`);
				}
			}

			const stripOwned = (obj) =>
				Object.fromEntries(
					Object.entries(obj ?? {}).filter(([k]) => !k.startsWith(ownedPrefix))
				);

			const component = {
				...existing,
				javascriptsmodule: { ...stripOwned(existing.javascriptsmodule), ...newJs },
				css:               { ...stripOwned(existing.css),               ...newCss },
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

// ─────────────────────────────────────────────────────────────────────────────
// Entry generation
// ─────────────────────────────────────────────────────────────────────────────

function generateEntry(projectRoot, pagesDir, { basename }) {
	const imports = [];
	let counter = 0;
	const idFor = (file) => {
		const id = `P${counter++}`;
		imports.push(`import ${id} from ${JSON.stringify(file)};`);
		return id;
	};

	const special = detectSpecial(projectRoot, pagesDir);
	const appId      = special.app      ? idFor(special.app)      : null;
	const errorId    = special.error    ? idFor(special.error)    : null;
	const notFoundId = special.notFound ? idFor(special.notFound) : null;
	const loaderImport = special.loader ? `import loader from ${JSON.stringify(special.loader)};` : null;

	const tree = buildTree(pagesDir, /* skipSpecial */ true);
	const routes = renderRoot(tree, idFor, errorId, notFoundId);

	const head = [
		`import React from "react";`,
		`import { createRoot } from "react-dom/client";`,
		`import { createBrowserRouter, RouterProvider } from "react-router-dom";`,
		...(loaderImport ? [loaderImport] : []),
		...imports
	];

	const routerOpts = basename ? `, { basename: ${JSON.stringify(basename)} }` : "";
	const loaderLine = special.loader ? `const data = await loader();` : `const data = undefined;`;

	// Avoid emitting JSX — virtual modules are not guaranteed to be transformed
	// by the React plugin regardless of the virtual ID extension. Use
	// React.createElement directly so no JSX transform is needed.
	const routerEl = `React.createElement(RouterProvider, { router })`;
	const appEl = appId
		? `React.createElement(${appId}, { data }, ${routerEl})`
		: `React.createElement(React.Fragment, null, ${routerEl})`;

	return `${head.join("\n")}

const router = createBrowserRouter(${routes}${routerOpts});

const container = document.getElementById("root");
if (!container) throw new Error("[blitz-router] #root not found");

(async () => {
	try {
		${loaderLine}
		createRoot(container).render(${appEl});
	} catch (err) {
		console.error("[blitz-router] failed to mount:", err);
		container.innerHTML = '<pre style="color:#b00;padding:1rem;white-space:pre-wrap;">' + (err && err.stack || String(err)) + '</pre>';
	}
})();`;
}

/**
 * Look up special files. _app/_error/_404 are checked in pages/ first, then in
 * src/ (or projectRoot if there's no src/). _loader is only checked in src/ or root.
 */
function detectSpecial(projectRoot, pagesDir) {
	const srcDir = fs.existsSync(path.join(projectRoot, "src"))
		? path.join(projectRoot, "src")
		: projectRoot;

	const findIn = (dir, base) => {
		for (const ext of PAGE_EXTS) {
			const full = path.join(dir, base + ext);
			if (fs.existsSync(full)) return full;
		}
		return null;
	};

	const findEither = (base) => findIn(pagesDir, base) ?? findIn(srcDir, base);

	return {
		app:      findEither("_app"),
		error:    findEither("_error"),
		notFound: findEither("_404"),
		loader:   findEither("_loader")
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Route tree + rendering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walk a directory and return:
 *   { layout, index, pages: [{ segment, file }], children: [{ segment, ...node }] }
 *
 * `skipSpecial` excludes _app/error/404 — only meaningful at the root level.
 */
function buildTree(dir, skipSpecial = false) {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	const node = { layout: null, index: null, pages: [], children: [] };

	for (const entry of entries) {
		const full = path.join(dir, entry.name);

		if (entry.isDirectory()) {
			const child = buildTree(full);
			child.segment = toSegment(entry.name);
			node.children.push(child);
			continue;
		}

		const ext = PAGE_EXTS.find((e) => entry.name.endsWith(e));
		if (!ext) continue;
		const base = entry.name.slice(0, -ext.length);

		if (skipSpecial && (base === "_app" || base === "_error" || base === "_404" || base === "_loader")) continue;

		if (base === "layout") node.layout = full;
		else if (base === "index") node.index = full;
		else node.pages.push({ segment: toSegment(base), file: full });
	}

	return node;
}

function toSegment(name) {
	const catchAll = name.match(/^\[\.\.\.(.+)\]$/);
	if (catchAll) return "*";
	const dynamic = name.match(/^\[(.+)\]$/);
	if (dynamic) return ":" + dynamic[1];
	return name;
}

function renderRoot(tree, idFor, errorId, notFoundId) {
	const children = renderChildren(tree, idFor, "");
	if (notFoundId) children.push(`{ path: "*", element: React.createElement(${notFoundId}) }`);

	if (tree.layout) {
		const layoutId = idFor(tree.layout);
		return `[
	{
		path: "/",
		element: React.createElement(${layoutId}),
		${errorId ? `errorElement: React.createElement(${errorId}),` : ""}
		children: ${arr(children, 2)}
	}
]`;
	}

	if (errorId) {
		return `[
	{
		errorElement: React.createElement(${errorId}),
		children: ${arr(children, 2)}
	}
]`;
	}

	return arr(children, 1);
}

/**
 * Render the children of a node as an array of route-object source strings.
 * `pathPrefix` is used to flatten folders that lack a layout.
 */
function renderChildren(node, idFor, pathPrefix) {
	const out = [];

	if (node.index) {
		const el = idFor(node.index);
		out.push(pathPrefix
			? `{ path: ${JSON.stringify(pathPrefix)}, element: React.createElement(${el}) }`
			: `{ index: true, element: React.createElement(${el}) }`);
	}

	for (const page of node.pages) {
		const el = idFor(page.file);
		const p = pathPrefix ? `${pathPrefix}/${page.segment}` : page.segment;
		out.push(`{ path: ${JSON.stringify(p)}, element: React.createElement(${el}) }`);
	}

	for (const child of node.children) {
		const childPath = pathPrefix ? `${pathPrefix}/${child.segment}` : child.segment;

		if (child.layout) {
			const layoutId = idFor(child.layout);
			const grandkids = renderChildren(child, idFor, "");
			out.push(`{
			path: ${JSON.stringify(childPath)},
			element: React.createElement(${layoutId}),
			children: ${arr(grandkids, 3)}
		}`);
		} else {
			// No layout → flatten into parent with prefixed paths.
			out.push(...renderChildren(child, idFor, childPath));
		}
	}

	return out;
}

function arr(items, indent) {
	if (items.length === 0) return "[]";
	const pad = "\t".repeat(indent);
	return `[\n${items.map((i) => pad + "\t" + i).join(",\n")}\n${pad}]`;
}
