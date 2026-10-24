"""Qualify one owned-emulator run with observed IME and restored settings.

Usage: ime.py WORK LABEL CLASS EXPECTED WIDTH HEIGHT FONT_SCALE
This wraps connected.py. Synthetic inputs only; logs stay outside the checkout.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading

work_arg, label, classes, expected, width, height, scale = sys.argv[1:]
ROOT = Path(__file__).resolve().parents[3]
WORK = Path(work_arg).resolve()
assert WORK.is_relative_to(Path('/workspace')) or WORK.is_relative_to(Path('/tmp'))
assert not WORK.is_relative_to(ROOT) and re.fullmatch(r'[a-z0-9-]+', label)
assert not (WORK / label).exists(), 'Use a new label; preserve prior results'
OUT = WORK / 'ime-observation' / label
OUT.mkdir(parents=True, exist_ok=False)
ENV = {k: v for k, v in os.environ.items() if k not in (
    'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')}
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
container = (WORK / 'android-container-id').read_text().strip()
info = json.loads(subprocess.check_output(DOCKER + ['inspect', container], env=ENV))[0]
assert info['Id'] == container and info['Config']['Labels'].get('todosns.verification') == 'final-m11'
ADB = DOCKER + ['exec', container, '/workspace/tooling/todosns/android-sdk/platform-tools/adb', '-s', 'emulator-5554']


def command(*args):
    return subprocess.check_output(ADB + list(args), env=ENV, timeout=15)


def shown(value):
    return 'mInputShown=true' in value or 'mIsInputViewShown=true' in value


original = command('shell', 'settings', 'get', 'secure', 'show_ime_with_hard_keyboard').decode().strip()
stop = threading.Event()
seen = threading.Event()


def observe():
    while not stop.is_set():
        try:
            current = command('shell', 'dumpsys', 'input_method').decode(errors='replace')
            if shown(current):
                if not seen.is_set():
                    (OUT / 'shown.log').write_text(current)
                    (OUT / 'shown.png').write_bytes(command('exec-out', 'screencap', '-p'))
                seen.set()
        except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as error:
            (OUT / 'observer-error.log').write_text(type(error).__name__ + '\n')
        stop.wait(.25)


thread = threading.Thread(target=observe, daemon=True)
result = {'imeShownObserved': False, 'settingsRestored': False, 'qualifiedPass': False}
try:
    command('shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '1')
    thread.start()
    run = subprocess.run([sys.executable, str(ROOT / 'infra/verification/android-v1/connected.py'),
                          str(WORK), label, classes, expected, width, height, scale],
                         env={**ENV, 'TODOSNS_VERIFY_IME': '1'}, check=False)
    result['connectedExitCode'] = run.returncode
finally:
    stop.set()
    if thread.ident is not None:
        thread.join(timeout=20)
    if original in ('null', ''):
        command('shell', 'settings', 'delete', 'secure', 'show_ime_with_hard_keyboard')
    else:
        command('shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', original)
    restored = command('shell', 'settings', 'get', 'secure', 'show_ime_with_hard_keyboard').decode().strip()
    result['settingsRestored'] = restored == original
    result['imeShownObserved'] = seen.is_set()
    result['observerStopped'] = not thread.is_alive()
    result['qualifiedPass'] = (result.get('connectedExitCode') == 0 and result['settingsRestored']
                               and result['imeShownObserved'] and result['observerStopped'])
    (OUT / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
sys.exit(0 if result['qualifiedPass'] else 1)
