import { braceBlockFinder } from "./brace-block-finder.js";
import type { BlockFinder } from "./context.js";
import { pythonBlockFinder } from "./python-block-finder.js";

const FINDERS: readonly BlockFinder[] = [pythonBlockFinder, braceBlockFinder];

/** The finder used when none is given: each built-in finder in turn, which only recognises its own extensions. */
export const defaultBlockFinder: BlockFinder = {
  name: "builtin",
  find(file, range) {
    for (const finder of FINDERS) {
      const found = finder.find(file, range);
      if (found) return found;
    }
    return null;
  },
};
