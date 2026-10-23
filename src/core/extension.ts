/**
 * The lower-case extension of a path's last segment, without the dot; "" when there is none. A dot in
 * a directory name does not count, and neither does a leading dot (`.bashrc` is a name, not an extension).
 */
export function extensionOf(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}
