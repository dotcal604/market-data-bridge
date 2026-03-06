"""
Test: verify segment clicking coordinates on both DTPs.

Clicks each segment (day, month, year) on both Start and End DTPs,
reads back after each arrow press to confirm which segment has focus.

USAGE:
  1. Open "Select History Range" dialog
  2. Run: py scripts/dtp_click_test.py
"""
import sys
import time

try:
    from pywinauto import Application, findwindows
    import pyautogui
    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0.15
except ImportError as e:
    print(f"Missing: {e}")
    sys.exit(1)


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
    return dlg, dtps_sorted[1], dtps_sorted[0]  # end, start


def test_dtp_clicks(dtp, label):
    """Click each segment and arrow up once to see which segment responds."""
    rect = dtp.rectangle()
    dtp_left = rect.left
    dtp_right = rect.right
    dtp_cy = (rect.top + rect.bottom) // 2
    dtp_width = dtp_right - dtp_left

    print(f"\n{'='*60}")
    print(f"  {label} DTP")
    print(f"  rect: left={dtp_left} right={dtp_right} top={rect.top} bottom={rect.bottom}")
    print(f"  width={dtp_width}  center_y={dtp_cy}")
    print(f"{'='*60}")

    # Read initial state
    t = dtp.get_time()
    initial = f"{t.wDay:02d}-{t.wMonth:02d}-{t.wYear}"
    print(f"  Initial: {initial}")

    # Test different X positions for day click
    for pct in [0.05, 0.10, 0.15, 0.20]:
        click_x = dtp_left + int(dtp_width * pct)

        # Read before
        t = dtp.get_time()
        before = (t.wDay, t.wMonth, t.wYear)

        # Click and arrow up
        pyautogui.click(click_x, dtp_cy)
        time.sleep(0.3)
        pyautogui.press("up")
        time.sleep(0.3)

        # Read after
        t = dtp.get_time()
        after = (t.wDay, t.wMonth, t.wYear)

        # Which changed?
        changed = []
        if after[0] != before[0]:
            changed.append(f"DAY {before[0]}→{after[0]}")
        if after[1] != before[1]:
            changed.append(f"MONTH {before[1]}→{after[1]}")
        if after[2] != before[2]:
            changed.append(f"YEAR {before[2]}→{after[2]}")

        change_str = ", ".join(changed) if changed else "NOTHING"
        print(f"  click@{pct:.0%} (x={click_x}): {change_str}")

        # Undo the arrow
        pyautogui.press("down")
        time.sleep(0.2)

    # Test month positions
    for pct in [0.30, 0.40, 0.50]:
        click_x = dtp_left + int(dtp_width * pct)
        t = dtp.get_time()
        before = (t.wDay, t.wMonth, t.wYear)
        pyautogui.click(click_x, dtp_cy)
        time.sleep(0.3)
        pyautogui.press("up")
        time.sleep(0.3)
        t = dtp.get_time()
        after = (t.wDay, t.wMonth, t.wYear)
        changed = []
        if after[0] != before[0]: changed.append(f"DAY {before[0]}→{after[0]}")
        if after[1] != before[1]: changed.append(f"MONTH {before[1]}→{after[1]}")
        if after[2] != before[2]: changed.append(f"YEAR {before[2]}→{after[2]}")
        change_str = ", ".join(changed) if changed else "NOTHING"
        print(f"  click@{pct:.0%} (x={click_x}): {change_str}")
        pyautogui.press("down")
        time.sleep(0.2)

    # Test year positions
    for pct in [0.70, 0.78, 0.85, 0.92]:
        click_x = dtp_left + int(dtp_width * pct)
        t = dtp.get_time()
        before = (t.wDay, t.wMonth, t.wYear)
        pyautogui.click(click_x, dtp_cy)
        time.sleep(0.3)
        pyautogui.press("up")
        time.sleep(0.3)
        t = dtp.get_time()
        after = (t.wDay, t.wMonth, t.wYear)
        changed = []
        if after[0] != before[0]: changed.append(f"DAY {before[0]}→{after[0]}")
        if after[1] != before[1]: changed.append(f"MONTH {before[1]}→{after[1]}")
        if after[2] != before[2]: changed.append(f"YEAR {before[2]}→{after[2]}")
        change_str = ", ".join(changed) if changed else "NOTHING"
        print(f"  click@{pct:.0%} (x={click_x}): {change_str}")
        pyautogui.press("down")
        time.sleep(0.2)

    # Also test: what does pyautogui think the mouse position is vs pywinauto rect?
    print(f"\n  pyautogui.position() check:")
    pyautogui.moveTo(dtp_left, dtp_cy)
    time.sleep(0.1)
    mx, my = pyautogui.position()
    print(f"    moveTo({dtp_left}, {dtp_cy}) → position()=({mx}, {my})"
          f"  offset=({mx - dtp_left}, {my - dtp_cy})")


if __name__ == "__main__":
    print("Finding dialog...")
    dlg, dtp_end, dtp_start = find_dialog()

    print("\nYou have 3 seconds — keep mouse away from dialog...")
    time.sleep(3)

    test_dtp_clicks(dtp_end, "END (Oldest Trade)")
    test_dtp_clicks(dtp_start, "START (Most Recent Trade)")

    print("\nDone! Check which percentages hit which segments.")
    print("If there's a coordinate offset, the pyautogui.position() check will show it.")
