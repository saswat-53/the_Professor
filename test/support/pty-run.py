"""Runs a command on a pseudo-terminal, so it sees a TTY on stdout and stderr.

usage: pty-run.py <wait-for-text> <signal> <command...>
Waits until <wait-for-text> shows up in the output, sends <signal> (a name, e.g. SIGINT) to the command,
then prints the output and ends with "exit <code>" on the last line (128 + n if the command died of a signal n).
"""
import os, pty, select, signal, sys, time

wait_for, sig_name, *cmd = sys.argv[1:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(cmd[0], cmd)
out = b""
sent = False
deadline = time.time() + 20
while time.time() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.1)
    if ready:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        out += data
    if not sent and wait_for.encode() in out:
        os.kill(pid, getattr(signal, sig_name))
        sent = True
_, status = os.waitpid(pid, 0)
code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else 128 + os.WTERMSIG(status)
sys.stdout.buffer.write(out + f"\nexit {code}\n".encode())
