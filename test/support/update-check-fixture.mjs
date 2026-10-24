// Stands in for the call the guard exists to catch: an update check, telemetry ping or similar
// that fires on startup. Preloaded only by the guard's own self-test; the target is $GUARD_FIXTURE_URL.
fetch(process.env.GUARD_FIXTURE_URL).catch(() => {});
