export const SIMULATED_BANNER = "SIMULATED PHONE – NOT A REAL iMESSAGE";
export const DISCLAIMER = "For communication and education. Not for diagnosis.";

/** Static page for /phone (mock mode). Data is rendered with textContent only. */
export function phonePageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Simulated phone</title>
<style>
  body { margin: 0; font-family: -apple-system, system-ui, sans-serif; background: #e9e9ee; display: flex; justify-content: center; }
  .phone { width: 375px; min-height: 100vh; background: #fff; display: flex; flex-direction: column; }
  .banner { background: #b00020; color: #fff; font-weight: 700; text-align: center; padding: 10px; letter-spacing: .04em; }
  .thread { flex: 1; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
  .bubble { background: #e5e5ea; border-radius: 18px; padding: 10px 14px; max-width: 85%; }
  .mine { align-self: flex-end; background: #0b84ff; color: #fff; }
  .card img { width: 100%; border-radius: 12px; display: block; margin-bottom: 4px; }
  .caption { font-size: 12px; color: #555; margin-bottom: 8px; }
  .poll button { display: block; width: 100%; margin-top: 6px; padding: 10px; border-radius: 10px; border: 1px solid #0b84ff; background: #fff; color: #0b84ff; font-size: 15px; cursor: pointer; }
  .poll button[aria-pressed="true"] { background: #0b84ff; color: #fff; }
  .optin button { padding: 10px 14px; border-radius: 18px; border: 0; background: #0b84ff; color: #fff; font-size: 15px; cursor: pointer; }
  footer { font-size: 12px; color: #555; text-align: center; padding: 10px; border-top: 1px solid #ddd; }
</style>
</head>
<body>
<div class="phone">
  <div class="banner" role="status">${SIMULATED_BANNER}</div>
  <div class="thread" id="thread"></div>
  <footer>${DISCLAIMER}</footer>
</div>
<script type="module">
const thread = document.getElementById("thread");
const votes = new Map();
let lastKey = "";

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c) node.append(c);
  return node;
}

async function inbound(content) {
  const res = await fetch("/api/messaging/mock/inbound", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) console.warn("inbound rejected", res.status);
}

function render(data) {
  const key = JSON.stringify([data, [...votes]]);
  if (key === lastKey) return;
  lastKey = key;
  thread.replaceChildren();
  if (!data.optedIn) {
    thread.append(
      el("div", { class: "bubble", text: "This simulated phone has not opted in. Patients opt in by texting the keyword to the clinic number." }),
      el("div", { class: "optin" }, el("button", { text: "Text " + data.keyword, onclick: () => inbound({ type: "text", text: data.keyword }) })),
    );
    return;
  }
  thread.append(el("div", { class: "bubble mine", text: data.keyword }));
  for (const m of data.messages) {
    const card = el("div", { class: "bubble card" });
    for (const s of m.snapshots) {
      card.append(el("img", { src: s.url, alt: s.label }), el("div", { class: "caption", text: s.label }));
    }
    card.append(el("div", { text: m.text }));
    thread.append(card);
    const poll = el("div", { class: "bubble poll" }, el("div", { text: m.poll.title }));
    for (const o of m.poll.options) {
      const k = m.poll.guid + "/" + o.id;
      const selected = votes.get(k) === true;
      poll.append(el("button", {
        text: o.label,
        "aria-pressed": String(selected),
        onclick: async () => {
          votes.set(k, !selected);
          await inbound({ type: "poll_option", option: { title: o.label, optionIdentifier: o.id }, pollMessageGuid: m.poll.guid, selected: !selected });
          refresh();
        },
      }));
    }
    thread.append(poll);
  }
}

async function refresh() {
  try {
    const res = await fetch("/api/messaging/mock/inbox");
    if (res.ok) render(await res.json());
  } catch (err) {
    console.warn(err);
  }
}
refresh();
setInterval(refresh, 1000);
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** The page a mini-app card opens: the verified text exactly as sent, and the disclaimer. */
export function sharePageHtml(verifiedText: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Message from your care team</title>
<style>
body{font:17px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:24px;max-width:640px;color:#111}
h1{font-size:18px}footer{margin-top:32px;color:#555;font-size:14px}
</style>
</head>
<body>
<h1>Message from your care team</h1>
<p>${escapeHtml(verifiedText)}</p>
<p>Reply to the poll in Messages to let your care team know.</p>
<footer>${DISCLAIMER}</footer>
</body>
</html>`;
}
