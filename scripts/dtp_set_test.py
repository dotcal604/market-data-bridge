"""
Test: can we set DTP values AND have TI actually pick them up?

Strategy:
  1. set_time() to write the Win32 control value
  2. Send DTN_DATETIMECHANGE notification to parent via WM_NOTIFY
  3. OR: click field + arrow nudge to force WinForms to read the control

USAGE:
  1. Open "Select History Range" dialog in Trade Ideas
  2. Run: py scripts/dtp_set_test.py 2021-07-15
  3. Check if the dialog visually shows the target date
  4. Click OK manually and see if TI uses the right date range
"""
import ctypes
import ctypes.wintypes
import struct
import sys
import time
from datetime import datetime

try:
    from pywinauto import Application, findwindows
except ImportError:
    print("ERROR: py -m pip install pywinauto")
    sys.exit(1)

# Win32 constants
WM_NOTIFY = 0x004E
DTN_FIRST = -740
DTN_DATETIMECHANGE = DTN_FIRST + 6  # = -734
GDT_VALID = 0
WM_SETFOCUS = 0x0007
WM_KILLFOCUS = 0x0008

SendMessage = ctypes.windll.user32.SendMessageW
PostMessage = ctypes.windll.user32.PostMessageW

class SYSTEMTIME(ctypes.Structure):
    _fields_ = [
        ("wYear", ctypes.wintypes.WORD),
        ("wMonth", ctypes.wintypes.WORD),
        ("wDayOfWeek", ctypes.wintypes.WORD),
        ("wDay", ctypes.wintypes.WORD),
        ("wHour", ctypes.wintypes.WORD),
        ("wMinute", ctypes.wintypes.WORD),
        ("wSecond", ctypes.wintypes.WORD),
        ("wMilliseconds", ctypes.wintypes.WORD),
    ]

class NMHDR(ctypes.Structure):
    _fields_ = [
        ("hwndFrom", ctypes.wintypes.HWND),
        ("idFrom", ctypes.POINTER(ctypes.c_uint)),
        ("code", ctypes.wintypes.UINT),
    ]

class NMDATETIMECHANGE(ctypes.Structure):
    _fields_ = [
        ("nmhdr", NMHDR),
        ("dwFlags", ctypes.wintypes.DWORD),
        ("st", SYSTEMTIME),
    ]


def find_dialog():
    handles = findwindows.find_windows(title="Select History Range")
    if not handles:
        handles = findwindows.find_windows(title_re=".*History.*Range.*")
    if not handles:
        print("Dialog not found!")
        sys.exit(1)
    app = Application(backend="win32").connect(handle=handles[0])
    dlg = app.window(handle=handles[0])
    dtps = [c for c in dlg.children()
            if "date" in c.friendly_class_name().lower()
            or "pick" in c.friendly_class_name().lower()]
    if len(dtps) < 2:
        print(f"Found {len(dtps)} DTPs, need 2")
        sys.exit(1)
    dtps_sorted = sorted(dtps, key=lambda c: c.rectangle().top)
    return dlg, dtps_sorted[1], dtps_sorted[0]  # end (lower), start (upper)


def send_dtn_change(dtp_handle, parent_handle, target_date):
    """Send DTN_DATETIMECHANGE notification to parent."""
    # Build NMDATETIMECHANGE struct
    nmdt = NMDATETIMECHANGE()
    nmdt.nmhdr.hwndFrom = dtp_handle
    nmdt.nmhdr.idFrom = ctypes.cast(
        ctypes.windll.user32.GetDlgCtrlID(dtp_handle),
        ctypes.POINTER(ctypes.c_uint)
    )
    nmdt.nmhdr.code = DTN_DATETIMECHANGE & 0xFFFFFFFF  # unsigned
    nmdt.dwFlags = GDT_VALID
    nmdt.st.wYear = target_date.year
    nmdt.st.wMonth = target_date.month
    nmdt.st.wDay = target_date.day

    # Send WM_NOTIFY to parent
    ptr = ctypes.addressof(nmdt)
    result = SendMessage(parent_handle, WM_NOTIFY,
                         ctypes.windll.user32.GetDlgCtrlID(dtp_handle),
                         ptr)
    return result


def set_date_method_1(dtp, dlg, target_date, label):
    """Method 1: set_time() + DTN_DATETIMECHANGE notification."""
    print(f"\n  [{label}] Method 1: set_time + DTN_DATETIMECHANGE")

    cur = dtp.get_time()
    print(f"    Before: {cur.wDay:02d}-{cur.wMonth:02d}-{cur.wYear}")

    dtp.set_time(year=target_date.year, month=target_date.month, day=target_date.day)
    time.sleep(0.2)

    verify = dtp.get_time()
    print(f"    After set_time: {verify.wDay:02d}-{verify.wMonth:02d}-{verify.wYear}")

    # Send notification
    try:
        result = send_dtn_change(dtp.handle, dlg.handle, target_date)
        print(f"    DTN_DATETIMECHANGE sent, result={result}")
    except Exception as e:
        print(f"    DTN_DATETIMECHANGE failed: {e}")

    time.sleep(0.3)
    verify2 = dtp.get_time()
    print(f"    After notify: {verify2.wDay:02d}-{verify2.wMonth:02d}-{verify2.wYear}")


def set_date_method_2(dtp, dlg, target_date, label):
    """Method 2: set_time() + focus/unfocus cycle to trigger change event."""
    print(f"\n  [{label}] Method 2: set_time + focus cycle")

    cur = dtp.get_time()
    print(f"    Before: {cur.wDay:02d}-{cur.wMonth:02d}-{cur.wYear}")

    dtp.set_time(year=target_date.year, month=target_date.month, day=target_date.day)
    time.sleep(0.2)

    # Focus the control, then unfocus — this sometimes triggers change events
    SendMessage(dtp.handle, WM_SETFOCUS, 0, 0)
    time.sleep(0.1)
    SendMessage(dtp.handle, WM_KILLFOCUS, 0, 0)
    time.sleep(0.3)

    verify = dtp.get_time()
    print(f"    After focus cycle: {verify.wDay:02d}-{verify.wMonth:02d}-{verify.wYear}")


def set_date_method_3(dtp, dlg, target_date, label):
    """Method 3: set_time() + click the control + arrow nudge."""
    import pyautogui

    print(f"\n  [{label}] Method 3: set_time + click + arrow nudge")

    cur = dtp.get_time()
    print(f"    Before: {cur.wDay:02d}-{cur.wMonth:02d}-{cur.wYear}")

    dtp.set_time(year=target_date.year, month=target_date.month, day=target_date.day)
    time.sleep(0.2)

    # Click the DTP to give it focus
    rect = dtp.rectangle()
    cx = (rect.left + rect.right) // 2
    cy = (rect.top + rect.bottom) // 2
    pyautogui.click(cx, cy)
    time.sleep(0.3)

    # Arrow up then down on the day segment (net zero change but triggers event)
    pyautogui.press("home")
    time.sleep(0.1)
    pyautogui.press("up")
    time.sleep(0.1)
    pyautogui.press("down")
    time.sleep(0.3)

    verify = dtp.get_time()
    print(f"    After nudge: {verify.wDay:02d}-{verify.wMonth:02d}-{verify.wYear}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: py scripts/dtp_set_test.py YYYY-MM-DD [method]")
        print("  method: 1 (notify), 2 (focus), 3 (click+nudge), or all (default)")
        sys.exit(1)

    target = datetime.strptime(sys.argv[1], "%Y-%m-%d")
    method = sys.argv[2] if len(sys.argv) > 2 else "all"

    print(f"Target date: {target.strftime('%d-%b-%Y')}")
    print("Finding dialog...")

    dlg, dtp_end, dtp_start = find_dialog()
    print(f"Found dialog! Testing on END (Oldest Trade) DTP...")

    if method in ("1", "all"):
        set_date_method_1(dtp_end, dlg, target, "END")

    if method in ("2", "all"):
        # Re-find in case method 1 changed state
        if method == "all":
            # Reset to original by re-finding
            dlg, dtp_end, dtp_start = find_dialog()
        set_date_method_2(dtp_end, dlg, target, "END")

    if method in ("3", "all"):
        if method == "all":
            dlg, dtp_end, dtp_start = find_dialog()
        set_date_method_3(dtp_end, dlg, target, "END")

    print("\n  CHECK THE DIALOG — does the End date show the target date?")
    print("  If yes, click OK and see if TI actually uses that date range.")
    print("  Look at the data that loads — does it match the target date?")
    input("  Press ENTER when done...")
