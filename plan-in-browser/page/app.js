  const token = new URLSearchParams(location.search).get("token") || "";
  const headers = { "content-type":"application/json", "x-planning-canvas-token":token };
  const cards = document.querySelector("#cards");
  const artifactList = document.querySelector("#artifact-list");
  const editing = new Set();
  const expandedArtifacts = new Set();
  const artifactViews = new Map();
  let lastSignature = "";
  let sessionTerminal = false;
  let pollTimer;

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers:{ ...headers, ...(options.headers || {}) } });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }

  function signature(state) {
    return JSON.stringify([
      state.status,
      state.tree.map(n => [n.id,n.status,n.answer]),
      (state.artifacts || []).map(a => [a.id,a.revision,a.title,a.error]),
      [...editing],
    ]);
  }

  async function tick() {
    try {
      const state = await api("/state?token=" + encodeURIComponent(token));
      document.querySelector("#banner").classList.remove("visible");
      document.querySelector("#topic").textContent = state.topic;
      document.querySelector("#status").textContent = state.status;
      sessionTerminal = state.status !== "open";
      if (sessionTerminal && pollTimer) clearInterval(pollTimer);
      const nextSignature = signature(state);
      if (nextSignature !== lastSignature) {
        lastSignature = nextSignature;
        render(state);
      }
    } catch {
      if (sessionTerminal) return;
      document.querySelector("#banner").classList.add("visible");
      document.querySelector("#status").textContent = "Offline";
    }
  }

  function render(state) {
    cards.replaceChildren();
    renderArtifacts(state.artifacts || []);
    let active;
    for (const question of state.tree) {
      let card;
      if (editing.has(question.id)) card = questionCard(question, true);
      else if (question.status === "active") card = questionCard(question, false);
      else card = resolvedCard(question);
      cards.append(card);
      if (question.status === "active") active = card;
    }
    const terminal = state.status !== "open";
    const hasActiveQuestion = state.tree.some(question => question.status === "active");
    const thinking = document.querySelector("#thinking");
    thinking.classList.toggle("visible", !terminal && !hasActiveQuestion);
    document.querySelector("#thinking-label").textContent = state.tree.length === 0
      ? "Preparing the first question…"
      : "Generating the next question…";
    document.querySelector("#session-actions").style.display = terminal ? "none" : "block";
    const done = document.querySelector("#done");
    done.style.display = terminal ? "block" : "none";
    done.textContent = state.status === "cancelled" ? "Session cancelled. You can close this tab." : "Session closed. You can close this tab.";
    if (active) active.scrollIntoView({ behavior:"smooth", block:"center" });
  }

  const languageByExtension = {
    bash:"bash", c:"c", cc:"cpp", cjs:"javascript", cpp:"cpp", cs:"csharp", css:"css",
    cts:"typescript", gql:"graphql", go:"go", graphql:"graphql", h:"c", hpp:"cpp", htm:"xml",
    html:"xml", ini:"ini", java:"java", js:"javascript", json:"json", jsonc:"json", jsx:"javascript",
    kt:"kotlin", kts:"kotlin", less:"less", lua:"lua", md:"markdown", mjs:"javascript", mts:"typescript",
    php:"php", pl:"perl", py:"python", rb:"ruby", rs:"rust", scss:"scss", sh:"bash", sql:"sql",
    svelte:"xml", svg:"xml", swift:"swift", toml:"ini", ts:"typescript", tsx:"typescript", vue:"xml",
    wasm:"wasm", xml:"xml", yaml:"yaml", yml:"yaml", zsh:"bash",
  };
  const languageByFilename = {
    dockerfile:"dockerfile", gemfile:"ruby", makefile:"makefile", rakefile:"ruby",
  };

  function artifactLanguage(artifact) {
    const path = artifact.displayPath || artifact.path || "";
    const filename = path.split(/[\\/]/).pop().toLowerCase();
    const extension = filename.includes(".") ? filename.split(".").pop() : "";
    const language = languageByFilename[filename] || languageByExtension[extension];
    return language && window.hljs?.getLanguage(language) ? language : undefined;
  }

  function highlightedCode(content, language, className = "") {
    const classes = [className, language ? `hljs language-${language}` : ""].filter(Boolean).join(" ");
    const code = element("code", classes, content);
    if (language) code.innerHTML = window.hljs.highlight(content, { language, ignoreIllegals:true }).value;
    return code;
  }

  function fileView(artifact, language, beneathToolbar) {
    const pre = element("pre", beneathToolbar ? "artifact-file" : "");
    pre.append(highlightedCode(artifact.content || "", language));
    return pre;
  }

  function parseDiffHunks(text) {
    const hunks = [];
    let hunk;
    let oldLine = 0;
    let newLine = 0;
    for (const line of text.split("\n")) {
      const header = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
      if (header) {
        oldLine = Number(header[1]);
        newLine = Number(header[3]);
        hunk = { header:line, lines:[] };
        hunks.push(hunk);
        continue;
      }
      if (!hunk) continue;
      const marker = line[0];
      if (marker === "\\") {
        hunk.lines.push({ kind:"note", marker:"\\", content:line.slice(1) });
        continue;
      }
      if (marker !== " " && marker !== "+" && marker !== "-") continue;
      const kind = marker === "+" ? "addition" : marker === "-" ? "deletion" : "context";
      const oldNumber = marker === "+" ? undefined : oldLine++;
      const newNumber = marker === "-" ? undefined : newLine++;
      hunk.lines.push({ kind, marker, content:line.slice(1), oldNumber, newNumber });
    }
    return hunks;
  }

  function diffView(artifact, language) {
    const scroll = element("div", "diff-scroll");
    for (const hunk of parseDiffHunks(artifact.diff.text)) {
      const section = element("section", "diff-hunk");
      section.append(element("div", "diff-hunk-header", hunk.header));
      for (const line of hunk.lines) {
        const row = element("div", `diff-line ${line.kind}`);
        row.append(
          element("span", "diff-line-number", line.oldNumber),
          element("span", "diff-line-number", line.newNumber),
          element("span", "diff-marker", line.marker),
          highlightedCode(line.content, line.kind === "note" ? undefined : language, "diff-code"),
        );
        section.append(row);
      }
      scroll.append(section);
    }
    return scroll;
  }

  function artifactContent(artifact, language) {
    if (!artifact.diff) return fileView(artifact, language, false);

    const container = element("div");
    const toolbar = element("div", "artifact-toolbar");
    const options = element("div", "artifact-view-options");
    const changes = element("button", "artifact-view", "Changes");
    const file = element("button", "artifact-view", "File");
    changes.type = file.type = "button";
    changes.title = `Working tree diff against ${artifact.diff.against}`;
    const summary = element("span", "diff-summary");
    summary.append(
      element("span", "additions", `+${artifact.diff.additions}`),
      document.createTextNode(" "),
      element("span", "deletions", `−${artifact.diff.deletions}`),
    );
    options.append(changes, file);
    toolbar.append(options, summary);
    const viewer = element("div");
    container.append(toolbar, viewer);

    const show = view => {
      artifactViews.set(artifact.id, view);
      changes.classList.toggle("active", view === "diff");
      file.classList.toggle("active", view === "file");
      changes.setAttribute("aria-pressed", String(view === "diff"));
      file.setAttribute("aria-pressed", String(view === "file"));
      viewer.replaceChildren(view === "diff" ? diffView(artifact, language) : fileView(artifact, language, true));
    };
    changes.onclick = () => show("diff");
    file.onclick = () => show("file");
    show(artifactViews.get(artifact.id) || "diff");
    return container;
  }

  function renderArtifacts(artifacts) {
    artifactList.replaceChildren();
    if (artifacts.length === 0) {
      artifactList.append(element("div", "", "Artifacts changed during this planning session will appear here."));
      artifactList.firstElementChild.id = "artifact-empty";
      return;
    }
    for (const artifact of artifacts) {
      const details = element("details", "artifact");
      details.open = expandedArtifacts.has(artifact.id);
      details.ontoggle = () => {
        if (details.open) expandedArtifacts.add(artifact.id);
        else expandedArtifacts.delete(artifact.id);
      };
      const summary = element("summary");
      summary.append(element("span", "artifact-path", artifact.title || artifact.displayPath || artifact.path));
      const language = artifactLanguage(artifact);
      if (language) summary.append(element("span", "artifact-language", language));
      details.append(summary);
      if (artifact.error) details.append(element("div", "artifact-error", artifact.error));
      else details.append(artifactContent(artifact, language));
      artifactList.append(details);
    }
  }

  function resolvedCard(question) {
    const card = element("article", question.status === "pending" ? "pending" : "");
    const head = element("div", "card-head");
    head.append(element("h2", "", question.question));
    if (question.answer) {
      const edit = element("button", "link", "Edit");
      edit.onclick = () => { editing.add(question.id); lastSignature = ""; tick(); };
      head.append(edit);
    }
    card.append(head);
    if (question.answer) {
      const answers = element("div", "answers");
      for (const id of question.answer.selectedOptionIds || []) {
        const option = (question.options || []).find(item => item.id === id);
        answers.append(element("span", "chip", option ? option.label : id === "__other__" ? "None of the above" : id));
      }
      card.append(answers);
      if (question.answer.note) card.append(element("blockquote", "", question.answer.note));
    } else {
      card.append(element("p", "context", "Waiting for a later decision."));
    }
    return card;
  }

  function questionCard(question, isEdit) {
    const card = element("article", "active" + (isEdit ? " editing" : ""));
    card.append(element("h2", "", question.question));
    if (question.context) card.append(element("p", "context", question.context));
    if (question.recommendation) card.append(element("div", "recommendation", "★ " + question.recommendation));

    const form = element("form");
    const selected = new Set(question.answer?.selectedOptionIds || question.recommendedOptionIds || []);
    if (question.answerType === "single" || question.answerType === "multi") {
      const options = element("div", "options");
      const type = question.answerType === "single" ? "radio" : "checkbox";
      for (const option of [...(question.options || []), { id:"__other__", label:"None of the above", detail:"Write your answer in the note below." }]) {
        const label = element("label", "option");
        const input = element("input");
        input.type = type;
        input.name = "choice";
        input.value = option.id;
        input.checked = selected.has(option.id);
        const copy = element("span");
        copy.append(element("strong", "", option.label));
        if (option.detail) copy.append(element("span", "detail", option.detail));
        label.append(input, copy);
        options.append(label);
      }
      form.append(options);
    }

    const note = element("textarea");
    note.name = "note";
    note.value = question.answer?.note || "";
    note.placeholder = question.answerType === "free" ? "Your answer…" : "Add a caveat or write your own answer…";
    form.append(note);

    const actions = element("div", "actions");
    const submit = element("button", "primary", isEdit ? "Save change" : question.answerType === "confirm" ? "Confirm" : "Answer");
    submit.type = "submit";
    actions.append(submit);
    if (isEdit) {
      const cancel = element("button", "quiet", "Cancel edit");
      cancel.type = "button";
      cancel.onclick = () => { editing.delete(question.id); lastSignature = ""; tick(); };
      actions.append(cancel);
    }
    form.append(actions);
    form.onsubmit = async event => {
      event.preventDefault();
      let selectedOptionIds = [];
      if (question.answerType === "confirm") selectedOptionIds = ["confirmed"];
      else if (question.answerType !== "free") selectedOptionIds = [...form.querySelectorAll('input[name="choice"]:checked')].map(input => input.value);
      await api(isEdit ? "/edit" : "/answer", { method:"POST", body:JSON.stringify({ nodeId:question.id, selectedOptionIds, note:note.value.trim() }) });
      editing.delete(question.id);
      lastSignature = "";
      tick();
    };
    card.append(form);
    return card;
  }

  document.querySelector("#cancel-session").onclick = async () => {
    if (!confirm("Cancel this planning session?")) return;
    await api("/cancel", { method:"POST", body:"{}" });
    lastSignature = "";
    tick();
  };

  tick();
  pollTimer = setInterval(tick, 1000);
