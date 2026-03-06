#!/usr/bin/env python3
"""
Holly AI Trade Export Bot  (v2 — Copy-Paste Workflow)
=====================================================
Automates the 90-day-limited export from Trade Ideas' Holly Trades window.

HOW IT WORKS:
  Trade Ideas has NO CSV export button. The actual workflow is:
  1. Right-click on grid → "History: All" → "Time Frame..."
  2. "Select History Range" dialog opens with date pickers
  3. Set Start/End dates → click OK
  4. Data loads in the grid
  5. Ctrl+A (select all) → Ctrl+C (copy to clipboard)
  6. Script reads clipboard (tab-separated text) → writes to CSV

  This script automates that loop in 90-day chunks, merges everything,
  and deduplicates by (symbol, entry_time, strategy).

PREREQUISITES:
  py -m pip install pyautogui pyperclip Pillow

USAGE:
  # First run — calibrate click coordinates
  py holly-export-bot.py --calibrate

  # Export all Holly history
  py holly-export-bot.py --start 2020-03-01 --end 2025-12-31

  # Just merge existing CSVs
  py holly-export-bot.py --merge-only --csv-dir ./holly_exports

  # Resume interrupted export (reads progress file automatically)
  py holly-export-bot.py --start 2020-03-01 --end 2025-12-31

NOTES:
  - Trade Ideas must be open with the "Strategy Trades (All)" window visible
  - Don't touch the mouse/keyboard while it's running
  - Move mouse to TOP-LEFT CORNER or press Ctrl+C to abort safely
  - Progress is saved after each chunk — you can resume anytime
"""

import argparse
import csv
import hashlib
import io
import json
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Optional imports — only needed for GUI automation (not --merge-only)
# ---------------------------------------------------------------------------
AUTOMATION_AVAILABLE = False
PYWINAUTO_AVAILABLE = False
try:
    import pyautogui
    import pyperclip
    pyautogui.FAILSAFE = True   # move mouse to top-left corner to abort
    pyautogui.PAUSE = 0.25      # default pause between actions
    AUTOMATION_AVAILABLE = True
except Exception as _import_err:
    print(f"WARNING: Could not import pyautogui/pyperclip: {_import_err}")

try:
    from pywinauto import Application, findwindows
    PYWINAUTO_AVAILABLE = True
except ImportError:
    print("WARNING: pywinauto not installed — date setting will not work.")
    print("  py -m pip install pywinauto")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CHUNK_DAYS = 7               # TI grid caps at 500 rows, weekly chunks stay under
GRID_LOAD_WAIT = 3           # seconds to wait for grid data to load after OK
MENU_OPEN_WAIT = 0.6         # seconds to wait for context menu to appear
DIALOG_WAIT = 1.0            # seconds to wait for date dialog to open
TYPING_INTERVAL = 0.03       # seconds between keystrokes
DEFAULT_CSV_DIR = Path("./holly_exports")
MERGED_OUTPUT = "holly_trades_merged.csv"
PROGRESS_FILE = "holly_export_progress.json"
CALIBRATION_FILE = "holly_calibration.json"

# Default calibration — all zeros means "not calibrated"
DEFAULT_CALIBRATION = {
    # Where to right-click to trigger the context menu
    "grid_x": 0,
    "grid_y": 0,
    # "History: All" menu item position (after right-click)
    "history_all_x": 0,
    "history_all_y": 0,
    # "Time Frame..." submenu item position
    "time_frame_x": 0,
    "time_frame_y": 0,
    # "Select History Range" dialog elements:
    # Start date — the custom date radio button
    "start_custom_radio_x": 0,
    "start_custom_radio_y": 0,
    # Start date — the date input field
    "start_date_field_x": 0,
    "start_date_field_y": 0,
    # End date — the custom date radio button
    "end_custom_radio_x": 0,
    "end_custom_radio_y": 0,
    # End date — the date input field
    "end_date_field_x": 0,
    "end_date_field_y": 0,
    # OK button in the dialog
    "ok_btn_x": 0,
    "ok_btn_y": 0,
}


# ═══════════════════════════════════════════════════════════════════════════
# CALIBRATION
# ═══════════════════════════════════════════════════════════════════════════

def load_calibration(script_dir: Path) -> dict:
    """Load saved calibration or return defaults."""
    cal_path = script_dir / CALIBRATION_FILE
    if cal_path.exists():
        with open(cal_path) as f:
            saved = json.load(f)
            return {**DEFAULT_CALIBRATION, **saved}
    return dict(DEFAULT_CALIBRATION)


def save_calibration(cal: dict, script_dir: Path):
    cal_path = script_dir / CALIBRATION_FILE
    with open(cal_path, "w") as f:
        json.dump(cal, f, indent=2)
    print(f"\n[OK] Calibration saved to {cal_path}")


def capture_point(label: str) -> tuple[int, int]:
    """Ask user to hover and press Enter, return (x, y)."""
    print(f"\n  → Hover your mouse over: {label}")
    input("    Then press ENTER...")
    x, y = pyautogui.position()
    print(f"    Captured: ({x}, {y})")
    return x, y


def capture_timed(label: str, seconds: int = 5) -> tuple[int, int]:
    """
    Countdown capture — grabs mouse position after N seconds.
    Lets you keep focus on Trade Ideas (no need to click the terminal).
    """
    print(f"\n  → Hover your mouse over: {label}")
    print(f"    Capturing in...", end="", flush=True)
    for i in range(seconds, 0, -1):
        print(f" {i}", end="", flush=True)
        time.sleep(1)
    x, y = pyautogui.position()
    print(f"  ✓ Captured: ({x}, {y})")
    return x, y


def run_calibration(script_dir: Path):
    """
    Interactive calibration — walks through each UI element the bot needs.

    For context menu items: uses TIMED COUNTDOWN capture so you never
    have to switch focus away from Trade Ideas (which would dismiss the menu).

    For date dialog items: uses Enter-based capture (dialog doesn't dismiss
    when you click the terminal).
    """
    if not AUTOMATION_AVAILABLE:
        print("ERROR: pyautogui is required for calibration.")
        print("  py -m pip install pyautogui pyperclip Pillow")
        sys.exit(1)

    cal = load_calibration(script_dir)

    print("=" * 65)
    print("  HOLLY EXPORT BOT — CALIBRATION WIZARD (v2)")
    print("=" * 65)
    print()
    print("  We'll capture click coordinates for each UI element.")
    print("  Make sure Trade Ideas is open with the Holly Trades grid visible.")
    print()
    print("  For MENU ITEMS: We use a countdown timer so you don't")
    print("  have to switch back to this window (which kills the menu).")
    print("  Just hover and wait for the countdown to finish.")
    print()
    print("  For DIALOG items: You'll press Enter normally.")
    print()
    input("  Press ENTER when ready to start...")

    # ── STEP 1: Grid position (Enter-based, menu isn't open yet) ─────
    print("\n" + "─" * 50)
    print("  STEP 1: GRID POSITION")
    print("─" * 50)

    x, y = capture_point("anywhere in the Holly trades GRID (data area)")
    cal["grid_x"] = x
    cal["grid_y"] = y

    # ── STEP 2: Context menu (ONE continuous timed sequence) ──────────
    print("\n" + "─" * 50)
    print("  STEP 2: RIGHT-CLICK CONTEXT MENU")
    print("─" * 50)
    print()
    print("  This is ONE continuous timed sequence. No Enter presses.")
    print("  Once you press Enter below, you'll have:")
    print()
    print("    15 sec → switch to TI, right-click grid,")
    print("             hover over 'History: All'")
    print("    *capture*")
    print("    10 sec → hover 'History: All' to expand submenu,")
    print("             then hover 'Time Frame...'")
    print("    *capture*")
    print("    10 sec → click 'Time Frame...' to open the dialog,")
    print("             then come back to this window")
    print()
    input("  Press ENTER to start the sequence, then switch to Trade Ideas!")

    # Phase 1: capture "History: All"
    print()
    print("  ── PHASE 1: Right-click grid, hover 'History: All' ──")
    x, y = capture_timed(
        "'History: All' in the context menu",
        seconds=15)
    cal["history_all_x"] = x
    cal["history_all_y"] = y

    # Phase 2: capture "Time Frame..."
    print()
    print("  ── PHASE 2: Hover 'History: All' → submenu → 'Time Frame...' ──")
    x, y = capture_timed(
        "'Time Frame...' in the submenu",
        seconds=10)
    cal["time_frame_x"] = x
    cal["time_frame_y"] = y

    # Phase 3: user clicks Time Frame, dialog opens, comes back here
    print()
    print("  ── PHASE 3: Click 'Time Frame...' now to open the dialog ──")
    print("  Then come back to this window.")
    print()
    print("  Waiting for you...", end="", flush=True)
    for i in range(15, 0, -1):
        print(f" {i}", end="", flush=True)
        time.sleep(1)
    print()
    print()
    print("  If the dialog is open, press Enter to continue.")
    print("  If you need more time, open it now, then press Enter.")
    input("  Press ENTER when the 'Select History Range' dialog is open...")

    # ── STEP 4: Date dialog (Enter-based — dialog stays open) ────────
    print("\n" + "─" * 50)
    print("  STEP 4: SELECT HISTORY RANGE DIALOG")
    print("─" * 50)
    print()
    print("  The dialog stays open when you switch windows,")
    print("  so you can hover and press Enter normally here.")

    # Start date section
    x, y = capture_point("the CUSTOM DATE radio button for START\n"
                         "    (the radio next to the date field, NOT 'Today')")
    cal["start_custom_radio_x"] = x
    cal["start_custom_radio_y"] = y

    x, y = capture_point("the START DATE input field (where the date text is)")
    cal["start_date_field_x"] = x
    cal["start_date_field_y"] = y

    # End date section
    x, y = capture_point("the CUSTOM DATE radio button for END\n"
                         "    (the radio next to the date field, NOT 'This morning')")
    cal["end_custom_radio_x"] = x
    cal["end_custom_radio_y"] = y

    x, y = capture_point("the END DATE input field (where the date text is)")
    cal["end_date_field_x"] = x
    cal["end_date_field_y"] = y

    # OK button
    x, y = capture_point("the OK button")
    cal["ok_btn_x"] = x
    cal["ok_btn_y"] = y

    # Format is always DD-Mon-YYYY based on TI dialog
    cal["segment_order"] = "dmy"
    print("\n  Date format detected: DD-Mon-YYYY (e.g. 08-Nov-2022)")

    # ── STEP 5: Verify pywinauto can see the dialog ──────────────────
    print("\n" + "─" * 50)
    print("  STEP 5: VERIFY pywinauto ACCESS")
    print("─" * 50)
    print()
    if PYWINAUTO_AVAILABLE:
        try:
            dlg, dtp_end, dtp_start = _find_date_dialog()
            start_val = dtp_start.get_time()
            end_val = dtp_end.get_time()
            print(f"  ✓ pywinauto found dialog!")
            print(f"    Start DTP reads: {start_val.wDay:02d}-{start_val.wMonth:02d}-{start_val.wYear}")
            print(f"    End DTP reads:   {end_val.wDay:02d}-{end_val.wMonth:02d}-{end_val.wYear}")
            print(f"    Date setting will use direct Win32 API — no arrow keys needed.")
        except Exception as e:
            print(f"  ⚠ pywinauto could not find dialog: {e}")
            print(f"    Make sure the 'Select History Range' dialog is open.")
            print(f"    Date setting may not work without pywinauto.")
    else:
        print("  ⚠ pywinauto not installed — date setting will not work.")
        print("    py -m pip install pywinauto")
    print()

    # ── Save ──────────────────────────────────────────────────────────
    save_calibration(cal, script_dir)

    print("\n" + "=" * 65)
    print("  CALIBRATION COMPLETE!")
    print("=" * 65)
    print()
    print("  You can close the date dialog now.")
    print("  To export, run:")
    print(f"    py {sys.argv[0]} --start 2020-03-01 --end 2025-12-31")
    print()


# ═══════════════════════════════════════════════════════════════════════════
# GUI AUTOMATION — COPY-PASTE WORKFLOW
# ═══════════════════════════════════════════════════════════════════════════

def open_date_dialog(cal: dict):
    """
    Right-click grid → 'History: All' → 'Time Frame...'
    Opens the 'Select History Range' dialog.
    """
    # Right-click on the grid
    pyautogui.click(cal["grid_x"], cal["grid_y"], button="right")
    time.sleep(1.0)

    # Hover over "History: All" — hover first, wait for submenu to expand
    pyautogui.moveTo(cal["history_all_x"], cal["history_all_y"])
    time.sleep(1.0)

    # Hover over "Time Frame..." first, THEN click (avoids misclick)
    pyautogui.moveTo(cal["time_frame_x"], cal["time_frame_y"])
    time.sleep(0.5)
    pyautogui.click()
    time.sleep(DIALOG_WAIT)


DEBUG_SCREENSHOTS = False  # set via --debug flag
_screenshot_counter = 0

def _debug_screenshot(label: str):
    """Capture a screenshot if debug mode is on."""
    global _screenshot_counter
    if not DEBUG_SCREENSHOTS:
        return
    _screenshot_counter += 1
    debug_dir = Path(__file__).parent / "debug_screenshots"
    debug_dir.mkdir(exist_ok=True)
    fname = f"{_screenshot_counter:03d}_{label}.png"
    path = debug_dir / fname
    pyautogui.screenshot(str(path))
    print(f"        📸 {fname}")


def _find_date_dialog():
    """
    Find TI's 'Select History Range' dialog via pywinauto.
    Returns (dlg, dtp_end, dtp_start) or raises RuntimeError.

    DTP #0 (lower y) = End (Oldest Trade)
    DTP #1 (upper y) = Start (Most Recent Trade)
    """
    if not PYWINAUTO_AVAILABLE:
        raise RuntimeError("pywinauto not installed — cannot access date controls")

    handles = findwindows.find_windows(title="Select History Range")
    if not handles:
        handles = findwindows.find_windows(title_re=".*History.*Range.*")
    if not handles:
        raise RuntimeError("'Select History Range' dialog not found — is it open?")

    app = Application(backend="win32").connect(handle=handles[0])
    dlg = app.window(handle=handles[0])

    # Find DateTimePicker controls
    dtps = dlg.children(class_name="SysDateTimePick32")
    if not dtps:
        # TI uses WinForms DateTimePicker — try broader match
        dtps = [c for c in dlg.children()
                if "date" in c.friendly_class_name().lower()
                or "pick" in c.friendly_class_name().lower()]
    if len(dtps) < 2:
        raise RuntimeError(f"Expected 2 DateTimePicker controls, found {len(dtps)}")

    # Sort by Y position: lower Y = higher on screen = Start (Most Recent)
    dtps_sorted = sorted(dtps, key=lambda c: c.rectangle().top)
    dtp_start = dtps_sorted[0]  # higher on screen = Start (Most Recent Trade)
    dtp_end = dtps_sorted[1]    # lower on screen = End (Oldest Trade)

    return dlg, dtp_end, dtp_start


def _arrow_set(segment_name: str, current: int, target: int):
    """Press UP/DOWN arrows to move from current to target value."""
    delta = target - current
    if delta == 0:
        print(f"        [{segment_name}] no change ({current})")
        return
    direction = "up" if delta > 0 else "down"
    presses = abs(delta)
    print(f"        [{segment_name}] {direction} × {presses} ({current} → {target})")
    for _ in range(presses):
        pyautogui.press(direction)
        time.sleep(0.04)


def set_date_in_dialog(radio_x: int, radio_y: int,
                        field_x: int, field_y: int,
                        target_date: datetime, cal: dict,
                        field_id: str = "start"):
    """
    Set a date in Trade Ideas' DateTimePicker.

    HYBRID approach:
      - READ current date via pywinauto (accurate, no calibration needed)
      - WRITE via arrow keys (the only method TI's WinForms actually picks up)

    Order: Year → Month → Day (right-to-left via Home→Right→Right).
    Year first so month changes don't get clamped by short months.
    """
    target_day = target_date.day
    target_month = target_date.month
    target_year = target_date.year

    print(f"      → target: {target_day:02d}-{target_month:02d}-{target_year}"
          f"  (field={field_id})")

    # 1. Click the custom date radio button
    pyautogui.click(radio_x, radio_y)
    time.sleep(0.5)

    # 2. Read current date from DTP via pywinauto (the key insight!)
    cur_day, cur_month, cur_year = target_day, target_month, target_year
    try:
        dlg, dtp_end, dtp_start = _find_date_dialog()
        dtp = dtp_start if field_id == "start" else dtp_end
        current = dtp.get_time()
        cur_day = current.wDay
        cur_month = current.wMonth
        cur_year = current.wYear
        print(f"        current: {cur_day:02d}-{cur_month:02d}-{cur_year}"
              f"  (read via pywinauto)")
    except Exception as e:
        print(f"        ⚠ pywinauto read failed: {e} — skipping arrows")
        return

    day_delta = target_day - cur_day
    month_delta = target_month - cur_month
    year_delta = target_year - cur_year

    print(f"        Δday={day_delta:+d} Δmon={month_delta:+d} Δyr={year_delta:+d}")

    # If already correct, skip
    if day_delta == 0 and month_delta == 0 and year_delta == 0:
        print(f"        ✓ already correct, no arrows needed")
        return

    # Get DTP rectangle for precise segment clicking
    rect = dtp.rectangle()
    dtp_left = rect.left
    dtp_right = rect.right
    dtp_cy = (rect.top + rect.bottom) // 2
    dtp_width = dtp_right - dtp_left

    # DD-Mon-YYYY layout (verified via dtp_click_test.py):
    #   day=5-15%, month=20-30%, year=40-50%, calendar button=60%+
    day_click_x = dtp_left + int(dtp_width * 0.10)
    month_click_x = dtp_left + int(dtp_width * 0.25)
    year_click_x = dtp_left + int(dtp_width * 0.45)

    print(f"        DTP rect: ({dtp_left},{rect.top})-({dtp_right},{rect.bottom})"
          f"  clicks: day@{day_click_x} month@{month_click_x} year@{year_click_x}")

    # Retry loop — sometimes arrows miss a segment on first attempt
    MAX_ATTEMPTS = 3
    for attempt in range(1, MAX_ATTEMPTS + 1):
        if attempt > 1:
            # Re-read current state for retry
            try:
                current = dtp.get_time()
                cur_day = current.wDay
                cur_month = current.wMonth
                cur_year = current.wYear
                print(f"        retry {attempt}: current={cur_day:02d}-{cur_month:02d}-{cur_year}")
            except Exception:
                pass

            if (cur_day == target_day and cur_month == target_month
                    and cur_year == target_year):
                print(f"        ✓ correct on re-read")
                return

        # 3. Click YEAR segment directly on the DTP control
        pyautogui.click(year_click_x, dtp_cy)
        time.sleep(0.35)

        _debug_screenshot(f"{field_id}_at_year_a{attempt}")

        # 4. Set YEAR (only if needed)
        if cur_year != target_year:
            _arrow_set("year", cur_year, target_year)
        else:
            print(f"        [year] no change ({cur_year})")
        time.sleep(0.2)

        # 5. Click MONTH segment directly
        pyautogui.click(month_click_x, dtp_cy)
        time.sleep(0.35)

        # 6. Set MONTH (only if needed)
        if cur_month != target_month:
            _arrow_set("month", cur_month, target_month)
        else:
            print(f"        [month] no change ({cur_month})")
        time.sleep(0.2)

        # 7. Click DAY segment directly
        pyautogui.click(day_click_x, dtp_cy)
        time.sleep(0.35)

        # 8. Set DAY (only if needed)
        if cur_day != target_day:
            _arrow_set("day", cur_day, target_day)
        else:
            print(f"        [day] no change ({cur_day})")
        time.sleep(0.3)

        _debug_screenshot(f"{field_id}_after_arrows_a{attempt}")

        # 9. Verify via pywinauto read-back
        try:
            verify = dtp.get_time()
            actual = f"{verify.wDay:02d}-{verify.wMonth:02d}-{verify.wYear}"
            expected = f"{target_day:02d}-{target_month:02d}-{target_year}"
            if actual == expected:
                print(f"        ✓ VERIFIED: {actual}")
                return  # success!
            else:
                print(f"        ⚠ MISMATCH: expected {expected}, got {actual}")
                # Update cur values for next retry
                cur_day = verify.wDay
                cur_month = verify.wMonth
                cur_year = verify.wYear
        except Exception:
            pass

    print(f"        ✗ FAILED after {MAX_ATTEMPTS} attempts")


def copy_grid_to_clipboard(cal: dict, scroll_first: bool = True):
    """
    Click on grid, select all data, copy to clipboard.

    Trade Ideas grids may only copy visible rows with Ctrl+A/Ctrl+C.
    Strategy: click first row, then Ctrl+Shift+End to select to bottom,
    then Ctrl+C. If that doesn't work, fall back to Ctrl+A.

    Returns the clipboard contents (tab-separated text).
    """
    # Clear clipboard first so we can detect if copy worked
    try:
        pyperclip.copy("")
    except Exception:
        pass

    # Click grid to make sure it has focus
    pyautogui.click(cal["grid_x"], cal["grid_y"])
    time.sleep(0.3)

    if scroll_first:
        # Try to go to top first: Ctrl+Home
        pyautogui.hotkey("ctrl", "Home")
        time.sleep(0.3)

    # Method 1: Ctrl+A then Ctrl+C (works in some Java/TI grids)
    pyautogui.hotkey("ctrl", "a")
    time.sleep(0.4)
    pyautogui.hotkey("ctrl", "c")
    time.sleep(0.8)

    clipboard = ""
    try:
        clipboard = pyperclip.paste()
    except Exception as e:
        print(f"    WARNING: Clipboard read failed: {e}")
        return ""

    # Count rows to see if we got a reasonable amount
    if clipboard and clipboard.strip():
        lines = clipboard.strip().split("\n")
        row_count = len(lines) - 1  # minus header
        if row_count > 0:
            print(f"    Clipboard: {row_count} rows captured")
            return clipboard

    # Method 2: If Ctrl+A got nothing useful, try click first cell
    # then Ctrl+Shift+End to select to the last cell
    print("    Ctrl+A didn't grab data, trying Ctrl+Shift+End method...")
    pyautogui.click(cal["grid_x"], cal["grid_y"])
    time.sleep(0.2)
    pyautogui.hotkey("ctrl", "Home")
    time.sleep(0.3)
    pyautogui.hotkey("ctrl", "shift", "End")
    time.sleep(0.5)
    pyautogui.hotkey("ctrl", "c")
    time.sleep(0.8)

    try:
        clipboard = pyperclip.paste()
    except Exception:
        pass

    if clipboard and clipboard.strip():
        lines = clipboard.strip().split("\n")
        print(f"    Clipboard (method 2): {len(lines) - 1} rows captured")

    return clipboard


def clipboard_to_csv(clipboard_text: str, output_path: Path) -> int:
    """
    Convert tab-separated clipboard text to a proper CSV file.
    Returns number of data rows written.
    """
    if not clipboard_text or not clipboard_text.strip():
        return 0

    lines = clipboard_text.strip().split("\n")
    if len(lines) < 2:
        return 0

    # Parse tab-separated data
    rows = []
    for line in lines:
        # Split on tab
        fields = line.split("\t")
        rows.append([f.strip() for f in fields])

    # First row is headers
    headers = rows[0]
    data_rows = rows[1:]

    if not data_rows:
        return 0

    # Write CSV
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(data_rows)

    return len(data_rows)


def export_chunk(cal: dict, start_date: datetime, end_date: datetime,
                 output_path: Path, grid_wait: float = GRID_LOAD_WAIT) -> bool:
    """
    Automate one weekly export cycle:
      1. Open date dialog (right-click → History: All → Time Frame...)
      2. Set start & end dates via segmented date picker
      3. Click OK, wait for data
      4. Ctrl+A, Ctrl+C → clipboard → CSV file
    Returns True on success.
    """
    print(f"    Date range: {start_date.strftime('%Y-%m-%d')} → {end_date.strftime('%Y-%m-%d')}")

    # 0. Click grid first to ensure it has focus and no stale dialogs
    pyautogui.click(cal["grid_x"], cal["grid_y"])
    time.sleep(0.5)

    # 1. Open the "Select History Range" dialog
    print("    Opening date dialog...")
    open_date_dialog(cal)

    # 2. Set dates via segmented picker
    # NOTE: Trade Ideas' dialog is backwards:
    #   "Start (Most Recent Trade)" = the newer/end date
    #   "End (Oldest Trade)" = the older/start date
    # So our start_date goes into the "End" field, and our end_date into "Start"

    print("    Setting End (Oldest) date...")
    set_date_in_dialog(
        cal["end_custom_radio_x"], cal["end_custom_radio_y"],
        cal["end_date_field_x"], cal["end_date_field_y"],
        start_date, cal, field_id="end",  # oldest = our start
    )

    print("    Setting Start (Most Recent) date...")
    set_date_in_dialog(
        cal["start_custom_radio_x"], cal["start_custom_radio_y"],
        cal["start_date_field_x"], cal["start_date_field_y"],
        end_date, cal, field_id="start",  # most recent = our end
    )

    # 3. Click OK — try pywinauto first, fall back to calibrated coords
    print("    Clicking OK...")
    ok_clicked = False
    if PYWINAUTO_AVAILABLE:
        try:
            dlg, _, _ = _find_date_dialog()
            ok_btn = dlg.child_window(title="OK", class_name="Button")
            ok_btn.click()
            ok_clicked = True
            print("      (via pywinauto)")
        except Exception:
            pass
    if not ok_clicked:
        pyautogui.click(cal["ok_btn_x"], cal["ok_btn_y"])
        print("      (via calibrated coords)")
    time.sleep(1.0)  # wait for dialog to fully close

    # 4. Wait for grid to load
    print(f"    Waiting {grid_wait}s for data to load...")
    time.sleep(grid_wait)

    # 5. Copy grid data
    print("    Copying grid data (Ctrl+A, Ctrl+C)...")
    clipboard = copy_grid_to_clipboard(cal)

    if not clipboard or len(clipboard.strip()) < 50:
        print("    ✗ Clipboard empty or too small — no data for this range?")
        # Write empty marker file so we know we tried
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text("")
        return True  # not an error, just no trades in this range

    # 6. Write to CSV
    row_count = clipboard_to_csv(clipboard, output_path)

    if row_count > 0:
        size = output_path.stat().st_size
        print(f"    ✓ Saved: {output_path.name} — {row_count} rows ({size:,} bytes)")
        return True
    else:
        print(f"    ✗ No data rows parsed from clipboard")
        return False


def run_export(start_date: datetime, end_date: datetime, csv_dir: Path,
               script_dir: Path, chunk_days: int = CHUNK_DAYS,
               grid_wait: float = GRID_LOAD_WAIT):
    """Run the full automated export loop through all date chunks."""
    if not AUTOMATION_AVAILABLE:
        print("ERROR: pyautogui + pyperclip are required for GUI automation.")
        print("  py -m pip install pyautogui pyperclip Pillow")
        sys.exit(1)

    cal = load_calibration(script_dir)

    # Validate calibration
    if cal["grid_x"] == 0 and cal["grid_y"] == 0:
        print("ERROR: Not calibrated yet. Run with --calibrate first.")
        sys.exit(1)

    csv_dir.mkdir(parents=True, exist_ok=True)
    progress_path = script_dir / PROGRESS_FILE

    # Load progress (for resume after interruption)
    progress = {"completed_chunks": []}
    if progress_path.exists():
        with open(progress_path) as f:
            progress = json.load(f)

    completed = set(progress.get("completed_chunks", []))

    # Generate date chunks (going from oldest to newest)
    chunks = []
    current = start_date
    while current < end_date:
        chunk_end = min(current + timedelta(days=chunk_days), end_date)
        chunks.append((current, chunk_end))
        current = chunk_end + timedelta(days=1)

    total = len(chunks)
    skipped = 0
    exported = 0
    failed = 0
    total_rows = 0

    print()
    print("=" * 65)
    print(f"  HOLLY EXPORT BOT — EXPORTING {total} CHUNKS")
    print("=" * 65)
    print(f"  Range:  {start_date.strftime('%Y-%m-%d')} → {end_date.strftime('%Y-%m-%d')}")
    print(f"  Chunks: {total} × {chunk_days} days")
    print(f"  Output: {csv_dir}")
    print("=" * 65)
    print()
    print("  ⚠  DON'T TOUCH THE MOUSE/KEYBOARD")
    print("  ⚠  Move mouse to TOP-LEFT CORNER to emergency abort")
    print("  ⚠  Or press Ctrl+C to stop gracefully")
    print()

    time.sleep(3)  # give user a moment to read

    for i, (chunk_start, chunk_end) in enumerate(chunks, 1):
        chunk_key = f"{chunk_start.strftime('%Y%m%d')}_{chunk_end.strftime('%Y%m%d')}"

        if chunk_key in completed:
            print(f"  [{i}/{total}] Skipping (already done): {chunk_key}")
            skipped += 1
            continue

        filename = f"holly_{chunk_key}.csv"
        output_path = csv_dir / filename

        print(f"\n  [{i}/{total}] Chunk: {chunk_key}")

        try:
            success = export_chunk(cal, chunk_start, chunk_end, output_path, grid_wait)

            if success:
                exported += 1
                # Count rows if file exists and has content
                if output_path.exists() and output_path.stat().st_size > 0:
                    with open(output_path) as f:
                        total_rows += max(0, sum(1 for _ in f) - 1)  # minus header

                completed.add(chunk_key)
                progress["completed_chunks"] = list(completed)
                with open(progress_path, "w") as f:
                    json.dump(progress, f)
            else:
                failed += 1

        except pyautogui.FailSafeException:
            print("\n\n  ⛔ FAILSAFE — Mouse at top-left corner. Aborting.")
            break
        except KeyboardInterrupt:
            print("\n\n  ⛔ Ctrl+C — Stopping. Progress saved, you can resume later.")
            break

        # Pause between chunks — let TI fully settle before next right-click
        time.sleep(3.0)

    print()
    print("=" * 65)
    print(f"  EXPORT COMPLETE")
    print(f"    Exported:  {exported}")
    print(f"    Skipped:   {skipped} (already done)")
    print(f"    Failed:    {failed}")
    print(f"    Total rows: ~{total_rows:,}")
    print(f"    CSVs in:   {csv_dir}")
    print("=" * 65)


# ═══════════════════════════════════════════════════════════════════════════
# CSV MERGE & DEDUP
# ═══════════════════════════════════════════════════════════════════════════

def make_dedup_key(row: list) -> str:
    """Hash the entire row for dedup (CSVs have no headers)."""
    raw = "|".join(cell.strip() for cell in row)
    return hashlib.md5(raw.encode()).hexdigest()


def merge_csvs(csv_dir: Path, output_path: Path) -> dict:
    """
    Merge all holly_*.csv in directory, dedup by full-row hash.
    TI's clipboard copy has NO header row, so we use csv.reader (not DictReader).
    """
    csv_files = sorted(csv_dir.glob("holly_*.csv"))
    # Exclude the merged output itself if it exists
    csv_files = [f for f in csv_files if f.name != output_path.name]
    if not csv_files:
        print(f"No holly_*.csv files found in {csv_dir}")
        return {"files": 0, "total_rows": 0, "unique_rows": 0, "dupes": 0}

    print(f"\n  Merging {len(csv_files)} CSV files from {csv_dir}")

    seen_keys = set()
    all_rows = []
    total_rows = 0
    dupes = 0

    for csv_file in csv_files:
        if csv_file.stat().st_size < 10:
            continue  # skip empty marker files

        print(f"    {csv_file.name}...", end=" ")
        try:
            with open(csv_file, "r", encoding="utf-8-sig") as f:
                reader = csv.reader(f)
                file_rows = [row for row in reader if any(cell.strip() for cell in row)]

            if not file_rows:
                print("(empty)")
                continue

            file_total = 0
            file_dupes = 0
            for row in file_rows:
                total_rows += 1
                file_total += 1
                key = make_dedup_key(row)
                if key in seen_keys:
                    dupes += 1
                    file_dupes += 1
                    continue
                seen_keys.add(key)
                all_rows.append(row)

            print(f"{file_total} rows ({file_dupes} dupes)")

        except Exception as e:
            print(f"ERROR: {e}")

    if not all_rows:
        print("  No rows to write.")
        return {"files": len(csv_files), "total_rows": total_rows,
                "unique_rows": 0, "dupes": dupes}

    # Sort by first column (entry timestamp, e.g. "01-Mar-2024 06:40:05")
    try:
        all_rows.sort(key=lambda r: r[0] if r else "")
    except Exception:
        pass

    # Write merged CSV (no header — raw data like the source)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerows(all_rows)

    result = {
        "files": len(csv_files),
        "total_rows": total_rows,
        "unique_rows": len(all_rows),
        "dupes": dupes,
        "output": str(output_path),
    }

    print()
    print("  " + "─" * 50)
    print(f"  MERGE COMPLETE")
    print(f"    Files:   {result['files']}")
    print(f"    Total:   {result['total_rows']:,} rows")
    print(f"    Dupes:   {result['dupes']:,}")
    print(f"    Unique:  {result['unique_rows']:,}")
    print(f"    Output:  {result['output']}")
    print("  " + "─" * 50)

    return result


# ═══════════════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="Holly AI Trade Export Bot — automates Trade Ideas copy-paste export",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Workflow:
  Trade Ideas has no CSV export. This bot automates:
  Right-click → History: All → Time Frame → set dates → OK →
  wait for load → Ctrl+A → Ctrl+C → save clipboard as CSV

Examples:
  # Calibrate (first time — captures all click positions)
  py holly-export-bot.py --calibrate

  # Export all history from 2020 to now
  py holly-export-bot.py --start 2020-03-01 --end 2025-12-31

  # Just merge existing chunk CSVs
  py holly-export-bot.py --merge-only --csv-dir ./holly_exports

  # Resume interrupted export (progress auto-saved)
  py holly-export-bot.py --start 2020-03-01 --end 2025-12-31
        """,
    )

    parser.add_argument("--calibrate", action="store_true",
                        help="Run interactive calibration wizard")
    parser.add_argument("--start", type=str,
                        help="Start date YYYY-MM-DD (oldest date to export)")
    parser.add_argument("--end", type=str,
                        help="End date YYYY-MM-DD (newest date to export)")
    parser.add_argument("--merge-only", action="store_true",
                        help="Skip GUI export, just merge existing CSVs")
    parser.add_argument("--csv-dir", type=str, default=str(DEFAULT_CSV_DIR),
                        help=f"Directory for CSV chunks (default: {DEFAULT_CSV_DIR})")
    parser.add_argument("--output", type=str, default=MERGED_OUTPUT,
                        help=f"Merged output filename (default: {MERGED_OUTPUT})")
    parser.add_argument("--chunk-days", type=int, default=CHUNK_DAYS,
                        help=f"Days per chunk (default: {CHUNK_DAYS})")
    parser.add_argument("--wait", type=float, default=GRID_LOAD_WAIT,
                        help=f"Seconds to wait for grid load (default: {GRID_LOAD_WAIT})")
    parser.add_argument("--reset-progress", action="store_true",
                        help="Clear progress file and start fresh")
    parser.add_argument("--test-date", type=str, metavar="YYYY-MM-DD",
                        help="Test date-setting only: opens dialog, sets this date, "
                             "pauses so you can verify. Does NOT export.")
    parser.add_argument("--debug", action="store_true",
                        help="Capture screenshots at each step (saved to scripts/debug_screenshots/)")

    args = parser.parse_args()
    script_dir = Path(__file__).parent

    csv_dir = Path(args.csv_dir)
    output_path = csv_dir / args.output

    if args.calibrate:
        run_calibration(script_dir)
        return

    if args.reset_progress:
        progress_path = script_dir / PROGRESS_FILE
        if progress_path.exists():
            progress_path.unlink()
            print("Progress file cleared.")
        return

    if args.debug:
        global DEBUG_SCREENSHOTS
        DEBUG_SCREENSHOTS = True
        print("  📸 Debug screenshots ENABLED — saving to scripts/debug_screenshots/")

    if args.test_date:
        # Quick test mode: open date dialog, set both dates, pause for verification
        if not AUTOMATION_AVAILABLE:
            print("ERROR: pyautogui required. py -m pip install pyautogui pyperclip Pillow")
            sys.exit(1)
        cal = load_calibration(script_dir)
        if cal["grid_x"] == 0:
            print("ERROR: Not calibrated. Run --calibrate first.")
            sys.exit(1)
        try:
            test_dt = datetime.strptime(args.test_date, "%Y-%m-%d")
        except ValueError:
            print("ERROR: Use YYYY-MM-DD format")
            sys.exit(1)

        print(f"\n  TEST MODE: Setting both dates to {test_dt.strftime('%d-%b-%Y')}")
        print(f"  You have 5 seconds to make sure TI is focused...")
        time.sleep(5)

        print("\n  Opening date dialog...")
        open_date_dialog(cal)

        print("  Setting END (Oldest Trade) date...")
        set_date_in_dialog(
            cal["end_custom_radio_x"], cal["end_custom_radio_y"],
            cal["end_date_field_x"], cal["end_date_field_y"],
            test_dt, cal, field_id="end")

        print("  Setting START (Most Recent Trade) date...")
        set_date_in_dialog(
            cal["start_custom_radio_x"], cal["start_custom_radio_y"],
            cal["start_date_field_x"], cal["start_date_field_y"],
            test_dt, cal, field_id="start")

        # Verify via pywinauto read-back
        if PYWINAUTO_AVAILABLE:
            try:
                _, dtp_end, dtp_start = _find_date_dialog()
                sv = dtp_start.get_time()
                ev = dtp_end.get_time()
                print(f"\n  pywinauto read-back:")
                print(f"    Start DTP: {sv.wDay:02d}-{sv.wMonth:02d}-{sv.wYear}")
                print(f"    End DTP:   {ev.wDay:02d}-{ev.wMonth:02d}-{ev.wYear}")
            except Exception as e:
                print(f"\n  pywinauto read-back failed: {e}")

        print(f"\n  Target was: {test_dt.strftime('%d-%b-%Y')}")
        print("  CHECK THE DIALOG — do both dates look correct?")
        print("  (Don't click OK — just verify, then close the dialog)")
        input("  Press ENTER when done checking...")
        return

    if args.merge_only:
        merge_csvs(csv_dir, output_path)
        return

    if not args.start or not args.end:
        parser.print_help()
        print("\nERROR: --start and --end required (or use --calibrate / --merge-only)")
        sys.exit(1)

    try:
        start_date = datetime.strptime(args.start, "%Y-%m-%d")
        end_date = datetime.strptime(args.end, "%Y-%m-%d")
    except ValueError as e:
        print(f"ERROR: Bad date format: {e}  (use YYYY-MM-DD)")
        sys.exit(1)

    if start_date >= end_date:
        print("ERROR: --start must be before --end")
        sys.exit(1)

    # Run export
    run_export(start_date, end_date, csv_dir, script_dir,
               chunk_days=args.chunk_days, grid_wait=args.wait)

    # Auto-merge after export
    print("\n  Auto-merging exported CSVs...")
    merge_csvs(csv_dir, output_path)

    print(f"\n  Done! Merged file: {output_path}")
    print(f"  Import into market-data-bridge:")
    print(f"    node scripts/run-holly-import.mjs {output_path}")


if __name__ == "__main__":
    main()
