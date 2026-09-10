"""Keep Windows awake only for the lifetime of the current book build.

Does not change a power plan or prevent the display from turning off. A process
handle tracks the exact worker even if Windows later reuses its numeric PID.
"""
import ctypes
from ctypes import wintypes
import json
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / 'data'
state = json.loads((DATA / 'book-build-status.json').read_text(encoding='utf-8'))
if state.get('state') != 'running':
    raise SystemExit(0)
kernel = ctypes.WinDLL('kernel32', use_last_error=True)
kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel.OpenProcess.restype = wintypes.HANDLE
kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
kernel.WaitForSingleObject.restype = wintypes.DWORD
kernel.CloseHandle.argtypes = [wintypes.HANDLE]
kernel.SetThreadExecutionState.argtypes = [wintypes.DWORD]
kernel.SetThreadExecutionState.restype = wintypes.DWORD
handle = kernel.OpenProcess(0x100000, False, state['pid'])
if not handle:
    raise SystemExit('The book build is no longer running.')
try:
    if not kernel.SetThreadExecutionState(0x80000001):
        raise OSError(ctypes.get_last_error(), 'Cannot keep Windows awake')
    (DATA / 'book-awake-status.json').write_text(json.dumps({'state':'active','buildPid':state['pid']}), encoding='utf-8')
    while kernel.WaitForSingleObject(handle, 30000) == 258:
        pass
finally:
    kernel.SetThreadExecutionState(0x80000000)
    kernel.CloseHandle(handle)
    (DATA / 'book-awake-status.json').write_text(json.dumps({'state':'released','buildPid':state['pid']}), encoding='utf-8')
