"""One qualified Compose run on the explicitly labelled disposable Docker emulator.

Usage: connected.py WORK LABEL CLASS EXPECTED_TESTS WIDTH HEIGHT FONT_SCALE
Build/install matching APKs first. Shell exit zero alone is never a pass. OS ANR
evidence and an end-of-run screenshot are retained; images still need human review.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
work_arg, label, classes, expected, width, height, scale = sys.argv[1:]
WORK = Path(work_arg).resolve()
assert WORK.is_relative_to(Path('/workspace')) or WORK.is_relative_to(Path('/tmp'))
assert not WORK.is_relative_to(ROOT)
assert re.fullmatch(r'[a-z0-9-]+', label)
assert int(expected) > 0 and int(width) >= 320 and int(height) >= 360
assert float(scale) in (1.0, 2.0)
container = (WORK / 'android-container-id').read_text().strip()
ENV = {k: v for k, v in os.environ.items() if k not in (
    'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')}
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
info = json.loads(subprocess.check_output(DOCKER + ['inspect', container], env=ENV))[0]
assert info['Id'] == container and info['Config']['Labels'].get('todosns.verification') == 'final-m11'
ADB = DOCKER + ['exec', container, '/workspace/tooling/todosns/android-sdk/platform-tools/adb', '-s', 'emulator-5554']
OUT = WORK / label
OUT.mkdir(parents=True, exist_ok=True)


def adb(*args, timeout=45):
    return subprocess.check_output(ADB + list(args), env=ENV, timeout=timeout)


def evidence(phase):
    windows = adb('shell', 'dumpsys', 'window', 'windows').decode(errors='replace')
    events = adb('logcat', '-b', 'events', '-d', '-s', 'am_anr').decode(errors='replace')
    (OUT / (phase + '-windows.log')).write_text(windows)
    (OUT / (phase + '-anr.log')).write_text(events)
    (OUT / (phase + '.png')).write_bytes(adb('exec-out', 'screencap', '-p'))
    return bool(re.search(r'Application (?:Not Responding|Error)|mCurrentFocus=.*(?:Not Responding|Error)', windows, re.I)
                or re.search(r'\bam_anr\s*:', events))


assert adb('shell', 'getprop', 'sys.boot_completed').strip() == b'1', 'Emulator has not finished booting'
result = {'label': label, 'classes': classes, 'expected': int(expected),
          'width': int(width), 'height': int(height), 'fontScale': float(scale),
          'functionalPass': False, 'qualifiedPass': False, 'visualReview': 'pending'}
try:
    if evidence('before'):
        result['blocked'] = 'OS ANR observed; instrumentation not started'
    else:
        adb('shell', 'wm', 'density', '160')
        adb('shell', 'wm', 'size', width + 'x' + height)
        adb('shell', 'settings', 'put', 'system', 'font_scale', scale)
        adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
        adb('shell', 'wm', 'dismiss-keyguard')
        extra = ['-e', 'm06RealApi', '1'] if classes == 'kr.kro.mungsil.HistoryRealApiTest' else []
        if ENV.get('TODOSNS_VERIFY_IME') == '1':
            extra += ['-e', 'requireIme', 'true']
            result['imeAssertionRequested'] = True
        with (OUT / 'instrumentation.log').open('wb') as log:
            subprocess.run(ADB + ['shell', 'am', 'instrument', '-w', '-r', '-e', 'class', classes,
                           '-e', 'screenshotLabel', label, *extra,
                           'kr.kro.mungsil.test/androidx.test.runner.AndroidJUnitRunner'], env=ENV,
                           stdout=log, stderr=subprocess.STDOUT, timeout=1200, check=True)
        output = (OUT / 'instrumentation.log').read_text(errors='replace')
        succeeded = len(re.findall(r'^INSTRUMENTATION_STATUS_CODE: 0\s*$', output, re.M))
        failed = bool(re.search(r'FAILURES|INSTRUMENTATION_FAILED|Process crashed|shortMsg=|INSTRUMENTATION_STATUS_CODE: -[1-9]', output))
        result['succeeded'] = succeeded
        result['functionalPass'] = (succeeded == int(expected) and not failed
            and bool(re.search(r'OK \(' + expected + r' tests?\)', output))
            and bool(re.search(r'^INSTRUMENTATION_CODE: -1\s*$', output, re.M)))
        result['osAnr'] = evidence('after')
        result['qualifiedPass'] = result['functionalPass'] and not result['osAnr']
except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as error:
    result['blocked'] = type(error).__name__
    raise
finally:
    (OUT / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
sys.exit(0 if result['qualifiedPass'] else 1)
