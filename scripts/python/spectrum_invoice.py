"""
Fetch the latest Spectrum invoice PDF.

Run by the AI Task Scheduler as a "script" task. Behaviour:
- Signs in at spectrum.net with credentials from the task's secrets file
  (SECRETS_FILE env var, keys: SPECTRUM_USERNAME, SPECTRUM_PASSWORD).
- Opens the billing page and looks for the newest statement link.
- If a statement newer than the last one we've seen exists, downloads the
  PDF into server/data/downloads/spectrum/ and sends a macOS notification.
- If there is no new bill, exits quietly (exit 0, no notification).
- Any error exits non-zero and leaves a screenshot at FAILURE_SCREENSHOT_PATH.

Note: Spectrum's site is a JS-heavy SPA and selectors change over time; the
login/billing flow below uses several candidate selectors and may need
adjusting if Spectrum redesigns. A failed run's screenshot shows what the
page actually looked like.
"""

import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.service import Service

secrets_file = os.environ.get("SECRETS_FILE")
if secrets_file and os.path.exists(secrets_file):
    load_dotenv(secrets_file)

USERNAME = os.environ.get("SPECTRUM_USERNAME")
PASSWORD = os.environ.get("SPECTRUM_PASSWORD")
COMPT_USERNAME = os.environ.get("COMPT_USERNAME")
COMPT_PASSWORD = os.environ.get("COMPT_PASSWORD")
COMPT_URL = os.environ.get("COMPT_URL", "https://app.compt.io")

FAILURE_SCREENSHOT_PATH = os.environ.get("FAILURE_SCREENSHOT_PATH")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DOWNLOAD_DIR = PROJECT_ROOT / "server" / "data" / "downloads" / "spectrum"
STATE_FILE = DOWNLOAD_DIR / "state.json"
# Persistent Chrome profile so the Spectrum session survives between runs
# (log in once, manually if needed; subsequent runs reuse the cookies).
CHROME_PROFILE_DIR = PROJECT_ROOT / "server" / "data" / "chrome-profile-spectrum"

LOGIN_URL = "https://www.spectrum.net/login"
BILLING_URL = "https://www.spectrum.net/billing/statements"

WAIT = 60  # Spectrum's SPA can sit on a loading spinner for a long time


def fail(driver, message: str) -> None:
    if driver is not None and FAILURE_SCREENSHOT_PATH:
        try:
            driver.save_screenshot(FAILURE_SCREENSHOT_PATH)
        except Exception:
            pass
    print(f"FAILED: {message}", file=sys.stderr)
    sys.exit(1)


def notify(title: str, message: str) -> None:
    import subprocess

    def q(v: str) -> str:
        return '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'

    subprocess.run(
        ["osascript", "-e", f"display notification {q(message)} with title {q(title)}"],
        check=False,
    )


def first_present(driver, wait, selectors, visible_only: bool = True):
    """Return the first element matching any (by, value) selector, or None."""
    deadline = time.time() + WAIT
    last_err = None
    while time.time() < deadline:
        try:
            focus_current_window(driver)
        except Exception:
            pass
        for by, value in selectors:
            try:
                els = driver.find_elements(by, value)
                for el in els:
                    if visible_only and not (el.is_displayed() and el.is_enabled()):
                        continue
                    return el
            except Exception as exc:  # noqa: BLE001
                last_err = exc
        time.sleep(0.5)
    if last_err:
        raise last_err
    return None


def safe_clear(el) -> None:
    try:
        el.clear()
    except Exception:
        pass


def type_into(driver, el, text: str) -> None:
    try:
        el.click()
    except Exception:
        pass
    try:
        safe_clear(el)
        el.send_keys(text)
    except Exception:
        # React controlled inputs ignore direct .value assignment; go through
        # the native setter so the framework picks the value up.
        driver.execute_script(
            "const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;"
            "setter.call(arguments[0], arguments[1]);"
            "arguments[0].dispatchEvent(new Event('input', {bubbles: true}));"
            "arguments[0].dispatchEvent(new Event('change', {bubbles: true}));",
            el,
            text,
        )


def is_on_auth_page(driver) -> bool:
    url = (driver.current_url or "").lower()
    return bool(url) and ("id.spectrum.net" in url or "login" in url or "signin" in url)


def login(driver, wait) -> None:
    # Try the billing page directly first - a persisted profile may still
    # have a valid session and skip login entirely.
    print("Opening billing page (reusing saved session if still valid)...", flush=True)
    driver.get(BILLING_URL)
    time.sleep(5)
    if not is_on_auth_page(driver):
        print("Saved session is valid, skipping login.", flush=True)
        return

    print("Session expired - signing in...", flush=True)
    # Spectrum's landing page requires clicking a "Sign In" button/link
    # before the username/password form is shown.
    signin_link = first_present(
        driver,
        wait,
        [
            (By.XPATH, "//a[contains(translate(., 'SIGN', 'sign'), 'sign in')]"),
            (By.XPATH, "//button[contains(translate(., 'SIGN', 'sign'), 'sign in')]"),
            (By.CSS_SELECTOR, "a[href*='login']"),
            (By.CSS_SELECTOR, "a[href*='signin']"),
        ],
    )
    if signin_link is not None:
        try:
            signin_link.click()
        except Exception:
            driver.execute_script("arguments[0].click();", signin_link)

    # Clicking Sign In redirects to the SSO form at id.spectrum.net.
    try:
        wait.until(lambda d: "id.spectrum.net" in d.current_url)
    except Exception:
        pass  # fall through and try the fields anyway

    user_el = first_present(
        driver,
        wait,
        [
            (By.CSS_SELECTOR, "input[autocomplete='username']"),
            (By.ID, "signin-username"),
            (By.NAME, "username"),
            (By.CSS_SELECTOR, "input[type='email']"),
        ],
    )
    if user_el is None:
        fail(driver, "Could not find the username field on the Spectrum sign-in page.")
    type_into(driver, user_el, USERNAME)

    pass_el = first_present(
        driver,
        wait,
        [
            (By.CSS_SELECTOR, "input[autocomplete='current-password']"),
            (By.ID, "signin-password"),
            (By.NAME, "password"),
            (By.CSS_SELECTOR, "input[type='password']"),
        ],
    )
    if pass_el is None:
        # Some flows split username/password across two screens; click continue first.
        cont = first_present(
            driver,
            wait,
            [
                (By.CSS_SELECTOR, "button[type='submit']"),
                (By.XPATH, "//button[contains(., 'Continue') or contains(., 'Next')]"),
            ],
        )
        if cont:
            cont.click()
        pass_el = first_present(
            driver,
            wait,
            [
                (By.ID, "signin-password"),
                (By.NAME, "password"),
                (By.CSS_SELECTOR, "input[type='password']"),
            ],
        )
    if pass_el is None:
        fail(driver, "Could not find the password field on the Spectrum sign-in page.")
    type_into(driver, pass_el, PASSWORD)

    submit = first_present(
        driver,
        wait,
        [
            (By.ID, "signin-button"),
            (By.CSS_SELECTOR, "button[type='submit']"),
            (By.XPATH, "//button[contains(., 'Sign In') or contains(., 'Sign in')]"),
        ],
    )
    print("Credentials entered, submitting...", flush=True)
    if submit is None:
        pass_el.submit()
    else:
        submit.click()

    # Wait until we leave the login page. In headful mode allow extra time
    # for you to complete an MFA/captcha challenge manually; the session is
    # then remembered by the persistent profile for future runs.
    login_wait_secs = 300 if os.environ.get("HEADFUL") == "1" else WAIT
    deadline = time.time() + login_wait_secs
    while time.time() < deadline:
        if not is_on_auth_page(driver):
            return
        time.sleep(1)
    fail(driver, "Login did not complete (credentials wrong, or an MFA/captcha challenge appeared).")


def focus_current_window(driver) -> None:
    """Recover if a redirect or the page closed/replaced our window handle."""
    handles = driver.window_handles
    if not handles:
        try:
            driver.switch_to.new_window("tab")
        except Exception:
            pass  # session is gone; caller's next step will fail cleanly
        return
    try:
        current = driver.current_window_handle
    except Exception:
        current = None
    if current not in handles:
        driver.switch_to.window(handles[-1])


def find_latest_statement_link(driver, wait):
    """On the statements page (/billing/statements), find the first
    statement/PDF link."""
    focus_current_window(driver)
    # login() already opened the statements page - only reload if we
    # ended up somewhere else after the auth redirect.
    if "billing/statements" not in (driver.current_url or ""):
        print("Loading statements page...", flush=True)
        driver.get(BILLING_URL)
        time.sleep(5)

    # Give the SPA a moment to render the statement list.
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
                    or "statement" in label.lower()
                    or "view bill" in label.lower()
                    or "download" in label.lower()
                ):
                    candidates.append((label, a))
            except Exception:  # noqa: BLE001
                continue
        if candidates:
            return candidates
        time.sleep(1)
    return None


def upload_to_compt(
    driver,
    wait,
    pdf_path: Path,
    label: str,
    claim_category: str = "Internet",
    stipend: str = "",
) -> None:
    """Log in to Compt and upload the bill PDF as a new expense claim
    under `claim_category` with stipend `stipend`."""
    if not (COMPT_USERNAME and COMPT_PASSWORD):
        print("COMPT_USERNAME / COMPT_PASSWORD not set - skipping upload.", flush=True)
        return

    print("Opening Compt (reusing saved session if still valid)...", flush=True)
    driver.get(f"{COMPT_URL}/login/")
    time.sleep(5)

    # A saved session redirects away from /login straight to the dashboard.
    needs_login = "login" in (driver.current_url or "").lower()
    if not needs_login:
        print("Compt session already valid, skipping login.", flush=True)
    email_el = None
    if needs_login:
        email_el = first_present(
            driver,
            wait,
            [
                (By.CSS_SELECTOR, "input[type='email']"),
                (By.NAME, "email"),
                (By.CSS_SELECTOR, "input[autocomplete='username']"),
            ],
        )
        if email_el is None:
            print("No login form on Compt - assuming saved session is valid.", flush=True)

    if email_el is not None:
        type_into(driver, email_el, COMPT_USERNAME)
        cont = first_present(
            driver,
            wait,
            [
                (By.XPATH, "//button[contains(., 'Continue')]"),
                (By.CSS_SELECTOR, "button[type='submit']"),
            ],
        )
        if cont is not None:
            try:
                cont.click()
            except Exception:
                driver.execute_script("arguments[0].click();", cont)
        time.sleep(2)

        pass_el = first_present(
            driver,
            wait,
            [(By.CSS_SELECTOR, "input[type='password']"), (By.NAME, "password")],
        )
        if pass_el is not None:
            type_into(driver, pass_el, COMPT_PASSWORD)
        submit = first_present(
            driver,
            wait,
            [
                (By.CSS_SELECTOR, "button[type='submit']"),
                (By.XPATH, "//button[contains(., 'Log in') or contains(., 'Sign in') or contains(., 'Login') or contains(., 'Continue')]"),
            ],
        )
        if submit is not None:
            try:
                submit.click()
            except Exception:
                driver.execute_script("arguments[0].click();", submit)
        time.sleep(5)

    # If still on the login page after submitting, let the user finish
    # manually in headful mode; otherwise fail.
    deadline = time.time() + (300 if os.environ.get("HEADFUL") == "1" else WAIT)
    while "login" in (driver.current_url or "").lower():
        if time.time() > deadline:
            fail(driver, "Compt login did not complete.")
        time.sleep(1)

    print("Compt login OK, opening the claim form...", flush=True)
    open_claim = first_present(
        driver,
        wait,
        [
            (By.XPATH, "//button[contains(., 'Submit a claim')]"),
            (By.XPATH, "//*[self::a or self::button][contains(., 'Submit a claim')]"),
        ],
    )
    if open_claim is not None:
        try:
            open_claim.click()
        except Exception:
            driver.execute_script("arguments[0].click();", open_claim)
        time.sleep(3)

    internet_claim = None
    deadline = time.time() + WAIT
    while internet_claim is None and time.time() < deadline:
        matches = driver.find_elements(
            By.XPATH, f"//*[contains(., '{claim_category}') and contains(., 'Claim here')]"
        )
        for el in reversed(matches):
            try:
                if el.is_displayed() and el.is_enabled():
                    internet_claim = el
                    break
            except Exception:
                continue
        if internet_claim is None:
            time.sleep(0.5)
    if internet_claim is None:
        fail(driver, f"Could not find the '{claim_category} - Claim here' row on Compt.")
    try:
        internet_claim.click()
    except Exception:
        driver.execute_script("arguments[0].click();", internet_claim)
    time.sleep(3)

    file_input = first_present(
        driver,
        wait,
        [(By.CSS_SELECTOR, "input[type='file']")],
        visible_only=False,
    )
    if file_input is None:
        fail(driver, "Could not find a file upload input on the Compt claim form.")

    print(f"Uploading {pdf_path.name} to Compt...", flush=True)
    file_input.send_keys(str(pdf_path))
    # Give the upload a few seconds to process before submitting.
    time.sleep(8)

    # Open the "Choose Stipend" dropdown and pick "Work From Home" -
    # required before Submit enables.
    stipend_trigger = first_present(
        driver,
        wait,
        [(By.XPATH, "//*[normalize-space()='Choose Stipend']")],
    )
    if stipend_trigger is None:
        fail(driver, "Could not find the 'Choose Stipend' dropdown on Compt.")
    try:
        stipend_trigger.click()
    except Exception:
        driver.execute_script("arguments[0].click();", stipend_trigger)
    time.sleep(2)

    stipend_name = stipend or os.environ.get("COMPT_STIPEND", "Work From Home")
    stipend_option = None
    deadline = time.time() + WAIT
    while stipend_option is None and time.time() < deadline:
        try:
            matches = driver.find_elements(
                By.XPATH,
                f"(//*[@role='option' or @role='menuitem' or self::li]"
                f"[contains(normalize-space(), '{stipend_name}')]) | "
                f"(//*[normalize-space()='{stipend_name}'][not(*)])",
            )
        except Exception:
            focus_current_window(driver)
            time.sleep(1)
            continue
        for el in reversed(matches):
            try:
                if el.is_displayed():
                    stipend_option = el
                    break
            except Exception:
                continue
        if stipend_option is None:
            time.sleep(0.5)
    if stipend_option is None:
        fail(driver, f"Stipend dropdown opened but no '{stipend_name}' option was found.")
    try:
        stipend_option.click()
    except Exception:
        driver.execute_script("arguments[0].click();", stipend_option)
    print(f"Stipend selected: {stipend_name}", flush=True)
    time.sleep(2)

    # The real submit button is inside the claim form - exclude the
    # "Submit a claim" drawer-opener button, which also matches 'Submit'.
    save_btn = None
    deadline = time.time() + WAIT
    while save_btn is None and time.time() < deadline:
        try:
            matches = driver.find_elements(
                By.XPATH,
                "//button[not(@disabled)][contains(., 'Submit') and not(contains(., 'Submit a claim'))]",
            )
        except Exception:
            focus_current_window(driver)
            time.sleep(1)
            continue
        for el in reversed(matches):
            try:
                if el.is_displayed() and el.is_enabled():
                    save_btn = el
                    break
            except Exception:
                continue
        if save_btn is None:
            time.sleep(0.5)
    if save_btn is not None:
        print(f"Clicking submit button: '{(save_btn.text or '').strip()[:60]}'", flush=True)
        try:
            save_btn.click()
        except Exception:
            driver.execute_script("arguments[0].click();", save_btn)
        time.sleep(5)
    else:
        fail(driver, "Receipt uploaded but no Submit button was found on Compt.")

    try:
        driver.save_screenshot("/tmp/compt_after_submit.png")
    except Exception:
        pass
    print(f"Uploaded {pdf_path.name} to Compt.", flush=True)



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


def statement_date(label: str):
    """Parse a date out of a statement/payment label -> datetime or None.
    Handles 'September 19, 2026' and '09/19/2026' style formats."""
    m = re.search(r"([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})", label or "")
    if m:
        try:
            return datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", "%B %d %Y")
        except Exception:
            return None
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", label or "")
    if m:
        try:
            return datetime.strptime(f"{m.group(1)}/{m.group(2)}/{m.group(3)}", "%m/%d/%Y")
        except Exception:
            return None
    return None


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2))


def main() -> None:
    if not (USERNAME and PASSWORD):
        print("Missing SPECTRUM_USERNAME / SPECTRUM_PASSWORD in the task's secrets file.", file=sys.stderr)
        sys.exit(1)

    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    options = Options()
    if os.environ.get("HEADFUL") != "1":
        options.add_argument("--headless=new")
    # Avoid the automation fingerprints that make Spectrum's bot check hang on a spinner.
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument(
        "--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    )
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

        found = find_latest_statement_link(driver, wait)
        if not found:
            fail(driver, "Signed in, but no statement link was found on the billing page.")

        # Pick the candidate with the newest statement date in its label.
        label, link_el = max(
            found, key=lambda c: statement_date(c[0]) or datetime.min
        )
        stmt_dt = statement_date(label)

        # Only proceed if this statement is newer than the last one we
        # downloaded (never re-process an already-submitted bill).
        state = load_state()
        last_dt = None
        if state.get("last_statement_date"):
            try:
                last_dt = datetime.strptime(state["last_statement_date"], "%Y-%m-%d")
            except Exception:
                pass
        elif state.get("last_statement"):
            last_dt = statement_date(state["last_statement"])

        if last_dt is not None and stmt_dt is not None and stmt_dt <= last_dt:
            print(f"[QUIET] No new bill. Latest statement is still: {label}")
            return
        if stmt_dt is None and state.get("last_statement") == label:
            print(f"[QUIET] No new bill. Latest statement is still: {label}")
            return

        # New statement: open it, then click "View Printable Statement" to download.
        print(f"New statement found: {label} - opening it...", flush=True)
        try:
            link_el.click()
        except Exception:
            driver.execute_script("arguments[0].click();", link_el)
        time.sleep(3)

        focus_current_window(driver)
        pdf_link = first_present(
            driver,
            wait,
            [
                (By.XPATH, "//*[contains(normalize-space(), 'View Printable Statement')]"
                           "[self::a or self::button]"),
                (By.PARTIAL_LINK_TEXT, "Printable Statement"),
                (By.XPATH, "//*[self::a or self::button][contains(., 'PDF')]"),
            ],
        )
        if pdf_link is None:
            fail(driver, f"Opened the statement ({label}) but found no 'View Printable Statement' link.")
        try:
            pdf_link.click()
        except Exception:
            driver.execute_script("arguments[0].click();", pdf_link)

        print("Waiting for PDF download...", flush=True)
        pdf = wait_for_download()
        if pdf is None:
            fail(driver, f"Clicked 'View Printable Statement' ({label}) but no PDF downloaded within 30s.")

        # Rename the file to include the statement date, e.g.
        # "spectrum-2026-09-19.pdf" parsed from the label text.
        if stmt_dt:
            try:
                renamed = pdf.with_name(f"spectrum-{stmt_dt:%Y-%m-%d}.pdf")
                pdf.rename(renamed)
                pdf = renamed
            except Exception:
                pass

        print(f"Downloaded new bill: {pdf}")

        focus_current_window(driver)
        upload_to_compt(driver, wait, pdf, label)

        save_state(
            {
                "last_statement": label,
                "last_statement_date": stmt_dt.strftime("%Y-%m-%d") if stmt_dt else None,
                "file": str(pdf),
            }
        )
        notify("Spectrum bill ready", f"New statement downloaded and uploaded to Compt: {pdf.name}")
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
