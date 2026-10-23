import { BRACE_EXTENSIONS, braceBlockFinder } from "./brace-block-finder.js";
import { type BlockFinder, noBlockFinder } from "./context.js";
import { extensionOf } from "./extension.js";
import { PYTHON_EXTENSIONS, pythonBlockFinder } from "./python-block-finder.js";

/**
 * The built-in finder for a file, chosen by extension before searching so the Context report names
 * the finder that actually ran. Files no built-in finder understands get the one that finds nothing.
 */
export function blockFinderFor(path: string): BlockFinder {
  const ext = extensionOf(path);
  if (PYTHON_EXTENSIONS.has(ext)) return pythonBlockFinder;
  return BRACE_EXTENSIONS.has(ext) ? braceBlockFinder : noBlockFinder;
}
