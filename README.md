# ClickFix Guard (Chrome Extension, Manifest V3)

## Install locally
1. Extract `clickfix-guard-extension.zip`.
2. Open `chrome://extensions` in Chrome or Edge.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted `clickfix_guard_extension` folder.

## What it detects
- Fake CAPTCHA / human-verification wording and common overlay selectors.
- Windows shortcut instructions such as Windows + X and Win + R.
- Instructions to open Run, PowerShell, Terminal, Command Prompt, or paste commands.
- Supporting clues in inline scripts, such as clipboard API use and some common obfuscation patterns.
- Overlays inserted dynamically after page load.

## Important limitations
- This is a heuristic prototype, not a guarantee of maliciousness or a replacement for browser reputation/security controls.
- It scans accessible DOM and inline scripts in each frame. It cannot inspect cross-origin iframe contents from the parent frame, browser UI, or all dynamically fetched/external scripts.
- Text can be obfuscated, translated, rendered in images, or changed to evade these rules.
- `all_frames` helps inspect frames where Chrome permits injection, but browser-internal pages and restricted URLs are not accessible.
- The broad host permissions are required for automatic scanning across sites. For a narrower deployment, restrict `host_permissions` and `content_scripts.matches` to the sites you want to test.
- The current version shows a page warning; it does not block navigation or disable page controls.

## Testing
Use a controlled test HTML page containing:
- "I'm not a robot"
- "Press Windows Key + X"
- "Open PowerShell and paste the following command"

A normal CAPTCHA that only says "I'm not a robot" should not produce a ClickFix alert by itself.


## Clipboard clearing
When a suspicious ClickFix warning appears, the warning panel includes a **Clear clipboard** button. The extension clears clipboard text only after the user explicitly clicks that button; it does not automatically erase clipboard contents. Clearing is best-effort and depends on browser clipboard permissions and context. Re-load the unpacked extension after updating it.


## Automatic clipboard clearing
The extension attempts to clear clipboard text automatically, without a button, when a verification-style page is combined with concrete Windows/system-tool instructions. It attempts this only once per page. This may remove legitimate copied text, and Chrome may block the attempt depending on context or permissions. A failed attempt is logged in the page's developer console. This behavior is heuristic and should be tested in a controlled environment.
