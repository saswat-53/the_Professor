// Preloaded into the CLI with `node --import` (see test/no-network.test.ts). Appends one line to
// $LEARN_NET_LOG for every network operation the process starts: a socket connect, a DNS lookup,
// or a UDP send. fetch, http and https all end up in net.Socket#connect, so one patch covers them.
import { appendFileSync } from "node:fs";
import dgram from "node:dgram";
import dns from "node:dns";
import net from "node:net";

const log = (line) => appendFileSync(process.env.LEARN_NET_LOG, `${line}\n`);

const connect = net.Socket.prototype.connect;
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
  return connect.apply(this, args);
};

const lookup = dns.lookup;
dns.lookup = function (hostname, ...rest) {
  log(`lookup ${hostname}`);
  return lookup.call(this, hostname, ...rest);
};
const lookupPromise = dns.promises.lookup;
dns.promises.lookup = function (hostname, ...rest) {
  log(`lookup ${hostname}`);
  return lookupPromise.call(this, hostname, ...rest);
};

for (const method of ["send", "connect"]) {
  const original = dgram.Socket.prototype[method];
  dgram.Socket.prototype[method] = function (...args) {
    log(`udp ${method}`);
    return original.apply(this, args);
  };
}
