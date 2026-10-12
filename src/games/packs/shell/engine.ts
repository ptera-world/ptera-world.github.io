import type { GamesApi } from "../../api";

/**
 * The engine services this pack uses, taken from the games object it is loaded with. Live
 * bindings: valid once `bind` has run (the pack entry does that before anything else).
 */
export let SessionCtor!: GamesApi["Session"];
export let PluginHostCtor!: GamesApi["plugins"]["PluginHost"];
export let loadPluginConfig!: GamesApi["plugins"]["loadPluginConfig"];
export let TechniqueHostCtor!: GamesApi["techniques"]["TechniqueHost"];
export let findPracticePosition!: GamesApi["techniques"]["findPracticePosition"];
export let hintFrom!: GamesApi["techniques"]["hintFrom"];
export let isPartOfStep!: GamesApi["techniques"]["isPartOfStep"];
export let stepsLeft!: GamesApi["techniques"]["stepsLeft"];
export let stepsOf!: GamesApi["techniques"]["stepsOf"];
export let firstStep!: GamesApi["techniques"]["firstStep"];
export let findStep!: GamesApi["techniques"]["findStep"];
export let loadPace!: GamesApi["techniques"]["loadPace"];
export let rateByTechniques!: GamesApi["techniques"]["rateByTechniques"];
export let findStepAt!: GamesApi["techniques"]["findStepAt"];
export let aimable!: GamesApi["techniques"]["aimable"];
export let applyStep!: GamesApi["techniques"]["applyStep"];
export let colorOf!: GamesApi["techniques"]["colorOf"];
export let rememberPosition!: GamesApi["techniques"]["rememberPosition"];
export let stepsAt!: GamesApi["techniques"]["stepsAt"];
export let generate!: GamesApi["generate"];
export let labelSides!: GamesApi["board"]["labelSides"];
export let setLabelSides!: GamesApi["board"]["setLabelSides"];
export let cycleLabels!: GamesApi["board"]["cycleLabels"];
export let onBoardPrefsChange!: GamesApi["board"]["onBoardPrefsChange"];
export let COLOR_TOKENS!: GamesApi["look"]["COLOR_TOKENS"];
export let setTheme!: GamesApi["look"]["setTheme"];
export let setTokenOverride!: GamesApi["look"]["setTokenOverride"];
export let themeChoice!: GamesApi["look"]["themeChoice"];
export let SYSTEM_THEME!: GamesApi["look"]["SYSTEM_THEME"];
export let tokenOverrides!: GamesApi["look"]["tokenOverrides"];
export let onThemeChange!: GamesApi["look"]["onThemeChange"];
export let checkForUpdate!: GamesApi["packs"]["checkForUpdate"];
export let listMods!: GamesApi["packs"]["listMods"];
export let packRecord!: GamesApi["packs"]["packRecord"];
export let saveMods!: GamesApi["packs"]["saveMods"];
export let selectPackVersion!: GamesApi["packs"]["selectPackVersion"];
export let setPackEnabled!: GamesApi["packs"]["setPackEnabled"];
export let setTrack!: GamesApi["packs"]["setTrack"];

export function bind(g: GamesApi): void {
  SessionCtor = g.Session;
  ({ PluginHost: PluginHostCtor, loadPluginConfig } = g.plugins);
  ({ TechniqueHost: TechniqueHostCtor, findPracticePosition, hintFrom, isPartOfStep, stepsLeft, stepsOf, firstStep, findStep, loadPace, rateByTechniques, findStepAt, aimable, applyStep, colorOf, rememberPosition, stepsAt } = g.techniques);
  generate = g.generate;
  ({ labelSides, setLabelSides, cycleLabels, onBoardPrefsChange } = g.board);
  ({ COLOR_TOKENS, SYSTEM_THEME, setTheme, setTokenOverride, themeChoice, tokenOverrides, onThemeChange } = g.look);
  ({ checkForUpdate, listMods, packRecord, saveMods, selectPackVersion, setPackEnabled, setTrack } = g.packs);
}
