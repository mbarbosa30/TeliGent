(function() {
  "use strict";

  var scriptTag = document.currentScript;
  if (!scriptTag) return;

  var widgetKey = scriptTag.getAttribute("data-widget-key");
  if (!widgetKey) {
    console.error("TeliGent Widget: Missing data-widget-key attribute");
    return;
  }

  var API_BASE = scriptTag.src.replace(/\/widget\.js.*$/, "");
  var SESSION_KEY = "tg_widget_sid_" + widgetKey.substring(0, 8);
  var sessionId = localStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = "w_" + Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem(SESSION_KEY, sessionId);
  }

  var isOpen = false;
  var messages = [];
  var botName = "Assistant";
  var greeting = "Hi! How can I help you?";
  var isLoading = false;
  var unreadCount = 0;

  var style = document.createElement("style");
  style.textContent = [
    "#tg-widget-root{position:fixed;bottom:20px;right:20px;z-index:999999;font-family:'Space Grotesk',system-ui,-apple-system,sans-serif}",
    "#tg-widget-root *{box-sizing:border-box;margin:0;padding:0}",
    "#tg-bubble{width:56px;height:56px;background:#000;color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;position:relative;transition:transform 0.15s}",
    "#tg-bubble:hover{transform:scale(1.05)}",
    "#tg-bubble svg{width:24px;height:24px}",
    "#tg-badge{position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;font-size:11px;font-weight:600;min-width:18px;height:18px;display:flex;align-items:center;justify-content:center;padding:0 4px}",
    "#tg-panel{display:none;position:absolute;bottom:68px;right:0;width:380px;height:520px;background:#fff;border:1px solid #e5e5e5;flex-direction:column;overflow:hidden}",
    "#tg-panel.open{display:flex}",
    "#tg-header{padding:16px;background:#000;color:#fff;display:flex;align-items:center;gap:10px;flex-shrink:0}",
    "#tg-header-icon{width:32px;height:32px;background:rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center}",
    "#tg-header-icon svg{width:18px;height:18px}",
    "#tg-header-name{font-size:14px;font-weight:600}",
    "#tg-header-status{font-size:11px;opacity:0.7}",
    "#tg-close{margin-left:auto;background:none;border:none;color:#fff;cursor:pointer;padding:4px;opacity:0.7}",
    "#tg-close:hover{opacity:1}",
    "#tg-close svg{width:18px;height:18px}",
    "#tg-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px}",
    ".tg-msg{max-width:85%;padding:10px 14px;font-size:13px;line-height:1.5;word-wrap:break-word;white-space:pre-wrap}",
    ".tg-msg-user{align-self:flex-end;background:#000;color:#fff}",
    ".tg-msg-bot{align-self:flex-start;background:#f5f5f5;color:#000;border:1px solid #e5e5e5}",
    ".tg-typing{align-self:flex-start;background:#f5f5f5;padding:10px 14px;border:1px solid #e5e5e5}",
    ".tg-typing-dots{display:flex;gap:4px}",
    ".tg-typing-dots span{width:6px;height:6px;background:#999;display:block;animation:tg-blink 1.4s infinite}",
    ".tg-typing-dots span:nth-child(2){animation-delay:0.2s}",
    ".tg-typing-dots span:nth-child(3){animation-delay:0.4s}",
    "@keyframes tg-blink{0%,80%,100%{opacity:0.3}40%{opacity:1}}",
    "#tg-input-area{padding:12px;border-top:1px solid #e5e5e5;display:flex;gap:8px;flex-shrink:0}",
    "#tg-input{flex:1;border:1px solid #e5e5e5;padding:8px 12px;font-size:13px;font-family:inherit;outline:none;resize:none;height:38px;max-height:80px}",
    "#tg-input:focus{border-color:#000}",
    "#tg-send{background:#000;color:#fff;border:none;padding:0 14px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}",
    "#tg-send:disabled{opacity:0.4;cursor:not-allowed}",
    "#tg-send svg{width:16px;height:16px}",
    "#tg-powered{text-align:center;padding:6px;font-size:10px;color:#999;border-top:1px solid #f0f0f0;flex-shrink:0}",
    "#tg-powered a{color:#666;text-decoration:none}",
    "#tg-powered a:hover{text-decoration:underline}",
    "@media(max-width:440px){#tg-panel{width:calc(100vw - 24px);right:-8px;height:70vh;bottom:64px}#tg-widget-root{bottom:12px;right:12px}}",
    "@media(prefers-color-scheme:dark){#tg-panel{background:#1a1a1a;border-color:#333}",
    ".tg-msg-bot{background:#262626;color:#e5e5e5;border-color:#333}",
    "#tg-input{background:#262626;color:#e5e5e5;border-color:#333}#tg-input:focus{border-color:#fff}",
    "#tg-input-area{border-color:#333}.tg-typing{background:#262626;border-color:#333}",
    "#tg-powered{border-color:#333}#tg-powered a{color:#888}}"
  ].join("\n");
  document.head.appendChild(style);

  var root = document.createElement("div");
  root.id = "tg-widget-root";
  root.innerHTML = [
    '<div id="tg-panel">',
    '  <div id="tg-header">',
    '    <div id="tg-header-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>',
    '    <div><div id="tg-header-name"></div><div id="tg-header-status">Online</div></div>',
    '    <button id="tg-close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>',
    '  </div>',
    '  <div id="tg-messages"></div>',
    '  <div id="tg-input-area">',
    '    <textarea id="tg-input" placeholder="Type a message..." rows="1"></textarea>',
    '    <button id="tg-send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>',
    '  </div>',
    '  <div id="tg-powered">Powered by <a href="https://teli.gent" target="_blank" rel="noopener">TeliGent</a></div>',
    '</div>',
    '<button id="tg-bubble">',
    '  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    '</button>'
  ].join("\n");
  document.body.appendChild(root);

  var panel = document.getElementById("tg-panel");
  var bubble = document.getElementById("tg-bubble");
  var closeBtn = document.getElementById("tg-close");
  var msgContainer = document.getElementById("tg-messages");
  var input = document.getElementById("tg-input");
  var sendBtn = document.getElementById("tg-send");
  var headerName = document.getElementById("tg-header-name");

  function togglePanel() {
    isOpen = !isOpen;
    panel.classList.toggle("open", isOpen);
    if (isOpen) {
      unreadCount = 0;
      updateBadge();
      input.focus();
      scrollToBottom();
    }
  }

  function updateBadge() {
    var existing = document.getElementById("tg-badge");
    if (unreadCount > 0 && !isOpen) {
      if (!existing) {
        var badge = document.createElement("span");
        badge.id = "tg-badge";
        badge.textContent = unreadCount;
        bubble.appendChild(badge);
      } else {
        existing.textContent = unreadCount;
      }
    } else if (existing) {
      existing.remove();
    }
  }

  function scrollToBottom() {
    setTimeout(function() {
      msgContainer.scrollTop = msgContainer.scrollHeight;
    }, 50);
  }

  function addMessage(role, content) {
    messages.push({ role: role, content: content });
    var div = document.createElement("div");
    div.className = "tg-msg tg-msg-" + (role === "user" ? "user" : "bot");
    div.textContent = content;
    msgContainer.appendChild(div);
    scrollToBottom();
    if (role === "assistant" && !isOpen) {
      unreadCount++;
      updateBadge();
    }
  }

  function showTyping() {
    var div = document.createElement("div");
    div.className = "tg-typing";
    div.id = "tg-typing";
    div.innerHTML = '<div class="tg-typing-dots"><span></span><span></span><span></span></div>';
    msgContainer.appendChild(div);
    scrollToBottom();
  }

  function hideTyping() {
    var el = document.getElementById("tg-typing");
    if (el) el.remove();
  }

  function sendMessage() {
    var text = input.value.trim();
    if (!text || isLoading) return;
    input.value = "";
    input.style.height = "38px";
    addMessage("user", text);
    isLoading = true;
    sendBtn.disabled = true;
    showTyping();

    fetch(API_BASE + "/api/widget/" + widgetKey + "/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        sessionId: sessionId,
        pageUrl: window.location.href
      })
    })
    .then(function(res) {
      if (!res.ok) throw new Error("Request failed");
      return res.json();
    })
    .then(function(data) {
      hideTyping();
      addMessage("assistant", data.response);
    })
    .catch(function() {
      hideTyping();
      addMessage("assistant", "Sorry, I'm having trouble responding right now. Please try again.");
    })
    .finally(function() {
      isLoading = false;
      sendBtn.disabled = false;
    });
  }

  bubble.addEventListener("click", togglePanel);
  closeBtn.addEventListener("click", togglePanel);
  sendBtn.addEventListener("click", sendMessage);

  input.addEventListener("keydown", function(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  input.addEventListener("input", function() {
    this.style.height = "38px";
    this.style.height = Math.min(this.scrollHeight, 80) + "px";
  });

  fetch(API_BASE + "/api/widget/" + widgetKey + "/config")
    .then(function(res) {
      if (!res.ok) throw new Error("Widget not found");
      return res.json();
    })
    .then(function(data) {
      botName = data.botName || "Assistant";
      greeting = data.greeting || "Hi! How can I help you?";
      headerName.textContent = botName;
      addMessage("assistant", greeting);
    })
    .catch(function(err) {
      console.error("TeliGent Widget: Failed to load config", err);
      headerName.textContent = "Chat";
      addMessage("assistant", "Hi! How can I help you?");
    });
})();
