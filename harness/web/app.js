const out = document.querySelector("#out");
const status = document.querySelector("#status");
const actions = document.querySelector("#actions");
const banner = document.querySelector("#banner");

function show(value) {
  out.textContent = JSON.stringify(value, null, 2);
}

async function refresh() {
  const response = await fetch("/api/status");
  const body = await response.json();
  status.textContent = JSON.stringify(body, null, 2);
}

async function run(action, input) {
  show({ running: action });
  const response = await fetch("/api/act", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, input }),
  });
  const body = await response.json();
  show(body);
  refresh().catch(() => undefined);
}

function fieldValue(form, name) {
  const input = form.querySelector(`[name="${name}"]`);
  return input ? input.value : "";
}

function render(list) {
  actions.textContent = "";
  for (const action of list) {
    const form = document.createElement("form");
    const title = document.createElement("strong");
    title.textContent = action.id;
    form.append(title, document.createTextNode(` — ${action.summary}`));
    form.append(document.createElement("br"));
    for (const field of action.fields) {
      const label = document.createElement("label");
      label.textContent = `${field.label} `;
      const input = document.createElement("input");
      input.name = field.name;
      input.value = field.default || "";
      label.append(input);
      form.append(label, document.createTextNode(" "));
    }
    const button = document.createElement("button");
    button.type = "submit";
    button.textContent = "Run";
    form.append(button);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = {};
      for (const field of action.fields) {
        const value = fieldValue(form, field.name);
        if (value !== "") input[field.name] = value;
      }
      run(action.id, input).catch((err) => show({ error: String(err) }));
    });
    actions.append(form, document.createElement("hr"));
  }
}

fetch("/api/surface").then((response) => response.json()).then((body) => {
  banner.textContent = `mode: ${body.mode}. Writes are refused on every chain except local Anvil.`;
  render(body.actions);
}).catch((err) => { banner.textContent = String(err); });

refresh().catch((err) => { status.textContent = String(err); });
