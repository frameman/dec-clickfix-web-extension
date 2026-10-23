(() => {
  "use strict";

  // Avoid duplicate injection if a page or extension reload causes a second run.
  if (window.__clickFixGuardLoaded) return;
  window.__clickFixGuardLoaded = true;

  const CONFIG = {
    // Keep this small to avoid repeatedly scanning huge pages.
    maxTextLength: 180000,
    debounceMs: 180,
    minAlertScore: 5
  };

  const RULES = [
    {
      id: "fake-captcha-language",
      score: 2,
      label: "Human-verification wording",
      regex: /\b(?:i['’]?m not a robot|i am not a robot|verify you are human|human verification|complete these verification steps|security verification)\b/i
    },
    {
      id: "fake-captcha-branding",
      score: 2,
      label: "CAPTCHA-like overlay or branding",
      selector: [
        ".cjs-container", ".checkbox-window", ".verify-window",
        "[id*='captcha' i]", "[class*='captcha' i]",
        "[aria-label*='captcha' i]"
      ].join(",")
    },
    {
      id: "os-shortcut",
      score: 5,
      label: "Instruction to use a Windows shortcut",
      regex: /\b(?:press|hold|use|hit)\b.{0,45}\b(?:windows?\s*(?:key|button)?|win)\b.{0,35}(?:\+\s*(?:x|r)|power\s*user|run\s*dialog)\b|\b(?:windows?\s*key|win)\s*\+\s*(?:x|r)\b/i
    },
    {
      id: "open-system-tool",
      score: 4,
      label: "Instruction to open a system utility",
      regex: /\b(?:open|launch|start|bring up)\b.{0,55}\b(?:run dialog|powershell|windows terminal|command prompt|cmd(?:\.exe)?|terminal|power user menu)\b/i
    },
    {
      id: "paste-command",
      score: 5,
      label: "Instruction to copy or paste a command",
      regex: /\b(?:copy|paste|type|enter)\b.{0,70}\b(?:command|code|script|powershell|cmd(?:\.exe)?|terminal)\b|\b(?:copy and paste|paste the following|paste this command)\b/i
    },
    {
      id: "execution-language",
      score: 3,
      label: "Command execution wording",
      regex: /\b(?:press\s+enter\s+to\s+run|execute\s+the\s+command|run\s+the\s+following|powershell(?:\.exe)?\s+-|cmd(?:\.exe)?\s+\/c)\b/i
    },
    {
      id: "clipboard-api",
      score: 3,
      label: "Page references clipboard access",
      scriptRegex: /navigator\.clipboard|clipboard\.writeText|document\.execCommand\s*\(\s*['"]copy/i
    },
    {
      id: "obfuscated-script",
      score: 2,
      label: "Obfuscated or dynamically decoded script",
      scriptRegex: /\beval\s*\(\s*(?:atob|decodeURIComponent)|atob\s*\(|data:text\/javascript;base64,/i
    }
  ];

  let scanTimer = null;
  let lastSignature = "";
  let clipboardClearAttempted = false;
  let alertNode = null;
  let shadowRoot = null;

  function safeText() {
    const bodyText = document.body?.innerText || document.documentElement?.innerText || "";
    return bodyText.slice(0, CONFIG.maxTextLength);
  }

  function getPageScripts() {
    let out = "";
    for (const script of document.scripts || []) {
      const value = script.textContent || "";
      if (value) out += value.slice(0, 20000) + "\n";
      if (out.length > 80000) break;
    }
    return out;
  }

  function detectFakeCaptcha(text) {
    const selectors = [
      ".cjs-container", ".checkbox-window", ".verify-window",
      "[id*='captcha' i]", "[class*='captcha' i]"
    ];
    const hasCaptchaElement = selectors.some(sel => {
      try { return !!document.querySelector(sel); } catch { return false; }
    });

    const hasVerificationText =
      /\b(?:i['’]?m not a robot|i am not a robot|complete these verification steps|verify you are human|human verification)\b/i.test(text);

    // A CAPTCHA-like widget alone is not enough to call ClickFix.
    return hasCaptchaElement || hasVerificationText;
  }

  function collectEvidence(text, scripts) {
    const evidence = [];
    let score = 0;
    const fakeCaptcha = detectFakeCaptcha(text);

    for (const rule of RULES) {
      let matched = false;

      if (rule.regex && rule.regex.test(text)) matched = true;
      if (rule.selector) {
        try { if (document.querySelector(rule.selector)) matched = true; } catch {}
      }
      if (rule.scriptRegex && rule.scriptRegex.test(scripts)) matched = true;

      if (matched) {
        evidence.push({ id: rule.id, label: rule.label, score: rule.score });
        score += rule.score;
      }
    }

    // Strongly prioritize the combination: fake verification + OS/command instructions.
    const hasOSOrCommandEvidence = evidence.some(e =>
      ["os-shortcut", "open-system-tool", "paste-command", "execution-language"].includes(e.id)
    );

    if (fakeCaptcha && hasOSOrCommandEvidence) score += 3;

    // A normal CAPTCHA should not be labeled ClickFix just because it says "I'm not a robot".
    let level = "No alert";
    if (score >= 9 && fakeCaptcha && hasOSOrCommandEvidence) level = "High";
    else if (score >= CONFIG.minAlertScore && hasOSOrCommandEvidence) level = "Medium";
    else if (fakeCaptcha && hasOSOrCommandEvidence) level = "Medium";
    else if (score >= 7) level = "Review";

    return { score, level, evidence, fakeCaptcha, hasOSOrCommandEvidence };
  }

  function ensureAlert() {
    if (alertNode?.isConnected) return;
    alertNode = document.createElement("div");
    alertNode.id = "clickfix-guard-alert";
    alertNode.setAttribute("role", "status");
    alertNode.setAttribute("aria-live", "polite");

    // Shadow DOM prevents site CSS from restyling the warning.
    shadowRoot = alertNode.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .cfx-panel {
        box-sizing: border-box; width: 100%; padding: 16px;
        border: 1px solid #b42318; border-radius: 12px;
        background: #fff; color: #202124; box-shadow: 0 8px 28px rgba(0,0,0,.25);
        font: 14px/1.45 Arial, Helvetica, sans-serif;
      }
      .cfx-top { display:flex; align-items:center; justify-content:space-between; gap:12px; }
      .cfx-title { font-size: 15px; font-weight: 700; }
      .cfx-close { border:0; background:transparent; color:#555; cursor:pointer; font-size:24px; line-height:1; }
      .cfx-level { margin-top:10px; font-weight:700; color:#b42318; }
      .cfx-summary { margin:8px 0; }
      .cfx-evidence { margin:8px 0; padding-left:20px; }
      .cfx-evidence li { margin:4px 0; }
      .cfx-note { margin:10px 0 0; padding-top:9px; border-top:1px solid #ddd; font-size:12px; color:#555; }
      .cfx-panel[data-level="medium"] { border-color:#b54708; }
      .cfx-panel[data-level="medium"] .cfx-level { color:#b54708; }
      .cfx-panel[data-level="review"] { border-color:#667085; }
      .cfx-panel[data-level="review"] .cfx-level { color:#475467; }
    `;
    shadowRoot.appendChild(style);

    const wrapper = document.createElement("div");
    wrapper.className = "cfx-panel";
    wrapper.innerHTML = `
      <div class="cfx-top">
        <strong class="cfx-title">ClickFix Guard</strong>
        <button type="button" class="cfx-close" aria-label="Dismiss warning">×</button>
      </div>
      <div class="cfx-level"></div>
      <p class="cfx-summary"></p>
      <ul class="cfx-evidence"></ul>
      <p class="cfx-note">Do not paste commands into Run, PowerShell, or Terminal to complete a CAPTCHA. Clipboard clearing is attempted automatically only when strong ClickFix indicators are detected.</p>
    `;
    shadowRoot.appendChild(wrapper);

    shadowRoot.querySelector(".cfx-close").addEventListener("click", () => {
      alertNode?.remove();
      alertNode = null;
      shadowRoot = null;
    });

    (document.documentElement || document).appendChild(alertNode);
  }

  function renderAlert(result) {
    if (result.level === "No alert") return;

    ensureAlert();
    const panel = shadowRoot.querySelector(".cfx-panel");
    panel.dataset.level = result.level.toLowerCase();

    shadowRoot.querySelector(".cfx-level").textContent =
      `${result.level} risk · Score ${result.score}`;
    shadowRoot.querySelector(".cfx-summary").textContent =
      result.fakeCaptcha && result.hasOSOrCommandEvidence
        ? "This page combines verification-style content with instructions to interact with Windows or run commands."
        : "Suspicious page behavior was found. Review the evidence before proceeding.";

    const list = shadowRoot.querySelector(".cfx-evidence");
    list.replaceChildren();
    for (const item of result.evidence) {
      const li = document.createElement("li");
      li.textContent = item.label;
      list.appendChild(li);
    }
  }

  async function autoClearClipboard(result) {
    // Only act when a verification-style page and OS/command instructions occur together.
    // One attempt per document prevents repeated clipboard writes from DOM mutations.
    if (clipboardClearAttempted) return;
    if (!result.fakeCaptcha || !result.hasOSOrCommandEvidence) return;

    const ids = new Set(result.evidence.map(item => item.id));
    const hasConcreteOSInstruction =
      ids.has("os-shortcut") || ids.has("open-system-tool");
    const hasCommandInstruction =
      ids.has("paste-command") || ids.has("execution-language");

    // Stronger threshold: fake verification plus a Windows/system-tool instruction,
    // and either paste/execute wording or a Windows shortcut explicitly present.
    if (!hasConcreteOSInstruction || !(hasCommandInstruction || ids.has("os-shortcut"))) return;

    clipboardClearAttempted = true;
    try {
      await navigator.clipboard.writeText("");
      console.warn("[ClickFix Guard] Clipboard text cleared automatically after strong ClickFix indicators.");
      const note = shadowRoot?.querySelector(".cfx-note");
      if (note) note.textContent = "Clipboard text was cleared automatically after strong ClickFix indicators were detected.";
    } catch (error) {
      console.warn("[ClickFix Guard] Automatic clipboard clearing was blocked by the browser:", error);
      const note = shadowRoot?.querySelector(".cfx-note");
      if (note) note.textContent = "ClickFix indicators detected, but the browser blocked automatic clipboard clearing. Clear it manually if needed.";
    }
  }

  function scan() {
    scanTimer = null;
    if (!document.documentElement) return;

    const text = safeText();
    const scripts = getPageScripts();
    const result = collectEvidence(text, scripts);

    const signature = JSON.stringify({
      score: result.score,
      level: result.level,
      evidence: result.evidence.map(x => x.id)
    });

    if (signature !== lastSignature) {
      lastSignature = signature;
      if (result.level !== "No alert") renderAlert(result);
      if (result.level === "High" || (result.fakeCaptcha && result.hasOSOrCommandEvidence)) {
        void autoClearClipboard(result);
      }
      // If an earlier scan alerted but the page no longer matches, remove the alert.
      else if (alertNode) {
        alertNode.remove();
        alertNode = null;
        shadowRoot = null;
      }
    }
  }

  function scheduleScan() {
    if (scanTimer !== null) clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, CONFIG.debounceMs);
  }

  // Scan immediately, including pages that inject the overlay after initial load.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scan, { once: true });
  } else {
    scan();
  }

  // Observe dynamically added overlays and changed text without waiting for a click.
  const observer = new MutationObserver(scheduleScan);
  const startObserver = () => {
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
  };
  startObserver();

  // SPA navigations can change URL/content without a full reload.
  let previousUrl = location.href;
  setInterval(() => {
    if (location.href !== previousUrl) {
      previousUrl = location.href;
      scheduleScan();
    }
  }, 1000);
})();
