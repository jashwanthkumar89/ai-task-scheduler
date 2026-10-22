"""
Fetch the latest gym payment receipt from myiclubonline.com and upload it
to Compt under "Health & Wellness".

Run by the AI Task Scheduler as a "script" task. Behaviour mirrors
spectrum_invoice.py:
- Signs in at myiclubonline.com with credentials from the task's secrets
  file (SECRETS_FILE env var, keys: GYM_USERNAME, GYM_PASSWORD). Compt
  credentials are read from the same file or fall back to spectrum.env.
- Opens the payment history page and finds the newest payment entry.
- If it's newer than the last one we've processed, saves it as a PDF
  (direct download when possible, otherwise Chrome print-to-PDF) into
  server/data/downloads/gym/, uploads it to Compt under the
  "Health & Wellness" category and "Health & Wellness" stipend, and sends
  a macOS notification.
- If there is no new payment, exits quietly (exit 0, no notification).
"""

import json
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.service import Service

sys.path.insert(0, str(Path(__file__).resolve().parent))
from spectrum_invoice import (  # noqa: E402
    first_present, focus_current_window, type_into, notify, upload_to_compt,
    statement_date,
)

secrets_file = os.environ.get("SECRETS_FILE")
if secrets_file and os.path.exists(secrets_file):
    load_dotenv(secrets_file)
# Compt credentials may live in spectrum.env; use it as a fallback.
fallback = Path(__file__).resolve().parents[1] / "secrets" / "spectrum.env"
if fallback.exists():
    load_dotenv(fallback, override=False)

GYM_USERNAME = os.environ.get("GYM_USERNAME")
GYM_PASSWORD = os.environ.get("GYM_PASSWORD")

FAILURE_SCREENSHOT_PATH = os.environ.get("FAILURE_SCREENSHOT_PATH")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DOWNLOAD_DIR = PROJECT_ROOT / "server" / "data" / "downloads" / "gym"
STATE_FILE = DOWNLOAD_DIR / "state.json"
CHROME_PROFILE_DIR = PROJECT_ROOT / "server" / "data" / "chrome-profile-spectrum"

LOGIN_URL = "https://www.myiclubonline.com/iclub/members"
PAYMENT_HISTORY_URL = "https://www.myiclubonline.com/iclub/members#account/paymenthistory"

WAIT = 60


def fail(driver, message: str) -> None:
    if driver is not None and FAILURE_SCREENSHOT_PATH:
        try:
            driver.save_screenshot(FAILURE_SCREENSHOT_PATH)
        except Exception:
            pass
    print(f"FAILED: {message}", file=sys.stderr)
    sys.exit(1)


def is_on_auth_page(driver) -> bool:
    url = (driver.current_url or "").lower()
    return bool(url) and ("login" in url or "signin" in url)


def login(driver, wait) -> None:
    print("Opening payment history (reusing saved session if still valid)...", flush=True)
    driver.get(PAYMENT_HISTORY_URL)
    time.sleep(5)
    if not is_on_auth_page(driver):
        print("Saved session is valid, skipping login.", flush=True)
        # Make sure we're actually on the payment history page - the
        # portal may have landed somewhere else.
        if "paymenthistory" not in (driver.current_url or ""):
            driver.get(PAYMENT_HISTORY_URL)
            time.sleep(5)
        return

    print("Session expired - signing in...", flush=True)
    user_el = first_present(
        driver,
        wait,
        [
            (By.NAME, "username"),
            (By.CSS_SELECTOR, "input[type='email']"),
            (By.CSS_SELECTOR, "input[autocomplete='username']"),
            (By.CSS_SELECTOR, "input[type='text']"),
        ],
    )
    if user_el is None:
        fail(driver, "Could not find the username field on the gym sign-in page.")
    type_into(driver, user_el, GYM_USERNAME)

    pass_el = first_present(
        driver,
        wait,
        [(By.CSS_SELECTOR, "input[type='password']"), (By.NAME, "password")],
    )
    if pass_el is None:
        fail(driver, "Could not find the password field on the gym sign-in page.")
    type_into(driver, pass_el, GYM_PASSWORD)

    # Tick "Remember me" so the session persists in the saved profile.
    remember = first_present(
        driver,
        wait,
        [
            (By.XPATH, "//input[@type='checkbox']"),
        ],
        visible_only=False,
    )
    if remember is not None:
        try:
            if not remember.is_selected():
                driver.execute_script("arguments[0].click();", remember)
                print("Remember me checked.", flush=True)
        except Exception:
            pass

    submit = first_present(
        driver,
        wait,
        [
            (By.CSS_SELECTOR, "button[type='submit']"),
            (By.XPATH, "//button[contains(., 'Sign') or contains(., 'Log') or contains(., 'Submit')]"),
            (By.CSS_SELECTOR, "input[type='submit']"),
        ],
    )
    if submit is None:
        pass_el.submit()
    else:
        try:
            submit.click()
        except Exception:
            driver.execute_script("arguments[0].click();", submit)

    login_wait_secs = 300 if os.environ.get("HEADFUL") == "1" else WAIT
    deadline = time.time() + login_wait_secs
    while time.time() < deadline:
        if not is_on_auth_page(driver):
            # After a fresh login, return to the payment history page.
            driver.get(PAYMENT_HISTORY_URL)
            time.sleep(5)
            return
        time.sleep(1)
    fail(driver, "Gym login did not complete.")


def open_payment_history(driver, wait) -> None:
    """The portal drops you on billing after login - click the
    'My payment history' link in the left sidebar."""
    link = first_present(
        driver,
        wait,
        [
            (By.XPATH, "//*[contains(translate(normalize-space(), 'PAYMENT HISTORY', 'payment history'), 'payment history')]"
                       "[self::a or self::button or self::li or @role='link' or @role='menuitem']"),
            (By.PARTIAL_LINK_TEXT, "ayment history"),
        ],
    )
    if link is None:
        fail(driver, "Could not find 'My payment history' in the sidebar.")
    try:
        link.click()
    except Exception:
        driver.execute_script("arguments[0].click();", link)
    print("Opened My payment history.", flush=True)
    time.sleep(4)

    # The page defaults to an earlier view - click "Show" and pick the
    # "later" option to reveal the most recent payments.
    show_btn = first_present(
        driver,
        wait,
        [
            (By.XPATH, "//*[normalize-space()='Show'][self::a or self::button or self::span or self::li]"),
            (By.XPATH, "//*[contains(normalize-space(), 'Show')][self::a or self::button or self::select]"),
        ],
    )
    if show_btn is not None:
        try:
            show_btn.click()
        except Exception:
            driver.execute_script("arguments[0].click();", show_btn)
        time.sleep(2)
        later_opt = first_present(
            driver,
            wait,
            [
                (By.XPATH, "//*[contains(translate(normalize-space(), 'LATER', 'later'), 'later')]"
                           "[self::a or self::button or self::span or self::li or @role='option']"),
            ],
        )
        if later_opt is not None:
            try:
                later_opt.click()
            except Exception:
                driver.execute_script("arguments[0].click();", later_opt)
            print("Selected 'later' from the Show menu.", flush=True)
            time.sleep(3)


def find_latest_payment(driver, wait):
    """On the payment history page, return (label, element) for the newest
    payment row - a link/button containing a date or 'receipt'/'view'."""
    deadline = time.time() + WAIT
    while time.time() < deadline:
        try:
            elems = driver.find_elements(By.TAG_NAME, "a") + driver.find_elements(
                By.TAG_NAME, "button"
            )
        except Exception:
            focus_current_window(driver)
            time.sleep(1)
            continue
        candidates = []
        for a in elems:
            try:
                href = a.get_attribute("href") or ""
                text = (a.text or "").strip()
                label = " ".join(filter(None, [text, href]))
                if (
                    ".pdf" in href.lower()
                    or "receipt" in label.lower()
                    or "payment" in label.lower()
                    or "view" in label.lower()
                    or "print" in label.lower()
                    or statement_date(label) is not None
                ):
                    candidates.append((label, a))
            except Exception:  # noqa: BLE001
                continue
        if candidates:
            return candidates
        time.sleep(1)
    return None


def wait_for_download(timeout: int = 30):
    deadline = time.time() + timeout
    before = set(DOWNLOAD_DIR.glob("*.pdf"))
    while time.time() < deadline:
        current = set(DOWNLOAD_DIR.glob("*.pdf"))
        new_files = current - before
        if new_files and not list(DOWNLOAD_DIR.glob("*.crdownload")):
            return new_files.pop()
        time.sleep(0.5)
    return None


def print_current_page_to_pdf(driver, dest: Path) -> Path:
    """Fallback for receipts shown as HTML: print the page to a PDF via CDP."""
    import base64

    result = driver.execute_cdp_cmd("Page.printToPDF", {"printBackground": True})
    dest.write_bytes(base64.b64decode(result["data"]))
    return dest


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2))


def main() -> None:
    if not (GYM_USERNAME and GYM_PASSWORD):
        print("Missing GYM_USERNAME / GYM_PASSWORD in the task's secrets file.", file=sys.stderr)
        sys.exit(1)

    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    options = Options()
    if os.environ.get("HEADFUL") != "1":
        options.add_argument("--headless=new")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)
    options.add_argument(f"--user-data-dir={CHROME_PROFILE_DIR}")
    options.add_experimental_option(
        "prefs",
        {
            "download.default_directory": str(DOWNLOAD_DIR),
            "download.prompt_for_download": False,
            "plugins.always_open_pdf_externally": True,
        },
    )
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
    try:
        driver.execute_cdp_cmd(
            "Page.addScriptToEvaluateOnNewDocument",
            {"source": "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"},
        )
    except Exception:
        pass
    wait = WebDriverWait(driver, WAIT)

    try:
        login(driver, wait)
        open_payment_history(driver, wait)

        # Set the payment-history date range: from the last processed
        # payment date (or a year back) through today.
        from datetime import datetime, timedelta
        import re as _re

        state = load_state()
        last_dt = None
        if state.get("last_payment_date"):
            try:
                last_dt = datetime.strptime(state["last_payment_date"], "%Y-%m-%d")
            except Exception:
                pass
        elif state.get("last_payment"):
            last_dt = statement_date(state["last_payment"])

        # Window starts the day AFTER the last processed payment so it
        # only covers genuinely new activity.
        from_dt = (last_dt + timedelta(days=1)) if last_dt else (datetime.today() - timedelta(days=365))
        to_dt = datetime.today()

        def looks_like_date_input(el) -> bool:
            if el.get_attribute("type") == "date":
                return True
            attrs = " ".join(
                str(el.get_attribute(a) or "")
                for a in ("placeholder", "name", "id", "aria-label", "class")
            ).lower()
            return (
                "date" in attrs
                or "mm/dd" in attrs
                or "dd/mm" in attrs
                or _re.search(r"m{2}[/\-.]d{2}", attrs) is not None
                or _re.search(r"d{2}[/\-.]m{2}", attrs) is not None
            )

        date_inputs = [
            el
            for el in driver.find_elements(By.TAG_NAME, "input")
            if el.is_displayed() and el.is_enabled() and looks_like_date_input(el)
        ]
        if len(date_inputs) >= 2:
            # Set both date pairs: Purchase History (first two inputs)
            # and Payment History (last two inputs).
            print(f"Setting date range {from_dt:%m/%d/%Y} - {to_dt:%m/%d/%Y}...", flush=True)
            if len(date_inputs) >= 4:
                type_into(driver, date_inputs[0], from_dt.strftime("%m/%d/%Y"))
                type_into(driver, date_inputs[1], to_dt.strftime("%m/%d/%Y"))
            type_into(driver, date_inputs[-2], from_dt.strftime("%m/%d/%Y"))
            type_into(driver, date_inputs[-1], to_dt.strftime("%m/%d/%Y"))
            time.sleep(1)
            # Click BOTH "Show" buttons (Purchase History and Payment
            # History) so both result lists refresh.
            try:
                shows = [
                    el
                    for el in driver.find_elements(
                        By.XPATH, "//*[normalize-space()='Show'][self::button or self::a or @type='submit']"
                    )
                    if el.is_displayed()
                ]
                for btn in shows:
                    try:
                        btn.click()
                    except Exception:
                        driver.execute_script("arguments[0].click();", btn)
                    time.sleep(2)
                if shows:
                    print(f"Clicked 'Show' ({len(shows)}x) to update results.", flush=True)
                time.sleep(4)
            except Exception:
                pass
        else:
            print("No date range inputs found - using the page as-is.", flush=True)

        # Dedup: find the newest payment date in the history table rows
        # (NOT the whole page - the from/to inputs we just typed contain
        # today's date and would masquerade as a payment).
        pay_dt = None
        texts = []
        for el in driver.find_elements(By.CSS_SELECTOR, "table tr, table td, table th"):
            try:
                t = (el.text or "").strip()
                if t:
                    texts.append(t)
            except Exception:
                continue
        if not texts:
            # No <table> cells - fall back to visible leaf-element text
            # (element text never includes typed input values).
            for el in driver.find_elements(By.XPATH, "//*[not(*)]"):
                try:
                    t = (el.text or "").strip()
                    if t and el.is_displayed():
                        texts.append(t)
                except Exception:
                    continue
        for t in texts:
            for m in _re.finditer(r"(\d{1,2})/(\d{1,2})/(\d{4})", t):
                try:
                    d = datetime.strptime(m.group(0), "%m/%d/%Y")
                    if d <= to_dt and (pay_dt is None or d > pay_dt):
                        pay_dt = d
                except Exception:
                    pass
        label = pay_dt.strftime("%m/%d/%Y") if pay_dt else "latest payment"
        try:
            driver.save_screenshot("/tmp/gym_payhist.png")
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight)")
            time.sleep(1)
            driver.save_screenshot("/tmp/gym_payhist_bottom.png")
        except Exception:
            pass
        if pay_dt is None:
            page_text = (driver.find_element(By.TAG_NAME, "body").text or "").lower()
            if "no payment history" in page_text or "no purchase history" in page_text:
                since = last_dt.strftime("%m/%d/%Y") if last_dt else "the last recorded payment"
                print(f"[QUIET] No payments posted after {since} - nothing new.")
            else:
                print("Could not determine the latest payment date - skipping to be safe.")
            return
        if last_dt is not None and pay_dt <= last_dt:
            print(f"[QUIET] No new payment. Latest is still: {label}")
            return

        print(f"New payment found: {label} - downloading receipt...", flush=True)

        # Click the download icon on the payment history page.
        download_btn = first_present(
            driver,
            wait,
            [
                (By.XPATH, "//*[@title='Download' or @aria-label='Download' or @alt='Download']"),
                (By.XPATH, "//a[contains(@href, 'download')]"),
                (By.XPATH, "//img[contains(@src, 'download')]"),
                (By.XPATH, "//*[contains(@class, 'download')][self::a or self::button or self::i or self::span]"),
                (By.XPATH, "//*[self::a or self::button][contains(normalize-space(), 'Download')]"),
            ],
            visible_only=False,
        )
        if download_btn is None:
            fail(driver, "Could not find the download icon on the payment history page.")
        try:
            download_btn.click()
        except Exception:
            driver.execute_script("arguments[0].click();", download_btn)
        time.sleep(4)

        focus_current_window(driver)
        pdf = wait_for_download(timeout=30)
        if pdf is None:
            # Nothing downloaded - print the current view to PDF as a fallback.
            pdf = DOWNLOAD_DIR / "receipt.pdf"
            print_current_page_to_pdf(driver, pdf)

        if pay_dt:
            try:
                renamed = pdf.with_name(f"gym-{pay_dt:%Y-%m-%d}.pdf")
                pdf.rename(renamed)
                pdf = renamed
            except Exception:
                pass

        print(f"Saved receipt: {pdf}")

        focus_current_window(driver)
        upload_to_compt(driver, wait, pdf, label, claim_category="Health & Wellness", stipend="Health & Wellness")

        save_state(
            {
                "last_payment": label,
                "last_payment_date": pay_dt.strftime("%Y-%m-%d") if pay_dt else None,
                "file": str(pdf),
            }
        )
        notify("Gym bill ready", f"New receipt downloaded and uploaded to Compt: {pdf.name}")
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
