export interface BlitzComponentOptions {
  /**
   * External JS URLs to include in the `javascripts4header` section.
   * @default []
   */
  javascripts4header?: string[];

  /**
   * External CSS URLs to include in the `css` section.
   * @default []
   */
  externalCss?: string[];

  /**
   * Custom HTML for the root mount point.
   * @default '<div id="root"></div>'
   */
  html?: string;
}

export default function BlitzComponent(
  opts?: BlitzComponentOptions
): import("vite").Plugin;