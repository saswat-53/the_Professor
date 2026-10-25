"""Runs a command on a pseudo-terminal and types a script into it, like a person at a keyboard.

usage: pty-script.py '<json list of [wait-for-text, text-to-send]>' <command...>
For each step it waits until the text shows up in the output printed since the previous step, then sends the
text exactly as given (so include "\\r" for Enter and "\\u0003" for Ctrl-C). Prints the output and ends with
"exit <code>" on the last line (128 + n if the command died of a signal n).
"""
import json, os, pty, select, signal, sys, time

steps = json.loads(sys.argv[1])
cmd = sys.argv[2:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(cmd[0], cmd)
out = b""
mark = 0
deadline = time.time() + 20
while time.time() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.05)
    if ready:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        out += data
    if steps and steps[0][0].encode() in out[mark:]:
        mark = len(out)
        os.write(fd, steps.pop(0)[1].encode())
if time.time() >= deadline:
    os.kill(pid, signal.SIGKILL)
_, status = os.waitpid(pid, 0)
code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else 128 + os.WTERMSIG(status)
sys.stdout.buffer.write(out + f"\nexit {code}\n".encode())
