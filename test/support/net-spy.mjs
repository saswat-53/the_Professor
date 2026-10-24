// Preloaded into the CLI with `node --import` (an ESM preload: it runs before the program's own code).
// It works by monkey patching: each built-in below is replaced by a wrapper that logs, then calls the
// original. Used by test/no-network.test.ts. Appends one line to $LEARN_NET_LOG for every outside-world
// operation the process starts:
//   connect <host>:<port>  a socket connect (fetch, http, https and tls all end up in net.Socket#connect)
//   lookup <host>          a DNS lookup or resolve
//   udp <method>           a UDP send or connect
//   spawn <command>        a child process, async (ChildProcess#spawn) or sync (spawnSync and friends)
import { appendFileSync } from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import dgram from "node:dgram";
import dns from "node:dns";
import net from "node:net";

const log = (line) => appendFileSync(process.env.LEARN_NET_LOG, `${line}\n`);

const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  // net.connect() hands Socket#connect its arguments already normalized, as [options, callback].
  const [first, second] = Array.isArray(args[0]) ? args[0] : args;
  if (first !== null && typeof first === "object") {
    log(first.path ? `connect unix:${first.path}` : `connect ${first.host ?? "localhost"}:${first.port}`);
  } else if (typeof first === "number") {
    log(`connect ${typeof second === "string" ? second : "localhost"}:${first}`);
  } else {
    log(`connect unix:${first}`);
  }
  return realConnect.apply(this, args);
};

for (const target of [dns, dns.promises]) {
  const realLookup = target.lookup;
  target.lookup = function (hostname, ...rest) {
    log(`lookup ${hostname}`);
    return realLookup.call(this, hostname, ...rest);
  };
}

// c-ares lookups (dns.resolve4, resolveTxt, ...) bypass dns.lookup, so they are wrapped by name.
for (const target of [dns, dns.promises]) {
  for (const name of Object.keys(target).filter((key) => key.startsWith("resolve") && typeof target[key] === "function")) {
    const realResolve = target[name];
    target[name] = function (hostname, ...rest) {
      log(`lookup ${hostname}`);
      return realResolve.call(this, hostname, ...rest);
    };
  }
}

const realSpawn = childProcess.ChildProcess.prototype.spawn;
childProcess.ChildProcess.prototype.spawn = function (options) {
  log(`spawn ${options.file}`);
  return realSpawn.call(this, options);
};

// The synchronous APIs run through a separate native path, so each is wrapped on its own.
// Rebinding the exports afterwards (syncBuiltinESMExports) keeps `import { execFileSync } from` in step.
for (const [name, commandOf] of [
  ["spawnSync", (command) => command],
  ["execFileSync", (command) => command],
  ["execSync", () => "sh"],
]) {
  const realSync = childProcess[name];
  childProcess[name] = function (command, ...rest) {
    log(`spawn ${commandOf(command)}`);
    return realSync.call(this, command, ...rest);
  };
}
syncBuiltinESMExports();

for (const method of ["send", "connect"]) {
  const original = dgram.Socket.prototype[method];
  dgram.Socket.prototype[method] = function (...args) {
    log(`udp ${method}`);
    return original.apply(this, args);
  };
}
