# 40: Show the wait time on a rate limit

**What to build:** When a 429 response carries a `Retry-After` header, the rate-limit message tells the user how long to wait.

**Blocked by:** 05 (Typed errors and exit codes)

**Status:** done

- [x] The fake server sends a 429 with `Retry-After: 30`; stderr says to wait about 30 seconds
- [x] `Retry-After` given as an HTTP date is handled as well as seconds
- [x] Without the header the message is unchanged, and there is still no automatic retry
- [x] The header value is parsed, never echoed raw, so it cannot carry raw provider output to the terminal
