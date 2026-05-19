// Twilight Sword Foundry v13 system


// Utility Helpers 


function buildPips(value, max, type) {
  const pips = [];
  value = Number(value ?? 0);
  max = Number(max ?? 0);

  for (let i = 1; i <= max; i++) {
    pips.push({ filled: i <= value, type, value: i });
  }

  return pips;
}

async function confirmDialog(title, content) {
  return new Promise(resolve => {
    new Dialog({
      title,
      content: `<p>${content}</p>`,
      buttons: {
        yes: { label: "Yes", callback: () => resolve(true) },
        no: { label: "No", callback: () => resolve(false) }
      },
      default: "no",
      close: () => resolve(false)
    }).render(true);
  });
}

function getRawHtmlElement(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

function getCompendiumFolderIdFromClick(target) {
  return target.closest("[data-folder-id]")?.dataset.folderId || null;
}

function getDialogForm(root, selector) {
  if (root instanceof HTMLFormElement) return root;
  if (root instanceof HTMLElement) return root.querySelector(selector);
  if (root?.[0] instanceof HTMLElement) return root[0].querySelector(selector);
  return null;
}

async function createWorldCompendiumFromDialog(event, folderId = null) {
  event.preventDefault();
  event.stopPropagation();

  if (!game.user.isGM) {
    ui.notifications.warn("Only a GM can create compendiums.");
    return null;
  }

  const types = CONST.COMPENDIUM_DOCUMENT_TYPES.reduce((types, documentName) => {
    types[documentName] = game.i18n.localize(getDocumentClass(documentName).metadata.label);
    return types;
  }, {});
  const html = await renderTemplate("templates/sidebar/compendium-create.html", { types });

  return Dialog.prompt({
    title: game.i18n.localize("COMPENDIUM.Create"),
    content: html,
    label: game.i18n.localize("COMPENDIUM.Create"),
    callback: async dialogHtml => {
      const form = getDialogForm(dialogHtml, "#compendium-create");
      const fd = new FormDataExtended(form);
      const metadata = fd.object;

      if (!metadata.label) {
        let defaultName = game.i18n.format("DOCUMENT.New", {
          type: game.i18n.localize("PACKAGE.TagCompendium")
        });
        const count = game.packs.size;
        if (count > 0) defaultName += ` (${count + 1})`;
        metadata.label = defaultName;
      }

      if (["Actor", "Item"].includes(metadata.type)) {
        metadata.system = game.system.id;
      }

      const pack = await CompendiumCollection.createCompendium(metadata);

      if (folderId && game.CF?.CompendiumFolder?.collection) {
        const folder = game.CF.CompendiumFolder.collection.get(folderId);
        if (folder?.addCompendium) await folder.addCompendium(pack.collection);
      }

      ui.compendium?.render(true);
      return pack;
    },
    rejectClose: false,
    options: { jQuery: false }
  });
}

async function createCompendiumFolderFromDialog(event, parentFolderId = null) {
  event.preventDefault();
  event.stopPropagation();

  if (!game.user.isGM) {
    ui.notifications.warn("Only a GM can create compendium folders.");
    return null;
  }

  if (!game.CF?.CompendiumFolder) {
    ui.notifications.warn("Compendium folders require the Compendium Folders module.");
    return null;
  }

  return Dialog.prompt({
    title: game.i18n.localize("FOLDER.Create"),
    content: `
      <form class="twilight-compendium-folder-create">
        <div class="form-group">
          <label>${game.i18n.localize("Name")}</label>
          <input type="text" name="name" placeholder="${game.i18n.localize("FOLDER.Create")}" autofocus>
        </div>
      </form>
    `,
    label: game.i18n.localize("FOLDER.Create"),
    callback: async dialogHtml => {
      const form = getDialogForm(dialogHtml, "form");
      const fd = new FormDataExtended(form);
      const folderName = String(fd.object.name || "").trim() || game.i18n.localize("FOLDER.Create");
      const parentFolder = parentFolderId
        ? game.CF.CompendiumFolder.collection?.get(parentFolderId)
        : null;
      const data = {
        titleText: folderName,
        parent: parentFolder?.id || null,
        pathToFolder: parentFolder ? parentFolder.path.concat(parentFolder.id) : []
      };
      const folder = game.CF.CompendiumFolder.create(data);

      await folder.save(true);
      ui.compendium?.render(true);
      return folder;
    },
    rejectClose: false,
    options: { jQuery: false }
  });
}

function installCompendiumCreationFallbacks() {
  document.addEventListener("click", event => {
    const createCompendiumButton = event.target.closest(
      "#compendium .create-compendium, #compendium .create-entity-c"
    );

    if (createCompendiumButton) {
      event.stopImmediatePropagation();
      createWorldCompendiumFromDialog(event, getCompendiumFolderIdFromClick(createCompendiumButton));
      return;
    }

    const createFolderButton = event.target.closest("#compendium .create-folder");

    if (createFolderButton) {
      event.stopImmediatePropagation();
      createCompendiumFolderFromDialog(event, getCompendiumFolderIdFromClick(createFolderButton));
    }
  }, true);
}

function addCompendiumPackCreationControls(app, html) {
  if (!game.user.isGM || !app.collection || app.collection.locked) return;

  const root = getRawHtmlElement(html);
  const wrapper = root?.querySelector(".compendium.directory");
  if (!wrapper || wrapper.querySelector(".twilight-compendium-controls")) return;

  let footer = wrapper.querySelector(".directory-footer");
  if (!footer) {
    footer = document.createElement("footer");
    footer.classList.add("directory-footer", "flexrow");
    wrapper.appendChild(footer);
  }

  const controls = document.createElement("div");
  controls.classList.add("twilight-compendium-controls", "flexrow");
  controls.innerHTML = `
    <button type="button" class="twilight-compendium-create-entry">
      <i class="fas fa-plus"></i> Create Entry
    </button>
  `;

  controls.querySelector(".twilight-compendium-create-entry").addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();

    const cls = app.collection.documentClass;
    if (!cls?.createDialog) {
      ui.notifications.warn("This compendium type cannot create entries directly.");
      return;
    }

    await cls.createDialog({}, {
      pack: app.collection.collection,
      top: event.currentTarget.offsetTop,
      left: window.innerWidth - 630,
      width: 320
    });

    app.collection.render(false);
  });

  footer.prepend(controls);
}


// Status Helpers 


function getStatusIds(actor) {
  const ids = new Set();

  for (const effect of actor.effects.contents) {
    for (const status of Array.from(effect.statuses || [])) {
      ids.add(status);
    }
  }

  return ids;
}

async function actorHasStatus(actor, statusId) {
  return getStatusIds(actor).has(statusId);
}

async function hasStatus(actor, statusId) {
  return actorHasStatus(actor, statusId);
}

function getActorStatusEffects(actor) {
  const activeIds = getStatusIds(actor);

  return CONFIG.statusEffects.map(effect => ({
    id: effect.id,
    name: effect.name,
    icon: effect.icon,
    active: activeIds.has(effect.id)
  }));
}

function normalizeStatusId(statusId) {
  const id = String(statusId || "").trim().toLowerCase();
  const effect = CONFIG.statusEffects?.find(e => e.id === id);

  return effect ? effect.id : "";
}

function getStatusConfig(statusId) {
  const id = normalizeStatusId(statusId);

  return CONFIG.statusEffects?.find(e => e.id === id) || null;
}

function getStatusLabel(statusId) {
  return getStatusConfig(statusId)?.name || "";
}

function buildStatusOptions(selectedStatus = "") {
  const selected = normalizeStatusId(selectedStatus);
  const options = ['<option value="">None</option>'];

  for (const effect of CONFIG.statusEffects || []) {
    options.push(
      `<option value="${effect.id}" ${effect.id === selected ? "selected" : ""}>${effect.name}</option>`
    );
  }

  return options.join("");
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripHtml(value = "") {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function rollStatusDuration(durationFormula = "") {
  const formula = String(durationFormula || "").trim();

  if (!formula) return { rounds: null, roll: null, text: "" };

  const numericDuration = Number(formula);

  if (Number.isFinite(numericDuration)) {
    const rounds = Math.max(Math.floor(numericDuration), 0);

    return {
      rounds: rounds || null,
      roll: null,
      text: rounds ? `${rounds} ${rounds === 1 ? "round" : "rounds"}` : ""
    };
  }

  const roll = await new Roll(formula).evaluate();
  const rounds = Math.max(Math.floor(Number(roll.total)), 0);

  return {
    rounds: rounds || null,
    roll,
    text: rounds ? `${rounds} ${rounds === 1 ? "round" : "rounds"}` : ""
  };
}

async function addStatus(actor, statusId, {
  durationRounds = null,
  repeatBehavior = "ignore"
} = {}) {
  statusId = normalizeStatusId(statusId);
  if (!statusId) return null;

  const effect = getStatusConfig(statusId);
  if (!effect) return null;

  const existing = actor.effects.find(e => e.statuses?.has(statusId));
  const rounds = Number(durationRounds);
  const hasDuration = Number.isFinite(rounds) && rounds > 0;

  if (existing) {
    if (repeatBehavior !== "extend") return null;

    const currentRounds = Number(existing.duration?.rounds ?? 0);

    if (hasDuration && currentRounds > 0) {
      await existing.update({ "duration.rounds": currentRounds + Math.floor(rounds) });

      return {
        effect: existing,
        created: false,
        repeated: true,
        extended: true
      };
    }

    await applyDirectDamage(actor, 1, {
      ignoreArmor: true,
      reason: `Repeated ${effect.name}`
    });

    return {
      effect: existing,
      created: false,
      repeated: true,
      damage: 1
    };
  }

  const duration = {};

  if (hasDuration) {
    duration.rounds = Math.floor(rounds);
  }

  const created = await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: effect.name,
    icon: effect.icon,
    statuses: [statusId],
    duration,
    changes: []
  }]);

  if (statusId === "ko" && created[0]) {
    await clearActiveSpells(actor, "Caster went K.O.");
  }

  return {
    effect: created[0] || null,
    created: Boolean(created[0]),
    repeated: false
  };
}

async function removeStatus(actor, statusId) {
  const existing = actor.effects.find(e => e.statuses?.has(statusId));
  if (existing) await existing.delete();
}

async function removeStatuses(actor, statusIds = []) {
  const effectsToRemove = actor.effects.filter(effect =>
    Array.from(effect.statuses || []).some(status => statusIds.includes(status))
  );

  if (!effectsToRemove.length) return;

  await actor.deleteEmbeddedDocuments(
    "ActiveEffect",
    effectsToRemove.map(effect => effect.id)
  );
}

async function toggleActorStatus(actor, statusId) {
  if (await actorHasStatus(actor, statusId)) {
    await removeStatus(actor, statusId);
  } else {
    await addStatus(actor, statusId);
  }
}

async function toggleActorBoon(actor) {
  const hasBoon = actor.system?.boon === true || actor.system?.boon === "true";
  const nextBoon = !hasBoon;

  await actor.update({ "system.boon": nextBoon });
  ui.notifications.info(`${actor.name} ${nextBoon ? "has a Boon." : "spent or lost their Boon."}`);
}




// Combat / Healing Helpers


async function recalcArmor(actor) {
  const equippedArmor = actor.items
    .filter(i => i.type === "armor" && i.system.equipped)
    .reduce((total, i) => total + Number(i.system.armor || 0), 0);

  await actor.update({ "system.armor.value": equippedArmor });
}

function compactRolls(...rolls) {
  return rolls.flat().filter(Boolean);
}

async function applyDirectDamage(actor, amount, { ignoreArmor = true, reason = "Damage", rolls = [] } = {}) {
  const armor = getActorArmorValue(actor);
  const elementalAdjustment = getElementalDamageAdjustment(actor, amount, { damageType: reason });
  const finalDamage = ignoreArmor
    ? elementalAdjustment.damage
    : Math.max(elementalAdjustment.damage - armor, 0);
  const currentHearts = Number(actor.system.hearts?.value ?? 0);
  const newHearts = Math.max(currentHearts - finalDamage, 0);

  await actor.update({ "system.hearts.value": newHearts });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    rolls: compactRolls(rolls),
    content: `
      <div class="ts-chat-card">
        <h2>${reason}</h2>
        <p><strong>${actor.name}</strong> took ${finalDamage} damage.</p>
        ${elementalAdjustment.text ? `<p>${elementalAdjustment.text}</p>` : ""}
      </div>
    `
  });

  await checkZeroHearts(actor);
}

async function healActor(actor, amount) {
  const current = Number(actor.system.hearts?.value ?? 0);
  const max = Number(actor.system.hearts?.max ?? 0);

  const newValue = Math.min(current + amount, max);

  await actor.update({
    "system.hearts.value": newValue
  });

  if (newValue > 0) {
    await removeStatus(actor, "ko");
  }
}

async function setActorResourceFromPip(actor, resource, pipValue) {
  if (!["hearts", "stamina"].includes(resource)) return;

  const value = Math.max(Number(pipValue || 0), 0);
  const current = Number(actor.system?.[resource]?.value ?? 0);
  const max = Math.max(Number(actor.system?.[resource]?.max ?? value), value);
  const nextValue = current >= value
    ? Math.max(value - 1, 0)
    : value;

  await actor.update({
    [`system.${resource}.value`]: Math.min(nextValue, max)
  });
}

function activateResourcePipListeners(actor, html) {
  html.find(".resource-pip").click(async event => {
    event.preventDefault();
    event.stopPropagation();

    await setActorResourceFromPip(
      actor,
      event.currentTarget.dataset.resource,
      event.currentTarget.dataset.value
    );
  });
}

function activateActorStatTabOrder(html) {
  const root = getRawHtmlElement(html);
  if (!root) return;

  root.querySelectorAll(".resource-pip").forEach(pip => {
    pip.tabIndex = -1;
  });

  const statFields = root.querySelectorAll([
    ".sheet-header input:not([type='hidden']):not([readonly]):not([disabled])",
    ".sheet-header select:not([disabled])",
    ".resources input:not([type='hidden']):not([readonly]):not([disabled])",
    ".monster-vitals input:not([type='hidden']):not([readonly]):not([disabled])",
    ".monster-vitals select:not([disabled])",
    ".abilities input:not([type='hidden']):not([readonly]):not([disabled])"
  ].join(", "));

  statFields.forEach((field, index) => {
    field.tabIndex = index + 1;
  });
}

async function applyHealingToTarget(amount, reason = "Healing") {
  const targets = Array.from(game.user.targets);
  const token = targets[0] || canvas.tokens.controlled[0];

  if (!token?.actor) {
    ui.notifications.warn("Target a token first, or select one token.");
    return;
  }

  const actor = token.actor;
  await healActor(actor, amount);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="ts-chat-card">
        <h2>${reason} Applied</h2>
        <p><strong>${actor.name}</strong> recovered ${amount} Hearts.</p>
      </div>
    `
  });
}

async function applyStatusToActor(actor, statusId, {
  durationFormula = "",
  sourceName = "Status",
  createMessage = true
} = {}) {
  const normalizedStatus = normalizeStatusId(statusId);
  const statusLabel = getStatusLabel(normalizedStatus);

  if (!actor || !normalizedStatus) {
    ui.notifications.warn("Choose a valid status first.");
    return null;
  }

  let durationResult;

  try {
    durationResult = await rollStatusDuration(durationFormula);
  } catch (err) {
    console.error(err);
    ui.notifications.warn(`Could not roll status duration "${durationFormula}".`);
    return null;
  }

  const statusResult = await addStatus(actor, normalizedStatus, {
    durationRounds: durationResult.rounds,
    repeatBehavior: "extend"
  });

  const result = {
    actor,
    statusId: normalizedStatus,
    statusLabel,
    durationRoll: durationResult.roll,
    durationText: durationResult.text,
    applied: Boolean(statusResult?.created),
    repeated: Boolean(statusResult?.repeated),
    extended: Boolean(statusResult?.extended),
    repeatDamage: Number(statusResult?.damage || 0)
  };

  if (createMessage) {
    const actionText = result.applied
      ? "gains"
      : result.extended
        ? "extends"
        : result.repeatDamage
          ? "already had"
          : "already has";
    const titleText = result.applied
      ? "Applied"
      : result.extended
        ? "Extended"
        : result.repeatDamage
          ? "Repeated"
          : "Already Active";

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      rolls: compactRolls(durationResult.roll),
      content: `
        <div class="ts-chat-card">
          <h2>${escapeHtml(statusLabel)} ${titleText}</h2>
          <p><strong>${escapeHtml(actor.name)}</strong> ${actionText} ${escapeHtml(statusLabel)}.</p>
          ${durationResult.text ? `<p><strong>Duration:</strong> ${escapeHtml(durationResult.text)}</p>` : ""}
          ${result.repeatDamage ? `<p>The repeated status had no duration limit, so ${escapeHtml(actor.name)} took 1 damage.</p>` : ""}
          ${sourceName ? `<p><strong>Source:</strong> ${escapeHtml(sourceName)}</p>` : ""}
        </div>
      `
    });
  }

  return result;
}

async function applyStatusToTarget(statusId, options = {}) {
  const targets = Array.from(game.user.targets);
  const token = targets[0] || canvas.tokens.controlled[0];

  if (!token?.actor) {
    ui.notifications.warn("Target a token first, or select one token.");
    return null;
  }

  return applyStatusToActor(token.actor, statusId, options);
}

async function checkZeroHearts(actor) {
  if (actor.type !== "champion") return;

  const hearts = Number(actor.system.hearts?.value ?? 0);
  if (hearts > 0) return;

  await addStatus(actor, "wound");

  if (await actorHasStatus(actor, "ko")) return;

  const vit = actor.system.abilities?.vit;
  if (!vit) {
    await addStatus(actor, "ko");
    return;
  }

  const roll = await new Roll("1d12").evaluate();
  const success = roll.total <= Number(vit.value);

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `
      <div class="ts-chat-card">
        <h2>${actor.name} risks K.O.</h2>
        <p><strong>Vitality:</strong> ${vit.value}</p>
        <p><strong>Result:</strong> ${roll.total} — ${success ? "Stays conscious" : "K.O."}</p>
      </div>
    `
  });

  if (!success) await addStatus(actor, "ko");
}

async function advanceCombatTurnIfCurrent(actor) {
  const combat = game.combat;
  if (!combat?.started) return;

  const combatant = combat.combatant;
  if (!combatant?.actor) return;
  if (combatant.actor.id !== actor.id) return;

  await combat.nextTurn();
}

async function cleanupRestStatuses(actor) {
  await removeStatuses(actor, [
    "burn",
    "poison",
    "stun",
    "confusion",
    "fear",
    "freeze",
    "blind",
    "silence",
    "prone"
  ]);

  if (Number(actor.system.hearts?.value ?? 0) > 0) {
    await removeStatus(actor, "ko");
  }
}


// Active Spell Tracking


function getActiveSpells(actor) {
  const storedSpells = actor?.getFlag("twilight-sword", "activeSpells") || [];
  const activeSpells = Array.isArray(storedSpells) ? storedSpells : [];

  return foundry.utils.deepClone(activeSpells)
    .filter(spell => spell?.id && spell?.name)
    .map(spell => ({
      id: spell.id,
      spellId: spell.spellId || "",
      name: spell.name || "Spell",
      duration: spell.duration || "",
      target: spell.target || "",
      startedRound: spell.startedRound ?? null
    }));
}

function isInstantSpellDuration(duration) {
  const text = String(duration || "").trim().toLowerCase();

  return !text || ["instant", "instantaneous", "immediate"].includes(text);
}

async function setActiveSpells(actor, activeSpells) {
  await actor.setFlag("twilight-sword", "activeSpells", activeSpells);
}

async function trackActiveSpell(actor, {
  spellId = "",
  name = "Spell",
  duration = "",
  target = ""
} = {}) {
  if (!actor) return null;

  const activeSpells = getActiveSpells(actor);
  const existing = activeSpells.find(spell =>
    spell.spellId &&
    spell.spellId === spellId &&
    spell.target === target
  );

  const entry = {
    id: existing?.id || foundry.utils.randomID(),
    spellId,
    name,
    duration,
    target,
    startedRound: game.combat?.round ?? existing?.startedRound ?? null
  };

  const nextSpells = existing
    ? activeSpells.map(spell => spell.id === existing.id ? entry : spell)
    : [...activeSpells, entry];

  await setActiveSpells(actor, nextSpells);
  actor.sheet?.render(false);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="ts-chat-card">
        <h2>${escapeHtml(entry.name)} Tracked</h2>
        <p><strong>Caster:</strong> ${escapeHtml(actor.name)}</p>
        ${entry.target ? `<p><strong>Target:</strong> ${escapeHtml(entry.target)}</p>` : ""}
        ${entry.duration ? `<p><strong>Duration:</strong> ${escapeHtml(entry.duration)}</p>` : ""}
      </div>
    `
  });

  return entry;
}

async function endActiveSpell(actor, activeSpellId, reason = "Ended manually") {
  if (!actor || !activeSpellId) return false;

  const activeSpells = getActiveSpells(actor);
  const activeSpell = activeSpells.find(spell => spell.id === activeSpellId);
  if (!activeSpell) return false;

  await setActiveSpells(
    actor,
    activeSpells.filter(spell => spell.id !== activeSpellId)
  );
  actor.sheet?.render(false);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="ts-chat-card">
        <h2>${escapeHtml(activeSpell.name)} Ended</h2>
        <p><strong>Caster:</strong> ${escapeHtml(actor.name)}</p>
        <p>${escapeHtml(reason)}</p>
      </div>
    `
  });

  return true;
}

async function clearActiveSpells(actor, reason = "Cleared") {
  if (!actor) return false;

  const activeSpells = getActiveSpells(actor);
  if (!activeSpells.length) return false;

  await setActiveSpells(actor, []);
  actor.sheet?.render(false);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="ts-chat-card">
        <h2>Active Spells Cleared</h2>
        <p><strong>${escapeHtml(actor.name)}</strong> lost ${activeSpells.length} active ${activeSpells.length === 1 ? "spell" : "spells"}.</p>
        <p>${escapeHtml(reason)}</p>
      </div>
    `
  });

  return true;
}


// Action Restrictions


function getDisadvantageReason(actor, abilityKey, options = {}) {
  const statuses = getStatusIds(actor);
  const armorDisadvantage = getArmorDisadvantageSummary(actor);

  if (statuses.has("ko")) return "K.O.";
  if (statuses.has("confusion") && ["kno", "ste"].includes(abilityKey)) return "Confusion";
  if (statuses.has("wound") && ["str", "agl"].includes(abilityKey)) return "Wound";
  if (statuses.has("fear") && ["wil", "cha"].includes(abilityKey)) return "Fear";
  if (statuses.has("blind") && abilityKey === "per") return "Blind";
  if (statuses.has("blind") && options.attack) return "Blind";
  if (armorDisadvantage.abilityKeys.includes(abilityKey)) return `${armorDisadvantage.typeLabel} Armor`;
  if (getActorInventorySummary(actor).encumbered) return "Encumbrance";

  return null;
}

async function enforceCanAct(actor, actionName = "act") {
  if (await actorHasStatus(actor, "ko")) {
    ui.notifications.warn(`${actor.name} is K.O. and cannot ${actionName}.`);
    return false;
  }

  return true;
}

async function enforceCanReact(actor) {
  if (await actorHasStatus(actor, "ko")) {
    ui.notifications.warn(`${actor.name} is K.O. and cannot react.`);
    return false;
  }

  if (await actorHasStatus(actor, "freeze")) {
    ui.notifications.warn(`${actor.name} is Frozen and cannot use reactions.`);
    return false;
  }

  return true;
}

async function enforceCanCast(actor, { ignoreEquipmentRestrictions = false } = {}) {
  if (!(await enforceCanAct(actor, "cast spells"))) return false;

  if (await actorHasStatus(actor, "silence")) {
    ui.notifications.warn(`${actor.name} is Silenced and cannot cast spells.`);
    return false;
  }

  if (ignoreEquipmentRestrictions) return true;

  const restrictions = getCastingRestrictionSummary(actor);

  if (restrictions.blocked) {
    ui.notifications.warn(restrictions.text);
    return false;
  }

  return true;
}

function isActorCurrentCombatant(actor) {
  const combat = game.combat;

  if (!combat?.started) return true;

  const activeActor = combat.combatant?.actor;
  if (!activeActor) return true;

  return activeActor.id === actor.id;
}

async function enforceTurnActor(actor, actionName = "act", { reaction = false } = {}) {
  if (reaction) return true;

  if (!game.combat?.started) return true;

  if (!isActorCurrentCombatant(actor)) {
    ui.notifications.warn(`${actor.name} cannot ${actionName}; it is not their turn.`);
    return false;
  }

  return true;
}


// Status Processing


async function processStartOfTurnStatuses(actor) {
  if (!actor) return;

  if (await actorHasStatus(actor, "burn")) {
    await applyDirectDamage(actor, 1, { ignoreArmor: true, reason: "Burn" });
  }

  if (await actorHasStatus(actor, "poison")) {
    const vit = actor.system.abilities?.vit;

    if (vit) {
      const roll = await new Roll("1d12").evaluate();
      const success = roll.total <= Number(vit.value);

      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor: `
          <div class="ts-chat-card">
            <h2>${actor.name} resists Poison</h2>
            <p><strong>Vitality:</strong> ${vit.value}</p>
            <p><strong>Result:</strong> ${roll.total} — ${success ? "No damage" : "Poison damage"}</p>
          </div>
        `
      });

      if (!success) {
        const dmg = await new Roll("1d4").evaluate();
        await applyDirectDamage(actor, dmg.total, { ignoreArmor: true, reason: "Poison", rolls: [dmg] });
      }
    }
  }

    if (await actorHasStatus(actor, "freeze")) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <div class="ts-chat-card">
          <h2>${actor.name} is Frozen</h2>
          <p>Cannot use reactions.</p>
          <p>Must Dash in order to move.</p>
        </div>
      `
    });
  }

  if (await actorHasStatus(actor, "stun")) {
    const vit = actor.system.abilities?.vit;

    if (vit) {
      const roll = await new Roll("1d12").evaluate();
      const success = roll.total <= Number(vit.value);

      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor: `
          <div class="ts-chat-card">
            <h2>${actor.name} resists Stun</h2>
            <p><strong>Vitality:</strong> ${vit.value}</p>
            <p><strong>Result:</strong> ${roll.total} — ${success ? "Can act" : "Skip Turn"}</p>
          </div>
        `
      });

      if (!success) {
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          content: `
            <div class="ts-chat-card">
              <h2>${actor.name} is Stunned</h2>
              <p>This creature skips its turn.</p>
            </div>
          `
        });

        await advanceCombatTurnIfCurrent(actor);
      }
    }
  }

  await checkZeroHearts(actor);
}


// Rolls 

const ABILITY_OPTIONS = [
  { key: "str", label: "Strength" },
  { key: "agl", label: "Agility" },
  { key: "vit", label: "Vitality" },
  { key: "per", label: "Perception" },
  { key: "wil", label: "Will" },
  { key: "kno", label: "Knowledge" },
  { key: "cha", label: "Charisma" },
  { key: "ste", label: "Stealth" }
];

function normalizeAbilityKey(value) {
  const key = String(value || "").trim().toLowerCase();
  const aliases = {
    strength: "str",
    agility: "agl",
    vitality: "vit",
    perception: "per",
    will: "wil",
    knowledge: "kno",
    charisma: "cha",
    stealth: "ste"
  };

  return aliases[key] || key;
}

function getAbilityLabel(abilityKey) {
  const key = normalizeAbilityKey(abilityKey);

  return ABILITY_OPTIONS.find(option => option.key === key)?.label || "";
}

function buildAbilityOptions(selectedAbility = "", { includeBlank = true } = {}) {
  const selected = normalizeAbilityKey(selectedAbility);
  const options = includeBlank
    ? [`<option value="none" ${!selected || selected === "none" ? "selected" : ""}>None</option>`]
    : [];

  for (const ability of ABILITY_OPTIONS) {
    options.push(
      `<option value="${ability.key}" ${ability.key === selected ? "selected" : ""}>${ability.label}</option>`
    );
  }

  return options.join("");
}

async function rollAbility(actor, abilityKey, options = {}) {
  abilityKey = normalizeAbilityKey(abilityKey);

  const ability = actor.system.abilities?.[abilityKey];

  if (!ability) {
    ui.notifications.warn(`Ability ${abilityKey} not found.`);
    return;
  }

  if (await actorHasStatus(actor, "ko")) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <div class="ts-chat-card">
          <h2>${escapeHtml(options.title || `${ability.label} Roll`)}</h2>
          <p><strong>${actor.name}</strong> is K.O. and automatically fails.</p>
          ${options.sourceName ? `<p><strong>Source:</strong> ${escapeHtml(options.sourceName)}</p>` : ""}
        </div>
      `
    });

    return { roll: null, success: false, total: null, target: Number(ability.value) };
  }

  let formula = "1d12";
  let staminaSpent = false;
  const rollBonuses = getAbilityRollBonuses(actor, abilityKey, options);
  const rollBonus = rollBonuses.reduce((total, bonus) => total + bonus.value, 0);
  const rollBonusReason = rollBonuses.map(bonus => bonus.reason).filter(Boolean).join(", ") || "Bonus";
  const disadvantageReason = getDisadvantageReason(actor, abilityKey, options);

  if (disadvantageReason) {
    formula = "2d12kh";
  } else if (options.askStamina) {
    const spend = await confirmDialog(
      "Spend Stamina?",
      "Spend 1 Stamina to roll with Advantage?"
    );

    if (spend && Number(actor.system.stamina?.value ?? 0) > 0) {
      formula = "2d12kl";
      staminaSpent = true;
      await actor.update({ "system.stamina.value": Number(actor.system.stamina.value) - 1 });
    }
  }

  const roll = await new Roll(formula).evaluate();
  const rawTotal = roll.total;
  const total = Math.max(rawTotal - rollBonus, 1);
  const hasTargetOverride = options.target !== undefined && options.target !== null && String(options.target).trim() !== "";
  const target = hasTargetOverride && Number.isFinite(Number(options.target))
    ? Number(options.target)
    : Number(ability.value);
  const success = total <= target;

  let result = success ? "Success" : "Failure";
  if (rawTotal === 1) result = "Critical Success";
  if (rawTotal === 12) result = "Critical Failure";

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `
      <div class="ts-chat-card">
        <h2>${escapeHtml(options.title || `${ability.label} Roll`)}</h2>
        ${options.sourceName ? `<p><strong>Source:</strong> ${escapeHtml(options.sourceName)}</p>` : ""}
        <p><strong>Roll:</strong> ${rawTotal}${rollBonus ? ` - ${rollBonus} ${rollBonusReason} = ${total}` : ""} vs ${target}</p>
        <p><strong>Result:</strong> ${result}</p>
        ${staminaSpent ? "<p>Spent 1 Stamina for Advantage.</p>" : ""}
        ${disadvantageReason ? `<p>Rolled with Disadvantage from ${disadvantageReason}.</p>` : ""}
      </div>
    `
  });

  return { roll, success, total, rawTotal, target, rollBonus, rollBonusReason };
}

async function rollWeaponAttack(actor, weapon, options = {}) {
  if (!(await enforceCanAct(actor, "attack"))) return;
  if (!(await enforceTurnActor(actor, "attack"))) return;

  if (!isWeaponAvailable(weapon)) {
    ui.notifications.warn(`${weapon.name} must be picked up before it can be used.`);
    return;
  }

  if (!weapon.system?.wielded) {
    ui.notifications.warn(`${weapon.name} must be wielded before attacking.`);
    return;
  }

  const system = weapon.system;

  const feats = getWeaponFeats(weapon);
  const usingArcane = options.arcane === true;
  const usingThrown = options.thrown === true;
  const usingTwoHands = options.twoHands === true;

  if (feats.has("two-handed") && Number(system.hands ?? 2) !== 2) {
    await weapon.update({ "system.hands": 2 });
  }

  if (usingTwoHands && feats.has("versatile") && !feats.has("two-handed")) {
    const handsUsed = getActorInventorySummary(actor).handsUsed;

    if (handsUsed > 1) {
      ui.notifications.warn(`${weapon.name} needs your other hand free for a two-handed attack.`);
      return;
    }
  }

  let requiredRange = system.range || system.weaponRange || "close";

  if (usingArcane) requiredRange = "far";
  if (usingThrown && feats.has("boomerang")) requiredRange = "far";
  else if (usingThrown) requiredRange = "near";

  const targetToken = getPrimaryTargetToken();
  const rangeInfo = targetToken ? getRangeInfo(actor, targetToken) : null;

  if (targetToken && !isTargetWithinRange(requiredRange, rangeInfo)) {
    ui.notifications.warn(
      `${weapon.name} is ${requiredRange} range, but target is ${rangeInfo.label}.`
    );
    return;
  }

  let abilityKey;

  if (usingArcane) {
    abilityKey = "kno";
  } else if (usingThrown) {
    abilityKey = feats.has("finesse") ? "agl" : "str";
  } else if (isWeaponRanged(weapon)) {
    abilityKey = "per";
  } else if (feats.has("finesse")) {
    abilityKey = "agl";
  } else {
    abilityKey = "str";
  }

  const ability = actor.system.abilities?.[abilityKey];

  if (!ability) {
    ui.notifications.warn(`Weapon ability ${abilityKey} not found.`);
    return;
  }

  const smallCloseRanged = feats.has("small") && isWeaponRanged(weapon);
  const closeRangedPenalty =
    isRangedAttackInCloseRange(requiredRange, rangeInfo) &&
    !smallCloseRanged;

  const disadvantageReason =
    getDisadvantageReason(actor, abilityKey, { attack: true }) ||
    (closeRangedPenalty ? "Ranged attack at Close range" : null);

  const accurateBonus = feats.has("accurate") ? 1 : 0;
  const formula = disadvantageReason ? "2d12kh" : "1d12";
  const attackRoll = await new Roll(formula).evaluate();

  const rawTotal = attackRoll.total;
  const adjustedTotal = Math.max(rawTotal - accurateBonus, 1);
  const target = Number(ability.value);
  const sharpshooterAttack = actorHasFeatNamed(actor, "sharpshooter") &&
    !usingArcane &&
    (isWeaponRanged(weapon) || usingThrown);
  const cunningStrikeAttack = actorHasFeatNamed(actor, "cunning strike") &&
    !usingArcane &&
    feats.has("small");
  const swordplayAttack = actorHasFeatNamed(actor, "swordplay") &&
    !usingArcane &&
    !usingThrown &&
    !isWeaponRanged(weapon);
  const swordplayDamage = actorHasFeatNamed(actor, "swordplay") &&
    !usingArcane &&
    feats.has("finesse");

  const crit = rawTotal === 1 ||
    (sharpshooterAttack && rawTotal === 2) ||
    (swordplayAttack && rawTotal === 2);
  const fumble = rawTotal === 12;
  const hit = crit || (!fumble && adjustedTotal <= target);

  let damageFormula = usingArcane
    ? (actorHasFeatNamed(actor, "arcane blaster") ? "1d6" : "1d4")
    : system.damage || "1d6";

  if (feats.has("versatile") && usingTwoHands && !usingArcane) {
    damageFormula = `(${damageFormula}) + 1`;
  }

  if (sharpshooterAttack) {
    damageFormula = `(${damageFormula}) + 1`;
  }

  if (cunningStrikeAttack) {
    damageFormula = `(${damageFormula}) + 1`;
  }

  if (swordplayDamage) {
    damageFormula = `(${damageFormula}) + 1`;
  }

  if (crit) {
    damageFormula = `(${damageFormula}) * ${cunningStrikeAttack ? 3 : 2}`;
  }

  const baseDamageRoll = hit ? await new Roll(damageFormula).evaluate() : null;
  const elementalDamageType = getWeaponElementalDamageType(weapon);
  const elementalDamageTypeLabel = getDamageTypeLabel(elementalDamageType);
  const elementalRoll = hit && elementalDamageType !== "none"
    ? await new Roll("1d4").evaluate()
    : null;

  const totalDamage =
    (baseDamageRoll?.total || 0) +
    (elementalRoll?.total || 0);
  const damageType = normalizeDamageType(system.damageType);
  const damageTypeLabel = getDamageTypeLabel(damageType);
  const elementalTypeWarning = feats.has("elemental") && elementalDamageType === "none"
    ? "<p><strong>Elemental:</strong> Choose an Elemental Damage Type on this weapon, or write this feat as Elemental [type], to add +1D4 typed damage.</p>"
    : "";
  const elementalDamageData = elementalRoll
    ? ` data-elemental-damage="${elementalRoll.total}" data-elemental-damage-type="${elementalDamageType}"`
    : "";

  let result = hit ? "Hit" : "Miss";
  if (crit) result = "Critical Hit";
  if (fumble) result = "Critical Failure";

  const boomerangReturnText =
    usingThrown && feats.has("boomerang")
      ? (fumble
          ? "<p><strong>Boomerang:</strong> Critical failure — it does not return.</p>"
          : "<p><strong>Boomerang:</strong> It returns after the attack.</p>")
      : "";

  const thrownText =
    usingThrown && !feats.has("boomerang")
      ? "<p><strong>Thrown:</strong> You need an action to retrieve this weapon.</p>"
      : "";
  const sharpshooterText = sharpshooterAttack
    ? "<p><strong>Sharpshooter:</strong> +1 damage with this ranged or thrown weapon. A natural 2 counts as a critical hit.</p>"
    : "";
  const cunningStrikeText = cunningStrikeAttack
    ? `<p><strong>Cunning Strike:</strong> +1 damage with this small weapon${crit ? ", and this critical hit deals triple damage" : ""}.</p>`
    : "";
  const swordplayText = swordplayAttack || swordplayDamage
    ? `<p><strong>Swordplay:</strong>${swordplayDamage ? " +1 damage with this finesse weapon." : ""}${swordplayAttack ? " A natural 2 counts as a critical hit with this melee weapon." : ""}</p>`
    : "";
  const rotationBreakTarget = crit && actor.type === "champion" && targetToken?.actor?.type === "monster"
    ? targetToken.actor
    : null;

  if (usingThrown) {
    if (feats.has("boomerang")) {
      if (fumble) {
        await weapon.update({
          "system.expended": true,
          "system.wielded": false,
          "flags.twilight-sword.pickupAddsQuantity": false
        });
      }
    } else {
      const quantity = getWeaponQuantity(weapon);
      const nextQuantity = Math.max(quantity - 1, 0);

      await weapon.update({
        "system.quantity": nextQuantity,
        "system.expended": nextQuantity === 0,
        "system.wielded": nextQuantity > 0 && weapon.system?.wielded === true,
        "flags.twilight-sword.pickupAddsQuantity": nextQuantity === 0
      });
    }
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    rolls: compactRolls(attackRoll, baseDamageRoll, elementalRoll),
    content: `
      <div class="ts-chat-card">
        <h2>${actor.name} attacks with ${weapon.name}</h2>
        ${rangeInfo ? `<p><strong>Range:</strong> ${rangeInfo.label}</p>` : ""}
        <p><strong>Attack Type:</strong> ${usingArcane ? "Arcane Missile" : usingThrown ? "Thrown" : "Weapon"}</p>
        <p><strong>Attack:</strong> ${result}</p>
        <p><strong>Roll:</strong> ${rawTotal}${accurateBonus ? ` - ${accurateBonus} Accurate = ${adjustedTotal}` : ""} vs ${ability.label} ${target}</p>
        ${disadvantageReason ? `<p>Rolled with Disadvantage from ${disadvantageReason}.</p>` : ""}
        ${boomerangReturnText}
        ${thrownText}
        ${sharpshooterText}
        ${cunningStrikeText}
        ${swordplayText}
        ${
          hit
            ? `
              <p><strong>Base Damage:</strong> ${baseDamageRoll?.total || 0}</p>
              ${damageTypeLabel ? `<p><strong>Damage Type:</strong> ${damageTypeLabel}</p>` : ""}
              ${elementalRoll ? `<p><strong>Elemental Damage:</strong> +${elementalRoll.total} ${elementalDamageTypeLabel}</p>` : ""}
              <p><strong>Total Damage:</strong> ${totalDamage}</p>
              ${elementalTypeWarning}
              ${buildReactionButtons({
                attacker: actor,
                defender: targetToken?.actor,
                rangedAttack: isWeaponRanged(weapon) || usingThrown || usingArcane
              })}

              <button class="ts-apply-damage" data-damage="${totalDamage}" data-base-damage="${baseDamageRoll?.total || 0}" data-damage-type="${damageType}"${elementalDamageData}>
                Apply Damage to Target
              </button>
            `
            : ""
        }
      </div>
    `
  });

  if (rotationBreakTarget) {
    await breakMonsterRotation(rotationBreakTarget, `${actor.name} landed a critical hit.`);
  }
}

function getMonsterReactionOptions(actor) {
  const reactions = {
    dodge: null,
    parry: null
  };

  if (actor?.type !== "monster") return reactions;

  if (getMonsterVariantData(actor).rank === "black") {
    reactions.dodge = { type: "dodge", target: 8, source: "Black Variant" };
    reactions.parry = { type: "parry", target: 8, source: "Black Variant" };
  }

  for (const item of getMonsterAbilityItems(actor)) {
    const text = getMonsterAbilityText(item);
    const regex = /\b(dodge|parry)\s*\[\s*(\d+)\s*\]/gi;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const type = match[1].toLowerCase();
      const target = Math.max(Math.floor(Number(match[2]) || 0), 1);

      if (!reactions[type] || target > reactions[type].target) {
        reactions[type] = {
          type,
          target,
          source: item.name
        };
      }
    }
  }

  return reactions;
}

function getMonsterAbilityItems(actor) {
  if (actor?.type !== "monster") return [];

  return actor.items.filter(item => item.type === "feat");
}

function getMonsterAbilityText(item) {
  return [
    item.name,
    stripHtml(item.system?.description || ""),
    stripHtml(item.system?.effect || "")
  ].filter(Boolean).join(" ");
}

function findMonsterAbility(actor, regex) {
  for (const item of getMonsterAbilityItems(actor)) {
    if (!regex.test(getMonsterAbilityText(item))) continue;

    return item;
  }

  return null;
}

function getMonsterQuickDodgePenalty(actor) {
  const ability = findMonsterAbility(actor, /\bquick\b/i);
  if (!ability) return null;

  return {
    modifier: -1,
    source: ability.name
  };
}

function getMonsterSavageReactionPenalty(actor) {
  const ability = findMonsterAbility(actor, /\bsavage\b/i);
  if (!ability) return null;

  return {
    modifier: -1,
    source: ability.name
  };
}

function getMonsterJuggernautParryDisadvantage(actor) {
  const ability = findMonsterAbility(actor, /\bjuggernaut\b/i);
  if (!ability) return null;

  return {
    source: ability.name
  };
}

function getMonsterPlantElementalTrait(actor) {
  const ability = findMonsterAbility(actor, /\bplants?\b/i);
  if (!ability) return null;

  return {
    source: ability.name,
    resistant: "light",
    weak: "fire"
  };
}

function getMonsterRegenerationAbility(actor) {
  const ability = findMonsterAbility(actor, /\b(?:regeneration|regneration|regenerate|regenerates|regenerating|no\s+pain)\b/i);
  if (!ability) return null;

  return {
    amount: 1,
    source: ability.name
  };
}

async function processMonsterStartOfTurnAbilities(actor, combat, combatant) {
  if (actor?.type !== "monster") return;

  const threatTurn = Number(combatant?.getFlag("twilight-sword", "threatTurn") || 1);
  if (threatTurn !== 1) return;

  await processMonsterRegeneration(actor, combat);
}

async function processMonsterRegeneration(actor, combat) {
  const regeneration = getMonsterRegenerationAbility(actor);
  if (!regeneration) return;

  const round = Number(combat?.round || 0);
  const combatId = combat?.id || "no-combat";
  const turnKey = `${combatId}:${round}`;

  if (actor.getFlag("twilight-sword", "regenerationTurnKey") === turnKey) return;

  await actor.setFlag("twilight-sword", "regenerationTurnKey", turnKey);

  const current = Number(actor.system.hearts?.value ?? 0);
  const max = getMonsterEffectiveMaxHearts(actor);
  const healed = Math.max(Math.min(regeneration.amount, max - current), 0);

  if (healed > 0) {
    await actor.update({
      "system.hearts.value": current + healed
    });
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="ts-chat-card">
        <h2>${escapeHtml(actor.name)} Regeneration</h2>
        <p><strong>${escapeHtml(regeneration.source)}:</strong> At the beginning of its turn, ${escapeHtml(actor.name)} recovers ${regeneration.amount} Heart.</p>
        <p><strong>Result:</strong> ${healed > 0 ? `Recovered ${healed} Heart (${current + healed}/${max}).` : `Already at full Hearts (${current}/${max}).`}</p>
      </div>
    `
  });
}

function getMonsterReactionOption(actor, type) {
  const reactionType = String(type || "").toLowerCase();

  return getMonsterReactionOptions(actor)[reactionType] || null;
}

function canMonsterUseVariantReaction(actor) {
  const reactions = getMonsterReactionOptions(actor);

  return Boolean(reactions.dodge || reactions.parry);
}

function canMonsterUseReactionType(actor, type) {
  return Boolean(getMonsterReactionOption(actor, type));
}

function canActorUseDefenseReaction(actor) {
  return actor?.type === "champion" || actor?.type === "npc" || canMonsterUseVariantReaction(actor);
}

function shouldOfferReactionButtons(attacker, defender = null) {
  if (attacker?.type === "monster") {
    if (defender && !canActorUseDefenseReaction(defender)) return false;

    return true;
  }

  if (defender && canMonsterUseVariantReaction(defender)) return true;

  return false;
}

function buildReactionButtons({
  attacker = null,
  defender = null,
  rangedAttack = false,
  allowDodge = true,
  allowParry = true,
  restrictionText = ""
} = {}) {
  if (!shouldOfferReactionButtons(attacker, defender)) return "";

  if (defender?.type === "monster") {
    allowDodge = allowDodge && canMonsterUseReactionType(defender, "dodge");
    allowParry = allowParry && canMonsterUseReactionType(defender, "parry");
  }

  if (!allowDodge && !allowParry) {
    return restrictionText ? `<p><strong>Reactions:</strong> ${escapeHtml(restrictionText)}</p>` : "";
  }

  return `
    <div class="ts-reaction-buttons">
      ${
        allowDodge
          ? `<button class="ts-reaction-dodge" data-ranged-attack="${rangedAttack}">
              Dodge
            </button>`
          : ""
      }

      ${
        allowParry
          ? `<button class="ts-reaction-parry" data-ranged-attack="${rangedAttack}">
              Parry
            </button>`
          : ""
      }
    </div>
    ${restrictionText ? `<p><strong>Reactions:</strong> ${escapeHtml(restrictionText)}</p>` : ""}
  `;
}

function getEquippedReactionItems(actor) {
  return actor.items.filter(i =>
    ["weapon", "armor", "gear"].includes(i.type) &&
    i.system?.wielded
  );
}

function isShieldItem(item) {
  const system = item.system || {};
  const weaponType = String(system.weaponType || "").toLowerCase();

  if (weaponType === "s" || weaponType === "shield") return true;

  const text = [
    item.name,
    item.type,
    system.weaponType,
    system.type,
    system.category,
    system.traits,
    system.tags,
    system.properties,
    system.weaponFeats
  ].filter(Boolean).join(" ").toLowerCase();

  return text.includes("shield") || text.includes("[s]") || text === "s";
}

function canItemParry(item, { rangedAttack = false } = {}) {
  if (!item) return false;

  const feats = getWeaponFeats(item);

  if (feats.has("small")) return false;
  if (isShieldItem(item)) return true;
  if (rangedAttack) return false;

  return item.type === "weapon" && !isWeaponRanged(item);
}

function getBestParryItem(actor, { rangedAttack = false } = {}) {
  const equipped = getEquippedReactionItems(actor);
  return equipped.find(item => canItemParry(item, { rangedAttack })) || null;
}

function hasDefensiveStance(actor) {
  return actor.getFlag("twilight-sword", "defensiveStance") === true;
}

async function setDefensiveStance(actor, value) {
  await actor.setFlag("twilight-sword", "defensiveStance", value);
}

function isDancerReactionEligible(actor) {
  if (actor?.type !== "champion") return false;
  if (!actorHasFeatNamed(actor, "dancer")) return false;

  const armor = getEquippedArmor(actor);
  const armorType = normalizeArmorTypeValue(armor?.system?.armorType || armor?.system?.type);

  return armorType === "clothing";
}

function getReactionLimit(actor) {
  return isDancerReactionEligible(actor) ? 2 : 1;
}

function getReactionUsedCount(actor) {
  const value = actor.getFlag("twilight-sword", "reactionUsed");

  if (typeof value === "number") return Math.max(Math.floor(value), 0);
  if (value === true) return 1;

  return 0;
}

function hasReactionUsed(actor) {
  return getReactionUsedCount(actor) >= getReactionLimit(actor);
}

async function setReactionUsed(actor, value) {
  if (!value) {
    await actor.setFlag("twilight-sword", "reactionUsed", 0);
    return;
  }

  await actor.setFlag("twilight-sword", "reactionUsed", getReactionUsedCount(actor) + 1);
}

async function rollMonsterVariantReaction(actor, type) {
  const reactionType = String(type || "").toLowerCase();

  if (!["dodge", "parry"].includes(reactionType)) {
    ui.notifications.warn("Unknown reaction type.");
    return;
  }

  const reaction = getMonsterReactionOption(actor, reactionType);

  if (!reaction) {
    ui.notifications.warn(`${actor.name} cannot ${reactionType}.`);
    return;
  }

  if (hasReactionUsed(actor)) {
    ui.notifications.warn(`${actor.name} has already used their monster reaction this round.`);
    return;
  }

  const roll = await new Roll("1d12").evaluate();
  const success = roll.total <= reaction.target;

  await setReactionUsed(actor, true);

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `
      <div class="ts-chat-card">
        <h2>${actor.name} attempts to ${reactionType === "dodge" ? "Dodge" : "Parry"}</h2>
        <p><strong>${escapeHtml(reaction.source)}:</strong> ${reactionType === "dodge" ? "Dodge" : "Parry"} [${reaction.target}] once per round.</p>
        <p><strong>Roll:</strong> ${roll.total} vs ${reaction.target}</p>
        <p><strong>Result:</strong> ${success ? "Avoids the attack" : "Fails"}</p>
      </div>
    `
  });

  return { success, total: roll.total, target: reaction.target, type: reactionType };
}

async function rollReaction(actor, type, options = {}) {
  if (!canActorUseDefenseReaction(actor)) {
    ui.notifications.warn(`${actor.name} cannot dodge or parry.`);
    return;
  }

  if (actor.type === "monster") {
    if (!(await enforceCanReact(actor))) return;
    return rollMonsterVariantReaction(actor, type);
  }

  if (!(await enforceCanReact(actor))) return;

  if (hasReactionUsed(actor)) {
    ui.notifications.warn(`${actor.name} has already used their ${getReactionLimit(actor)} reaction(s) this round.`);
    return;
  }

  const reactionType = String(type || "").toLowerCase();
  const rangedAttack = options.rangedAttack === true;

  let abilityKey;
  let parryItem = null;
  let bonus = 0;
  let formula = "1d12";
  let reason = "";
  const rollAdjustments = [];
  let quickPenalty = null;
  let savagePenalty = null;
  let juggernautDisadvantage = null;

  if (reactionType === "dodge") {
    abilityKey = "agl";
    reason = "Dodge";
    quickPenalty = getMonsterQuickDodgePenalty(options.attacker);
    savagePenalty = getMonsterSavageReactionPenalty(options.attacker);

    if (quickPenalty) {
      rollAdjustments.push({
        label: `Quick (${quickPenalty.source})`,
        value: quickPenalty.modifier
      });
    }

    if (savagePenalty) {
      rollAdjustments.push({
        label: `Savage (${savagePenalty.source})`,
        value: savagePenalty.modifier
      });
    }
  } else if (reactionType === "parry") {
    abilityKey = "str";
    parryItem = getBestParryItem(actor, { rangedAttack });

    if (!parryItem) {
      ui.notifications.warn(
        rangedAttack
          ? `${actor.name} needs a shield to parry a ranged attack.`
          : `${actor.name} needs a melee weapon or shield to parry.`
      );
      return;
    }

    const feats = getWeaponFeats(parryItem);
    bonus = feats.has("defensive") ? 1 : 0;
    reason = `Parry with ${parryItem.name}`;
    savagePenalty = getMonsterSavageReactionPenalty(options.attacker);
    juggernautDisadvantage = getMonsterJuggernautParryDisadvantage(options.attacker);

    if (bonus) {
      rollAdjustments.push({
        label: "Defensive",
        value: bonus
      });
    }

    if (savagePenalty) {
      rollAdjustments.push({
        label: `Savage (${savagePenalty.source})`,
        value: savagePenalty.modifier
      });
    }
  } else {
    ui.notifications.warn("Unknown reaction type.");
    return;
  }

  const ability = actor.system.abilities?.[abilityKey];

  if (!ability) {
    ui.notifications.warn(`Ability ${abilityKey} not found.`);
    return;
  }

  const disadvantageReasons = [
    getDisadvantageReason(actor, abilityKey, {}),
    juggernautDisadvantage ? `Juggernaut (${juggernautDisadvantage.source})` : ""
  ].filter(Boolean);
  const disadvantageReason = disadvantageReasons.join(", ");
  const advantage = hasDefensiveStance(actor);

  if (disadvantageReason && advantage) {
    formula = "1d12";
  } else if (disadvantageReason) {
    formula = "2d12kh";
  } else if (advantage) {
    formula = "2d12kl";
  }

  const roll = await new Roll(formula).evaluate();
  const rollAdjustmentTotal = rollAdjustments.reduce((total, adjustment) => total + adjustment.value, 0);
  const adjustedTotal = Math.max(roll.total - rollAdjustmentTotal, 1);
  const rollAdjustmentText = rollAdjustments
    .map(adjustment => {
      const sign = adjustment.value > 0 ? "-" : "+";
      return ` ${sign} ${Math.abs(adjustment.value)} ${escapeHtml(adjustment.label)}`;
    })
    .join("");
  const target = Number(ability.value);
  const success = adjustedTotal <= target;
  const reactionLimit = getReactionLimit(actor);
  const dancerReaction = reactionLimit > 1;

  await setReactionUsed(actor, true);
  if (advantage) await setDefensiveStance(actor, false);

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `
      <div class="ts-chat-card">
        <h2>${actor.name} attempts to ${reactionType === "dodge" ? "Dodge" : "Parry"}</h2>
        <p><strong>${reason}</strong></p>
        <p><strong>Roll:</strong> ${roll.total}${rollAdjustmentText ? `${rollAdjustmentText} = ${adjustedTotal}` : ""} vs ${ability.label} ${target}</p>
        <p><strong>Result:</strong> ${success ? "Avoids the attack" : "Fails"}</p>
        ${quickPenalty ? `<p><strong>Quick:</strong> -1 to Dodge rolls against attacks from ${escapeHtml(options.attacker?.name || "this monster")}.</p>` : ""}
        ${savagePenalty ? `<p><strong>Savage:</strong> -1 to Dodge and Parry rolls against attacks from ${escapeHtml(options.attacker?.name || "this monster")}.</p>` : ""}
        ${juggernautDisadvantage ? `<p><strong>Juggernaut:</strong> Parry rolls against attacks from ${escapeHtml(options.attacker?.name || "this monster")} have Disadvantage.</p>` : ""}
        ${dancerReaction ? `<p><strong>Dancer:</strong> May use up to ${reactionLimit} reactions this round while wearing Clothing.</p>` : ""}
        ${advantage ? "<p>Used Defensive Stance for Advantage.</p>" : ""}
        ${disadvantageReason ? `<p>Disadvantage from ${disadvantageReason}${advantage ? " was cancelled by Advantage." : "."}</p>` : ""}
      </div>
    `
  });

  return { success, total: adjustedTotal, target, type: reactionType };
}

async function rollMonsterDamage(actor) {
  const formula = actor.system.damage || "1d6";
  const roll = await new Roll(formula).evaluate();
  const damageBonus = getMonsterVariantDamageBonus(actor);
  const damageTotal = roll.total + damageBonus;
  const targetToken = getPrimaryTargetToken();
  const damageType = getMonsterEffectiveDamageType(actor, actor.system.damageType);
  const damageTypeLabel = getDamageTypeLabel(damageType);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    rolls: compactRolls(roll),
    content: `
      <div class="ts-chat-card">
        <h2>${actor.name} Damage</h2>
        <p><strong>Damage:</strong> ${roll.total}${damageBonus ? ` + ${damageBonus} Variant = ${damageTotal}` : ""}</p>
        ${damageTypeLabel ? `<p><strong>Damage Type:</strong> ${damageTypeLabel}</p>` : ""}
          ${buildReactionButtons({
            attacker: actor,
            defender: targetToken?.actor,
            rangedAttack: false
          })}

          <button class="ts-apply-damage" data-damage="${damageTotal}" data-damage-type="${damageType}">
            Apply Damage to Target
          </button>
      </div>
    `
  });
}

function getMonsterThreatTurns(actor) {
  if (actor.type !== "monster") return 1;

  const threat = Math.floor(getMonsterEffectiveThreat(actor));

  return Number.isFinite(threat) ? Math.max(threat, 1) : 1;
}

function getCombatantsForActorToken(combat, actor, token) {
  return combat.combatants.filter(combatant =>
    combatant.actor?.id === actor.id &&
    (
      combatant.tokenId === token.id ||
      combatant.token?.id === token.id
    )
  );
}

async function syncThreatCombatants(combat, actor, token) {
  const turns = getMonsterThreatTurns(actor);
  const existing = getCombatantsForActorToken(combat, actor, token);

  if (existing.length < turns) {
    const toCreate = Array.from({ length: turns - existing.length }, (_, index) => ({
      tokenId: token.id,
      sceneId: canvas.scene.id,
      actorId: actor.id,
      hidden: token.document.hidden,
      flags: {
        "twilight-sword": {
          threatTurn: existing.length + index + 1
        }
      }
    }));

    const created = await combat.createEmbeddedDocuments("Combatant", toCreate);
    existing.push(...created);
  }

  if (existing.length > turns) {
    const extras = existing.slice(turns);
    await combat.deleteEmbeddedDocuments("Combatant", extras.map(combatant => combatant.id));
    existing.length = turns;
  }

  for (let index = 0; index < existing.length; index += 1) {
    await existing[index].setFlag("twilight-sword", "threatTurn", index + 1);
  }

  return existing;
}

async function rollInitiativeForActor(actor) {
  let combat = game.combat;

  if (!combat) {
    combat = await Combat.create({
      scene: canvas.scene.id,
      active: true
    });
  }

  let token =
    canvas.tokens.controlled.find(t => t.actor?.id === actor.id) ||
    canvas.tokens.placeables.find(t => t.actor?.id === actor.id);

  if (!token) {
    ui.notifications.warn(`Place or select a token for ${actor.name} before rolling initiative.`);
    return;
  }

  const rawBaseModifier = Number(actor.system.initiative?.modifier ?? actor.system.initiative ?? 0);
  const baseModifier = Number.isFinite(rawBaseModifier) ? rawBaseModifier : 0;
  const tempoModifier = actorHasFeatNamed(actor, "tempo") ? -1 : 0;
  const swiftModifier = actor.type === "monster" && actorHasFeatNamed(actor, "swift") ? -1 : 0;
  const modifier = baseModifier + tempoModifier + swiftModifier;
  const combatants = await syncThreatCombatants(combat, actor, token);
  const rolls = [];
  const initiativeTotals = [];

  for (let index = 0; index < combatants.length; index += 1) {
    const combatant = combatants[index];
    const roll = await new Roll("1d12").evaluate();
    const total = Math.max(roll.total + modifier, 1);

    rolls.push(roll);
    initiativeTotals.push(total);

    await combat.setInitiative(combatant.id, -total);
  }

  const modifierText = modifier
    ? `${modifier < 0 ? " - " : " + "}${Math.abs(modifier)} = `
    : "";
  const rollLines = rolls.map((roll, index) => {
    const total = initiativeTotals[index];

    return `<p><strong>${actor.type === "monster" ? `Turn ${index + 1}` : "Twilight Sword Initiative"}:</strong> ${
      modifier ? `${roll.total}${modifierText}${total}` : total
    }</p>`;
  }).join("");

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token: token.document }),
    rolls: compactRolls(rolls),
    content: `
      <div class="ts-chat-card">
        <h2>${actor.name} rolls Initiative</h2>
        ${actor.type === "monster" ? `<p><strong>Threat:</strong> ${combatants.length}</p>` : ""}
        ${tempoModifier ? `<p><strong>Tempo:</strong> -1 to initiative rolls.</p>` : ""}
        ${swiftModifier ? `<p><strong>Swift:</strong> -1 to initiative rolls, minimum 1.</p>` : ""}
        ${rollLines}
        <p><em>Lower goes first.</em></p>
      </div>
    `
  });

  ui.notifications.info(`${actor.name} rolled ${combatants.length} initiative ${combatants.length === 1 ? "turn" : "turns"}.`);
}

function getActorCombatant(combat, actor) {
  return combat?.combatants?.find(combatant => combatant.actor?.id === actor?.id) || null;
}

function getFirstInitiativeValue(combat) {
  const initiatives = Array.from(combat?.combatants || [])
    .map(combatant => Number(combatant.initiative))
    .filter(value => Number.isFinite(value));

  return initiatives.length ? Math.max(...initiatives) + 1 : 0;
}

async function spendTempoInitiative(combat, actor) {
  const combatant = getActorCombatant(combat, actor);
  if (!combatant) return false;

  const stamina = Number(actor.system.stamina?.value ?? 0);
  if (stamina <= 0) {
    ui.notifications.warn(`${actor.name} has no Stamina to spend on Tempo.`);
    return false;
  }

  await actor.update({ "system.stamina.value": stamina - 1 });
  await combat.setInitiative(combatant.id, getFirstInitiativeValue(combat));

  const turnIndex = combat.turns.findIndex(turn => turn.id === combatant.id);
  if (turnIndex >= 0) await combat.update({ turn: turnIndex });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="ts-chat-card">
        <h2>${actor.name} uses Tempo</h2>
        <p>Spent 1 Stamina to become first in initiative this Round.</p>
      </div>
    `
  });

  return true;
}

async function promptTempoAtRoundStart(combat) {
  if (!game.user.isGM || !combat?.started) return;

  const round = Number(combat.round || 0);
  if (round <= 0) return;

  if (combat.getFlag("twilight-sword", "tempoPromptRound") === round) return;
  await combat.setFlag("twilight-sword", "tempoPromptRound", round);

  const actors = [];
  const seenActorIds = new Set();

  for (const combatant of combat.combatants ?? []) {
    const actor = combatant.actor;
    if (!actor || actor.type !== "champion") continue;
    if (seenActorIds.has(actor.id)) continue;
    if (!actorHasFeatNamed(actor, "tempo")) continue;
    if (getStatusIds(actor).has("ko")) continue;
    if (Number(actor.system.stamina?.value ?? 0) <= 0) continue;

    seenActorIds.add(actor.id);
    actors.push(actor);
  }

  for (const actor of actors) {
    const spend = await confirmDialog(
      "Use Tempo?",
      `${actor.name} has Tempo. Spend 1 Stamina to become first in initiative this Round?`
    );

    if (spend) await spendTempoInitiative(combat, actor);
  }
}

function getTokenForActor(actor) {
  return canvas.tokens.controlled.find(t => t.actor?.id === actor.id)
    || canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
}

function getPrimaryTargetToken() {
  return Array.from(game.user.targets)[0];
}

function getSquareDistanceBetweenTokens(sourceToken, targetToken) {
  if (!sourceToken || !targetToken) return null;

  const gridSize = canvas.grid.size;
  const dx = Math.abs(sourceToken.center.x - targetToken.center.x) / gridSize;
  const dy = Math.abs(sourceToken.center.y - targetToken.center.y) / gridSize;

  return Math.max(dx, dy);
}
function getWeaponFeats(weapon) {
  const system = weapon.system || {};

  const raw = [
    system.feats,
    system.weaponFeats,
    system.traits,
    system.tags,
    system.properties
  ]
    .filter(Boolean)
    .join(",")
    .toLowerCase();

  const parts = raw
    .split(/[,;|]/)
    .map(s => s.trim())
    .filter(Boolean);

  const feats = new Set(parts);

  for (const feat of [
    "accurate", "arcane", "boomerang", "defensive", "elemental",
    "finesse", "heavy", "magic", "small", "thrown",
    "two-handed", "versatile"
  ]) {
    if (raw.includes(feat)) feats.add(feat);
  }

  if (/\belem\.?\b/.test(raw)) feats.add("elemental");

  return feats;
}

function getWeaponFeatText(weapon) {
  const system = weapon.system || {};

  return [
    system.feats,
    system.weaponFeats,
    system.traits,
    system.tags,
    system.properties
  ]
    .filter(Boolean)
    .join(", ");
}

function getWeaponElementalDamageType(weapon) {
  const explicitType = normalizeElementalAffinity(weapon.system?.elementalDamageType);
  if (explicitType !== "none") return explicitType;

  const raw = getWeaponFeatText(weapon).toLowerCase();
  const match = raw.match(/\b(?:elemental|elem\.?)\s*(?:\[|\(|:|-)?\s*([a-z -]+?)\s*(?:\]|\)|[,;|]|$)/i);

  if (match?.[1]) {
    const parsed = normalizeElementalAffinity(match[1]);
    if (parsed !== "none") return parsed;
  }

  const feats = getWeaponFeats(weapon);
  const weaponDamageType = normalizeElementalAffinity(weapon.system?.damageType);

  if (feats.has("elemental") && weaponDamageType !== "none") return weaponDamageType;

  return "none";
}

function normalizeWeaponTypeName(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\b(old|rusty|broken|worn|crude|simple|basic|quality|good)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getSmallWeaponTypeKey(item) {
  const category = normalizeWeaponTypeName(item.system?.category);
  if (category) return category === "claws" ? "claw" : category;

  const name = normalizeWeaponTypeName(item.name);
  if (name) return name === "claws" ? "claw" : name;

  return item.type;
}

function isWeaponExpended(weapon) {
  if (weapon?.type !== "weapon") return false;

  return weapon.system?.expended === true || weapon.system?.expended === "true";
}

function getWeaponQuantity(weapon) {
  const quantity = Math.floor(Number(weapon.system?.quantity ?? 1));

  return Number.isFinite(quantity) ? Math.max(quantity, 0) : 1;
}

function isWeaponAvailable(weapon) {
  if (weapon?.type !== "weapon") return true;

  return !isWeaponExpended(weapon) && getWeaponQuantity(weapon) > 0;
}

function isWeaponRanged(weapon) {
  const system = weapon.system || {};
  const feats = getWeaponFeats(weapon);
  const weaponType = String(system.weaponType || "").toLowerCase();
  const rangeText = String(system.range || system.weaponRange || "").toLowerCase();
  const typeText = String(system.weaponType || system.type || "").toLowerCase();

  if (weaponType === "r" || weaponType === "ranged") return true;
  if (weaponType === "m" || weaponType === "melee" || weaponType === "s" || weaponType === "shield") return false;

  return system.ranged === true ||
    system.ranged === "true" ||
    typeText.includes("r") ||
    typeText.includes("ranged") ||
    ["near", "far"].includes(rangeText) ||
    feats.has("boomerang");
}

function isEquippableInventoryItem(item) {
  return ["weapon", "gear", "consumable"].includes(item.type);
}

function getItemQuantity(item) {
  const quantity = Math.floor(Number(item.system?.quantity ?? 1));

  return Number.isFinite(quantity) ? Math.max(quantity, 0) : 1;
}

function isLockpickItem(item) {
  const name = normalizeItemName(item?.name || "");

  return name === "lockpick" || name === "lock pick" || name.includes("lockpick");
}

function getResourceStoneType(item) {
  const name = normalizeItemName(item?.name || "");

  if (name === "heart stone") return "hearts";
  if (name === "stamina stone") return "stamina";
  return "";
}

function getConsumableItemUses(item) {
  const uses = Number(item.system?.uses?.value);

  return Number.isFinite(uses) ? Math.max(Math.floor(uses), 0) : null;
}

function getAvailableItemUnits(item) {
  const uses = getConsumableItemUses(item);

  return uses ?? getItemQuantity(item);
}

async function consumeItemUnit(actor, item) {
  const uses = getConsumableItemUses(item);

  if (uses !== null) {
    await item.update({ "system.uses.value": Math.max(uses - 1, 0) });
    return;
  }

  const quantity = getItemQuantity(item);
  const nextQuantity = Math.max(quantity - 1, 0);

  if (nextQuantity > 0) {
    await item.update({ "system.quantity": nextQuantity });
  } else {
    await actor.deleteEmbeddedDocuments("Item", [item.id]);
  }
}

function getItemSlotValue(item) {
  const value = Number(item.system?.slot ?? item.system?.slots ?? 1);
  return Number.isFinite(value) ? Math.max(value, 0) : 1;
}

function getInventorySlotsForItem(item) {
  if (["feat", "spell", "kin"].includes(item.type)) return 0;
  if (item.system?.equipped && (isEquippableInventoryItem(item) || item.type === "armor")) return 0;

  return getItemSlotValue(item) * getItemQuantity(item);
}

function getEquipmentSlotsForItem(item) {
  if (!isEquippableInventoryItem(item) || !item.system?.equipped) return 0;
  if (item.type === "weapon" && !isWeaponAvailable(item)) return 0;

  const feats = item.type === "weapon" ? getWeaponFeats(item) : new Set();
  if (feats.has("heavy")) return 2;

  return 1;
}

function getEquipmentSlotsUsed(items) {
  let used = 0;
  const smallWeapons = new Map();

  for (const item of items) {
    if (!isEquippableInventoryItem(item) || !item.system?.equipped) continue;

    const feats = item.type === "weapon" ? getWeaponFeats(item) : new Set();

    if (item.type === "weapon" && feats.has("small")) {
      const key = getSmallWeaponTypeKey(item);
      smallWeapons.set(key, (smallWeapons.get(key) || 0) + getItemQuantity(item));
      continue;
    }

    used += feats.has("heavy") ? 2 : 1;
  }

  for (const count of smallWeapons.values()) {
    used += Math.ceil(count / 2);
  }

  return used;
}

function getHandSlotsForItem(item) {
  if (!item.system?.wielded) return 0;
  if (item.type !== "weapon" && item.type !== "gear" && item.type !== "consumable") return 0;
  if (item.type === "weapon" && !isWeaponAvailable(item)) return 0;

  const feats = item.type === "weapon" ? getWeaponFeats(item) : new Set();
  if (feats.has("two-handed")) return 2;

  const hands = Number(item.system?.hands ?? 1);
  return Number.isFinite(hands) ? Math.max(hands, 1) : 1;
}

function getActorInventorySummary(actor) {
  const strength = Number(actor.system.abilities?.str?.value ?? 0);
  const bonus = Number(actor.system.inventory?.bonus ?? 0);
  const max = Math.max((strength * 2) + bonus, 0);
  const used = actor.items.reduce((total, item) => total + getInventorySlotsForItem(item), 0);
  const equipmentUsed = getEquipmentSlotsUsed(actor.items.contents || Array.from(actor.items));
  const handsUsed = actor.items.reduce((total, item) => total + getHandSlotsForItem(item), 0);

  return {
    used,
    max,
    bonus,
    equipmentUsed,
    equipmentMax: 3,
    handsUsed,
    handsMax: 2,
    encumbered: used > max,
    equipmentOver: equipmentUsed > 3,
    handsOver: handsUsed > 2
  };
}

function getCurrencyValue(currency = {}) {
  const green = Math.max(Number(currency.green ?? currency.value ?? 0), 0);
  const blue = Math.max(Number(currency.blue ?? 0), 0);
  const red = Math.max(Number(currency.red ?? 0), 0);

  return Math.floor(green) + (Math.floor(blue) * 10) + (Math.floor(red) * 100);
}

function normalizeCurrencyFromGreen(totalGreen) {
  totalGreen = Math.max(Math.floor(Number(totalGreen || 0)), 0);

  const red = Math.floor(totalGreen / 100);
  const blue = Math.floor((totalGreen % 100) / 10);
  const green = totalGreen % 10;

  return { green, blue, red };
}

function getActorCurrency(actor) {
  const zin = actor.system.zin || {};
  const green = zin.green ?? zin.value ?? 0;

  return {
    green: Math.max(Math.floor(Number(green || 0)), 0),
    blue: Math.max(Math.floor(Number(zin.blue || 0)), 0),
    red: Math.max(Math.floor(Number(zin.red || 0)), 0)
  };
}

function getItemCost(item) {
  return normalizeCurrencyFromGreen(getCurrencyValue(item.system?.purchaseCost));
}

function formatCurrency(currency = {}) {
  currency = normalizeCurrencyFromGreen(getCurrencyValue(currency));

  return `${currency.red} Red, ${currency.blue} Blue, ${currency.green} Green`;
}

function isPurchasableItem(item) {
  return ["weapon", "armor", "consumable", "gear"].includes(item?.type);
}

async function buyItem(actor, item) {
  if (!isPurchasableItem(item)) {
    ui.notifications.warn(`${item.name} is not purchasable.`);
    return;
  }

  const cost = getItemCost(item);
  const costTotal = getCurrencyValue(cost);

  if (costTotal <= 0) {
    ui.notifications.warn(`${item.name} has no cost set.`);
    return;
  }

  const funds = getActorCurrency(actor);
  const fundsTotal = getCurrencyValue(funds);

  if (fundsTotal < costTotal) {
    ui.notifications.warn(
      `${actor.name} cannot afford ${item.name}. Cost: ${formatCurrency(cost)}. Available: ${formatCurrency(funds)}.`
    );
    return;
  }

  const confirmed = await confirmDialog(
    "Buy Item?",
    `Buy ${item.name} for ${formatCurrency(cost)}? ${actor.name} has ${formatCurrency(funds)}.`
  );

  if (!confirmed) return;

  const remaining = normalizeCurrencyFromGreen(fundsTotal - costTotal);

  await actor.update({
    "system.zin.green": remaining.green,
    "system.zin.blue": remaining.blue,
    "system.zin.red": remaining.red,
    "system.zin.value": getCurrencyValue(remaining)
  });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="ts-chat-card">
        <h2>${actor.name} buys ${item.name}</h2>
        <p><strong>Cost:</strong> ${formatCurrency(cost)}</p>
        <p><strong>Remaining:</strong> ${formatCurrency(remaining)}</p>
      </div>
    `
  });
}

function normalizeArmorTypeValue(value) {
  const type = String(value || "").trim().toLowerCase();

  if (["c", "cloth", "clothing", "clothes"].includes(type)) return "clothing";
  if (["l", "light", "light armor", "light armour"].includes(type) || type.includes("light")) return "light";
  if (["m", "medium", "medium armor", "medium armour"].includes(type) || type.includes("medium")) return "medium";
  if (["h", "heavy", "heavy armor", "heavy armour"].includes(type) || type.includes("heavy")) return "heavy";

  return type;
}

function normalizeSpellTypeValue(value) {
  const type = String(value || "").trim().toLowerCase();

  if (["bless", "blessing", "prayer"].includes(type)) return "blessing";
  if (["common", "basic"].includes(type)) return "common";

  return "arcane";
}

function getSpellTypeLabel(value) {
  const labels = {
    arcane: "Arcane",
    blessing: "Blessing",
    common: "Common"
  };

  return labels[normalizeSpellTypeValue(value)];
}

function getItemTooltip(item) {
  const parts = [
    item?.system?.description,
    item?.system?.effect,
    item?.system?.featDescription,
    item?.system?.startingEquipment
  ]
    .map(stripHtml)
    .filter(Boolean);

  if (item?.magicSpellSourceName) {
    parts.unshift(`Granted by ${item.magicSpellSourceName}.`);
  }

  return parts.join(" ");
}

function isKinFeat(item) {
  return item?.type === "feat" && (
    item.flags?.["twilight-sword"]?.kinFeat ||
    item.flags?.["twilight-sword"]?.sourceKin ||
    item.system?.way === "Kin"
  );
}

function isDuplicateKinFeat(actor, item) {
  if (!isKinFeat(item)) return false;

  const sourceKin = item.flags?.["twilight-sword"]?.sourceKin || actor.system?.kin || "";
  const kinFeats = actor.items.filter(existing => isKinFeat(existing));
  const matchingKinFeats = sourceKin
    ? kinFeats.filter(existing =>
        (existing.flags?.["twilight-sword"]?.sourceKin || actor.system?.kin || "") === sourceKin
      )
    : kinFeats;

  return matchingKinFeats.length > 1;
}

function normalizeItemName(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function actorHasWay(actor, wayName) {
  const requiredWay = normalizeItemName(wayName);
  if (!requiredWay) return true;

  return [actor.system?.way, actor.system?.way2]
    .map(normalizeItemName)
    .includes(requiredWay);
}

function canChooseFeatMultipleTimes(feat) {
  const description = stripHtml(feat?.system?.description || "");

  return description.includes("You can choose this feat multiple times");
}

async function addFeatToActor(actor, feat) {
  if (actor.type === "champion" && !actorHasWay(actor, feat.system?.way)) {
    ui.notifications.warn(`${actor.name} must have the ${feat.system?.way || "listed"} Way to take ${feat.name}.`);
    return false;
  }

  if (!canChooseFeatMultipleTimes(feat)) {
    const featName = normalizeItemName(feat.name);
    const existing = actor.items.find(item =>
      item.type === "feat" &&
      normalizeItemName(item.name) === featName
    );

    if (existing) {
      ui.notifications.warn(`${actor.name} already has ${feat.name}.`);
      return false;
    }
  }

  const data = feat.toObject ? feat.toObject() : foundry.utils.deepClone(feat);
  delete data._id;
  delete data.id;

  if (["monster", "npc"].includes(actor.type)) {
    foundry.utils.setProperty(data, "system.way", "");
  }

  await actor.createEmbeddedDocuments("Item", [data]);
  return true;
}

async function createOwnedFeat(actor, name = "New Monster Ability") {
  if (!actor) return null;

  const created = await actor.createEmbeddedDocuments("Item", [{
    name,
    type: "feat",
    system: {
      way: "",
      description: "",
      effect: ""
    }
  }]);
  const feat = created[0];

  feat?.sheet?.render(true);
  return feat;
}

async function applyWayToActor(actor, wayItem, slot = null) {
  const normalizedSlot = Number(slot);
  let field = normalizedSlot === 2 ? "system.way2" : normalizedSlot === 1 ? "system.way" : "";

  if (!field) {
    if (!actor.system?.way) field = "system.way";
    else if (!actor.system?.way2) field = "system.way2";
  }

  if (!field) {
    ui.notifications.warn(`${actor.name} already has two Ways. Drop ${wayItem.name} directly onto Way 1 or Way 2 to replace one.`);
    return;
  }

  await actor.update({ [field]: wayItem.name });

  const label = field === "system.way2" ? "Way 2" : "Way 1";
  ui.notifications.info(`${actor.name} ${label} set to ${wayItem.name}.`);
}

function getArmorTypeLabel(type) {
  const normalized = normalizeArmorTypeValue(type);

  if (normalized === "clothing") return "Clothing";
  if (normalized === "light") return "Light";
  if (normalized === "medium") return "Medium";
  if (normalized === "heavy") return "Heavy";

  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "None";
}

function getArmorDisadvantageAbilityKeys(armor) {
  const type = normalizeArmorTypeValue(armor?.system?.armorType || armor?.system?.type);

  if (type === "medium") return ["ste"];
  if (type === "heavy") return ["ste", "agl"];

  return [];
}

function getArmorDisadvantageSummary(actor) {
  const armor = getEquippedArmor(actor);
  const type = normalizeArmorTypeValue(armor?.system?.armorType || armor?.system?.type);
  const abilityKeys = getArmorDisadvantageAbilityKeys(armor);
  const abilities = abilityKeys.map(key => actor.system.abilities?.[key]?.label || key.toUpperCase());

  return {
    armor,
    type,
    typeLabel: getArmorTypeLabel(type),
    abilityKeys,
    abilities,
    text: abilities.length ? `Disadvantage: ${abilities.join(", ")}` : "No armor disadvantage",
    hasPenalty: abilities.length > 0
  };
}

function getHeldShield(actor) {
  return actor.items.find(item =>
    ["weapon", "armor", "gear"].includes(item.type) &&
    (item.type === "weapon" ? item.system?.wielded : (item.system?.wielded || item.system?.equipped)) &&
    isShieldItem(item)
  ) || null;
}

function getCastingRestrictionSummary(actor) {
  const armor = getEquippedArmor(actor);
  const armorType = normalizeArmorTypeValue(armor?.system?.armorType || armor?.system?.type);
  const armorLabel = getArmorTypeLabel(armorType);
  const shield = getHeldShield(actor);
  const hasBattleMage = actorHasFeatNamed(actor, "battle mage");
  const hasLightGuardian = actorHasFeatNamed(actor, "light guardian");
  const statuses = getStatusIds(actor);
  const allowedArmorTypes = new Set(["", "clothing"]);
  const blockers = [];
  const allowances = [];

  if (statuses.has("ko")) {
    blockers.push("Cannot cast while K.O.");
  }

  if (statuses.has("silence")) {
    blockers.push("Cannot cast while Silenced.");
  }

  if (hasBattleMage || hasLightGuardian) {
    allowedArmorTypes.add("light");
  }

  if (hasLightGuardian) {
    allowedArmorTypes.add("medium");
    allowances.push("Light Guardian allows casting with light/medium armor and shields.");
  } else if (hasBattleMage) {
    allowances.push("Battle Mage allows casting with light armor.");
  }

  if (armor && !allowedArmorTypes.has(armorType)) {
    blockers.push(`Cannot cast while wearing ${armor.name} (${armorLabel}).`);
  }

  if (shield && !hasLightGuardian) {
    blockers.push(`Cannot cast while holding ${shield.name}.`);
  }

  return {
    armor,
    armorType,
    armorLabel,
    shield,
    hasBattleMage,
    hasLightGuardian,
    blocked: blockers.length > 0,
    blockers,
    allowances,
    text: blockers.join(" ")
  };
}

function getSpellCastRollBonus(actor, abilityKey) {
  abilityKey = normalizeAbilityKey(abilityKey);

  const armor = getEquippedArmor(actor);
  const armorName = String(armor?.name || "").trim().toLowerCase();

  if (armorName.includes("mystic robe") && abilityKey === "kno") {
    return { value: 1, reason: "Mystic Robe" };
  }

  if (armorName.includes("priest robe") && abilityKey === "cha") {
    return { value: 1, reason: "Priest Robe" };
  }

  return { value: 0, reason: "" };
}

function getEquippedActorItems(actor) {
  return actor.items.filter(item => item.system?.equipped || item.system?.wielded);
}

function getActorFeatNames(actor) {
  return actor.items
    .filter(item => item.type === "feat")
    .map(item => String(item.name || "").trim().toLowerCase());
}

function actorHasFeatNamed(actor, featName) {
  const needle = String(featName || "").trim().toLowerCase();

  return getActorFeatNames(actor).some(name => name.includes(needle));
}

function hasEquippedItemNamed(actor, name) {
  const needle = String(name || "").trim().toLowerCase();

  return getEquippedActorItems(actor).some(item =>
    String(item.name || "").trim().toLowerCase().includes(needle)
  );
}

function isInstrumentSongFeat(feat) {
  if (feat?.type !== "feat") return false;

  const name = String(feat.name || "").trim().toLowerCase();
  const way = String(feat.system?.way || "").trim().toLowerCase();
  const rulesText = stripHtml([
    feat.system?.description,
    feat.system?.effect,
    feat.system?.featDescription
  ].filter(Boolean).join(" "));
  const knownInstrumentSongs = new Set(["battle song", "campfire song", "inspiring song"]);

  if (knownInstrumentSongs.has(name)) return true;

  return way.includes("song") &&
    name.includes("song") &&
    rulesText.toLowerCase().includes("musical instrument");
}

async function enforceCanUseFeat(actor, feat) {
  if (!(await enforceCanAct(actor, "use feats"))) return false;

  if (!isInstrumentSongFeat(feat)) return true;

  if (await actorHasStatus(actor, "silence")) {
    ui.notifications.warn(`${actor.name} is Silenced and cannot use ${feat.name}.`);
    return false;
  }

  if (!hasEquippedItemNamed(actor, "musical instrument")) {
    ui.notifications.warn(`${actor.name} needs an equipped Musical Instrument to use ${feat.name}.`);
    return false;
  }

  return true;
}

async function useFeat(actor, feat) {
  if (!(await enforceCanUseFeat(actor, feat))) return;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="ts-chat-card">
        <h2>${escapeHtml(feat.name)}</h2>
        <p><strong>Type:</strong> Feat</p>
        ${feat.system?.way ? `<p><strong>Way:</strong> ${escapeHtml(feat.system.way)}</p>` : ""}
        ${isInstrumentSongFeat(feat) ? `<p><strong>Song Requirement:</strong> Equipped Musical Instrument and not Silenced.</p>` : ""}
        ${feat.system?.description ? `<p>${feat.system.description}</p>` : ""}
        ${feat.system?.effect ? `<p><strong>Effect:</strong> ${feat.system.effect}</p>` : ""}
      </div>
    `
  });
}

function getAbilityRollBonuses(actor, abilityKey, options = {}) {
  abilityKey = normalizeAbilityKey(abilityKey);

  const bonuses = [];
  const optionBonus = Math.max(Number(options.rollBonus || 0), 0);

  if (optionBonus) {
    bonuses.push({
      value: optionBonus,
      reason: options.rollBonusReason || "Bonus"
    });
  }

  if (abilityKey === "ste" && hasEquippedItemNamed(actor, "stealth gear")) {
    bonuses.push({ value: 1, reason: "Stealth Gear" });
  }

  return bonuses;
}

const ELEMENTAL_DAMAGE_TYPES = [
  { value: "fire", label: "Fire" },
  { value: "ice", label: "Ice" },
  { value: "wind", label: "Wind" },
  { value: "earth", label: "Earth" },
  { value: "thunder", label: "Thunder" },
  { value: "water", label: "Water" },
  { value: "light", label: "Light" },
  { value: "darkness", label: "Darkness" },
  { value: "twilight", label: "Twilight" }
];

function buildSelectOptions(options, selectedValue) {
  return options.map(option => `
    <option value="${option.value}" ${option.value === selectedValue ? "selected" : ""}>${option.label}</option>
  `).join("");
}

function buildDamageTypeOptions(selectedType = "") {
  const selected = normalizeDamageType(selectedType);

  return buildSelectOptions([
    { value: "non-magical", label: "Non-magical" },
    ...ELEMENTAL_DAMAGE_TYPES
  ], selected);
}

function buildElementalAffinityOptions(selectedAffinity = "") {
  const selected = normalizeElementalAffinity(selectedAffinity);

  return buildSelectOptions([
    { value: "none", label: "None" },
    ...ELEMENTAL_DAMAGE_TYPES
  ], selected);
}

function normalizeDamageType(value) {
  const damageType = String(value || "").trim().toLowerCase();

  if (!damageType || ["none", "normal", "mundane", "physical", "nonmagical", "non-magical", "non magical"].includes(damageType)) {
    return "non-magical";
  }

  if (damageType.includes("twilight")) return "twilight";
  if (damageType.includes("dark")) return "darkness";
  if (damageType.includes("thunder") || damageType.includes("lightning")) return "thunder";
  if (damageType.includes("fire") || damageType.includes("flame")) return "fire";
  if (damageType.includes("ice") || damageType.includes("cold") || damageType.includes("freeze")) return "ice";
  if (damageType.includes("wind") || damageType.includes("air")) return "wind";
  if (damageType.includes("earth") || damageType.includes("stone")) return "earth";
  if (damageType.includes("water")) return "water";
  if (damageType.includes("light")) return "light";

  return damageType;
}

function getDamageTypeLabel(type) {
  const normalized = normalizeDamageType(type);

  if (normalized === "non-magical") return "Non-magical";
  if (normalized === "thunder") return "Thunder";
  if (normalized === "fire") return "Fire";
  if (normalized === "ice") return "Ice";
  if (normalized === "wind") return "Wind";
  if (normalized === "earth") return "Earth";
  if (normalized === "water") return "Water";
  if (normalized === "light") return "Light";
  if (normalized === "darkness") return "Darkness";
  if (normalized === "twilight") return "Twilight";

  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "";
}

function normalizeMonsterVariantRank(value) {
  const rank = String(value || "").trim().toLowerCase();

  if (["blue", "red", "black"].includes(rank)) return rank;

  return "none";
}

function getMonsterVariantData(actor) {
  const variant = actor?.system?.variant || {};

  if (typeof variant === "string") {
    return {
      rank: normalizeMonsterVariantRank(variant),
      elementalType: "none"
    };
  }

  return {
    rank: normalizeMonsterVariantRank(variant.rank),
    elementalType: normalizeElementalAffinity(variant.elementalType)
  };
}

function getMonsterBaseThreat(actor) {
  const threat = Math.floor(Number(actor?.system?.level ?? 1));

  return Number.isFinite(threat) ? Math.max(threat, 1) : 1;
}

function getMonsterBaseMaxHearts(actor) {
  const hearts = Math.floor(Number(actor?.system?.hearts?.max ?? 0));

  return Number.isFinite(hearts) ? Math.max(hearts, 0) : 0;
}

function getMonsterBaseArmor(actor) {
  const armor = Math.floor(Number(actor?.system?.armor?.value ?? 0));

  return Number.isFinite(armor) ? Math.max(armor, 0) : 0;
}

function getMonsterVariantDamageBonus(actor) {
  if (actor?.type !== "monster") return 0;

  const { rank } = getMonsterVariantData(actor);

  if (rank === "black") return 2;
  if (rank === "blue" || rank === "red") return 1;

  return 0;
}

function getMonsterEffectiveThreat(actor) {
  const baseThreat = getMonsterBaseThreat(actor);
  const { rank } = getMonsterVariantData(actor);

  return rank === "black" ? baseThreat + 1 : baseThreat;
}

function getMonsterEffectiveMaxHeartsFromValues(baseMax, baseThreat, rank) {
  rank = normalizeMonsterVariantRank(rank);

  if (rank === "black") return baseMax * 2;
  if (rank === "red") return baseMax + (5 * baseThreat);
  if (rank === "blue") return baseMax + (3 * baseThreat);

  return baseMax;
}

function getMonsterEffectiveMaxHearts(actor) {
  const baseMax = getMonsterBaseMaxHearts(actor);
  const baseThreat = getMonsterBaseThreat(actor);
  const { rank } = getMonsterVariantData(actor);

  return getMonsterEffectiveMaxHeartsFromValues(baseMax, baseThreat, rank);
}

function getMonsterEffectiveArmor(actor) {
  const baseArmor = getMonsterBaseArmor(actor);
  const { rank } = getMonsterVariantData(actor);

  return baseArmor + (rank === "red" || rank === "black" ? 1 : 0);
}

function getActorArmorValue(actor) {
  if (actor?.type === "monster") return getMonsterEffectiveArmor(actor);

  return Number(actor?.system?.armor?.value || 0);
}

function getMonsterEffectiveElementalAffinity(actor) {
  if (actor?.type !== "monster") {
    return normalizeElementalAffinity(actor?.system?.elementalAffinity);
  }

  const { elementalType } = getMonsterVariantData(actor);

  return elementalType !== "none"
    ? elementalType
    : normalizeElementalAffinity(actor.system?.elementalAffinity);
}

function getMonsterEffectiveDamageType(actor, baseDamageType = "") {
  if (actor?.type !== "monster") return normalizeDamageType(baseDamageType);

  const { elementalType } = getMonsterVariantData(actor);

  return elementalType !== "none" ? elementalType : normalizeDamageType(baseDamageType);
}

function getMonsterVariantLabel(rank) {
  rank = normalizeMonsterVariantRank(rank);

  if (rank === "blue") return "Blue";
  if (rank === "red") return "Red";
  if (rank === "black") return "Black";

  return "None";
}

function getMonsterVariantSummary(actor) {
  const data = getMonsterVariantData(actor);
  const baseThreat = getMonsterBaseThreat(actor);
  const effectiveThreat = getMonsterEffectiveThreat(actor);
  const baseArmor = getMonsterBaseArmor(actor);
  const effectiveArmor = getMonsterEffectiveArmor(actor);
  const baseHeartsMax = getMonsterBaseMaxHearts(actor);
  const effectiveHeartsMax = getMonsterEffectiveMaxHearts(actor);
  const damageBonus = getMonsterVariantDamageBonus(actor);
  const effectiveAffinity = getMonsterEffectiveElementalAffinity(actor);
  const traits = [];

  if (data.elementalType !== "none") {
    traits.push(`Elemental ${getDamageTypeLabel(data.elementalType)} attacks and affinity`);
  }

  if (damageBonus) traits.push(`Monster attacks deal +${damageBonus} damage`);
  if (effectiveArmor !== baseArmor) traits.push(`Armor ${baseArmor} -> ${effectiveArmor}`);
  if (effectiveThreat !== baseThreat) traits.push(`Threat ${baseThreat} -> ${effectiveThreat}`);
  if (effectiveHeartsMax !== baseHeartsMax) traits.push(`Hearts ${baseHeartsMax} -> ${effectiveHeartsMax}`);
  if (data.rank === "black") traits.push("Can dodge/parry [8] once per round");

  return {
    ...data,
    rankLabel: getMonsterVariantLabel(data.rank),
    elementalTypeLabel: getElementalAffinityLabel(data.elementalType),
    baseThreat,
    effectiveThreat,
    baseArmor,
    effectiveArmor,
    baseHeartsMax,
    effectiveHeartsMax,
    damageBonus,
    effectiveAffinity,
    effectiveAffinityLabel: getElementalAffinityLabel(effectiveAffinity),
    hasVariant: data.rank !== "none" || data.elementalType !== "none",
    traits,
    text: traits.join(", ")
  };
}

function getMonsterRotationGroupKey(actor) {
  const name = String(actor?.name || "monster")
    .trim()
    .toLowerCase()
    .replace(/\b(blue|red|black|fire|ice|wind|earth|thunder|water|light|darkness)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return name || actor?.id || "monster";
}

function getMonsterRotationStore() {
  return foundry.utils.deepClone(game.combat?.getFlag("twilight-sword", "monsterRotations") || {});
}

function getMonsterRotationState(actor) {
  const store = getMonsterRotationStore();
  const key = getMonsterRotationGroupKey(actor);

  return {
    active: false,
    nextIndex: 0,
    lastIndex: null,
    groupKey: key,
    ...(store[key] || {})
  };
}

async function setMonsterRotationState(actor, state = {}) {
  if (!game.combat) return;

  const store = getMonsterRotationStore();
  const key = getMonsterRotationGroupKey(actor);

  store[key] = {
    ...getMonsterRotationState(actor),
    ...state,
    groupKey: key
  };

  await game.combat.setFlag("twilight-sword", "monsterRotations", store);
}

function getNextMonsterRotationIndex(actor, startIndex = 0) {
  const actions = actor.system?.actions || [];
  if (!actions.length) return 0;

  const index = Math.floor(Number(startIndex || 0));

  return ((index % actions.length) + actions.length) % actions.length;
}

async function noteMonsterActionUsed(actor, actionIndex) {
  if (!game.combat) return;
  if (actionIndex === null || actionIndex === undefined || Number.isNaN(Number(actionIndex))) return;

  const actions = actor.system?.actions || [];
  if (!actions.length) return;

  const index = getNextMonsterRotationIndex(actor, actionIndex);
  const state = getMonsterRotationState(actor);

  await setMonsterRotationState(actor, {
    lastIndex: index,
    nextIndex: getNextMonsterRotationIndex(actor, index + 1),
    active: state.active
  });
}

function getSwappedMonsterActionIndex(index, fromIndex, toIndex) {
  if (index === null || index === undefined || Number.isNaN(Number(index))) return index;

  const numericIndex = Number(index);
  if (numericIndex === fromIndex) return toIndex;
  if (numericIndex === toIndex) return fromIndex;

  return numericIndex;
}

async function preserveMonsterRotationAfterActionMove(actor, fromIndex, toIndex) {
  if (!game.combat) return;

  const state = getMonsterRotationState(actor);
  await setMonsterRotationState(actor, {
    ...state,
    lastIndex: getSwappedMonsterActionIndex(state.lastIndex, fromIndex, toIndex),
    nextIndex: getSwappedMonsterActionIndex(state.nextIndex, fromIndex, toIndex)
  });
}

async function moveMonsterAction(actor, index, direction) {
  const actions = foundry.utils.deepClone(actor.system.actions || []);
  const fromIndex = Number(index);
  const toIndex = fromIndex + Number(direction);

  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return;
  if (toIndex < 0 || toIndex >= actions.length) {
    ui.notifications.info("That monster action is already at the edge of the list.");
    return;
  }

  [actions[fromIndex], actions[toIndex]] = [actions[toIndex], actions[fromIndex]];

  await actor.update({ "system.actions": actions });
  await preserveMonsterRotationAfterActionMove(actor, fromIndex, toIndex);
}

async function startMonsterRotation(actor) {
  if (!game.combat) {
    ui.notifications.warn("Start combat before using monster rotation.");
    return;
  }

  const actions = actor.system?.actions || [];

  if (!actions.length) {
    ui.notifications.warn(`${actor.name} has no actions to rotate.`);
    return;
  }

  const state = getMonsterRotationState(actor);
  const nextIndex = state.lastIndex === null || state.lastIndex === undefined
    ? 0
    : getNextMonsterRotationIndex(actor, Number(state.lastIndex) + 1);

  await setMonsterRotationState(actor, {
    active: true,
    nextIndex
  });

  ui.notifications.info(`${actor.name} rotation started at action ${nextIndex + 1}.`);
}

async function breakMonsterRotation(actor, reason = "Rotation broken") {
  if (!game.combat) return false;

  const state = getMonsterRotationState(actor);
  if (!state.active) return false;

  await setMonsterRotationState(actor, {
    active: false
  });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="ts-chat-card">
        <h2>${actor.name} Rotation Breaks</h2>
        <p>${escapeHtml(reason)}</p>
      </div>
    `
  });

  return true;
}

async function useNextMonsterRotationAction(actor) {
  if (!game.combat) {
    ui.notifications.warn("Start combat before using monster rotation.");
    return;
  }

  const actions = actor.system?.actions || [];

  if (!actions.length) {
    ui.notifications.warn(`${actor.name} has no actions.`);
    return;
  }

  const state = getMonsterRotationState(actor);

  if (!state.active) {
    ui.notifications.warn(`${actor.name} is not in rotation.`);
    return;
  }

  const index = getNextMonsterRotationIndex(actor, state.nextIndex);
  const action = actions[index];

  if (!action) {
    ui.notifications.warn(`Could not find rotation action ${index + 1}.`);
    return;
  }

  await useMonsterAction(actor, action, { actionIndex: index, rotation: true });
}

function normalizeElementalAffinity(value) {
  const affinity = normalizeDamageType(value);

  return affinity === "non-magical" ? "none" : affinity;
}

function getElementalAffinityLabel(affinity) {
  affinity = normalizeElementalAffinity(affinity);

  return affinity === "none" ? "None" : getDamageTypeLabel(affinity);
}

function getElementalAffinityProfile(actor) {
  const affinity = getMonsterEffectiveElementalAffinity(actor);

  if (affinity === "none") {
    return {
      affinity,
      immune: "",
      resistant: "",
      weak: ""
    };
  }

  if (affinity === "light") {
    return {
      affinity,
      immune: "light",
      resistant: "",
      weak: "darkness"
    };
  }

  if (affinity === "darkness") {
    return {
      affinity,
      immune: "darkness",
      resistant: "",
      weak: "light"
    };
  }

  if (affinity === "twilight") {
    return {
      affinity,
      immune: "",
      resistant: "",
      weak: "twilight"
    };
  }

  const wheel = ["fire", "ice", "wind", "earth", "thunder", "water"];
  const index = wheel.indexOf(affinity);

  if (index === -1) {
    return {
      affinity: "none",
      immune: "",
      resistant: "",
      weak: ""
    };
  }

  return {
    affinity,
    immune: affinity,
    resistant: wheel[(index + 1) % wheel.length],
    weak: wheel[(index - 1 + wheel.length) % wheel.length]
  };
}

function getElementalAffinityDamageAdjustment(actor, damage, { damageType = "" } = {}) {
  const normalizedType = normalizeDamageType(damageType);
  const startingDamage = Math.max(Number(damage || 0), 0);

  if (actor.type !== "monster" || normalizedType === "non-magical") {
    return { damage: startingDamage, text: "", multiplier: 1 };
  }

  const damageLabel = getDamageTypeLabel(normalizedType);
  const plantTrait = getMonsterPlantElementalTrait(actor);

  if (plantTrait && normalizedType === plantTrait.resistant) {
    const adjusted = Math.ceil(startingDamage / 2);

    return {
      damage: adjusted,
      multiplier: 0.5,
      text: `${actor.name}'s ${escapeHtml(plantTrait.source)} ability resists ${damageLabel} damage: ${startingDamage} -> ${adjusted}.`
    };
  }

  if (plantTrait && normalizedType === plantTrait.weak) {
    const adjusted = startingDamage * 2;

    return {
      damage: adjusted,
      multiplier: 2,
      text: `${actor.name}'s ${escapeHtml(plantTrait.source)} ability is weak to ${damageLabel} damage: ${startingDamage} -> ${adjusted}.`
    };
  }

  const profile = getElementalAffinityProfile(actor);
  const affinityLabel = getElementalAffinityLabel(profile.affinity);

  if (normalizedType === "twilight" && profile.affinity !== "none") {
    const adjusted = startingDamage * 2;

    return {
      damage: adjusted,
      multiplier: 2,
      text: `${actor.name}'s ${affinityLabel} affinity is weak to ${damageLabel} damage: ${startingDamage} -> ${adjusted}.`
    };
  }

  if (normalizedType === profile.immune) {
    return {
      damage: 0,
      multiplier: 0,
      text: `${actor.name}'s ${affinityLabel} affinity grants immunity to ${damageLabel} damage: ${startingDamage} -> 0.`
    };
  }

  if (normalizedType === profile.resistant) {
    const adjusted = Math.ceil(startingDamage / 2);

    return {
      damage: adjusted,
      multiplier: 0.5,
      text: `${actor.name}'s ${affinityLabel} affinity resists ${damageLabel} damage: ${startingDamage} -> ${adjusted}.`
    };
  }

  if (normalizedType === profile.weak) {
    const adjusted = startingDamage * 2;

    return {
      damage: adjusted,
      multiplier: 2,
      text: `${actor.name}'s ${affinityLabel} affinity is weak to ${damageLabel} damage: ${startingDamage} -> ${adjusted}.`
    };
  }

  return { damage: startingDamage, text: "", multiplier: 1 };
}

function getElementalArmorDamageAdjustment(actor, damage, { damageType = "" } = {}) {
  const normalizedType = normalizeDamageType(damageType);
  const armor = getEquippedArmor(actor);
  const armorName = String(armor?.name || "").trim().toLowerCase();
  const startingDamage = Math.max(Number(damage || 0), 0);

  if (!normalizedType || normalizedType === "non-magical") {
    return { damage: startingDamage, text: "", multiplier: 1 };
  }

  if (armorName.includes("rubber armor") && normalizedType === "thunder") {
    const adjusted = Math.ceil(startingDamage / 2);

    return {
      damage: adjusted,
      multiplier: 0.5,
      text: `Rubber Armor resisted ${getDamageTypeLabel(normalizedType)} damage: ${startingDamage} -> ${adjusted}.`
    };
  }

  if (armorName.includes("plate armor") && normalizedType === "thunder") {
    const adjusted = startingDamage * 2;

    return {
      damage: adjusted,
      multiplier: 2,
      text: `Plate Armor weakness to ${getDamageTypeLabel(normalizedType)} damage: ${startingDamage} -> ${adjusted}.`
    };
  }

  if (armorName.includes("fireproof armor") && normalizedType === "fire") {
    const adjusted = Math.ceil(startingDamage / 2);

    return {
      damage: adjusted,
      multiplier: 0.5,
      text: `Fireproof Armor resisted ${getDamageTypeLabel(normalizedType)} damage: ${startingDamage} -> ${adjusted}.`
    };
  }

  return { damage: startingDamage, text: "", multiplier: 1 };
}

function getElementalDamageAdjustment(actor, damage, { damageType = "" } = {}) {
  const affinityAdjustment = getElementalAffinityDamageAdjustment(actor, damage, { damageType });
  const armorAdjustment = getElementalArmorDamageAdjustment(actor, affinityAdjustment.damage, { damageType });

  return {
    damage: armorAdjustment.damage,
    multiplier: affinityAdjustment.multiplier * armorAdjustment.multiplier,
    text: [affinityAdjustment.text, armorAdjustment.text].filter(Boolean).join("<br>")
  };
}

function getArmorElementalTraitSummary(actor) {
  const armor = getEquippedArmor(actor);
  const armorName = String(armor?.name || "").trim().toLowerCase();
  const traits = [];

  if (armorName.includes("rubber armor")) traits.push("Resists Thunder");
  if (armorName.includes("plate armor")) traits.push("Weak to Thunder");
  if (armorName.includes("fireproof armor")) traits.push("Resists Fire");

  return {
    armor,
    traits,
    text: traits.join(", "),
    hasTraits: traits.length > 0
  };
}

function getEquippedArmor(actor) {
  return actor.items.find(item => item.type === "armor" && item.system?.equipped) || null;
}

async function toggleItemEquipped(actor, item) {
  const willEquip = !item.system?.equipped;

  if (!willEquip) {
    await item.update({ "system.equipped": false, "system.wielded": false });
    if (item.type === "armor") await recalcArmor(actor);
    return;
  }

  if (item.type === "weapon" && !isWeaponAvailable(item)) {
    ui.notifications.warn(`${item.name} must be picked up before it can be equipped.`);
    return;
  }

  if (item.type === "armor") {
    const otherArmor = actor.items.filter(i =>
      i.type === "armor" &&
      i.id !== item.id &&
      i.system?.equipped
    );

    for (const armor of otherArmor) {
      await armor.update({ "system.equipped": false });
    }

    await item.update({ "system.equipped": true });
    await recalcArmor(actor);
    return;
  }

  if (isEquippableInventoryItem(item)) {
    const currentItems = actor.items.contents || Array.from(actor.items);
    const nextItems = currentItems
      .filter(existing => existing.id !== item.id)
      .concat({
        id: item.id,
        name: item.name,
        type: item.type,
        system: { ...item.system, equipped: true }
      });
    const nextEquipmentUsed = getEquipmentSlotsUsed(nextItems);

    if (nextEquipmentUsed > getActorInventorySummary(actor).equipmentMax) {
      ui.notifications.warn(`${actor.name} can only keep 3 equipment slots ready.`);
      return;
    }
  }

  await item.update({ "system.equipped": true });
}

async function toggleItemWielded(actor, item) {
  const willWield = !item.system?.wielded;

  if (!willWield) {
    await item.update({ "system.wielded": false });
    return;
  }

  if (!isEquippableInventoryItem(item)) return;

  if (item.type === "weapon" && !isWeaponAvailable(item)) {
    ui.notifications.warn(`${item.name} must be picked up before it can be wielded.`);
    return;
  }

  if (!item.system?.equipped) {
    ui.notifications.warn(`${item.name} must be equipped before it can be wielded.`);
    return;
  }

  if (item.type === "weapon" && getWeaponFeats(item).has("two-handed") && Number(item.system?.hands ?? 2) !== 2) {
    await item.update({ "system.hands": 2 });
  }

  const current = getActorInventorySummary(actor);
  const nextHandsUsed = current.handsUsed + getHandSlotsForItem({
      type: item.type,
      system: { ...item.system, wielded: true }
    });

  if (nextHandsUsed > current.handsMax) {
    ui.notifications.warn(`${actor.name} only has 2 hand slots.`);
    return;
  }

  await item.update({ "system.wielded": true });
}

async function pickUpWeapon(actor, weapon) {
  if (weapon.type !== "weapon") return;
  if (!(await enforceCanAct(actor, "pick up weapons"))) return;
  if (!(await enforceTurnActor(actor, "pick up weapons"))) return;

  const quantity = getWeaponQuantity(weapon);
  const addsQuantity = weapon.getFlag("twilight-sword", "pickupAddsQuantity") === true || quantity === 0;
  const nextQuantity = addsQuantity ? quantity + 1 : Math.max(quantity, 1);

  await weapon.update({
    "system.quantity": nextQuantity,
    "system.expended": false,
    "flags.twilight-sword.pickupAddsQuantity": false
  });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="ts-chat-card">
        <h2>${actor.name} picks up ${weapon.name}</h2>
        <p><strong>Quantity:</strong> ${nextQuantity}</p>
      </div>
    `
  });
}

function getRangeBandFromSquares(squares) {
  if (squares === null || squares === undefined) return null;
  if (squares <= 1) return "close";
  if (squares <= 5) return "near";
  if (squares <= 15) return "far";
  return "too far";
}

function normalizeRange(range) {
  return String(range || "").trim().toLowerCase();
}

function getRangeLabel(range) {
  range = normalizeRange(range);

  if (range === "self") return "Self";
  if (range === "close") return "Close";
  if (range === "near") return "Near";
  if (range === "far") return "Far";

  return "";
}

function buildRangeOptions(selectedRange = "", { includeBlank = true } = {}) {
  const selected = normalizeRange(selectedRange);
  const options = includeBlank ? ['<option value="">Not set</option>'] : [];

  for (const [value, label] of [
    ["close", "Close"],
    ["near", "Near"],
    ["far", "Far"],
    ["self", "Self"]
  ]) {
    options.push(
      `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`
    );
  }

  return options.join("");
}

function getRangeLimit(range) {
  range = normalizeRange(range);

  if (!range || range === "—") return null;
  if (range === "self") return 0;
  if (range === "close") return 1;
  if (range === "near") return 5;
  if (range === "far") return 15;

  return null;
}

function getRangeInfo(actor, targetToken = null) {
  const sourceToken = getTokenForActor(actor);
  const target = targetToken || getPrimaryTargetToken();

  if (!sourceToken || !target) return null;

  const squares = getSquareDistanceBetweenTokens(sourceToken, target);
  const band = getRangeBandFromSquares(squares);

  return {
    sourceToken,
    targetToken: target,
    squares,
    roundedSquares: Math.round(squares),
    band,
    label: `${band.toUpperCase()} (${Math.round(squares)} squares)`
  };
}

const RANGE_HOVER_LABEL_NAME = "twilight-sword-range-hover";

function getRangeHoverSourceToken(targetToken) {
  const controlled = canvas.tokens?.controlled?.find(token =>
    token?.actor &&
    token.id !== targetToken?.id
  );

  if (controlled) return controlled;

  const combatantToken = game.combat?.combatant?.token?.object;

  if (combatantToken?.actor && combatantToken.id !== targetToken?.id) {
    return combatantToken;
  }

  return null;
}

function clearTokenRangeHoverLabel(token) {
  const label = token?.getChildByName?.(RANGE_HOVER_LABEL_NAME);
  if (label) label.destroy({ children: true });
}

function getRangeHoverLabel(sourceToken, targetToken) {
  const squares = getSquareDistanceBetweenTokens(sourceToken, targetToken);
  const band = getRangeBandFromSquares(squares);

  if (!band) return "";

  return `${band.toUpperCase()} (${Math.round(squares)} squares)`;
}

function createRangeHoverText(text) {
  const style = {
    fontFamily: "Georgia",
    fontSize: 20,
    fontWeight: "bold",
    fill: "#fff3cf",
    stroke: "#064f55",
    strokeThickness: 5,
    dropShadow: true,
    dropShadowColor: "#000000",
    dropShadowBlur: 3,
    dropShadowDistance: 2
  };

  try {
    return new PIXI.Text({ text, style });
  } catch (_error) {
    return new PIXI.Text(text, style);
  }
}

function showTokenRangeHoverLabel(targetToken) {
  clearTokenRangeHoverLabel(targetToken);

  const sourceToken = getRangeHoverSourceToken(targetToken);
  if (!sourceToken) return;

  const text = getRangeHoverLabel(sourceToken, targetToken);
  if (!text) return;

  const label = createRangeHoverText(text);
  label.name = RANGE_HOVER_LABEL_NAME;
  label.anchor?.set?.(0.5, 1);
  label.position.set(targetToken.w / 2, -8);
  label.zIndex = 9999;

  targetToken.addChild(label);
}

function clearAllRangeHoverLabels() {
  for (const token of canvas.tokens?.placeables || []) {
    clearTokenRangeHoverLabel(token);
  }
}

function isTargetWithinRange(requiredRange, rangeInfo) {
  const limit = getRangeLimit(requiredRange);

  if (limit === null) return true;
  if (!rangeInfo) return false;

  return rangeInfo.squares <= limit;
}

function isRangedAttackInCloseRange(requiredRange, rangeInfo) {
  const range = normalizeRange(requiredRange);

  return ["near", "far"].includes(range)
    && rangeInfo
    && rangeInfo.squares <= 1;
}


// Items / Spells

async function useLockpick(actor, item) {
  if (!(await enforceCanAct(actor, "use lockpicks"))) return;
  if (!(await enforceTurnActor(actor, "use items"))) return;

  if (getAvailableItemUnits(item) <= 0) {
    ui.notifications.warn(`${item.name} has none left.`);
    return;
  }

  const result = await rollAbility(actor, "ste", { askStamina: true });
  if (!result) return;

  const hasThief = actorHasFeatNamed(actor, "thief");
  const lockpickResultText = result.success
    ? "Success. The lock opens and the lockpick is not consumed."
    : hasThief
      ? "Failure, but Thief prevents the lockpick from breaking."
      : "Failure. Check whether the lockpick breaks.";
  const thiefText = hasThief
    ? "<p><strong>Thief:</strong> The lockpick does not risk breaking.</p>"
    : "";
  const breakButton = !result.success && !hasThief
    ? `
      <button
        type="button"
        class="ts-lockpick-break-check"
        data-actor-id="${actor.id}"
        data-item-id="${item.id}"
      >
        Roll again to see if the lockpick breaks
      </button>
    `
    : "";

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="ts-chat-card">
        <h2>${actor.name} uses ${item.name}</h2>
        <p><strong>Stealth:</strong> ${lockpickResultText}</p>
        ${thiefText}
        ${breakButton}
      </div>
    `
  });
}

async function useConsumable(actor, item) {
  if (isLockpickItem(item)) {
    await useLockpick(actor, item);
    return;
  }

  if (!(await enforceTurnActor(actor, "use items"))) return;

  const effect = item.system.effect || "";
  const uses = Number(item.system.uses?.value ?? 1);

  if (uses <= 0) {
    ui.notifications.warn(`${item.name} has no uses left.`);
    return;
  }

  const stoneType = getResourceStoneType(item);

  if (stoneType === "hearts") {
    const currentMax = Number(actor.system.hearts?.max ?? 0);
    const currentValue = Number(actor.system.hearts?.value ?? 0);
    const nextMax = currentMax + 3;

    await actor.update({
      "system.hearts.max": nextMax,
      "system.hearts.value": Math.min(currentValue + 3, nextMax)
    });
  }

  if (stoneType === "stamina") {
    const currentMax = Number(actor.system.stamina?.max ?? 0);
    const currentValue = Number(actor.system.stamina?.value ?? 0);
    const nextMax = currentMax + 1;

    await actor.update({
      "system.stamina.max": nextMax,
      "system.stamina.value": Math.min(currentValue + 1, nextMax)
    });
  }

  const healMatch = effect.match(/heal\s+(\d+)/i);

  if (healMatch) {
    const heal = Number(healMatch[1]);
    await healActor(actor, heal);
  }

  await consumeItemUnit(actor, item);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="ts-chat-card">
        <h2>${actor.name} uses ${item.name}</h2>
        ${stoneType === "hearts" ? "<p>Maximum Hearts increased by 3.</p>" : ""}
        ${stoneType === "stamina" ? "<p>Maximum Stamina increased by 1.</p>" : ""}
        <p>${item.system.description || ""}</p>
      </div>
    `
  });
}

const MAGIC_ITEM_SPELL_EXPENDED_FLAG = "magicSpellExpended";
const PREPARED_SPELL_FLAG = "preparedSpell";

function getMagicSpellKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getMagicSpellTraitNames(item) {
  const text = [
    item.system?.description,
    item.system?.effect
  ]
    .filter(Boolean)
    .join("\n");
  const names = [];
  const seen = new Set();
  const regex = /\bmagic\s*\[([^\]]+)\]/gi;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const name = String(match[1] || "").trim();
    const key = getMagicSpellKey(name);

    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}

function isMagicSpellSourceItem(item, { equippedOnly = true } = {}) {
  if (!["weapon", "armor", "gear", "consumable"].includes(item?.type)) return false;
  if (equippedOnly && !item.system?.equipped) return false;

  return getMagicSpellTraitNames(item).length > 0;
}

function getMagicSpellSourceItems(actor, options = {}) {
  return actor.items.filter(item => isMagicSpellSourceItem(item, options));
}

function findActorSpellByName(actor, spellName) {
  const key = getMagicSpellKey(spellName);

  return actor.items.find(item =>
    item.type === "spell" &&
    getMagicSpellKey(item.name) === key
  ) || null;
}

function findWorldSpellByName(spellName) {
  const key = getMagicSpellKey(spellName);

  return game.items?.find(item =>
    item.type === "spell" &&
    getMagicSpellKey(item.name) === key
  ) || null;
}

function buildGrantedMagicSpell(actor, sourceItem, spellName) {
  const definition = findWorldSpellByName(spellName);
  const key = getMagicSpellKey(spellName);
  const system = definition
    ? foundry.utils.deepClone(definition.system || {})
    : {
        spellType: "arcane",
        roll: "",
        range: "",
        damage: "",
        failureDamage: "",
        damageType: "non-magical",
        duration: "",
        status: "",
        statusDuration: "",
        statusOnDamage: false,
        onFailEffect: "",
        description: `Granted by ${sourceItem.name}. Create a spell card named "${spellName}" to automate this spell.`
      };

  system.expended = false;

  return {
    id: `magic-${sourceItem.id}-${key}`,
    type: "spell",
    name: definition?.name || spellName,
    img: definition?.img || sourceItem.img,
    system,
    magicSpellSourceId: sourceItem.id,
    magicSpellSourceName: sourceItem.name,
    magicSpellName: spellName,
    magicSpellMissingDefinition: !definition,
    update: async changes => {
      if (changes["system.expended"] !== undefined || changes.system?.expended !== undefined) {
        system.expended = false;
      }
    }
  };
}

function getActorSpellList(actor) {
  const spells = actor.items.filter(item => item.type === "spell");
  const knownSpellKeys = new Set(spells.map(spell => getMagicSpellKey(spell.name)));
  const grantedSpells = [];

  for (const sourceItem of getMagicSpellSourceItems(actor)) {
    for (const spellName of getMagicSpellTraitNames(sourceItem)) {
      if (knownSpellKeys.has(getMagicSpellKey(spellName))) continue;

      grantedSpells.push(buildGrantedMagicSpell(actor, sourceItem, spellName));
    }
  }

  return spells.concat(grantedSpells);
}

function getSheetItemFromRow(actor, row) {
  if (!row) return null;

  const ownedItem = actor.items.get(row.dataset.itemId);
  if (ownedItem) return ownedItem;

  if (row.dataset.magicSpellName) {
    return findWorldSpellByName(row.dataset.magicSpellName);
  }

  return null;
}

function shouldIgnoreItemRowOpen(event) {
  return event.target.closest("button, input, select, textarea, a, .item-controls");
}

async function openItemRowSheet(actor, row) {
  const item = getSheetItemFromRow(actor, row);

  if (!item) {
    const sourceItem = row?.dataset.magicSpellSourceId
      ? actor.items.get(row.dataset.magicSpellSourceId)
      : null;

    if (sourceItem) {
      sourceItem.sheet.render(true);
      return;
    }

    ui.notifications.warn("Could not find an item sheet to open.");
    return;
  }

  item.sheet.render(true);
}

async function deleteOwnedItemFromSheet(actor, item) {
  if (!item) {
    ui.notifications.warn("Could not find item to delete.");
    return;
  }

  if (isKinFeat(item) && !isDuplicateKinFeat(actor, item)) {
    ui.notifications.warn(`${item.name} is a Kin feat and cannot be removed directly.`);
    return;
  }

  const confirmed = await confirmDialog(
    "Delete Item?",
    `Delete "${item.name}" from ${actor.name}?`
  );

  if (!confirmed) return;

  await actor.deleteEmbeddedDocuments("Item", [item.id]);
}

async function createOwnedInventoryItem(actor) {
  if (!actor) return null;

  return Dialog.prompt({
    title: `Create Item for ${actor.name}`,
    content: `
      <form class="twilight-create-owned-item">
        <div class="form-group">
          <label>Name</label>
          <input type="text" name="name" placeholder="New Item" autofocus>
        </div>
        <div class="form-group">
          <label>Type</label>
          <select name="type">
            <option value="gear" selected>Gear</option>
            <option value="consumable">Consumable</option>
            <option value="weapon">Weapon</option>
            <option value="armor">Armor</option>
          </select>
        </div>
      </form>
    `,
    label: "Create Item",
    callback: async html => {
      const form = getDialogForm(html, "form");
      const fd = new FormDataExtended(form);
      const type = ["gear", "consumable", "weapon", "armor"].includes(fd.object.type)
        ? fd.object.type
        : "gear";
      const name = String(fd.object.name || "").trim() || "New Item";
      const created = await actor.createEmbeddedDocuments("Item", [{ name, type }]);
      const item = created[0];

      item?.sheet?.render(true);
      return item || null;
    },
    rejectClose: false,
    options: { jQuery: false, width: 360 }
  });
}

async function showItemRowContextMenu(actor, row) {
  const item = getSheetItemFromRow(actor, row);
  const ownedItem = actor.items.get(row?.dataset.itemId);

  if (!item) {
    ui.notifications.warn("Could not find an item for this row.");
    return;
  }

  await new Promise(resolve => {
    new Dialog({
      title: item.name,
      content: "<p>What would you like to do?</p>",
      buttons: {
        edit: {
          label: "Edit",
          callback: () => {
            item.sheet.render(true);
            resolve("edit");
          }
        },
        delete: {
          label: "Delete",
          callback: async () => {
            if (!ownedItem) {
              ui.notifications.warn(`${item.name} is granted by an equipped item and cannot be deleted from this sheet.`);
              resolve("delete-unavailable");
              return;
            }

            await deleteOwnedItemFromSheet(actor, ownedItem);
            resolve("delete");
          }
        },
        cancel: {
          label: "Cancel",
          callback: () => resolve("cancel")
        }
      },
      default: "edit",
      close: () => resolve("close")
    }).render(true);
  });
}

async function refreshMagicItemSpells(actor) {
  for (const sourceItem of getMagicSpellSourceItems(actor, { equippedOnly: false })) {
    await sourceItem.unsetFlag("twilight-sword", MAGIC_ITEM_SPELL_EXPENDED_FLAG);
  }
}

function getKnownSpellItems(actor) {
  return actor.items
    .filter(item => item.type === "spell")
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getPreparedSpellState(actor) {
  const state = actor?.getFlag("twilight-sword", PREPARED_SPELL_FLAG);

  return state && typeof state === "object" ? state : null;
}

function isPreparedSpellReady(actor, spell) {
  if (!actorHasFeatNamed(actor, "prepared spell")) return false;

  const state = getPreparedSpellState(actor);
  if (!state || state.used) return false;

  return state.spellId === spell.id;
}

function getPreparedSpellSummary(actor) {
  if (!actorHasFeatNamed(actor, "prepared spell")) return null;

  const state = getPreparedSpellState(actor);
  if (!state?.spellId) return null;

  const spell = actor.items.get(state.spellId);

  return {
    name: spell?.name || state.name || "Unknown Spell",
    used: state.used === true
  };
}

async function markPreparedSpellUsed(actor) {
  const state = getPreparedSpellState(actor);
  if (!state) return;

  await actor.setFlag("twilight-sword", PREPARED_SPELL_FLAG, {
    ...state,
    used: true
  });
}

async function choosePreparedSpell(actor) {
  if (!actorHasFeatNamed(actor, "prepared spell")) {
    await actor.unsetFlag("twilight-sword", PREPARED_SPELL_FLAG);
    return null;
  }

  const knownSpells = getKnownSpellItems(actor);
  if (!knownSpells.length) {
    await actor.unsetFlag("twilight-sword", PREPARED_SPELL_FLAG);
    return null;
  }

  const previousState = getPreparedSpellState(actor);
  const options = knownSpells
    .map(spell => `
      <option value="${spell.id}" ${previousState?.spellId === spell.id ? "selected" : ""}>
        ${escapeHtml(spell.name)}
      </option>
    `)
    .join("");

  const spellId = await new Promise(resolve => {
    new Dialog({
      title: "Prepare Spell",
      content: `
        <form>
          <p><strong>Prepared Spell:</strong> Choose one spell you know. The first time you cast it after this rest, it does not become expended.</p>
          <select name="spellId">
            ${options}
            <option value="">Do not prepare a spell</option>
          </select>
        </form>
      `,
      buttons: {
        prepare: {
          label: "Prepare",
          callback: html => resolve(html[0].querySelector("[name='spellId']").value)
        },
        skip: {
          label: "Skip",
          callback: () => resolve("")
        }
      },
      default: "prepare",
      close: () => resolve("")
    }).render(true);
  });

  if (!spellId) {
    await actor.unsetFlag("twilight-sword", PREPARED_SPELL_FLAG);
    return null;
  }

  const spell = knownSpells.find(item => item.id === spellId);
  if (!spell) return null;

  await actor.setFlag("twilight-sword", PREPARED_SPELL_FLAG, {
    spellId: spell.id,
    name: spell.name,
    used: false
  });
  await spell.update({ "system.expended": false });

  return spell;
}

async function chooseShortRestSpellRecharge(actor) {
  const expendedSpells = getActorSpellList(actor).filter(item =>
    item.type === "spell" &&
    (item.system?.expended === true || item.system?.expended === "true")
  );

  if (!expendedSpells.length) return null;

  const options = expendedSpells
    .map(spell => `<option value="${spell.id}">${escapeHtml(spell.name)}</option>`)
    .join("");

  const spellId = await new Promise(resolve => {
    new Dialog({
      title: "Recharge One Spell?",
      content: `
        <form>
          <p>Short Rest can recharge one expended spell.</p>
          <select name="spellId">
            ${options}
            <option value="">Do not recharge a spell</option>
          </select>
        </form>
      `,
      buttons: {
        recharge: {
          label: "Recharge",
          callback: html => resolve(html[0].querySelector("[name='spellId']").value)
        },
        skip: {
          label: "Skip",
          callback: () => resolve("")
        }
      },
      default: "recharge",
      close: () => resolve("")
    }).render(true);
  });

  if (!spellId) return null;

  const spell = expendedSpells.find(item => item.id === spellId);
  if (!spell) return null;

  await spell.update({ "system.expended": false });

  return spell;
}

async function castSpell(actor, spell) {
  const isMagicItemSpell = Boolean(spell.magicSpellSourceId);
  let magicSpellSourceItem = null;

  if (spell.magicSpellSourceId) {
    magicSpellSourceItem = actor.items.get(spell.magicSpellSourceId);

    if (!magicSpellSourceItem?.system?.equipped) {
      ui.notifications.warn(`${spell.name} is only available while its source item is equipped.`);
      return;
    }

    if (spell.magicSpellMissingDefinition) {
      ui.notifications.warn(`${magicSpellSourceItem.name} grants ${spell.name}, but no spell card named "${spell.magicSpellName}" exists.`);
      return;
    }
  }

  if (!(await enforceCanCast(actor, { ignoreEquipmentRestrictions: isMagicItemSpell }))) return;
  if (!(await enforceTurnActor(actor, "cast spells"))) return;

  const spellName = spell.name.toLowerCase().trim();
  const requiredRange = spell.system.range || "self";
  const normalizedRange = normalizeRange(requiredRange);
  const targetToken = getPrimaryTargetToken();
  const rangeInfo = targetToken ? getRangeInfo(actor, targetToken) : null;

  if (normalizedRange === "self" && targetToken && targetToken.actor?.id !== actor.id) {
    ui.notifications.warn(`${spell.name} has Self range and can only target the caster.`);
    return;
  }

  if (normalizedRange !== "self" && targetToken && !isTargetWithinRange(requiredRange, rangeInfo)) {
    ui.notifications.warn(
      `${spell.name} is ${requiredRange} range, but target is ${rangeInfo.label}.`
    );
    return;
  }

  const stamina = Number(actor.system.stamina?.value ?? 0);
  const maxStamina = Number(actor.system.stamina?.max ?? stamina);
  const expended = Boolean(spell.system.expended);
  const preparedSpellReady = !isMagicItemSpell && isPreparedSpellReady(actor, spell);
  let spentStaminaToCast = false;

  if (isMagicItemSpell) {
    if (stamina <= 0) {
      ui.notifications.warn(`${spell.name} requires 1 Stamina to cast from a magic item.`);
      return;
    }

    await actor.update({
      "system.stamina.value": stamina - 1
    });
    spentStaminaToCast = true;
  } else if (expended && !preparedSpellReady) {
    if (stamina <= 0) {
      ui.notifications.warn(`${spell.name} is expended and ${actor.name} has no Stamina to cast it again.`);
      return;
    }

    const spend = await confirmDialog(
      "Spend Stamina?",
      `${spell.name} is already expended. Spend 1 Stamina to cast it again?`
    );

    if (!spend) return;

    await actor.update({
      "system.stamina.value": stamina - 1
    });
    spentStaminaToCast = true;
  }

  const rollAbilityKey = normalizeAbilityKey(spell.system.roll);
  let rollResult = "";
  let spellRollFailed = false;
  let spellCriticalSuccess = false;

  if (isMagicItemSpell) {
    rollResult = `
      <p><strong>Roll:</strong> None. Magic item casting does not require an Ability roll.</p>
    `;
  } else if (rollAbilityKey && rollAbilityKey !== "none") {
    const spellCastBonus = getSpellCastRollBonus(actor, rollAbilityKey);
    const result = await rollAbility(actor, rollAbilityKey, {
      spellCast: true,
      rollBonus: spellCastBonus.value,
      rollBonusReason: spellCastBonus.reason
    });

    if (result) {
      spellRollFailed = !result.success;
      spellCriticalSuccess = result.rawTotal === 1;
      rollResult = `
        <p><strong>Roll:</strong> ${
          result.rawTotal
            ? `${result.rawTotal}${result.rollBonus ? ` - ${result.rollBonus} ${result.rollBonusReason} = ${result.total}` : ""}`
            : "Auto-fail"
        } vs ${result.target}</p>
        <p><strong>Result:</strong> ${result.success ? "Success" : "Failure"}</p>
        ${spellCriticalSuccess ? "<p><strong>Critical Spell:</strong> This spell is not expended.</p>" : ""}
      `;
    }
  } else {
    rollResult = `
      <p><strong>Roll:</strong> None.</p>
    `;
  }

  if (preparedSpellReady) {
    await markPreparedSpellUsed(actor);
  }

  if (spellCriticalSuccess) {
    if (!expended) await spell.update({ "system.expended": false });

    if (spentStaminaToCast) {
      const currentStamina = Number(actor.system.stamina?.value ?? 0);
      await actor.update({
        "system.stamina.value": Math.min(currentStamina + 1, maxStamina)
      });
    }
  } else if (!isMagicItemSpell && !preparedSpellReady) {
    await spell.update({ "system.expended": true });
  }

  actor.sheet?.render(false);

  let healingButton = "";
  const healingRolls = [];

  if (spellName === "heal") {
    const healRoll = await new Roll("2d8").evaluate();
    healingRolls.push(healRoll);
    const failed = spellRollFailed;
    const healingTotal = failed ? Math.floor(healRoll.total / 2) : healRoll.total;

    healingButton = `
      <p><strong>Healing Roll:</strong> ${healRoll.total}</p>
      ${failed ? `<p><strong>Failed Cast:</strong> Healing halved to ${healingTotal}.</p>` : ""}
      <button class="ts-apply-healing" data-healing="${healingTotal}" data-reason="Heal">
        Apply Healing to Target
      </button>
    `;
  }

  if (spellName === "healing prayer") {
    const healRoll = await new Roll("1d8").evaluate();
    healingRolls.push(healRoll);
    const failed = spellRollFailed;
    const healingTotal = failed ? Math.floor(healRoll.total / 2) : healRoll.total;

    healingButton = `
      <p><strong>Healing Roll:</strong> ${healRoll.total}</p>
      ${failed ? `<p><strong>Failed Cast:</strong> Healing halved to ${healingTotal}.</p>` : ""}
      <button class="ts-apply-healing" data-healing="${healingTotal}" data-reason="Healing Prayer">
        Apply Healing to Target
      </button>
    `;
  }

  if (spellName === "life") {
    const lifeRoll = spellRollFailed ? null : await new Roll("1d8").evaluate();
    if (lifeRoll) healingRolls.push(lifeRoll);
    const lifeHealing = spellRollFailed ? 1 : lifeRoll.total;

    healingButton = `
      <p><strong>Life Healing:</strong> ${lifeHealing}</p>
      <button class="ts-apply-life" data-healing="${lifeHealing}">
        Apply Life to Target
      </button>
    `;
  }

  const spellDamageType = normalizeDamageType(spell.system.damageType);
  const spellDamageTypeLabel = getDamageTypeLabel(spellDamageType);
  const spellFailureDamage = String(spell.system.failureDamage || "").trim();
  const effectiveSpellDamage = spellRollFailed && spellFailureDamage
    ? spellFailureDamage
    : spell.system.damage;
  const spellOnFailEffect = String(spell.system.onFailEffect || "").trim();
  const spellStatus = normalizeStatusId(spell.system.status);
  const spellStatusDuration = spell.system.statusDuration || "";
  const spellStatusOnDamage = spell.system.statusOnDamage === true || spell.system.statusOnDamage === "true";
  const spellStatusSource = `${actor.name}: ${spell.name}`;
  const healingSpellNames = ["heal", "healing prayer", "life"];
  const spellHasDamageButton = effectiveSpellDamage && !healingSpellNames.includes(spellName);
  const spellStatusSummary = spellStatus
    ? buildMonsterActionStatusSummary({
        status: spellStatus,
        statusDuration: spellStatusDuration,
        statusOnDamage: spellStatusOnDamage
      })
    : "";
  const spellStatusButton = spellStatus && (!spellStatusOnDamage || !spellHasDamageButton)
    ? buildApplyStatusButton({
        status: spellStatus,
        statusDuration: spellStatusDuration
      }, spellStatusSource)
    : "";
  const spellStatusDamageData = spellStatus && spellStatusOnDamage && spellHasDamageButton
    ? `data-status="${spellStatus}" data-status-duration="${escapeHtml(spellStatusDuration)}" data-status-on-damage="true" data-status-source="${escapeHtml(spellStatusSource)}"`
    : "";
  const spellDuration = spell.system.duration || "";
  const magicSpellData = spell.magicSpellSourceId
    ? `data-magic-spell-source-id="${spell.magicSpellSourceId}" data-magic-spell-name="${escapeHtml(spell.magicSpellName || spell.name)}"`
    : "";
  const spellTargetName = normalizedRange === "self"
    ? actor.name
    : targetToken?.actor?.name || targetToken?.name || "";
  const trackActiveSpellButton = !isInstantSpellDuration(spellDuration)
    ? `
      <button
        type="button"
        class="ts-track-active-spell"
        data-actor-id="${actor.id}"
        data-spell-id="${spell.id}"
        data-spell-name="${escapeHtml(spell.name)}"
        data-duration="${escapeHtml(spellDuration)}"
        data-target="${escapeHtml(spellTargetName)}"
      >
        Track Active Spell
      </button>
    `
    : "";

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    rolls: compactRolls(healingRolls),
    content: `
      <div class="ts-chat-card">
        <h2>${actor.name} casts ${spell.name}</h2>
        ${rollResult}
        <p><strong>Range:</strong> ${spell.system.range || "—"}</p>
        ${rangeInfo ? `<p><strong>Target Distance:</strong> ${rangeInfo.label}</p>` : ""}
        ${isMagicItemSpell ? `<p><strong>Magic Item:</strong> Spent 1 Stamina to cast through ${escapeHtml(magicSpellSourceItem?.name || "the item")}. Armor and shields do not prevent this casting.</p>` : ""}
        ${preparedSpellReady ? `<p><strong>Prepared Spell:</strong> First prepared cast does not expend this spell.</p>` : ""}
        ${!isMagicItemSpell && spentStaminaToCast ? `<p><strong>Expended Spell:</strong> ${spellCriticalSuccess ? "Stamina refunded by Critical Spell." : "Spent 1 Stamina to cast again."}</p>` : ""}
        ${healingButton}
        ${spellRollFailed && spellOnFailEffect ? `<p><strong>On Fail:</strong> ${escapeHtml(spellOnFailEffect)}</p>` : ""}
        ${spellRollFailed && spellFailureDamage ? `<p><strong>Failed Cast Damage:</strong> ${escapeHtml(spellFailureDamage)} instead of ${escapeHtml(spell.system.damage || "none")}.</p>` : ""}
        ${effectiveSpellDamage && !["heal", "healing prayer", "life"].includes(spellName)
          ? `<p><strong>Damage:</strong> ${escapeHtml(effectiveSpellDamage)}</p>`
          : ""}
        ${effectiveSpellDamage && spellDamageTypeLabel && !["heal", "healing prayer", "life"].includes(spellName)
          ? `<p><strong>Damage Type:</strong> ${spellDamageTypeLabel}</p>`
          : ""}
        ${spellStatusSummary}
        ${spellDuration ? `<p><strong>Duration:</strong> ${escapeHtml(spellDuration)}</p>` : ""}
        <p>${spell.system.description || ""}</p>
        ${
          effectiveSpellDamage && !["heal", "healing prayer", "life"].includes(spellName)
            ? `<button class="ts-roll-spell-damage" data-item-id="${spell.id}" data-damage-formula="${escapeHtml(effectiveSpellDamage)}" data-damage-type="${spellDamageType}" ${magicSpellData} ${spellStatusDamageData}>
                Roll Spell Damage
              </button>`
            : ""
        }
        ${spellStatusButton}
        ${trackActiveSpellButton}
      </div>
    `
  });
}


// Monster Actions

function normalizeMonsterActionColor(value) {
  const color = String(value || "").trim().toLowerCase();

  if (["red", "blue"].includes(color)) return color;

  return "normal";
}

function getMonsterActionColorLabel(color) {
  color = normalizeMonsterActionColor(color);

  if (color === "red") return "Red";
  if (color === "blue") return "Blue";

  return "Normal";
}

function getMonsterActionReactionRules(action = {}) {
  const color = normalizeMonsterActionColor(action.actionColor);

  if (color === "red") {
    return {
      allowDodge: true,
      allowParry: false,
      text: "Red action: cannot be parried."
    };
  }

  if (color === "blue") {
    return {
      allowDodge: false,
      allowParry: true,
      text: "Blue action: cannot be dodged."
    };
  }

  return {
    allowDodge: true,
    allowParry: true,
    text: ""
  };
}

function normalizeMonsterAction(action = {}) {
  const special = action.special === true || action.special === "true";
  const range = getRangeLabel(action.range) ? normalizeRange(action.range) : "";
  const saveAbility = getAbilityLabel(action.saveAbility) ? normalizeAbilityKey(action.saveAbility) : "";
  const rawSaveTarget = String(action.saveTarget ?? "").trim();
  const saveTarget = rawSaveTarget && Number.isFinite(Number(rawSaveTarget))
    ? Math.max(Math.floor(Number(rawSaveTarget)), 1)
    : "";
  const rawStaminaCost = Number(action.staminaCost ?? 1);
  const staminaCost = special
    ? Math.max(Number.isFinite(rawStaminaCost) ? rawStaminaCost : 1, 1)
    : 0;

  return {
    name: action.name || "",
    roll: action.roll || "",
    range,
    damage: action.damage || "",
    damageType: normalizeDamageType(action.damageType),
    saveAbility,
    saveTarget,
    actionColor: normalizeMonsterActionColor(action.actionColor || action.color),
    special,
    staminaCost,
    effect: action.effect || "",
    status: normalizeStatusId(action.status),
    statusDuration: action.statusDuration || "",
    statusOnDamage: action.statusOnDamage === true || action.statusOnDamage === "true",
    ranged: action.ranged === true || action.ranged === "true" || ["near", "far"].includes(range),
    ignoreArmor: action.ignoreArmor === true || action.ignoreArmor === "true"
  };
}

function buildMonsterActionSaveSummary(action = {}) {
  const abilityLabel = getAbilityLabel(action.saveAbility);
  if (!abilityLabel) return "";

  return `
    <p><strong>Save:</strong> Target rolls ${escapeHtml(abilityLabel)}${
      action.saveTarget ? ` vs ${escapeHtml(action.saveTarget)}` : ""
    }.</p>
  `;
}

function buildMonsterActionSaveButton(action = {}, sourceName = "") {
  const abilityLabel = getAbilityLabel(action.saveAbility);
  if (!abilityLabel) return "";

  return `
    <button
      class="ts-roll-monster-save"
      data-save-ability="${normalizeAbilityKey(action.saveAbility)}"
      data-save-target="${escapeHtml(action.saveTarget || "")}"
      data-save-source="${escapeHtml(sourceName)}"
    >
      Roll ${escapeHtml(abilityLabel)} Save
    </button>
  `;
}

function buildMonsterActionStatusSummary(action = {}) {
  const statusId = normalizeStatusId(action.status);
  if (!statusId) return "";

  const statusLabel = getStatusLabel(statusId);
  const duration = String(action.statusDuration || "").trim();
  const timing = action.statusOnDamage ? "if damage gets through" : "on command";

  return `
    <p><strong>Status:</strong> ${escapeHtml(statusLabel)}${
      duration ? ` for ${escapeHtml(duration)} ${duration === "1" ? "round" : "rounds"}` : ""
    } <em>(${timing})</em></p>
  `;
}

function buildApplyStatusButton(action = {}, sourceName = "") {
  const statusId = normalizeStatusId(action.status);
  if (!statusId) return "";

  const statusLabel = getStatusLabel(statusId);

  return `
    <button
      class="ts-apply-status"
      data-status="${statusId}"
      data-status-duration="${escapeHtml(action.statusDuration || "")}"
      data-status-source="${escapeHtml(sourceName)}"
    >
      Apply ${escapeHtml(statusLabel)} to Target
    </button>
  `;
}

async function editMonsterAction(actor, index = null) {
  const actions = foundry.utils.deepClone(actor.system.actions || []);

  const existing = normalizeMonsterAction(index === null ? {} : actions[index]);
  const existingDamageType = normalizeDamageType(existing.damageType);

  const content = `
    <form>
      <div class="form-group">
        <label>Name</label>
        <input name="name" type="text" value="${escapeHtml(existing.name)}">
      </div>
      <div class="form-group">
        <label>Roll / Target</label>
        <input name="roll" type="text" value="${escapeHtml(existing.roll)}" placeholder="Example: 10">
      </div>
      <div class="form-group">
        <label>Range</label>
        <select name="range">
          ${buildRangeOptions(existing.range)}
        </select>
      </div>
      <div class="form-group">
        <label>Damage</label>
        <input name="damage" type="text" value="${escapeHtml(existing.damage)}" placeholder="Example: 1d6">
      </div>
      <div class="form-group">
        <label>Damage Type</label>
        <select name="damageType">
          ${buildDamageTypeOptions(existingDamageType)}
        </select>
      </div>
      <div class="form-group">
        <label>Save Ability</label>
        <select name="saveAbility">
          ${buildAbilityOptions(existing.saveAbility)}
        </select>
      </div>
      <div class="form-group">
        <label>Save Target</label>
        <input name="saveTarget" type="number" min="1" value="${escapeHtml(existing.saveTarget || "")}" placeholder="Blank uses target ability">
      </div>
      <div class="form-group">
        <label>Action Color</label>
        <select name="actionColor">
          <option value="normal" ${existing.actionColor === "normal" ? "selected" : ""}>Normal</option>
          <option value="red" ${existing.actionColor === "red" ? "selected" : ""}>Red - Cannot be parried</option>
          <option value="blue" ${existing.actionColor === "blue" ? "selected" : ""}>Blue - Cannot be dodged</option>
        </select>
      </div>
      <div class="form-group">
        <label>Special Action</label>
        <input name="special" type="checkbox" ${existing.special ? "checked" : ""}>
      </div>
      <div class="form-group">
        <label>Stamina Cost</label>
        <input name="staminaCost" type="number" min="0" value="${existing.staminaCost || (existing.special ? 1 : 0)}">
      </div>
      <div class="form-group">
        <label>Effect</label>
        <textarea name="effect">${escapeHtml(existing.effect)}</textarea>
      </div>
      <div class="form-group">
        <label>Status</label>
        <select name="status">
          ${buildStatusOptions(existing.status)}
        </select>
      </div>
      <div class="form-group">
        <label>Status Duration</label>
        <input name="statusDuration" type="text" value="${escapeHtml(existing.statusDuration)}" placeholder="Blank, 1, or 1d6 rounds">
      </div>
      <div class="form-group">
        <label>Only Apply Status if Damage Gets Through</label>
        <input name="statusOnDamage" type="checkbox" ${existing.statusOnDamage ? "checked" : ""}>
      </div>
      <div class="form-group">
        <label>Ignore Armor</label>
        <input name="ignoreArmor" type="checkbox" ${existing.ignoreArmor ? "checked" : ""}>
      </div>
    </form>
  `;

  new Dialog({
    title: index === null ? "Add Monster Action" : "Edit Monster Action",
    content,
    buttons: {
      save: {
        label: "Save",
        callback: async html => {
          const form = html[0].querySelector("form");

          const action = normalizeMonsterAction({
            name: form.name.value,
            roll: form.roll.value,
            range: form.range.value,
            damage: form.damage.value,
            damageType: form.damageType.value,
            saveAbility: form.saveAbility.value,
            saveTarget: form.saveTarget.value,
            actionColor: form.actionColor.value,
            special: form.special.checked,
            staminaCost: form.staminaCost.value,
            effect: form.effect.value,
            status: form.status.value,
            statusDuration: form.statusDuration.value,
            statusOnDamage: form.statusOnDamage.checked,
            ignoreArmor: form.ignoreArmor.checked
          });

          if (index === null) actions.push(action);
          else actions[index] = action;

          await actor.update({ "system.actions": actions });
        }
      }
    }
  }).render(true);
}

async function importMonsterActions(actor) {
  const content = `
    <form>
      <p>Paste monster actions as JSON:</p>
      <textarea name="actions" style="width:100%;height:260px;">[
  {
    "name": "Brawl",
    "roll": "8",
    "range": "close",
    "damage": "1d6",
    "damageType": "non-magical",
    "saveAbility": "",
    "saveTarget": "",
    "actionColor": "normal",
    "special": false,
    "staminaCost": 0,
    "effect": "A Close target takes damage.",
    "status": "",
    "statusDuration": "",
    "statusOnDamage": false,
    "ignoreArmor": false
  }
]</textarea>
    </form>
  `;

  new Dialog({
    title: `Import Actions for ${actor.name}`,
    content,
    buttons: {
      import: {
        label: "Import",
        callback: async html => {
          const raw = html[0].querySelector("textarea[name='actions']").value;

          let actions;
          try {
            actions = JSON.parse(raw);
          } catch (err) {
            ui.notifications.error("Invalid JSON.");
            return;
          }

          if (!Array.isArray(actions)) {
            ui.notifications.error("JSON must be an array of actions.");
            return;
          }

          const current = foundry.utils.deepClone(actor.system.actions || []);
          await actor.update({ "system.actions": current.concat(actions.map(action => normalizeMonsterAction(action))) });
          ui.notifications.info(`Imported ${actions.length} actions.`);
        }
      }
    }
  }).render(true);
}

async function useMonsterAction(actor, action, { actionIndex = null, rotation = false } = {}) {
  if (!(await enforceCanAct(actor, "use monster actions"))) return;
  if (!(await enforceTurnActor(actor, "use monster actions"))) return;

  action = normalizeMonsterAction(action);

  const targetToken = getPrimaryTargetToken();
  const requiredRange = normalizeRange(action.range);
  const rangeLabel = getRangeLabel(requiredRange);
  const rangeInfo = targetToken ? getRangeInfo(actor, targetToken) : null;

  if (requiredRange === "self" && targetToken && targetToken.actor?.id !== actor.id) {
    ui.notifications.warn(`${action.name} has Self range and can only target ${actor.name}.`);
    return;
  }

  if (requiredRange && requiredRange !== "self" && targetToken && !isTargetWithinRange(requiredRange, rangeInfo)) {
    ui.notifications.warn(
      `${action.name} is ${rangeLabel} range, but target is ${rangeInfo.label}.`
    );
    return;
  }

  const staminaCost = action.special ? Math.max(Number(action.staminaCost || 1), 1) : 0;
  const currentStamina = Number(actor.system.stamina?.value ?? 0);

  if (staminaCost > currentStamina) {
    ui.notifications.warn(`${actor.name} needs ${staminaCost} Stamina to use ${action.name}.`);
    return;
  }

  if (staminaCost) {
    await actor.update({ "system.stamina.value": currentStamina - staminaCost });
    await breakMonsterRotation(actor, "The Monster spent Stamina.");
  }

  let rollText = "";
  let damageTotal = null;
  let actionRoll = null;
  let damageRoll = null;
  const damageType = getMonsterEffectiveDamageType(actor, action.damageType);
  const damageTypeLabel = getDamageTypeLabel(damageType);
  const damageBonus = getMonsterVariantDamageBonus(actor);
  const statusId = normalizeStatusId(action.status);
  const statusSource = `${actor.name}: ${action.name}`;
  const statusSummary = buildMonsterActionStatusSummary(action);
  const saveSummary = buildMonsterActionSaveSummary(action);
  const saveButton = buildMonsterActionSaveButton(action, statusSource);
  const statusButton = statusId && (!action.statusOnDamage || !action.damage)
    ? buildApplyStatusButton(action, statusSource)
    : "";
  const reactionRules = getMonsterActionReactionRules(action);
  const damageStatusData = statusId && action.statusOnDamage
    ? `data-status="${statusId}" data-status-duration="${escapeHtml(action.statusDuration || "")}" data-status-on-damage="true" data-status-source="${escapeHtml(statusSource)}"`
    : "";

  if (action.roll) {
    actionRoll = await new Roll("1d12").evaluate();
    const target = Number(action.roll);
    const success = target ? actionRoll.total <= target : null;

    rollText = `
      <p><strong>Action Roll:</strong> ${actionRoll.total}${target ? ` vs ${target}` : ""}</p>
      ${success !== null ? `<p><strong>Result:</strong> ${success ? "Success" : "Failure"}</p>` : ""}
    `;
  }

  if (action.damage) {
    damageRoll = await new Roll(action.damage).evaluate();
    damageTotal = damageRoll.total + damageBonus;
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    rolls: compactRolls(actionRoll, damageRoll),
    content: `
      <div class="ts-chat-card">
        <h2>${actor.name}: ${action.name}</h2>
        ${rotation ? "<p><strong>Rotation:</strong> Used the next action in sequence.</p>" : ""}
        ${action.special ? `<p><strong>Special Action:</strong> Spent ${staminaCost} Stamina.</p>` : ""}
        ${action.actionColor !== "normal" ? `<p><strong>${getMonsterActionColorLabel(action.actionColor)} Action:</strong> ${reactionRules.text}</p>` : ""}
        ${rangeLabel ? `<p><strong>Range:</strong> ${rangeLabel}</p>` : ""}
        ${rangeInfo ? `<p><strong>Target Distance:</strong> ${rangeInfo.label}</p>` : ""}
        ${rollText}
        ${damageTotal !== null ? `<p><strong>Damage:</strong> ${damageRoll.total}${damageBonus ? ` + ${damageBonus} Variant = ${damageTotal}` : ""}</p>` : ""}
        ${damageTotal !== null && damageTypeLabel ? `<p><strong>Damage Type:</strong> ${damageTypeLabel}</p>` : ""}
        <p>${escapeHtml(action.effect || "")}</p>
        ${saveSummary}
        ${statusSummary}
        ${
          damageTotal !== null
            ? `${buildReactionButtons({
                attacker: actor,
                defender: targetToken?.actor,
                rangedAttack: action.ranged === true || action.ranged === "true" || ["near", "far"].includes(requiredRange),
                allowDodge: reactionRules.allowDodge,
                allowParry: reactionRules.allowParry,
                restrictionText: reactionRules.text
              })}

              <button class="ts-apply-damage" data-damage="${damageTotal}" data-damage-type="${damageType}" data-ignore-armor="${action.ignoreArmor ? "true" : "false"}" ${damageStatusData}>
                Apply Damage to Target
              </button>`
            : ""
        }
        ${saveButton}
        ${statusButton}
      </div>
    `
  });

  await noteMonsterActionUsed(actor, actionIndex);
}

// Actor Sheets 

class TwilightSwordChampionSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["twilight-sword", "sheet", "actor", "champion"],
      template: "systems/twilight-sword/templates/actor/champion-sheet.hbs",
      width: 820,
      height: 820,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "main" }]
    });
  }

  async getData(options = {}) {
    const context = await super.getData(options);
    const system = this.actor.system;

    context.system = system;
    context.items = this.actor.items;
    context.weapons = this.actor.items.filter(i => i.type === "weapon");
    context.armorItems = this.actor.items.filter(i => i.type === "armor");
    context.feats = this.actor.items.filter(i => i.type === "feat");
    context.spells = getActorSpellList(this.actor);
    context.gear = this.actor.items.filter(i => ["gear", "consumable"].includes(i.type));
    context.hearts = buildPips(system.hearts?.value, system.hearts?.max, "heart");
    context.stamina = buildPips(system.stamina?.value, system.stamina?.max, "stamina");
    context.statusEffects = getActorStatusEffects(this.actor);
    context.inventory = getActorInventorySummary(this.actor);
    context.currency = getActorCurrency(this.actor);
    context.equippedArmor = getEquippedArmor(this.actor);
    context.armorDisadvantage = getArmorDisadvantageSummary(this.actor);
    context.armorElementalTraits = getArmorElementalTraitSummary(this.actor);
    context.castingRestrictions = getCastingRestrictionSummary(this.actor);
    context.activeSpells = getActiveSpells(this.actor);
    context.preparedSpell = getPreparedSpellSummary(this.actor);
    context.boonActive = system.boon === true || system.boon === "true";
    context.actorTypeLabel = this.actor.type === "npc" ? "NPC" : "Champion";
    context.isNPC = this.actor.type === "npc";

    return context;
  }

  activateListeners(html) {
    super.activateListeners(html);
    activateActorStatTabOrder(html);
    activateResourcePipListeners(this.actor, html);

    html.find(".defense-stance").click(async event => {
      event.preventDefault();

      if (!(await enforceTurnActor(this.actor, "take the Defense action"))) return;

      await setDefensiveStance(this.actor, true);

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: `
          <div class="ts-chat-card">
            <h2>${this.actor.name} takes a Defensive Stance</h2>
            <p>Gains Advantage on the next Parry or Dodge.</p>
          </div>
        `
      });
    });

    html.find(".reaction-dodge").click(async event => {
      event.preventDefault();
      await rollReaction(this.actor, "dodge");
    });

    html.find(".reaction-parry").click(async event => {
      event.preventDefault();
      await rollReaction(this.actor, "parry", { rangedAttack: false });
    });

    html.find(".reaction-parry-ranged").click(async event => {
      event.preventDefault();
      await rollReaction(this.actor, "parry", { rangedAttack: true });
    });

    html.find(".weapon-throw").click(async event => {
    event.preventDefault();

    const itemId =
      event.currentTarget.dataset.itemId ||
      event.currentTarget.closest(".item")?.dataset.itemId;

    const weapon = this.actor.items.get(itemId);
    if (!weapon) return;

    const feats = getWeaponFeats(weapon);

    if (!feats.has("thrown") && !feats.has("boomerang")) {
      ui.notifications.warn(`${weapon.name} does not have Thrown or Boomerang.`);
      return;
    }

    await rollWeaponAttack(this.actor, weapon, { thrown: true });
  });

  html.find(".weapon-arcane").click(async event => {
    event.preventDefault();

    const itemId =
      event.currentTarget.dataset.itemId ||
      event.currentTarget.closest(".item")?.dataset.itemId;

    const weapon = this.actor.items.get(itemId);
    if (!weapon) return;

    const feats = getWeaponFeats(weapon);

    if (!feats.has("arcane")) {
      ui.notifications.warn(`${weapon.name} does not have Arcane.`);
      return;
    }

    await rollWeaponAttack(this.actor, weapon, { arcane: true });
  });

  html.find(".weapon-two-hands").click(async event => {
    event.preventDefault();

    const itemId =
      event.currentTarget.dataset.itemId ||
      event.currentTarget.closest(".item")?.dataset.itemId;

    const weapon = this.actor.items.get(itemId);
    if (!weapon) return;

    const feats = getWeaponFeats(weapon);

    if (!feats.has("versatile") && !feats.has("two-handed")) {
      ui.notifications.warn(`${weapon.name} is not Versatile or Two-Handed.`);
      return;
    }

    await rollWeaponAttack(this.actor, weapon, { twoHands: true });
  });

  html.find(".weapon-pick-up").click(async event => {
    event.preventDefault();

    const itemId =
      event.currentTarget.dataset.itemId ||
      event.currentTarget.closest(".item")?.dataset.itemId;

    const weapon = this.actor.items.get(itemId);
    if (!weapon) return;

    await pickUpWeapon(this.actor, weapon);
  });

      html.find(".roll-initiative").click(async event => {
        event.preventDefault();
        await rollInitiativeForActor(this.actor);
      });

      html.find(".feat-chat").click(async event => {
        event.preventDefault();
        event.stopPropagation();

        const itemId =
          event.currentTarget.dataset.itemId ||
          event.currentTarget.closest(".item")?.dataset.itemId;

        const feat = this.actor.items.get(itemId);

        if (!feat) {
          ui.notifications.warn("Could not find feat.");
          return;
        }

        await useFeat(this.actor, feat);
      });

      html.find(".item-edit").click(async event => {
        event.preventDefault();

        await openItemRowSheet(this.actor, event.currentTarget.closest(".zelda-item"));
      });

      html.find(".item-delete").click(async event => {
        event.preventDefault();

        const itemId = event.currentTarget.dataset.itemId;
        const item = this.actor.items.get(itemId);

        await deleteOwnedItemFromSheet(this.actor, item);
      });

      html.find(".create-inventory-item").click(async event => {
        event.preventDefault();

        await createOwnedInventoryItem(this.actor);
      });

      html.find(".zelda-item").dblclick(async event => {
        event.preventDefault();

        if (shouldIgnoreItemRowOpen(event)) return;

        await openItemRowSheet(this.actor, event.currentTarget);
      });

      html.find(".zelda-item").contextmenu(async event => {
        event.preventDefault();

        await showItemRowContextMenu(this.actor, event.currentTarget);
      });
    html.find(".ability-roll").click(async event => {
      await rollAbility(this.actor, event.currentTarget.dataset.ability, { askStamina: true });
    });

    html.find(".weapon-attack").click(async event => {
      const itemId =
        event.currentTarget.dataset.itemId ||
        event.currentTarget.closest(".item")?.dataset.itemId;
      const weapon = this.actor.items.get(itemId);
      if (weapon) await rollWeaponAttack(this.actor, weapon);
    });

  html.find(".spell-cast").click(async event => {
    event.preventDefault();

    const button = event.currentTarget;
    const itemElement =
      button.closest("[data-item-id]") ||
      button.closest(".item");

    const itemId =
      button.dataset.itemId ||
      itemElement?.dataset.itemId;

    if (!itemId) {
      ui.notifications.warn("Could not find spell item ID on the sheet.");
      console.warn("Twilight Sword | Spell cast button missing item ID", button, itemElement);
      return;
    }

    let spell = this.actor.items.get(itemId);

    if (!spell && button.dataset.magicSpellSourceId) {
      const sourceItem = this.actor.items.get(button.dataset.magicSpellSourceId);
      if (sourceItem) spell = buildGrantedMagicSpell(this.actor, sourceItem, button.dataset.magicSpellName || "");
    }

    if (!spell) {
      ui.notifications.warn(`Could not find spell with ID ${itemId}.`);
      console.warn("Twilight Sword | Actor items:", this.actor.items.contents);
      return;
    }

    await castSpell(this.actor, spell);
  });

    html.find(".active-spell-end").click(async event => {
      event.preventDefault();

      await endActiveSpell(
        this.actor,
        event.currentTarget.dataset.activeSpellId,
        "Ended manually."
      );
    });

    html.find(".consume-item").click(async event => {
      const itemId = event.currentTarget.closest(".item")?.dataset.itemId;
      const item = this.actor.items.get(itemId);
      if (item) await useConsumable(this.actor, item);
    });

    html.find(".item-equip").click(async event => {
      const itemId = event.currentTarget.closest(".item")?.dataset.itemId;
      const item = this.actor.items.get(itemId);
      if (!item) return;

      await toggleItemEquipped(this.actor, item);
    });

    html.find(".item-wield").click(async event => {
      const itemId = event.currentTarget.closest(".item")?.dataset.itemId;
      const item = this.actor.items.get(itemId);
      if (!item) return;

      await toggleItemWielded(this.actor, item);
    });

    if (this.actor.type !== "npc") {
      html.find(".short-rest").click(async () => this._shortRest());
      html.find(".full-rest").click(async () => this._fullRest());
    }

    html.find(".status-toggle").click(async event => {
      await toggleActorStatus(this.actor, event.currentTarget.dataset.statusId);
    });

    if (this.actor.type !== "npc") {
      html.find(".boon-toggle").click(async event => {
        event.preventDefault();
        await toggleActorBoon(this.actor);
      });
    }
  }

async _onDrop(event) {
  event.preventDefault();

  const data = TextEditor.getDragEventData(event);
  const item = await Item.implementation.fromDropData(data);

  if (!item) return super._onDrop(event);

  if (item.type === "feat") {
    await addFeatToActor(this.actor, item);
    return false;
  }

  if (item.type === "way") {
    if (this.actor.type === "npc") {
      ui.notifications.warn("NPCs do not use Ways.");
      return false;
    }

    const slot = event.target.closest("[data-way-slot]")?.dataset.waySlot;
    await applyWayToActor(this.actor, item, slot);
    return false;
  }

  if (item.type !== "kin") {
    return super._onDrop(event);
  }

  await this.actor.update({
    "system.kin": item.name
  });

  const featName = item.system.featName || `${item.name} Kin Feature`;

  const oldKinFeats = this.actor.items.filter(i =>
    i.type === "feat" &&
    (
      i.flags?.["twilight-sword"]?.kinFeat ||
      i.flags?.["twilight-sword"]?.sourceKin ||
      i.system?.way === "Kin" ||
      i.name === featName
    )
  );

  if (oldKinFeats.length) {
    await this.actor.deleteEmbeddedDocuments(
      "Item",
      oldKinFeats.map(i => i.id)
    );
  }

  await this.actor.createEmbeddedDocuments("Item", [{
    name: featName,
    type: "feat",
    img: item.img,
    system: {
      way: item.system.way || "Kin",
      description: item.system.featDescription || item.system.description || "",
      effect: item.system.effect || ""
    },
    flags: {
      "twilight-sword": {
        kinFeat: true,
        sourceKin: item.name
      }
    }
  }]);

  ui.notifications.info(`${this.actor.name} is now ${item.name}. Kin feat added.`);
}

  async _shortRest() {
  const staminaMax = Number(this.actor.system.stamina?.max ?? 0);

  const healAmount = 3;

  await healActor(this.actor, healAmount);

  await this.actor.update({
    "system.stamina.value": staminaMax
  });

  await cleanupRestStatuses(this.actor);

  const rechargedSpell = await chooseShortRestSpellRecharge(this.actor);
  const preparedSpell = await choosePreparedSpell(this.actor);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: this.actor }),
    content: `
      <div class="ts-chat-card">
        <h2>${this.actor.name} takes a Short Rest</h2>
        <p>Recovered Stamina and 3 Hearts.</p>
        ${rechargedSpell ? `<p>Recharged <strong>${escapeHtml(rechargedSpell.name)}</strong>.</p>` : ""}
        ${preparedSpell ? `<p>Prepared <strong>${escapeHtml(preparedSpell.name)}</strong>.</p>` : ""}
        <p>Temporary status effects were cleared. Wounds remain.</p>
      </div>
    `
  });
}

  async _fullRest() {
  await this.actor.update({
    "system.stamina.value": this.actor.system.stamina?.max ?? 0,
    "system.hearts.value": this.actor.system.hearts?.max ?? 0
  });

  await cleanupRestStatuses(this.actor);

  await removeStatus(this.actor, "ko");

  for (const spell of this.actor.items.filter(i => i.type === "spell")) {
    await spell.update({
      "system.expended": false
    });
  }

  await refreshMagicItemSpells(this.actor);
  const preparedSpell = await choosePreparedSpell(this.actor);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: this.actor }),
    content: `
      <div class="ts-chat-card">
        <h2>${this.actor.name} takes a Rest</h2>
        <p>Recovered Hearts, Stamina, and refreshed spells.</p>
        ${preparedSpell ? `<p>Prepared <strong>${escapeHtml(preparedSpell.name)}</strong>.</p>` : ""}
        <p>Temporary status effects were cleared. Wounds remain.</p>
      </div>
    `
  });
}
}

class TwilightSwordMonsterSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["twilight-sword", "sheet", "actor", "monster"],
      template: "systems/twilight-sword/templates/actor/monster-sheet.hbs",
      width: 800,
      height: 760,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "actions" }]
    });
  }

  async getData(options = {}) {
    const context = await super.getData(options);
    const system = this.actor.system;
    const monsterVariant = getMonsterVariantSummary(this.actor);
    const monsterRotation = getMonsterRotationState(this.actor);
    const actions = Array.isArray(system.actions) ? system.actions : [];
    const nextRotationAction = actions.length
      ? actions[getNextMonsterRotationIndex(this.actor, monsterRotation.nextIndex)]
      : null;

    context.system = system;
    context.items = this.actor.items;
    context.feats = this.actor.items.filter(i => i.type === "feat");
    context.monsterVariant = monsterVariant;
    context.hearts = buildPips(system.hearts?.value, monsterVariant.effectiveHeartsMax, "heart");
    context.stamina = buildPips(system.stamina?.value, system.stamina?.max, "stamina");
    context.statusEffects = getActorStatusEffects(this.actor);
    context.damageType = normalizeDamageType(system.damageType);
    context.elementalAffinity = normalizeElementalAffinity(system.elementalAffinity);
    context.effectiveElementalAffinity = monsterVariant.effectiveAffinity;
    context.monsterRotation = {
      ...monsterRotation,
      nextActionNumber: actions.length ? getNextMonsterRotationIndex(this.actor, monsterRotation.nextIndex) + 1 : null,
      nextActionName: nextRotationAction?.name || "",
      hasActions: actions.length > 0
    };

    if (!Array.isArray(context.system.actions)) {
      context.system.actions = [];
    }

    return context;
  }

  activateListeners(html) {
    super.activateListeners(html);
    activateActorStatTabOrder(html);
    activateResourcePipListeners(this.actor, html);

    html.find(".roll-initiative").click(async event => {
      event.preventDefault();
      await rollInitiativeForActor(this.actor);
    });

    html.find(".sync-monster-variant-hearts").click(async event => {
      event.preventDefault();

      const max = getMonsterEffectiveMaxHearts(this.actor);
      await this.actor.update({
        "system.hearts.value": max
      });
    });

    html.find(".status-toggle").click(async event => {
      await toggleActorStatus(this.actor, event.currentTarget.dataset.statusId);
    });

    html.find(".create-monster-feat").click(async event => {
      event.preventDefault();
      await createOwnedFeat(this.actor);
    });

    html.find(".feat-chat").click(async event => {
      event.preventDefault();
      event.stopPropagation();

      const itemId =
        event.currentTarget.dataset.itemId ||
        event.currentTarget.closest(".item")?.dataset.itemId;
      const feat = this.actor.items.get(itemId);

      if (!feat) {
        ui.notifications.warn("Could not find feat.");
        return;
      }

      await useFeat(this.actor, feat);
    });

    html.find(".item-edit").click(async event => {
      event.preventDefault();
      await openItemRowSheet(this.actor, event.currentTarget.closest(".zelda-item"));
    });

    html.find(".item-delete").click(async event => {
      event.preventDefault();

      const itemId = event.currentTarget.dataset.itemId;
      const item = this.actor.items.get(itemId);

      await deleteOwnedItemFromSheet(this.actor, item);
    });

    html.find(".zelda-item").dblclick(async event => {
      event.preventDefault();

      if (shouldIgnoreItemRowOpen(event)) return;

      await openItemRowSheet(this.actor, event.currentTarget);
    });

    html.find(".zelda-item").contextmenu(async event => {
      event.preventDefault();
      await showItemRowContextMenu(this.actor, event.currentTarget);
    });

    html.find(".monster-action-menu").click(event => {
      event.preventDefault();
      event.stopPropagation();

      const wrapper = event.currentTarget.closest(".monster-action-menu-wrap");
      html.find(".monster-action-menu-wrap").not(wrapper).removeClass("open");
      wrapper.classList.toggle("open");
    });

    html.click(event => {
      if (!event.target.closest(".monster-action-menu-wrap")) {
        html.find(".monster-action-menu-wrap").removeClass("open");
      }
    });

    html.find(".add-monster-action").click(async () => {
      await editMonsterAction(this.actor, null);
    });

    html.find(".start-monster-rotation").click(async event => {
      event.preventDefault();
      await startMonsterRotation(this.actor);
      this.render(false);
    });

    html.find(".next-monster-rotation").click(async event => {
      event.preventDefault();
      await useNextMonsterRotationAction(this.actor);
      this.render(false);
    });

    html.find(".break-monster-rotation").click(async event => {
      event.preventDefault();
      await breakMonsterRotation(this.actor, "The GM broke the rotation.");
      this.render(false);
    });

    html.find(".import-monster-actions").click(async () => {
      await importMonsterActions(this.actor);
    });

    html.find(".monster-action-edit").click(async event => {
      const card = event.currentTarget.closest(".monster-action-card");
      const index = Number(card.dataset.actionIndex);
      html.find(".monster-action-menu-wrap").removeClass("open");
      await editMonsterAction(this.actor, index);
    });

    html.find(".monster-action-move-up").click(async event => {
      event.preventDefault();
      const card = event.currentTarget.closest(".monster-action-card");
      const index = Number(card.dataset.actionIndex);
      html.find(".monster-action-menu-wrap").removeClass("open");
      await moveMonsterAction(this.actor, index, -1);
      this.render(false);
    });

    html.find(".monster-action-move-down").click(async event => {
      event.preventDefault();
      const card = event.currentTarget.closest(".monster-action-card");
      const index = Number(card.dataset.actionIndex);
      html.find(".monster-action-menu-wrap").removeClass("open");
      await moveMonsterAction(this.actor, index, 1);
      this.render(false);
    });

    html.find(".monster-action-delete").click(async event => {
      const card = event.currentTarget.closest(".monster-action-card");
      const index = Number(card.dataset.actionIndex);
      const actions = foundry.utils.deepClone(this.actor.system.actions || []);
      const action = actions[index];

      html.find(".monster-action-menu-wrap").removeClass("open");

      const confirmed = await confirmDialog(
        "Delete Monster Action?",
        `Delete "${action?.name || "this action"}"? This cannot be undone.`
      );

      if (!confirmed) return;

      actions.splice(index, 1);
      await this.actor.update({ "system.actions": actions });
    });

    html.find(".monster-action-use").click(async event => {
      const card = event.currentTarget.closest(".monster-action-card");
      const index = Number(card.dataset.actionIndex);
      const action = this.actor.system.actions?.[index];
      if (action) await useMonsterAction(this.actor, action, { actionIndex: index });
    });

    html.find(".random-monster-action").click(async () => {
      const actions = this.actor.system.actions || [];

      if (!actions.length) {
        ui.notifications.warn("This monster has no actions.");
        return;
      }

      const roll = await new Roll(`1d${actions.length}`).evaluate();
      const action = actions[roll.total - 1];

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        rolls: compactRolls(roll),
        content: `
          <div class="ts-chat-card">
            <h2>${this.actor.name} Random Action</h2>
            <p>Rolled ${roll.total}: <strong>${action.name}</strong></p>
          </div>
        `
      });

      await useMonsterAction(this.actor, action, { actionIndex: roll.total - 1 });
    });

    html.find(".monster-attack").click(async () => {
      const roll = await new Roll("1d12").evaluate();

      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        flavor: `
          <div class="ts-chat-card">
            <h2>${this.actor.name} Attacks</h2>
            <p>Monster attack roll.</p>
          </div>
        `
      });
    });

    html.find(".monster-damage").click(async () => {
      await rollMonsterDamage(this.actor);
    });
  }

  async _onDrop(event) {
    event.preventDefault();

    const data = TextEditor.getDragEventData(event);
    const item = await Item.implementation.fromDropData(data);

    if (!item) return super._onDrop(event);

    if (item.type === "feat") {
      await addFeatToActor(this.actor, item);
      return false;
    }

    return super._onDrop(event);
  }
}

class TwilightSwordNPCSheet extends TwilightSwordChampionSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["twilight-sword", "sheet", "actor", "npc"],
      template: "systems/twilight-sword/templates/actor/champion-sheet.hbs",
      width: 820,
      height: 820,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "main" }]
    });
  }
}


// Item Sheet

class TwilightSwordItemSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["twilight-sword", "sheet", "item"],
      template: "systems/twilight-sword/templates/item/item-sheet.hbs",
      width: 620,
      height: 700
    });
  }

  async getData(options = {}) {
    const context = await super.getData(options);

    context.system = this.item.system;
    context.isWeapon = this.item.type === "weapon";
    context.isArmor = this.item.type === "armor";
    context.isSpell = this.item.type === "spell";
    context.isFeat = this.item.type === "feat";
    context.isMonsterFeat = this.item.type === "feat" && this.item.parent?.type === "monster";
    context.isKin = this.item.type === "kin";
    context.isWay = this.item.type === "way";
    context.isGear = ["gear", "consumable"].includes(this.item.type);
    context.isPurchasable = isPurchasableItem(this.item);
    context.armorType = normalizeArmorTypeValue(this.item.system?.armorType);
    context.spellType = normalizeSpellTypeValue(this.item.system?.spellType);
    context.damageType = normalizeDamageType(this.item.system?.damageType);
    context.elementalDamageType = normalizeElementalAffinity(this.item.system?.elementalDamageType);
    context.status = normalizeStatusId(this.item.system?.status);

    return context;
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find(".use-item").click(async () => {
      const item = this.item;
      const actor = item.parent;

      if (!actor) {
        ui.notifications.warn("This item must be on an actor to use it.");
        return;
      }

      if (item.type === "consumable" || (item.type === "gear" && isLockpickItem(item))) await useConsumable(actor, item);
      if (item.type === "feat") await useFeat(actor, item);
      if (item.type === "spell") await castSpell(actor, item);
      if (item.type === "weapon") await rollWeaponAttack(actor, item);
    });

    html.find(".buy-item").click(async () => {
      const item = this.item;
      const actor = item.parent;

      if (!actor) {
        ui.notifications.warn("This item must be on an actor before it can be bought.");
        return;
      }

      await buyItem(actor, item);
    });
  }
}


// Hooks

Hooks.once("init", function () {
  console.log("Twilight Sword | Initializing");

  Handlebars.registerHelper("tsHasWeaponFeat", (item, feat) =>
    getWeaponFeats(item).has(String(feat || "").toLowerCase())
  );

  Handlebars.registerHelper("tsHasAnyWeaponFeat", (item, ...args) => {
    const options = args.pop();
    const feats = getWeaponFeats(item);

    return args.some(feat => feats.has(String(feat || "").toLowerCase()));
  });

  Handlebars.registerHelper("tsItemSlots", item => getInventorySlotsForItem(item));
  Handlebars.registerHelper("tsItemQuantity", item => getItemQuantity(item));
  Handlebars.registerHelper("tsEquipmentSlots", item => getEquipmentSlotsForItem(item));
  Handlebars.registerHelper("tsHandSlots", item => getHandSlotsForItem(item));
  Handlebars.registerHelper("tsWeaponExpended", item => isWeaponExpended(item));
  Handlebars.registerHelper("tsWeaponAvailable", item => isWeaponAvailable(item));
  Handlebars.registerHelper("tsFormatCost", item => formatCurrency(getItemCost(item)));
  Handlebars.registerHelper("tsHasCost", item =>
    isPurchasableItem(item) && getCurrencyValue(item.system?.purchaseCost) > 0
  );
  Handlebars.registerHelper("tsElementalAffinityLabel", affinity => getElementalAffinityLabel(affinity));
  Handlebars.registerHelper("tsDamageTypeLabel", damageType => getDamageTypeLabel(damageType));
  Handlebars.registerHelper("tsAbilityLabel", abilityKey => getAbilityLabel(abilityKey));
  Handlebars.registerHelper("tsSpellRollOptions", rollAbility =>
    new Handlebars.SafeString(buildAbilityOptions(rollAbility, { includeBlank: true }))
  );
  Handlebars.registerHelper("tsDamageTypeOptions", damageType =>
    new Handlebars.SafeString(buildDamageTypeOptions(damageType))
  );
  Handlebars.registerHelper("tsElementalAffinityOptions", affinity =>
    new Handlebars.SafeString(buildElementalAffinityOptions(affinity))
  );
  Handlebars.registerHelper("tsRangeLabel", range => getRangeLabel(range));
  Handlebars.registerHelper("tsStatusLabel", statusId => getStatusLabel(statusId));
  Handlebars.registerHelper("tsSpellTypeLabel", spellType => getSpellTypeLabel(spellType));
  Handlebars.registerHelper("tsItemTooltip", item => getItemTooltip(item));
  Handlebars.registerHelper("tsMonsterActionColorLabel", color => getMonsterActionColorLabel(color));
  Handlebars.registerHelper("tsHasMonsterActionColor", color => normalizeMonsterActionColor(color) !== "normal");

  Hooks.on("preUpdateToken", (tokenDocument, changes) => {
  if (!game.combat?.started) return true;

  const isMovement =
    foundry.utils.hasProperty(changes, "x") ||
    foundry.utils.hasProperty(changes, "y") ||
    foundry.utils.hasProperty(changes, "elevation");

  if (!isMovement) return true;

  const actor = tokenDocument.actor;
  const activeActor = game.combat.combatant?.actor;

  if (!actor || !activeActor) return true;

  if (actor.id !== activeActor.id) {
    ui.notifications.warn(`${actor.name} cannot move; it is not their turn.`);
    return false;
  }

  return true;
});

Hooks.once("ready", function () {
  installCompendiumCreationFallbacks();

  Combat.prototype.rollInitiative = async function (ids, options = {}) {
    ids = typeof ids === "string" ? [ids] : ids;
    const rolledActors = new Set();

    for (const id of ids) {
      const combatant = this.combatants.get(id);
      if (!combatant?.actor) continue;

      const actor = combatant.actor;

      if (rolledActors.has(actor.id)) continue;
      rolledActors.add(actor.id);

      await rollInitiativeForActor(actor);
    }

    return this;
  };
});

Hooks.on("renderCombatTracker", (app, html) => {
  const root = html instanceof HTMLElement ? html : html[0];

  for (const combatant of game.combat?.combatants ?? []) {
    if (combatant.initiative === null || combatant.initiative === undefined) continue;

    const row = root.querySelector(`[data-combatant-id="${combatant.id}"]`);
    if (!row) continue;

    const initiativeEl =
      row.querySelector(".token-initiative") ||
      row.querySelector(".initiative") ||
      row.querySelector("[data-tooltip='Initiative']");

    if (initiativeEl) {
      initiativeEl.textContent = Math.abs(combatant.initiative);
    }
  }

  root.querySelectorAll(".combatant-control[data-control='rollInitiative']").forEach(button => {
    button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();

      const row = button.closest("[data-combatant-id]");
      const combatantId = row?.dataset.combatantId;
      const combatant = game.combat?.combatants.get(combatantId);

      if (!combatant?.actor) {
        ui.notifications.warn("Could not find combatant actor.");
        return;
      }

      await rollInitiativeForActor(combatant.actor);
    });
  });
});

  CONFIG.statusEffects = [
    { id: "burn", name: "Burn", icon: "icons/magic/fire/flame-burning-hand-orange.webp" },
    { id: "poison", name: "Poison", icon: "icons/magic/acid/dissolve-drip-droplet-smoke.webp" },
    { id: "ko", name: "K.O.", icon: "icons/svg/unconscious.svg" },
    { id: "stun", name: "Stun", icon: "icons/svg/daze.svg" },
    { id: "confusion", name: "Confusion", icon: "icons/svg/terror.svg" },
    { id: "wound", name: "Wound", icon: "icons/svg/blood.svg" },
    { id: "fear", name: "Fear", icon: "icons/svg/terror.svg" },
    { id: "freeze", name: "Freeze", icon: "icons/magic/water/snowflake-ice-blue.webp" },
    { id: "blind", name: "Blind", icon: "icons/svg/blind.svg" },
    { id: "silence", name: "Silence", icon: "icons/svg/silenced.svg" },
    { id: "prone", name: "Prone", icon: "icons/svg/falling.svg" }
  ];

  Actors.unregisterSheet("core", ActorSheet);
  Items.unregisterSheet("core", ItemSheet);

  Actors.registerSheet("twilight-sword", TwilightSwordChampionSheet, {
    types: ["champion"],
    makeDefault: true,
    label: "Twilight Sword Champion"
  });

  Actors.registerSheet("twilight-sword", TwilightSwordMonsterSheet, {
    types: ["monster"],
    makeDefault: true,
    label: "Twilight Sword Monster"
  });

  Actors.registerSheet("twilight-sword", TwilightSwordNPCSheet, {
    types: ["npc"],
    makeDefault: true,
    label: "Twilight Sword NPC"
  });

  Items.registerSheet("twilight-sword", TwilightSwordItemSheet, {
    types: ["weapon", "armor", "feat", "spell", "consumable", "gear", "kin", "way"],
    makeDefault: true,
    label: "Twilight Sword Item"
  });

  console.log("Twilight Sword | Sheets registered");
});

function getUpdateChange(changes, path) {
  if (Object.prototype.hasOwnProperty.call(changes, path)) return changes[path];

  return foundry.utils.getProperty(changes, path);
}

function setUpdateChange(changes, path, value) {
  if (Object.prototype.hasOwnProperty.call(changes, path)) {
    changes[path] = value;
    return;
  }

  foundry.utils.setProperty(changes, path, value);
}

function clampActorResourceUpdate(actor, changes, resource, maxValue = null) {
  const maxPath = `system.${resource}.max`;
  const valuePath = `system.${resource}.value`;
  const maxChanged = getUpdateChange(changes, maxPath);
  const valueChanged = getUpdateChange(changes, valuePath);

  if (maxValue === null && maxChanged === undefined && valueChanged === undefined) return;

  const nextMax = Math.max(Math.floor(Number(
    maxValue !== null
      ? maxValue
      : maxChanged !== undefined
        ? maxChanged
        : actor.system?.[resource]?.max
  ) || 0), 0);
  const nextValue = valueChanged !== undefined
    ? Math.max(Math.floor(Number(valueChanged) || 0), 0)
    : Math.max(Math.floor(Number(actor.system?.[resource]?.value ?? 0) || 0), 0);
  const clampedValue = Math.min(nextValue, nextMax);

  if (maxValue !== null && maxChanged === undefined) {
    setUpdateChange(changes, maxPath, nextMax);
  }

  if (clampedValue !== nextValue) {
    setUpdateChange(changes, valuePath, clampedValue);
  }
}

Hooks.on("preUpdateActor", async (actor, changes) => {
  clampActorResourceUpdate(actor, changes, "stamina");

  if (actor.type === "monster") {
    const maxChanged = getUpdateChange(changes, "system.hearts.max");
    const valueChanged = getUpdateChange(changes, "system.hearts.value");
    const threatChanged = getUpdateChange(changes, "system.level");
    const variantRankChanged = getUpdateChange(changes, "system.variant.rank");

    if (
      maxChanged !== undefined ||
      valueChanged !== undefined ||
      threatChanged !== undefined ||
      variantRankChanged !== undefined
    ) {
      const baseMax = maxChanged !== undefined
        ? Math.max(Math.floor(Number(maxChanged) || 0), 0)
        : getMonsterBaseMaxHearts(actor);
      const baseThreat = threatChanged !== undefined
        ? Math.max(Math.floor(Number(threatChanged) || 1), 1)
        : getMonsterBaseThreat(actor);
      const rank = variantRankChanged !== undefined
        ? variantRankChanged
        : getMonsterVariantData(actor).rank;
      const effectiveMax = getMonsterEffectiveMaxHeartsFromValues(baseMax, baseThreat, rank);
      const currentValue = valueChanged !== undefined
        ? Math.max(Math.floor(Number(valueChanged) || 0), 0)
        : Number(actor.system.hearts?.value ?? 0);
      const clampedValue = Math.min(Math.max(currentValue, 0), effectiveMax);

      if (clampedValue !== currentValue) {
        setUpdateChange(changes, "system.hearts.value", clampedValue);
      }
    }

    return;
  }

  if (!["champion", "npc"].includes(actor.type)) return;

  const vit = getUpdateChange(changes, "system.abilities.vit.value");
  const heartsBonus = getUpdateChange(changes, "system.hearts.bonus");

  if (vit !== undefined || heartsBonus !== undefined) {
    const nextVit = vit !== undefined
      ? Number(vit)
      : Number(actor.system.abilities?.vit?.value ?? 0);
    const nextBonus = heartsBonus !== undefined
      ? Number(heartsBonus)
      : Number(actor.system.hearts?.bonus ?? 0);
    const newMax = 10 + nextVit + nextBonus;

    clampActorResourceUpdate(actor, changes, "hearts", newMax);
  }
});

Hooks.on("preUpdateItem", (item, changes) => {
  if (item.type !== "weapon") return;

  const nextWeapon = {
    name: foundry.utils.getProperty(changes, "name") ?? item.name,
    type: item.type,
    system: {
      ...item.system,
      ...(foundry.utils.getProperty(changes, "system") || {})
    }
  };

  if (getWeaponFeats(nextWeapon).has("two-handed")) {
    foundry.utils.setProperty(changes, "system.hands", 2);
  }
});

Hooks.on("updateActor", async (actor, changes) => {
  const newHearts = foundry.utils.getProperty(changes, "system.hearts.value");

  if (newHearts !== undefined) {
    if (Number(newHearts) > 0) {
      await removeStatus(actor, "ko");
    }

    await checkZeroHearts(actor);
  }
});

Hooks.on("hoverToken", (token, hovered) => {
  if (hovered) {
    showTokenRangeHoverLabel(token);
  } else {
    clearTokenRangeHoverLabel(token);
  }
});

Hooks.on("controlToken", () => {
  clearAllRangeHoverLabels();
});

Hooks.on("canvasReady", () => {
  clearAllRangeHoverLabels();
});

Hooks.on("updateCombat", async (combat, changed) => {
  if ("round" in changed) {
    const resetMonsterIds = new Set();

    for (const combatant of combat.combatants ?? []) {
      const actor = combatant.actor;
      if (!canMonsterUseVariantReaction(actor)) continue;
      if (resetMonsterIds.has(actor.id)) continue;

      resetMonsterIds.add(actor.id);
      await setReactionUsed(actor, false);
    }

    await promptTempoAtRoundStart(combat);
  }

  if (!("turn" in changed)) return;

  const combatant = combat.combatant;
  const actor = combatant?.actor;

  if (actor) {
    const threatTurn = Number(combatant.getFlag("twilight-sword", "threatTurn") || 1);

    if (actor.type !== "monster" || threatTurn === 1) {
      await setReactionUsed(actor, false);
    }
  }


  if (!actor) return;

  await processMonsterStartOfTurnAbilities(actor, combat, combatant);
  await processStartOfTurnStatuses(actor);
});

Hooks.on("renderCompendium", (app, html) => {
  addCompendiumPackCreationControls(app, html);
});

Hooks.on("renderChatMessage", (message, html) => {
  html.find(".ts-roll-monster-save").click(async event => {
    event.preventDefault();

    const abilityKey = normalizeAbilityKey(event.currentTarget.dataset.saveAbility);
    const abilityLabel = getAbilityLabel(abilityKey);
    const saveTarget = event.currentTarget.dataset.saveTarget || "";
    const sourceName = event.currentTarget.dataset.saveSource || "Monster Action";
    const targets = Array.from(game.user.targets);
    const token = targets[0] || canvas.tokens.controlled[0];

    if (!abilityLabel) {
      ui.notifications.warn("This save does not have a valid ability.");
      return;
    }

    if (!token?.actor) {
      ui.notifications.warn("Target a token first, or select the actor making the save.");
      return;
    }

    await rollAbility(token.actor, abilityKey, {
      askStamina: token.actor.type !== "monster",
      target: saveTarget,
      title: `${abilityLabel} Save`,
      sourceName
    });
  });

  html.find(".ts-reaction-dodge").click(async event => {
    event.preventDefault();

    const attacker = game.actors.get(message.speaker.actor);
    const targets = Array.from(game.user.targets);
    const token = targets[0] || canvas.tokens.controlled[0];

    if (!token?.actor) {
      ui.notifications.warn("Target a token first, or select the defending token.");
      return;
    }

    if (attacker?.type !== "monster" && !canMonsterUseReactionType(token.actor, "dodge")) {
      ui.notifications.warn("Only Champions and Monsters with Dodge [X] can dodge attacks.");
      return;
    }

    await rollReaction(token.actor, "dodge", { attacker });
  });

  html.find(".ts-reaction-parry").click(async event => {
    event.preventDefault();

    const attacker = game.actors.get(message.speaker.actor);
    const targets = Array.from(game.user.targets);
    const token = targets[0] || canvas.tokens.controlled[0];

    if (!token?.actor) {
      ui.notifications.warn("Target a token first, or select the defending token.");
      return;
    }

    if (attacker?.type !== "monster" && !canMonsterUseReactionType(token.actor, "parry")) {
      ui.notifications.warn("Only Champions and Monsters with Parry [X] can parry attacks.");
      return;
    }

    const rangedAttack = event.currentTarget.dataset.rangedAttack === "true";
    await rollReaction(token.actor, "parry", { attacker, rangedAttack });
  });

  html.find(".ts-lockpick-break-check").click(async event => {
    event.preventDefault();

    if (message.getFlag("twilight-sword", "lockpickBreakChecked")) {
      ui.notifications.warn("This lockpick break check has already been rolled.");
      return;
    }

    const actor = game.actors.get(event.currentTarget.dataset.actorId || message.speaker.actor);
    if (!actor) {
      ui.notifications.warn("Could not find lockpick user.");
      return;
    }

    const item = actor.items.get(event.currentTarget.dataset.itemId);
    if (!item || getAvailableItemUnits(item) <= 0) {
      ui.notifications.warn("Could not find an available lockpick.");
      return;
    }

    if (actorHasFeatNamed(actor, "thief")) {
      ui.notifications.info(`${actor.name}'s Thief feat prevents the lockpick from breaking.`);
      return;
    }

    await message.setFlag("twilight-sword", "lockpickBreakChecked", true);

    const result = await rollAbility(actor, "ste");
    if (!result) return;

    if (!result.success) {
      await consumeItemUnit(actor, item);
    }

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <div class="ts-chat-card">
          <h2>${item.name} Break Check</h2>
          <p><strong>Stealth:</strong> ${result.success ? "Success. The lockpick holds." : "Failure. The lockpick breaks and is consumed."}</p>
        </div>
      `
    });
  });

  html.find(".ts-apply-damage").click(async event => {
    const totalDamage = Number(event.currentTarget.dataset.damage);
    const hasBaseDamage = event.currentTarget.dataset.baseDamage !== undefined;
    const damage = hasBaseDamage
      ? Number(event.currentTarget.dataset.baseDamage)
      : totalDamage;
    const damageType = event.currentTarget.dataset.damageType || "";
    const elementalDamage = Number(event.currentTarget.dataset.elementalDamage || 0);
    const elementalDamageType = event.currentTarget.dataset.elementalDamageType || "";
    const ignoreArmor = event.currentTarget.dataset.ignoreArmor === "true";
    const statusId = normalizeStatusId(event.currentTarget.dataset.status);
    const statusDuration = event.currentTarget.dataset.statusDuration || "";
    const statusOnDamage = event.currentTarget.dataset.statusOnDamage === "true";
    const statusSource = event.currentTarget.dataset.statusSource || "Monster Action";

    const targets = Array.from(game.user.targets);
    const token = targets[0] || canvas.tokens.controlled[0];

    if (!token?.actor) {
      ui.notifications.warn("Target a token first, or select one token.");
      return;
    }

    const actor = token.actor;
    const armor = getActorArmorValue(actor);
    const baseAdjustment = getElementalDamageAdjustment(actor, damage, { damageType });
    const elementalAdjustment = elementalDamage > 0
      ? getElementalDamageAdjustment(actor, elementalDamage, { damageType: elementalDamageType })
      : { damage: 0, text: "" };
    const fallbackAdjustment = hasBaseDamage
      ? null
      : getElementalDamageAdjustment(actor, totalDamage, { damageType });
    const adjustedDamage = hasBaseDamage
      ? baseAdjustment.damage + elementalAdjustment.damage
      : fallbackAdjustment.damage;
    const finalDamage = ignoreArmor
      ? adjustedDamage
      : Math.max(adjustedDamage - armor, 0);
    const damageAdjustmentText = hasBaseDamage
      ? [baseAdjustment.text, elementalAdjustment.text].filter(Boolean).join("<br>")
      : fallbackAdjustment.text;
    const currentHearts = Number(actor.system.hearts?.value ?? 0);
    const newHearts = Math.max(currentHearts - finalDamage, 0);

    await actor.update({ "system.hearts.value": newHearts });

    let statusResult = null;
    let statusText = "";

    if (statusId) {
      if (!statusOnDamage || finalDamage > 0) {
        statusResult = await applyStatusToActor(actor, statusId, {
          durationFormula: statusDuration,
          sourceName: statusSource,
          createMessage: false
        });

        if (statusResult) {
          const statusVerb = statusResult.applied
            ? "applied"
            : statusResult.extended
              ? "duration extended"
              : statusResult.repeatDamage
                ? "was already active, so the repeated status caused 1 damage"
                : "was already active";

          statusText = `<p><strong>Status:</strong> ${escapeHtml(statusResult.statusLabel)} ${statusVerb}${
            statusResult.durationText ? ` for ${escapeHtml(statusResult.durationText)}` : ""
          }.</p>`;
        }
      } else {
        statusText = `<p><strong>Status:</strong> ${escapeHtml(getStatusLabel(statusId))} was not applied because no damage got through.</p>`;
      }
    }

    await ChatMessage.create({
      rolls: compactRolls(statusResult?.durationRoll),
      content: `
        <div class="ts-chat-card">
          <h2>Damage Applied</h2>
          <p><strong>${escapeHtml(actor.name)}</strong> took ${finalDamage} damage.</p>
          ${damageAdjustmentText ? `<p>${damageAdjustmentText}</p>` : ""}
          <p>Armor ${ignoreArmor ? "was ignored." : `reduced damage by ${armor}.`}</p>
          ${statusText}
        </div>
      `
    });
  });

  html.find(".ts-apply-status").click(async event => {
    event.preventDefault();

    await applyStatusToTarget(event.currentTarget.dataset.status, {
      durationFormula: event.currentTarget.dataset.statusDuration || "",
      sourceName: event.currentTarget.dataset.statusSource || "Monster Action"
    });
  });

  html.find(".ts-track-active-spell").click(async event => {
    event.preventDefault();

    const actorId = event.currentTarget.dataset.actorId || message.speaker.actor;
    const actor = game.actors.get(actorId);

    if (!actor) {
      ui.notifications.warn("Could not find spell caster.");
      return;
    }

    await trackActiveSpell(actor, {
      spellId: event.currentTarget.dataset.spellId || "",
      name: event.currentTarget.dataset.spellName || "Spell",
      duration: event.currentTarget.dataset.duration || "",
      target: event.currentTarget.dataset.target || ""
    });
  });

  html.find(".ts-roll-spell-damage").click(async event => {
    const itemId = event.currentTarget.dataset.itemId;
    const speaker = message.speaker;
    const actor = game.actors.get(speaker.actor);

    if (!actor) {
      ui.notifications.warn("Could not find casting actor.");
      return;
    }

    let spell = actor.items.get(itemId);

    if (!spell && event.currentTarget.dataset.magicSpellSourceId) {
      const sourceItem = actor.items.get(event.currentTarget.dataset.magicSpellSourceId);
      if (sourceItem) spell = buildGrantedMagicSpell(actor, sourceItem, event.currentTarget.dataset.magicSpellName || "");
    }

    if (!spell) {
      ui.notifications.warn("Could not find spell.");
      return;
    }

    if (spell.magicSpellMissingDefinition) {
      ui.notifications.warn(`${spell.magicSpellSourceName} grants ${spell.name}, but no matching spell card exists.`);
      return;
    }

    const damageFormula = event.currentTarget.dataset.damageFormula || spell.system.damage;

    if (!damageFormula) {
      ui.notifications.warn(`${spell.name} has no damage formula.`);
      return;
    }

    const roll = await new Roll(damageFormula).evaluate();
    const damageType = normalizeDamageType(
      event.currentTarget.dataset.damageType || spell.system.damageType
    );
    const damageTypeLabel = getDamageTypeLabel(damageType);
    const statusId = normalizeStatusId(event.currentTarget.dataset.status);
    const statusDuration = event.currentTarget.dataset.statusDuration || "";
    const statusOnDamage = event.currentTarget.dataset.statusOnDamage === "true";
    const statusSource = event.currentTarget.dataset.statusSource || `${actor.name}: ${spell.name}`;
    const statusSummary = statusId
      ? buildMonsterActionStatusSummary({
          status: statusId,
          statusDuration,
          statusOnDamage
        })
      : "";
    const statusDamageData = statusId
      ? `data-status="${statusId}" data-status-duration="${escapeHtml(statusDuration)}" data-status-on-damage="${statusOnDamage ? "true" : "false"}" data-status-source="${escapeHtml(statusSource)}"`
      : "";

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      rolls: compactRolls(roll),
      content: `
        <div class="ts-chat-card">
          <h2>${spell.name} Damage</h2>
          ${damageFormula !== spell.system.damage ? `<p><strong>Damage Formula:</strong> ${escapeHtml(damageFormula)}</p>` : ""}
          <p><strong>Damage:</strong> ${roll.total}</p>
          ${damageTypeLabel ? `<p><strong>Damage Type:</strong> ${damageTypeLabel}</p>` : ""}
          ${statusSummary}
          ${buildReactionButtons({
            attacker: actor,
            defender: getPrimaryTargetToken()?.actor,
            rangedAttack: true
          })}
          <button class="ts-apply-damage" data-damage="${roll.total}" data-damage-type="${damageType}" ${statusDamageData}>
            Apply Damage to Target
          </button>
        </div>
      `
    });
  });

  html.find(".ts-apply-healing").click(async event => {
    const healing = Number(event.currentTarget.dataset.healing);
    const reason = event.currentTarget.dataset.reason || "Healing";

    await applyHealingToTarget(healing, reason);
  });

  html.find(".ts-apply-life").click(async event => {
    const healing = Number(event.currentTarget.dataset.healing);

    const targets = Array.from(game.user.targets);
    const token = targets[0] || canvas.tokens.controlled[0];

    if (!token?.actor) {
      ui.notifications.warn("Target a token first, or select one token.");
      return;
    }

    const actor = token.actor;

    await removeStatus(actor, "ko");
    await healActor(actor, healing);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <div class="ts-chat-card">
          <h2>Life Applied</h2>
          <p><strong>${actor.name}</strong> removed K.O. and recovered ${healing} Hearts.</p>
        </div>
      `
    });
  });
});

