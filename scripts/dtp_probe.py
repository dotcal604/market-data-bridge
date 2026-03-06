"""
Quick probe: can pywinauto find and read TI's date picker controls?

USAGE:
  1. Open the "Select History Range" dialog in Trade Ideas
  2. Run: py scripts/dtp_probe.py
"""
import sys

try:
    from pywinauto import Application, findwindows
except ImportError:
    print("ERROR: pywinauto not installed.")
    print("  py -m pip install pywinauto")
    sys.exit(1)

print("Searching for 'Select History Range' dialog...")

# Try to find the dialog window
try:
    handles = findwindows.find_windows(title="Select History Range")
except Exception as e:
    handles = []

if not handles:
    # Try partial match
    try:
        handles = findwindows.find_windows(title_re=".*History.*Range.*")
    except Exception:
        pass

if not handles:
    # List all visible windows to help debug
    print("\nDialog not found! Listing all visible windows with 'Trade' or 'History' in title:\n")
    try:
        all_wins = findwindows.find_windows()
        from pywinauto import Desktop
        desktop = Desktop(backend="win32")
        for w in desktop.windows():
            title = w.window_text()
            if title and ("trade" in title.lower() or "history" in title.lower()
                         or "select" in title.lower() or "holly" in title.lower()):
                print(f"  HWND={w.handle}  class='{w.friendly_class_name()}'  title='{title}'")
    except Exception as e2:
        print(f"  Error listing windows: {e2}")
    print("\nMake sure the 'Select History Range' dialog is open in Trade Ideas.")
    sys.exit(1)

print(f"Found dialog! HWND={handles[0]}")

# Connect to it
app = Application(backend="win32").connect(handle=handles[0])
dlg = app.window(handle=handles[0])

print(f"Dialog title: '{dlg.window_text()}'")
print(f"\nAll child controls:")
print("-" * 70)

for ctrl in dlg.children():
    cls = ctrl.friendly_class_name()
    txt = ctrl.window_text()
    rect = ctrl.rectangle()
    print(f"  class='{cls}'  text='{txt}'  rect={rect}")

# Specifically look for DateTimePicker controls
print("\n" + "=" * 70)
print("Looking for DateTimePicker (SysDateTimePick32) controls...")
print("=" * 70)

dtps = dlg.children(class_name="SysDateTimePick32")
if not dtps:
    # Try broader search
    dtps = [c for c in dlg.children() if "date" in c.friendly_class_name().lower()
            or "time" in c.friendly_class_name().lower()
            or "pick" in c.friendly_class_name().lower()]

if dtps:
    for i, dtp in enumerate(dtps):
        print(f"\n  DTP #{i}: class='{dtp.friendly_class_name()}'")
        rect = dtp.rectangle()
        print(f"    Position: ({rect.left}, {rect.top}) - ({rect.right}, {rect.bottom})")
        try:
            # Try to read the current date/time
            dt = dtp.get_time()
            print(f"    Current value: {dt}")
            print(f"    ✓ CAN READ DATE!")
        except Exception as e:
            print(f"    get_time() failed: {e}")
        try:
            print(f"    Text: '{dtp.window_text()}'")
        except Exception:
            pass
else:
    print("\n  No DateTimePicker controls found!")
    print("  The date picker might be a custom Java control, not a native Windows one.")

print("\nDone.")
