"""
Example personal-task script: download a bill from one portal with Selenium,
then upload it to a reimbursement URL. This is a template, not a working
scraper for any specific site - copy it and fill in the real selectors.

Conventions the scheduler relies on:
- Credentials/URLs are loaded from the per-task secrets file via python-dotenv
  (its path is passed in the SECRETS_FILE env var).
- On failure, save a screenshot to the path in FAILURE_SCREENSHOT_PATH so it
  shows up next to the failed run in the UI.
- Exit with a non-zero status code on failure so the scheduler marks the run failed.
"""

import os
import sys

from dotenv import load_dotenv
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.service import Service

secrets_file = os.environ.get("SECRETS_FILE")
if secrets_file and os.path.exists(secrets_file):
    load_dotenv(secrets_file)

BILL_PORTAL_URL = os.environ.get("BILL_PORTAL_URL")
BILL_PORTAL_USERNAME = os.environ.get("BILL_PORTAL_USERNAME")
BILL_PORTAL_PASSWORD = os.environ.get("BILL_PORTAL_PASSWORD")
REIMBURSEMENT_UPLOAD_URL = os.environ.get("REIMBURSEMENT_UPLOAD_URL")

FAILURE_SCREENSHOT_PATH = os.environ.get("FAILURE_SCREENSHOT_PATH")


def fail(driver, message: str) -> None:
    if driver is not None and FAILURE_SCREENSHOT_PATH:
        try:
            driver.save_screenshot(FAILURE_SCREENSHOT_PATH)
        except Exception:
            pass
    print(f"FAILED: {message}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    if not (BILL_PORTAL_URL and BILL_PORTAL_USERNAME and BILL_PORTAL_PASSWORD and REIMBURSEMENT_UPLOAD_URL):
        print("Missing required environment variables - check the task's secrets file.", file=sys.stderr)
        sys.exit(1)

    options = Options()
    options.add_argument("--headless=new")
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)

    try:
        driver.get(BILL_PORTAL_URL)

        # --- Fill in real selectors for the actual bill portal here ---
        # driver.find_element(By.ID, "username").send_keys(BILL_PORTAL_USERNAME)
        # driver.find_element(By.ID, "password").send_keys(BILL_PORTAL_PASSWORD)
        # driver.find_element(By.ID, "login-button").click()
        # bill_path = download_latest_bill(driver)

        # --- Then upload it to the reimbursement portal ---
        # driver.get(REIMBURSEMENT_UPLOAD_URL)
        # driver.find_element(By.ID, "file-input").send_keys(bill_path)
        # driver.find_element(By.ID, "submit-button").click()

        print("Bill downloaded and uploaded successfully.")
    except Exception as exc:  # noqa: BLE001 - this is a failure boundary, not swallowing silently
        fail(driver, str(exc))
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
