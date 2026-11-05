"""Runs a command with stdout on a pipe and stderr on a pseudo-terminal, like `learn file | less` in a shell.

usage: stderr-pty.py <command...>
Prints one line of JSON: {"stdout": ..., "stderr": ..., "code": ...}, the stderr being what the terminal showed.
The terminal is read while the command runs: once every copy of its slave side is closed, what is left unread can be lost.
"""
import json, os, pty, select, subprocess, sys, threading

master, slave = pty.openpty()
proc = subprocess.Popen(sys.argv[1:], stdout=subprocess.PIPE, stderr=slave, stdin=subprocess.DEVNULL)
os.close(slave)

stdout_parts = []
reader = threading.Thread(target=lambda: stdout_parts.append(proc.stdout.read()))
reader.start()

stderr = b""
while True:
    ready, _, _ = select.select([master], [], [], 0.05)
    if ready:
        try:
            chunk = os.read(master, 65536)
        except OSError:
            break
        if not chunk:
            break
        stderr += chunk
    elif proc.poll() is not None:
        break

reader.join()
proc.wait()
print(json.dumps({"stdout": b"".join(stdout_parts).decode("utf-8", "replace"), "stderr": stderr.decode("utf-8", "replace"), "code": proc.returncode}))
