"""Debug helper: log in to Compt with the saved profile, open the claim
drawer, pick Internet, upload the latest downloaded PDF, then DUMP the form
DOM (labels, inputs, selects, buttons) and take a screenshot. Does NOT click
Submit or anything else dangerous."""

import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from spectrum_invoice import (  # noqa: E402
    CHROME_PROFILE_DIR, COMPT_URL, DOWNLOAD_DIR, first_present,
    focus_current_window, type_into, COMPT_USERNAME, COMPT_PASSWORD,
)
from selenium import webdriver  # noqa: E402
from selenium.webdriver.chrome.options import Options  # noqa: E402
from selenium.webdriver.common.by import By  # noqa: E402
from selenium.webdriver.support.ui import WebDriverWait  # noqa: E402
from webdriver_manager.chrome import ChromeDriverManager  # noqa: E402
from selenium.webdriver.chrome.service import Service  # noqa: E402

WAIT = 60
pdf = sorted(DOWNLOAD_DIR.glob("*.pdf"), key=lambda p: p.stat().st_mtime)[-1]
print("Using PDF:", pdf)

options = Options()
options.add_argument("--disable-blink-features=AutomationControlled")
options.add_experimental_option("excludeSwitches", ["enable-automation"])
options.add_experimental_option("useAutomationExtension", False)
options.add_argument(f"--user-data-dir={CHROME_PROFILE_DIR}")
driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
wait = WebDriverWait(driver, WAIT)

driver.get(f"{COMPT_URL}/login/")
time.sleep(5)
print("URL after login nav:", driver.current_url)

open_claim = first_present(driver, wait, [
    (By.XPATH, "//button[contains(., 'Submit a claim')]"),
    (By.XPATH, "//*[self::a or self::button][contains(., 'Submit a claim')]"),
])
print("open_claim:", open_claim and open_claim.text)
open_claim.click()
time.sleep(3)

internet = None
deadline = time.time() + WAIT
while internet is None and time.time() < deadline:
    matches = driver.find_elements(By.XPATH, "//*[contains(., 'Internet') and contains(., 'Claim here')]")
    for el in reversed(matches):
        if el.is_displayed():
            internet = el
            break
    time.sleep(0.5)
print("internet row:", internet.text.replace(chr(10), ' | ') if internet is not None else None)
internet.click()
time.sleep(3)

fi = first_present(driver, wait, [(By.CSS_SELECTOR, "input[type='file']")], visible_only=False)
fi.send_keys(str(pdf))
time.sleep(8)
driver.save_screenshot("/tmp/compt_form_dump.png")

print("\n=== LABELS ===")
for el in driver.find_elements(By.XPATH, "//*[not(*)]"):
    try:
        t = (el.text or "").strip()
        if t and len(t) < 50 and el.is_displayed():
            print(f"  {el.tag_name}: {t!r}")
    except Exception:
        pass

print("\n=== INPUTS ===")
for i, el in enumerate(driver.find_elements(By.TAG_NAME, "input")):
    try:
        print(
            f"  input[{i}] type={el.get_attribute('type')} name={el.get_attribute('name')} "
            f"id={el.get_attribute('id')} placeholder={el.get_attribute('placeholder')} "
            f"aria-label={el.get_attribute('aria-label')} displayed={el.is_displayed()}"
        )
    except Exception:
        pass

print("\n=== SELECTS / LISTBOXES / BUTTONS ===")
for tag in ["select", "button"]:
    for i, el in enumerate(driver.find_elements(By.TAG_NAME, tag)):
        try:
            if not el.is_displayed():
                continue
            print(f"  {tag}[{i}] text={(el.text or '').strip()[:50]!r} aria={el.get_attribute('aria-label')} disabled={el.get_attribute('disabled')}")
        except Exception:
            pass
for i, el in enumerate(driver.find_elements(By.CSS_SELECTOR, "[role='listbox'], [role='combobox'], [role='option']")):
    try:
        print(f"  role[{i}] role={el.get_attribute('role')} text={(el.text or '').strip()[:60]!r} displayed={el.is_displayed()}")
    except Exception:
        pass

print("\nLeaving browser open 90s for manual inspection...")
time.sleep(90)
driver.quit()
