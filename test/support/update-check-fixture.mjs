// Stands in for the calls the guard exists to catch: an update check or telemetry ping that fires on
// startup, or a helper binary it shells out to. Preloaded only by the guard's own self-test; the
// target is $GUARD_FIXTURE_URL.
import { execFileSync } from "node:child_process";

fetch(process.env.GUARD_FIXTURE_URL).catch(() => {});
// NODE_OPTIONS is cleared so the child does not preload this fixture again and spawn forever.
execFileSync(process.execPath, ["-e", ""], { env: { ...process.env, NODE_OPTIONS: "" } });
