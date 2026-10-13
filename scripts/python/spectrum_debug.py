"""Debug helper: open spectrum.net login headful, click Sign In, dump every
input element with its attributes, and take a screenshot. Leaves the browser
open for 60s so you can interact with it."""

import os
import time

from dotenv import load_dotenv
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.service import Service

secrets_file = os.environ.get("SECRETS_FILE")
if secrets_file and os.path.exists(secrets_file):
    load_dotenv(secrets_file)

options = Options()
options.add_argument("--disable-blink-features=AutomationControlled")
options.add_experimental_option("excludeSwitches", ["enable-automation"])
options.add_experimental_option("useAutomationExtension", False)
driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
driver.execute_cdp_cmd(
    "Page.addScriptToEvaluateOnNewDocument",
    {"source": "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"},
)

driver.get("https://www.spectrum.net/login")
time.sleep(10)

for xpath in [
    "//a[contains(translate(., 'SIGN', 'sign'), 'sign in')]",
    "//button[contains(translate(., 'SIGN', 'sign'), 'sign in')]",
]:
    els = driver.find_elements(By.XPATH, xpath)
    for el in els:
        if el.is_displayed():
            print("CLICKING:", el.tag_name, el.text.strip()[:60])
            el.click()
            break

time.sleep(8)
driver.save_screenshot("/tmp/spectrum_after_signin.png")
print("URL:", driver.current_url)
print("iframes:", len(driver.find_elements(By.TAG_NAME, "iframe")))
for i, el in enumerate(driver.find_elements(By.TAG_NAME, "input")):
    print(
        f"input[{i}] type={el.get_attribute('type')} name={el.get_attribute('name')} "
        f"id={el.get_attribute('id')} autocomplete={el.get_attribute('autocomplete')} "
        f"displayed={el.is_displayed()} enabled={el.is_enabled()}"
    )

print("Leaving browser open for 60s...")
time.sleep(60)
driver.quit()
