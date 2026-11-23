import type {
  BranchNode,
  DialogueLine,
  DialogueOption,
  EntityId,
  EvidenceId,
  ItemId,
} from "../types";
import type { ActSpec, InterludePanel, StingerLine } from "../engine/gameData";
import type { StateManager } from "../engine/stateManager";

export interface DomOverlayCallbacks {
  onSelectItem: (itemId: ItemId | null) => void;
  onExamineItem: (itemId: ItemId) => void;
  onRestartGame: () => void;
  onToggleMute: () => boolean;
  onUiClick?: () => void;
  onJournalToggle?: (open: boolean) => void;
  onTypewriterBlip?: (speaker: EntityId) => void;
}

export interface PortraitProvider {
  getPortraitUrl(entityId: EntityId, mood?: "default" | "cold" | "warm"): string | null;
}

interface EntityVisual {
  bg: string;
  accent: string;
  monogram: string;
}

const ENTITY_VISUALS: Record<EntityId, EntityVisual> = {
  TEREZA: { bg: "#26323e", accent: "#88c0e8", monogram: "TM" },
  DILAN: { bg: "#1e2c3a", accent: "#78a6c8", monogram: "DB" },
  ODELIA: { bg: "#3b2220", accent: "#e8927c", monogram: "OD" },
  JADEN: { bg: "#3a281d", accent: "#e3ab4f", monogram: "JD" },
  AMARINA: { bg: "#2b3626", accent: "#9dd082", monogram: "AM" },
  MARK: { bg: "#3a201b", accent: "#dc7666", monogram: "MK" },
  ROMENO: { bg: "#292522", accent: "#cfc0a4", monogram: "RS" },
  CALEB: { bg: "#242c28", accent: "#96bcac", monogram: "CB" },
  JOSEPH: { bg: "#302c22", accent: "#ded097", monogram: "JP" },
  SFX: { bg: "#1d1a18", accent: "#f0c256", monogram: "FX" },
};

const TYPEWRITER_INTERVAL_MS = 22;
const BLIP_EVERY_N_CHARS = 3;

const ICON_BACKPACK_SVG = `<svg class="eomm-btn-svg" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">
  <rect x="5" y="1" width="6" height="2" fill="#d9a74a"/>
  <rect x="3" y="3" width="10" height="11" fill="#8b5a34"/>
  <rect x="4" y="4" width="8" height="4" fill="#a87043"/>
  <rect x="4" y="9" width="8" height="4" fill="#6b4226"/>
  <rect x="6" y="7" width="4" height="2" fill="#f5cf6e"/>
  <rect x="2" y="5" width="1" height="6" fill="#52311b"/>
  <rect x="13" y="5" width="1" height="6" fill="#52311b"/>
</svg>`;

const ICON_JOURNAL_SVG = `<svg class="eomm-btn-svg" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">
  <rect x="2" y="2" width="11" height="12" fill="#7a4425"/>
  <rect x="4" y="3" width="8" height="10" fill="#f3e4c3"/>
  <rect x="2" y="2" width="2" height="12" fill="#472613"/>
  <rect x="5" y="5" width="6" height="1" fill="#664c35"/>
  <rect x="5" y="7" width="5" height="1" fill="#664c35"/>
  <rect x="5" y="9" width="6" height="1" fill="#664c35"/>
  <rect x="10" y="10" width="2" height="4" fill="#c94a3c"/>
</svg>`;

const ICON_CLOCK_SVG = `<svg class="eomm-btn-svg" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">
  <rect x="4" y="2" width="8" height="12" fill="#d9a74a"/>
  <rect x="2" y="4" width="12" height="8" fill="#d9a74a"/>
  <rect x="4" y="4" width="8" height="8" fill="#231710"/>
  <rect x="7" y="5" width="1" height="4" fill="#f5ebd4"/>
  <rect x="7" y="8" width="4" height="1" fill="#f5cf6e"/>
</svg>`;

const ICON_SOUND_ON_SVG = `<svg class="eomm-btn-svg" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">
  <rect x="2" y="6" width="3" height="4" fill="#f5ebd4"/>
  <rect x="5" y="4" width="2" height="8" fill="#f5ebd4"/>
  <rect x="7" y="3" width="2" height="10" fill="#d9a74a"/>
  <rect x="11" y="5" width="1" height="6" fill="#f5cf6e"/>
  <rect x="13" y="3" width="1" height="10" fill="#f5cf6e"/>
</svg>`;

const ICON_SOUND_OFF_SVG = `<svg class="eomm-btn-svg" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">
  <rect x="2" y="6" width="3" height="4" fill="#bca894"/>
  <rect x="5" y="4" width="2" height="8" fill="#bca894"/>
  <rect x="7" y="3" width="2" height="10" fill="#8b7360"/>
  <rect x="10" y="5" width="2" height="2" fill="#e56252"/>
  <rect x="12" y="7" width="2" height="2" fill="#e56252"/>
  <rect x="10" y="9" width="2" height="2" fill="#e56252"/>
  <rect x="14" y="5" width="1" height="2" fill="#e56252"/>
  <rect x="14" y="9" width="1" height="2" fill="#e56252"/>
</svg>`;

function getItemIconSvg(itemId: ItemId): string {
  switch (itemId) {
    case "ITEM_BUSSOLA":
      return `<svg class="eomm-inv-icon" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">
        <rect x="6" y="1" width="4" height="2" fill="#b9804c"/>
        <rect x="4" y="3" width="8" height="11" fill="#d9a74a"/>
        <rect x="2" y="5" width="12" height="7" fill="#d9a74a"/>
        <rect x="4" y="5" width="8" height="7" fill="#efe2c2"/>
        <rect x="7" y="6" width="2" height="2" fill="#c94a3c"/>
        <rect x="7" y="8" width="2" height="3" fill="#3a4c5e"/>
        <rect x="7" y="8" width="2" height="1" fill="#21130a"/>
      </svg>`;
    case "ITEM_COMIDA_VENCIDA":
      return `<svg class="eomm-inv-icon" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">
        <rect x="3" y="3" width="10" height="2" fill="#b7b3a8"/>
        <rect x="3" y="5" width="10" height="9" fill="#8d887e"/>
        <rect x="4" y="6" width="8" height="5" fill="#b84a39"/>
        <rect x="5" y="7" width="6" height="2" fill="#f3e4c3"/>
        <rect x="4" y="12" width="8" height="1" fill="#635e56"/>
      </svg>`;
    case "ITEM_FLOR_VENENOSA":
      return `<svg class="eomm-inv-icon" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">
        <rect x="7" y="9" width="2" height="6" fill="#4e7a44"/>
        <rect x="5" y="11" width="2" height="2" fill="#649956"/>
        <rect x="9" y="12" width="2" height="2" fill="#649956"/>
        <rect x="6" y="2" width="4" height="3" fill="#f4eff7"/>
        <rect x="3" y="5" width="3" height="3" fill="#b06be0"/>
        <rect x="10" y="5" width="3" height="3" fill="#b06be0"/>
        <rect x="6" y="8" width="4" height="2" fill="#efe7f5"/>
        <rect x="6" y="5" width="4" height="3" fill="#f0c854"/>
      </svg>`;
    case "ITEM_PISTOLA_CROMADA":
      return `<svg class="eomm-inv-icon" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">
        <rect x="2" y="4" width="12" height="3" fill="#dce3ea"/>
        <rect x="2" y="6" width="11" height="1" fill="#92a0ad"/>
        <rect x="8" y="7" width="4" height="2" fill="#707c87"/>
        <rect x="9" y="9" width="4" height="5" fill="#463327"/>
        <rect x="10" y="10" width="2" height="3" fill="#694b36"/>
        <rect x="6" y="7" width="2" height="2" fill="#525b63"/>
      </svg>`;
    case "ITEM_FICHA_TRIAGEM":
      return `<svg class="eomm-inv-icon" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">
        <rect x="3" y="2" width="10" height="11" fill="#f0e1be"/>
        <rect x="3" y="13" width="3" height="1" fill="#f0e1be"/>
        <rect x="8" y="13" width="4" height="1" fill="#f0e1be"/>
        <rect x="5" y="4" width="6" height="1" fill="#5b432b"/>
        <rect x="5" y="6" width="6" height="1" fill="#7c6248"/>
        <rect x="5" y="8" width="4" height="1" fill="#7c6248"/>
        <rect x="9" y="9" width="3" height="3" fill="#c94a3c"/>
      </svg>`;
  }
}

function getInterludeIllustrationSvg(panelIdx: number): string {
  switch (panelIdx) {
    case 0:
      // Panel 1: Sem Bússola — rising sun over wasteland horizon, Tereza silhouette heading east
      return `<svg class="eomm-interlude-svg" viewBox="0 0 320 140" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges" aria-hidden="true">
        <rect width="320" height="140" fill="#231c18"/>
        <rect y="0" width="320" height="28" fill="#3a2c22"/>
        <rect y="28" width="320" height="26" fill="#63452c"/>
        <rect y="54" width="320" height="30" fill="#9e6c3b"/>
        <rect x="206" y="42" width="36" height="36" fill="#eab354"/>
        <rect x="212" y="48" width="24" height="24" fill="#fbe299"/>
        <rect x="190" y="74" width="68" height="10" fill="#c78440"/>
        <rect y="84" width="320" height="56" fill="#1b1511"/>
        <rect y="84" width="320" height="4" fill="#3c2a1d"/>
        <rect x="64" y="58" width="8" height="8" fill="#120e0c"/>
        <rect x="62" y="66" width="12" height="16" fill="#120e0c"/>
        <rect x="63" y="82" width="4" height="12" fill="#120e0c"/>
        <rect x="69" y="82" width="4" height="12" fill="#120e0c"/>
        <rect x="74" y="68" width="5" height="9" fill="#4f3722"/>
        <rect x="132" y="80" width="18" height="4" fill="#2d231b"/>
        <rect x="260" y="76" width="28" height="8" fill="#251d17"/>
      </svg>`;
    case 1:
      // Panel 2: O Shopping — ruined mall facade & torn red banner ("TRAVESSIA")
      return `<svg class="eomm-interlude-svg" viewBox="0 0 320 140" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges" aria-hidden="true">
        <rect width="320" height="140" fill="#1d1b1d"/>
        <rect y="0" width="320" height="46" fill="#2c292b"/>
        <rect x="26" y="34" width="268" height="82" fill="#3b3634"/>
        <rect x="34" y="42" width="252" height="68" fill="#292524"/>
        <rect x="52" y="54" width="42" height="38" fill="#181617"/>
        <rect x="226" y="54" width="42" height="38" fill="#181617"/>
        <rect x="108" y="46" width="104" height="24" fill="#9e2a24"/>
        <rect x="114" y="52" width="92" height="12" fill="#c73c32"/>
        <rect x="122" y="56" width="76" height="4" fill="#f3e6cb"/>
        <rect x="196" y="70" width="10" height="8" fill="#9e2a24"/>
        <rect x="118" y="78" width="84" height="32" fill="#151212"/>
        <rect x="124" y="84" width="72" height="22" fill="#221d1c"/>
        <rect y="112" width="320" height="28" fill="#151311"/>
        <rect x="74" y="116" width="24" height="4" fill="#4e4742"/>
        <rect x="212" y="120" width="34" height="4" fill="#4e4742"/>
      </svg>`;
    case 2:
      // Panel 3: A Emboscada — high grass ambush, gleaming blade slash, encroaching shadows
      return `<svg class="eomm-interlude-svg" viewBox="0 0 320 140" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges" aria-hidden="true">
        <rect width="320" height="140" fill="#101511"/>
        <rect y="0" width="320" height="58" fill="#18201a"/>
        <rect y="58" width="320" height="82" fill="#1d2a1b"/>
        <rect x="18" y="46" width="8" height="64" fill="#2c3e26"/>
        <rect x="44" y="38" width="10" height="78" fill="#243420"/>
        <rect x="78" y="50" width="8" height="66" fill="#31472a"/>
        <rect x="234" y="42" width="10" height="74" fill="#243420"/>
        <rect x="266" y="36" width="10" height="84" fill="#2c3e26"/>
        <rect x="294" y="48" width="8" height="68" fill="#1a2617"/>
        <polygon points="96,94 218,32 224,38 102,100" fill="#dfe8ef"/>
        <polygon points="104,96 220,36 222,40 108,98" fill="#8ca2b3"/>
        <rect x="0" y="0" width="60" height="140" fill="#060706" fill-opacity="0.52"/>
        <rect x="260" y="0" width="60" height="140" fill="#060706" fill-opacity="0.52"/>
        <rect x="0" y="106" width="320" height="34" fill="#080a08" fill-opacity="0.72"/>
      </svg>`;
    default:
      // Panel 4: A Fazenda e a Triagem — fortified wooden gates, watchtower, yellow bracelet accent
      return `<svg class="eomm-interlude-svg" viewBox="0 0 320 140" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges" aria-hidden="true">
        <rect width="320" height="140" fill="#241e18"/>
        <rect y="0" width="320" height="66" fill="#463829"/>
        <rect y="36" width="320" height="30" fill="#6b5239"/>
        <rect x="242" y="14" width="28" height="58" fill="#2c2119"/>
        <rect x="236" y="10" width="40" height="10" fill="#3f2d20"/>
        <rect x="250" y="24" width="12" height="8" fill="#d9a74a"/>
        <rect y="66" width="320" height="74" fill="#211a14"/>
        <rect x="58" y="34" width="14" height="82" fill="#4f3723"/>
        <rect x="208" y="34" width="14" height="82" fill="#4f3723"/>
        <rect x="72" y="42" width="136" height="8" fill="#69482d"/>
        <rect x="72" y="96" width="136" height="8" fill="#69482d"/>
        <rect x="86" y="42" width="6" height="66" fill="#593c25"/>
        <rect x="110" y="42" width="6" height="66" fill="#593c25"/>
        <rect x="134" y="42" width="6" height="66" fill="#593c25"/>
        <rect x="158" y="42" width="6" height="66" fill="#593c25"/>
        <rect x="182" y="42" width="6" height="66" fill="#593c25"/>
        <rect x="240" y="112" width="54" height="14" fill="#17120e"/>
        <rect x="244" y="116" width="46" height="6" fill="#f0c248"/>
      </svg>`;
  }
}

export class DomOverlay {
  private readonly mountRoot: HTMLElement;
  private readonly stateManager: StateManager;
  private readonly callbacks: DomOverlayCallbacks;
  private portraits: PortraitProvider | null;

  private rootEl!: HTMLElement;

  // Top HUD Bar elements
  private topBarEl!: HTMLElement;
  private invBtnEl!: HTMLButtonElement;
  private invBtnLabelEl!: HTMLElement;
  private roomBannerEl!: HTMLElement;
  private roomBannerTextEl!: HTMLElement;
  private cancelItemBtnEl!: HTMLButtonElement;
  private clockPillEl!: HTMLElement;
  private clockValueEl!: HTMLElement;
  private muteBtnEl!: HTMLButtonElement;
  private journalBtnEl!: HTMLButtonElement;
  private journalBtnLabelEl!: HTMLElement;

  // Inventory Drawer
  private invDrawerEl!: HTMLElement;
  private invGridEl!: HTMLElement;

  // Floating Tooltip
  private tooltipEl!: HTMLElement;
  private tooltipLabelEl!: HTMLElement;
  private tooltipHintEl!: HTMLElement;

  // Dialogue & Branch Options
  private dialogueWrapEl!: HTMLElement;
  private optionsPanelEl!: HTMLElement;
  private dialogueBoxEl!: HTMLElement;
  private dialoguePortraitInnerEl!: HTMLElement;
  private dialogueSpeakerEl!: HTMLElement;
  private dialogueProgressEl!: HTMLElement;
  private dialogueTextEl!: HTMLElement;
  private dialogueCaretEl!: HTMLElement;

  // Journal Modal
  private journalBackdropEl!: HTMLElement;
  private journalTitleEl!: HTMLElement;
  private journalKeywordEl!: HTMLElement;
  private journalObjectiveEl!: HTMLElement;
  private journalListEl!: HTMLElement;
  private journalDetailEl!: HTMLElement;

  // Cutscene Overlay
  private cutsceneEl!: HTMLElement;

  // State
  private muted = false;
  private invOpen = false;
  private journalOpen = false;
  private selectedItem: ItemId | null = null;
  private journalAlertActive = false;
  private selectedEvidenceId: EvidenceId | null = null;

  // Dialogue state
  private dialogueActive = false;
  private pendingLines: DialogueLine[] = [];
  private lineIndex = 0;
  private onLinesComplete: (() => void) | null = null;
  private activeOptions: DialogueOption[] = [];
  private optionChoiceHandler: ((nextId: string) => void) | null = null;
  private currentLineShowContinue = false;

  // Cutscene state
  private cutsceneActive = false;
  private cutsceneAdvanceHandler: (() => void) | null = null;

  // Active portrait tracking so setPortraitProvider refreshes immediately
  private activePortraitRef: { el: HTMLElement; speaker: EntityId; text: string } | null = null;

  // Typewriter state
  private typewriterTimer: number | null = null;
  private typewriterTargetEl: HTMLElement | null = null;
  private typewriterFullText = "";
  private typewriterCharIdx = 0;
  private typewriterNonSpaceCount = 0;
  private typewriterSpeaker: EntityId | null = null;
  private typewriterOnDone: (() => void) | null = null;
  private isTyping = false;

  // Visual SFX pulse timer
  private sfxPulseTimer: number | null = null;

  constructor(
    mountRoot: HTMLElement,
    stateManager: StateManager,
    callbacks: DomOverlayCallbacks,
    portraits?: PortraitProvider
  ) {
    this.mountRoot = mountRoot;
    this.stateManager = stateManager;
    this.callbacks = callbacks;
    this.portraits = portraits ?? null;

    this.buildDom();
    this.refreshHud();
  }

  public setPortraitProvider(provider: PortraitProvider): void {
    this.portraits = provider;
    if (this.activePortraitRef) {
      this.renderPortraitInto(
        this.activePortraitRef.el,
        this.activePortraitRef.speaker,
        this.activePortraitRef.text
      );
    }
  }

  public setMutedState(muted: boolean): void {
    this.muted = muted;
    this.muteBtnEl.classList.toggle("is-muted", this.muted);
    this.muteBtnEl.innerHTML = this.muted ? ICON_SOUND_OFF_SVG : ICON_SOUND_ON_SVG;
    this.muteBtnEl.setAttribute(
      "aria-label",
      this.muted ? "Ativar áudio" : "Silenciar áudio"
    );
    this.muteBtnEl.title = this.muted ? "Ativar áudio" : "Silenciar áudio";
  }

  public isBlockingWorldInput(): boolean {
    return this.dialogueActive || this.journalOpen || this.cutsceneActive;
  }

  public isDialogueActive(): boolean {
    return this.dialogueActive;
  }

  public isCutsceneActive(): boolean {
    return this.cutsceneActive;
  }

  public isJournalOpen(): boolean {
    return this.journalOpen;
  }

  public isInventoryOpen(): boolean {
    return this.invOpen;
  }

  public getSelectedItem(): ItemId | null {
    return this.selectedItem;
  }

  public setSelectedItem(itemId: ItemId | null): void {
    this.selectedItem = itemId;
    this.refreshHud();
    if (this.invOpen) {
      this.rebuildInventorySlots();
    }
  }

  public notifyNewEvidence(evidenceId?: EvidenceId): void {
    this.journalAlertActive = true;
    if (evidenceId) {
      this.selectedEvidenceId = evidenceId;
    }
    this.refreshHud();
  }

  public refreshHud(): void {
    const room = this.stateManager.getRoom();
    if (this.selectedItem && !this.stateManager.state.inventory.includes(this.selectedItem)) {
      this.selectedItem = null;
    }
    const invCount = this.stateManager.state.inventory.length;
    const evCount = this.stateManager.state.evidences.length;

    // Mochila button
    this.invBtnLabelEl.textContent = `Mochila (${invCount})`;
    this.invBtnEl.classList.toggle("is-active", this.invOpen);
    this.invBtnEl.classList.toggle("is-armed", this.selectedItem !== null);

    // Center room name or armed item banner
    if (this.selectedItem) {
      const itemSpec = this.stateManager.getItemSpec(this.selectedItem);
      const itemLabel = itemSpec ? itemSpec.name : this.selectedItem;
      this.roomBannerEl.classList.add("is-armed");
      this.roomBannerTextEl.textContent = `USAR: ${itemLabel}`;
      this.cancelItemBtnEl.classList.remove("is-hidden");
    } else {
      this.roomBannerEl.classList.remove("is-armed");
      this.roomBannerTextEl.textContent = room.name;
      this.cancelItemBtnEl.classList.add("is-hidden");
    }

    // Narrative clock visible ONLY in Act II
    const showClock = room.act === "ACT_2";
    this.clockPillEl.classList.toggle("is-hidden", !showClock);
    if (showClock) {
      const mins = this.stateManager.state.narrative_clock;
      this.clockValueEl.textContent = `τ ${mins}m`;
      this.clockPillEl.classList.toggle("is-critical", mins <= 10);
      this.clockPillEl.classList.toggle("is-warn", mins > 10 && mins <= 20);
    }

    // Journal button & alert glow
    this.journalBtnLabelEl.textContent = `Diário [J] ${evCount}/5`;
    this.journalBtnEl.classList.toggle("is-alert", this.journalAlertActive);
    this.journalBtnEl.classList.toggle("is-active", this.journalOpen);

    if (this.invOpen) {
      this.rebuildInventorySlots();
    }
  }

  public closeTransientMenus(): void {
    if (this.invOpen) {
      this.invOpen = false;
      this.invDrawerEl.classList.add("is-hidden");
      this.invBtnEl.classList.remove("is-active");
    }
    if (this.journalOpen) {
      this.journalOpen = false;
      this.journalBackdropEl.classList.add("is-hidden");
      this.journalBtnEl.classList.remove("is-active");
      this.callbacks.onJournalToggle?.(false);
    }
  }

  public toggleInventory(): void {
    if (this.cutsceneActive || this.dialogueActive) return;

    if (this.journalOpen) {
      this.journalOpen = false;
      this.journalBackdropEl.classList.add("is-hidden");
      this.callbacks.onJournalToggle?.(false);
    }

    this.invOpen = !this.invOpen;
    this.invDrawerEl.classList.toggle("is-hidden", !this.invOpen);
    this.callbacks.onUiClick?.();
    if (this.invOpen) {
      this.rebuildInventorySlots();
    } else {
      this.hideTooltip();
    }
    this.refreshHud();
  }

  public toggleJournal(): void {
    if (this.cutsceneActive) return;

    if (this.invOpen) {
      this.invOpen = false;
      this.invDrawerEl.classList.add("is-hidden");
    }

    this.journalOpen = !this.journalOpen;
    if (this.journalOpen) {
      this.journalAlertActive = false;
      this.hideTooltip();
      this.rebuildJournalContents();
    }
    this.journalBackdropEl.classList.toggle("is-hidden", !this.journalOpen);
    this.callbacks.onJournalToggle?.(this.journalOpen);
    this.refreshHud();
  }

  public showTooltip(
    label: string | null,
    hint?: string | null,
    clientX?: number,
    clientY?: number
  ): void {
    if (!label || this.isBlockingWorldInput()) {
      this.hideTooltip();
      return;
    }

    this.tooltipLabelEl.textContent = label;
    if (hint) {
      this.tooltipHintEl.textContent = hint;
      this.tooltipHintEl.classList.remove("is-hidden");
    } else {
      this.tooltipHintEl.textContent = "";
      this.tooltipHintEl.classList.add("is-hidden");
    }

    this.tooltipEl.classList.remove("is-hidden");

    const stageRect = this.rootEl.getBoundingClientRect();
    const tipW = this.tooltipEl.offsetWidth || 160;
    const tipH = this.tooltipEl.offsetHeight || 36;
    const topBarH = this.topBarEl.offsetHeight || 40;
    const pad = 8;

    let x: number;
    let y: number;

    if (typeof clientX === "number" && typeof clientY === "number" && stageRect.width > 0) {
      x = clientX - stageRect.left + 14;
      y = clientY - stageRect.top - tipH - 12;

      if (y < topBarH + pad) {
        y = clientY - stageRect.top + 18;
      }
      if (x + tipW > stageRect.width - pad) {
        x = clientX - stageRect.left - tipW - 14;
      }

      x = Math.max(pad, Math.min(x, Math.max(pad, stageRect.width - tipW - pad)));
      y = Math.max(topBarH + pad, Math.min(y, Math.max(topBarH + pad, stageRect.height - tipH - pad)));
    } else {
      x = Math.max(pad, (stageRect.width - tipW) / 2);
      y = Math.max(topBarH + pad, stageRect.height - tipH - 16);
    }

    this.tooltipEl.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }

  public showLines(lines: DialogueLine[], onComplete: () => void, sfx?: string): void {
    this.closeTransientMenus();
    this.hideTooltip();

    if (lines.length === 0) {
      onComplete();
      return;
    }

    this.dialogueActive = true;
    this.pendingLines = lines;
    this.lineIndex = 0;
    this.onLinesComplete = onComplete;
    this.activeOptions = [];
    this.optionChoiceHandler = null;
    this.optionsPanelEl.classList.add("is-hidden");
    this.optionsPanelEl.innerHTML = "";
    this.dialogueWrapEl.classList.remove("is-hidden");

    if (sfx) {
      this.triggerSfxVisualPulse();
    }

    this.renderCurrentLine();
  }

  public showBranchNode(
    node: BranchNode,
    onSelectOption: (nextId: string) => void,
    onContinueNoOptions: () => void
  ): void {
    this.closeTransientMenus();
    this.hideTooltip();

    this.dialogueActive = true;
    this.pendingLines = [{ speaker: node.speaker, text: node.text }];
    this.lineIndex = 0;
    this.dialogueWrapEl.classList.remove("is-hidden");

    const hasOptions = Boolean(node.options && node.options.length > 0);
    if (hasOptions && node.options) {
      this.onLinesComplete = null;
      this.activeOptions = node.options;
      this.optionChoiceHandler = onSelectOption;
      this.renderOptions(node.options);
    } else {
      this.activeOptions = [];
      this.optionChoiceHandler = null;
      this.optionsPanelEl.classList.add("is-hidden");
      this.optionsPanelEl.innerHTML = "";
      this.onLinesComplete = onContinueNoOptions;
    }

    this.renderDialogueLine(node.speaker, node.text, !hasOptions, "");
  }

  public clearDialogue(): void {
    this.stopTypewriter();
    this.dialogueActive = false;
    this.pendingLines = [];
    this.lineIndex = 0;
    this.onLinesComplete = null;
    this.activeOptions = [];
    this.optionChoiceHandler = null;
    this.currentLineShowContinue = false;
    this.activePortraitRef = null;

    this.optionsPanelEl.classList.add("is-hidden");
    this.optionsPanelEl.innerHTML = "";
    this.dialogueWrapEl.classList.add("is-hidden");
    this.dialogueBoxEl.classList.remove("is-cold", "is-sfx-pulse");
  }

  public handleAdvanceInput(): boolean {
    if (this.cutsceneActive) {
      if (this.isTyping) {
        this.completeTypewriter();
        return true;
      }
      if (this.cutsceneAdvanceHandler) {
        this.cutsceneAdvanceHandler();
      }
      return true;
    }

    if (!this.dialogueActive) return false;

    if (this.isTyping) {
      this.completeTypewriter();
      return true;
    }

    if (this.activeOptions.length > 0) {
      return true;
    }

    this.lineIndex += 1;
    if (this.lineIndex < this.pendingLines.length) {
      this.renderCurrentLine();
    } else {
      const done = this.onLinesComplete;
      this.clearDialogue();
      if (done) done();
    }
    return true;
  }

  public handleOptionHotkey(indexZeroBased: number): boolean {
    if (!this.dialogueActive || this.activeOptions.length === 0) return false;
    const opt = this.activeOptions[indexZeroBased];
    if (!opt || !this.optionChoiceHandler) return false;

    this.stopTypewriter();
    this.callbacks.onUiClick?.();

    const handler = this.optionChoiceHandler;
    this.activeOptions = [];
    this.optionChoiceHandler = null;
    this.optionsPanelEl.classList.add("is-hidden");
    this.optionsPanelEl.innerHTML = "";
    handler(opt.next);
    return true;
  }

  public playBlackScreenCutscene(
    lines: DialogueLine[],
    onComplete: () => void,
    sfx?: string
  ): void {
    this.closeTransientMenus();
    this.clearDialogue();
    this.hideTooltip();

    if (lines.length === 0) {
      onComplete();
      return;
    }

    this.cutsceneActive = true;
    this.cutsceneEl.classList.remove("is-hidden");
    let idx = 0;

    const renderStep = (): void => {
      this.stopTypewriter();
      this.activePortraitRef = null;
      this.cutsceneEl.innerHTML = "";

      const line = lines[idx];
      if (!line) {
        this.finishCutscene(onComplete);
        return;
      }

      const visual = ENTITY_VISUALS[line.speaker] ?? ENTITY_VISUALS.SFX;
      const speakerName = this.stateManager.getSpeakerName(line.speaker);

      const stage = document.createElement("div");
      stage.className = "eomm-blackscreen-stage";
      stage.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        if (e.button === 0) {
          this.handleAdvanceInput();
        }
      });

      const headerTag = document.createElement("div");
      headerTag.className = "eomm-cutscene-tag";
      headerTag.textContent = "— ESCURIDÃO / VOZES DO LADO DE FORA —";

      const waveBox = document.createElement("div");
      waveBox.className = "eomm-wave-box is-speaking";
      waveBox.style.setProperty("--wave-color", visual.accent);

      const barCount = 24;
      for (let b = 0; b < barCount; b++) {
        const bar = document.createElement("div");
        bar.className = "eomm-wave-bar";
        const peak = 26 + ((b * 19 + idx * 13) % 58);
        const dur = (0.42 + ((b * 7) % 5) * 0.11).toFixed(2);
        const delay = (((b * 11) % 9) * 0.06).toFixed(2);
        bar.style.setProperty("--wave-peak", `${peak}%`);
        bar.style.setProperty("--wave-dur", `${dur}s`);
        bar.style.setProperty("--wave-delay", `${delay}s`);
        waveBox.appendChild(bar);
      }

      // Bottom portrait + typewriter box
      const box = document.createElement("div");
      box.className = sfx && idx === 0 ? "eomm-dialogue-box is-dark is-sfx-pulse" : "eomm-dialogue-box is-dark";

      const portraitFrame = document.createElement("div");
      portraitFrame.className = "eomm-portrait-frame";
      const portraitInner = document.createElement("div");
      portraitInner.className = "eomm-portrait-inner";
      portraitFrame.appendChild(portraitInner);

      this.renderPortraitInto(portraitInner, line.speaker, line.text);
      this.activePortraitRef = { el: portraitInner, speaker: line.speaker, text: line.text };

      const content = document.createElement("div");
      content.className = "eomm-dialogue-content";

      const header = document.createElement("div");
      header.className = "eomm-dialogue-header";

      const speakerBadge = document.createElement("span");
      speakerBadge.className = "eomm-speaker-badge";
      speakerBadge.textContent = speakerName;
      speakerBadge.style.color = visual.accent;

      const progress = document.createElement("span");
      progress.className = "eomm-dialogue-progress";
      progress.textContent = `${idx + 1}/${lines.length}`;

      header.append(speakerBadge, progress);

      const textEl = document.createElement("div");
      textEl.className = "eomm-dialogue-text";

      const caret = document.createElement("span");
      caret.className = "eomm-dialogue-caret is-hidden";
      caret.textContent = "▼";

      content.append(header, textEl);
      box.append(portraitFrame, content, caret);
      stage.append(headerTag, waveBox, box);
      this.cutsceneEl.appendChild(stage);

      this.startTypewriter(textEl, line.text, line.speaker, () => {
        waveBox.classList.remove("is-speaking");
        caret.classList.remove("is-hidden");
      });
    };

    this.cutsceneAdvanceHandler = () => {
      idx += 1;
      if (idx >= lines.length) {
        this.finishCutscene(onComplete);
      } else {
        renderStep();
      }
    };

    renderStep();
  }

  public playInterludeAct(act: ActSpec, onComplete: () => void): void {
    this.closeTransientMenus();
    this.clearDialogue();
    this.hideTooltip();

    const panels: InterludePanel[] = act.panels ?? [];
    if (panels.length === 0) {
      onComplete();
      return;
    }

    this.cutsceneActive = true;
    this.cutsceneEl.classList.remove("is-hidden");
    let idx = 0;

    const renderPanel = (): void => {
      this.stopTypewriter();
      this.activePortraitRef = null;
      this.cutsceneEl.innerHTML = "";

      const panel = panels[idx];
      if (!panel) {
        this.finishCutscene(onComplete);
        return;
      }

      const stage = document.createElement("div");
      stage.className = "eomm-interlude-stage";
      stage.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        if (e.button === 0) {
          this.handleAdvanceInput();
        }
      });

      const top = document.createElement("div");
      top.className = "eomm-interlude-top";

      const actTitle = document.createElement("div");
      actTitle.className = "eomm-interlude-act-title";
      actTitle.textContent = `${act.title} — ${panel.panel}/${panels.length}`;

      const dots = document.createElement("div");
      dots.className = "eomm-interlude-dots";
      for (let d = 0; d < panels.length; d++) {
        const dot = document.createElement("span");
        dot.className = "eomm-interlude-dot";
        if (d === idx) dot.classList.add("is-active");
        else if (d < idx) dot.classList.add("is-done");
        dots.appendChild(dot);
      }
      top.append(actTitle, dots);

      const frame = document.createElement("div");
      frame.className = "eomm-interlude-frame";
      frame.innerHTML = getInterludeIllustrationSvg(idx);

      const panelTitle = document.createElement("div");
      panelTitle.className = "eomm-interlude-panel-title";
      panelTitle.textContent = panel.title;

      const captionBox = document.createElement("div");
      captionBox.className = "eomm-interlude-caption-box";

      const captionText = document.createElement("div");
      captionText.className = "eomm-interlude-caption";

      const hint = document.createElement("div");
      hint.className = "eomm-cutscene-hint is-hidden";
      hint.textContent = "[Clique / Espaço ▶]";

      captionBox.append(captionText, hint);
      stage.append(top, frame, panelTitle, captionBox);
      this.cutsceneEl.appendChild(stage);

      this.startTypewriter(captionText, panel.caption, "TEREZA", () => {
        hint.classList.remove("is-hidden");
      });
    };

    this.cutsceneAdvanceHandler = () => {
      idx += 1;
      if (idx >= panels.length) {
        this.finishCutscene(onComplete);
      } else {
        renderPanel();
      }
    };

    renderPanel();
  }

  public playEndingAct(act: ActSpec): void {
    this.closeTransientMenus();
    this.clearDialogue();
    this.hideTooltip();

    const stinger: StingerLine[] = act.canon_stinger ?? [];
    this.cutsceneActive = true;
    this.cutsceneEl.classList.remove("is-hidden");
    let idx = 0;

    const renderStep = (): void => {
      this.stopTypewriter();
      this.activePortraitRef = null;
      this.cutsceneEl.innerHTML = "";

      const stage = document.createElement("div");
      stage.className = "eomm-ending-stage";

      const crack = document.createElement("div");
      crack.className = "eomm-door-crack";
      stage.appendChild(crack);

      if (idx < stinger.length) {
        stage.classList.add("is-clickable");
        stage.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          if (e.button === 0) {
            this.handleAdvanceInput();
          }
        });

        const entry = stinger[idx];
        const visual = ENTITY_VISUALS[entry.speaker] ?? ENTITY_VISUALS.SFX;
        const speakerName = this.stateManager.getSpeakerName(entry.speaker);

        const tag = document.createElement("div");
        tag.className = "eomm-cutscene-tag";
        tag.textContent = "— DO LADO DE FORA DA PORTA —";

        const portraitFrame = document.createElement("div");
        portraitFrame.className = "eomm-portrait-frame";
        const portraitInner = document.createElement("div");
        portraitInner.className = "eomm-portrait-inner";
        portraitFrame.appendChild(portraitInner);

        this.renderPortraitInto(portraitInner, entry.speaker, entry.line);
        this.activePortraitRef = { el: portraitInner, speaker: entry.speaker, text: entry.line };

        const speakerEl = document.createElement("div");
        speakerEl.className = "eomm-ending-stinger-speaker";
        speakerEl.style.color = visual.accent;
        speakerEl.textContent = speakerName;

        const quoteEl = document.createElement("div");
        quoteEl.className = "eomm-ending-stinger-quote";

        const hintEl = document.createElement("div");
        hintEl.className = "eomm-cutscene-hint is-hidden";
        hintEl.textContent = "[Clique / Espaço para continuar]";

        stage.append(tag, portraitFrame, speakerEl, quoteEl, hintEl);
        this.cutsceneEl.appendChild(stage);

        this.startTypewriter(quoteEl, `“${entry.line}”`, entry.speaker, () => {
          hintEl.classList.remove("is-hidden");
        });
      } else {
        // Closing card + Restart button
        this.cutsceneAdvanceHandler = null;

        const unlocked = this.stateManager.state.evidences;

        const titleEl = document.createElement("div");
        titleEl.className = "eomm-ending-card-title";
        titleEl.textContent = act.title;

        const subEl = document.createElement("div");
        subEl.className = "eomm-ending-card-sub";
        subEl.textContent = act.closing_card ?? "FIM DA DEMO";

        const statsBox = document.createElement("div");
        statsBox.className = "eomm-ending-stats";

        const statsLabel = document.createElement("div");
        statsLabel.className = "eomm-ending-stats-label";
        statsLabel.textContent = `Evidências reunidas no Diário: ${unlocked.length}/5`;

        const chips = document.createElement("div");
        chips.className = "eomm-ending-chips";
        for (const entry of this.stateManager.data.journal.entries) {
          const chip = document.createElement("span");
          chip.className = "eomm-ending-chip";
          if (unlocked.includes(entry.unlocked_by)) {
            chip.classList.add("is-unlocked");
            chip.textContent = `${entry.id}: ${entry.title}`;
          } else {
            chip.textContent = `${entry.id}: —`;
          }
          chips.appendChild(chip);
        }
        statsBox.append(statsLabel, chips);

        const restartBtn = document.createElement("button");
        restartBtn.type = "button";
        restartBtn.className = "eomm-restart-btn";
        restartBtn.textContent = "JOGAR NOVAMENTE";
        restartBtn.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
        });
        restartBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.callbacks.onUiClick?.();
          this.cutsceneActive = false;
          this.cutsceneAdvanceHandler = null;
          this.activePortraitRef = null;
          this.cutsceneEl.classList.add("is-hidden");
          this.cutsceneEl.innerHTML = "";
          this.callbacks.onRestartGame();
        });

        stage.append(titleEl, subEl, statsBox, restartBtn);
        this.cutsceneEl.appendChild(stage);
      }
    };

    this.cutsceneAdvanceHandler = () => {
      idx += 1;
      renderStep();
    };

    renderStep();
  }

  public destroy(): void {
    this.stopTypewriter();
    if (this.sfxPulseTimer !== null) {
      window.clearTimeout(this.sfxPulseTimer);
      this.sfxPulseTimer = null;
    }
    this.activePortraitRef = null;
    this.rootEl.remove();
  }

  // =========================================================
  // PRIVATE DOM BUILDERS
  // =========================================================

  private buildDom(): void {
    this.mountRoot.innerHTML = "";

    this.rootEl = document.createElement("div");
    this.rootEl.className = "eomm-root";

    this.buildTopBar();
    this.buildInventoryDrawer();
    this.buildTooltip();
    this.buildDialogueUi();
    this.buildJournalModal();
    this.buildCutsceneOverlay();

    this.mountRoot.appendChild(this.rootEl);
  }

  private bindStopPropagation(el: HTMLElement): void {
    const stop = (e: Event): void => {
      e.stopPropagation();
    };
    el.addEventListener("pointerdown", stop);
    el.addEventListener("mousedown", stop);
    el.addEventListener("mouseup", stop);
    el.addEventListener("click", stop);
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  }

  private buildTopBar(): void {
    this.topBarEl = document.createElement("header");
    this.topBarEl.className = "eomm-topbar";
    this.bindStopPropagation(this.topBarEl);

    // Left: Mochila
    const leftGroup = document.createElement("div");
    leftGroup.className = "eomm-topbar-left";

    this.invBtnEl = document.createElement("button");
    this.invBtnEl.type = "button";
    this.invBtnEl.className = "eomm-wood-btn";
    this.invBtnEl.innerHTML = ICON_BACKPACK_SVG;
    this.invBtnLabelEl = document.createElement("span");
    this.invBtnLabelEl.textContent = "Mochila (0)";
    this.invBtnEl.appendChild(this.invBtnLabelEl);
    this.invBtnEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleInventory();
    });

    leftGroup.appendChild(this.invBtnEl);

    // Center: Room name / Armed item banner
    const centerGroup = document.createElement("div");
    centerGroup.className = "eomm-topbar-center";

    this.roomBannerEl = document.createElement("div");
    this.roomBannerEl.className = "eomm-room-banner";

    this.roomBannerTextEl = document.createElement("span");
    this.roomBannerTextEl.className = "eomm-room-banner-text";

    this.cancelItemBtnEl = document.createElement("button");
    this.cancelItemBtnEl.type = "button";
    this.cancelItemBtnEl.className = "eomm-cancel-item-btn is-hidden";
    this.cancelItemBtnEl.textContent = "✕";
    this.cancelItemBtnEl.title = "Cancelar item selecionado";
    this.cancelItemBtnEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.callbacks.onUiClick?.();
      this.setSelectedItem(null);
      this.callbacks.onSelectItem(null);
    });

    this.roomBannerEl.append(this.roomBannerTextEl, this.cancelItemBtnEl);
    centerGroup.appendChild(this.roomBannerEl);

    // Right: Clock (Act II) + Mute + Journal
    const rightGroup = document.createElement("div");
    rightGroup.className = "eomm-topbar-right";

    this.clockPillEl = document.createElement("div");
    this.clockPillEl.className = "eomm-clock-pill is-hidden";
    this.clockPillEl.innerHTML = ICON_CLOCK_SVG;
    this.clockValueEl = document.createElement("span");
    this.clockValueEl.textContent = "τ 40m";
    this.clockPillEl.appendChild(this.clockValueEl);

    this.muteBtnEl = document.createElement("button");
    this.muteBtnEl.type = "button";
    this.muteBtnEl.className = "eomm-wood-btn is-icon-only";
    this.setMutedState(false);
    this.muteBtnEl.addEventListener("click", (e) => {
      e.stopPropagation();
      const nextMuted = this.callbacks.onToggleMute();
      this.setMutedState(nextMuted);
      if (!nextMuted) {
        this.callbacks.onUiClick?.();
      }
    });

    this.journalBtnEl = document.createElement("button");
    this.journalBtnEl.type = "button";
    this.journalBtnEl.className = "eomm-wood-btn";
    this.journalBtnEl.innerHTML = ICON_JOURNAL_SVG;
    this.journalBtnLabelEl = document.createElement("span");
    this.journalBtnLabelEl.textContent = "Diário [J] 0/5";
    this.journalBtnEl.appendChild(this.journalBtnLabelEl);
    this.journalBtnEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleJournal();
    });

    rightGroup.append(this.clockPillEl, this.muteBtnEl, this.journalBtnEl);
    this.topBarEl.append(leftGroup, centerGroup, rightGroup);
    this.rootEl.appendChild(this.topBarEl);
  }

  private buildInventoryDrawer(): void {
    this.invDrawerEl = document.createElement("section");
    this.invDrawerEl.className = "eomm-inv-drawer is-hidden";
    this.invDrawerEl.setAttribute("aria-label", "Inventário");
    this.bindStopPropagation(this.invDrawerEl);

    this.invGridEl = document.createElement("div");
    this.invGridEl.className = "eomm-inv-grid";

    const footer = document.createElement("div");
    footer.className = "eomm-inv-footer";
    footer.textContent = "Clique esquerdo: Selecionar para usar  •  Clique direito: Examinar item";

    this.invDrawerEl.append(this.invGridEl, footer);
    this.rootEl.appendChild(this.invDrawerEl);
  }

  private rebuildInventorySlots(): void {
    this.invGridEl.innerHTML = "";
    const inv = this.stateManager.state.inventory;

    if (inv.length === 0) {
      const empty = document.createElement("div");
      empty.className = "eomm-inv-empty";
      empty.textContent = "Mochila vazia. Clique esquerdo nos objetos do cenário para interagir.";
      this.invGridEl.appendChild(empty);
      return;
    }

    for (const itemId of inv) {
      const spec = this.stateManager.getItemSpec(itemId);
      const isSelected = this.selectedItem === itemId;
      const itemName = spec?.name ?? itemId;

      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = "eomm-inv-slot";
      if (isSelected) slot.classList.add("is-selected");

      const iconBox = document.createElement("span");
      iconBox.className = "eomm-inv-icon-box";
      iconBox.innerHTML = getItemIconSvg(itemId);

      const meta = document.createElement("span");
      meta.className = "eomm-inv-meta";

      const nameEl = document.createElement("span");
      nameEl.className = "eomm-inv-name";
      nameEl.textContent = itemName;

      const subEl = document.createElement("span");
      subEl.className = "eomm-inv-sub";
      subEl.textContent = isSelected ? "Selecionado — clique no alvo" : "Esq: Usar | Dir: Ver";

      meta.append(nameEl, subEl);
      slot.append(iconBox, meta);

      if (isSelected) {
        const badge = document.createElement("span");
        badge.className = "eomm-inv-badge";
        badge.textContent = "EM USO";
        slot.appendChild(badge);
      }

      slot.addEventListener("pointermove", (e) => {
        this.showTooltip(itemName, spec?.description ?? "Esq: Usar | Dir: Examinar", e.clientX, e.clientY);
      });
      slot.addEventListener("pointerleave", () => {
        this.hideTooltip();
      });
      slot.addEventListener("click", (e) => {
        e.stopPropagation();
        const nextSel = this.selectedItem === itemId ? null : itemId;
        this.selectedItem = nextSel;
        this.invOpen = false;
        this.invDrawerEl.classList.add("is-hidden");
        this.hideTooltip();
        this.callbacks.onUiClick?.();
        this.callbacks.onSelectItem(nextSel);
        this.refreshHud();
      });
      slot.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.invOpen = false;
        this.invDrawerEl.classList.add("is-hidden");
        this.hideTooltip();
        this.callbacks.onUiClick?.();
        this.refreshHud();
        this.callbacks.onExamineItem(itemId);
      });

      this.invGridEl.appendChild(slot);
    }
  }

  private buildTooltip(): void {
    this.tooltipEl = document.createElement("div");
    this.tooltipEl.className = "eomm-tooltip is-hidden";

    this.tooltipLabelEl = document.createElement("div");
    this.tooltipLabelEl.className = "eomm-tooltip-label";

    this.tooltipHintEl = document.createElement("div");
    this.tooltipHintEl.className = "eomm-tooltip-hint";

    this.tooltipEl.append(this.tooltipLabelEl, this.tooltipHintEl);
    this.rootEl.appendChild(this.tooltipEl);
  }

  private hideTooltip(): void {
    this.tooltipEl.classList.add("is-hidden");
  }

  private buildDialogueUi(): void {
    this.dialogueWrapEl = document.createElement("div");
    this.dialogueWrapEl.className = "eomm-dialogue-wrap is-hidden";

    this.optionsPanelEl = document.createElement("div");
    this.optionsPanelEl.className = "eomm-options-panel is-hidden";
    this.bindStopPropagation(this.optionsPanelEl);

    this.dialogueBoxEl = document.createElement("div");
    this.dialogueBoxEl.className = "eomm-dialogue-box";
    this.bindStopPropagation(this.dialogueBoxEl);
    this.dialogueBoxEl.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (e.button === 0) {
        this.handleAdvanceInput();
      }
    });

    const portraitFrame = document.createElement("div");
    portraitFrame.className = "eomm-portrait-frame";
    this.dialoguePortraitInnerEl = document.createElement("div");
    this.dialoguePortraitInnerEl.className = "eomm-portrait-inner";
    portraitFrame.appendChild(this.dialoguePortraitInnerEl);

    const content = document.createElement("div");
    content.className = "eomm-dialogue-content";

    const header = document.createElement("div");
    header.className = "eomm-dialogue-header";

    this.dialogueSpeakerEl = document.createElement("span");
    this.dialogueSpeakerEl.className = "eomm-speaker-badge";

    this.dialogueProgressEl = document.createElement("span");
    this.dialogueProgressEl.className = "eomm-dialogue-progress";

    header.append(this.dialogueSpeakerEl, this.dialogueProgressEl);

    this.dialogueTextEl = document.createElement("div");
    this.dialogueTextEl.className = "eomm-dialogue-text";

    this.dialogueCaretEl = document.createElement("span");
    this.dialogueCaretEl.className = "eomm-dialogue-caret is-hidden";
    this.dialogueCaretEl.textContent = "▼";

    content.append(header, this.dialogueTextEl);
    this.dialogueBoxEl.append(portraitFrame, content, this.dialogueCaretEl);
    this.dialogueWrapEl.append(this.optionsPanelEl, this.dialogueBoxEl);
    this.rootEl.appendChild(this.dialogueWrapEl);
  }

  private buildJournalModal(): void {
    this.journalBackdropEl = document.createElement("div");
    this.journalBackdropEl.className = "eomm-journal-backdrop is-hidden";
    this.bindStopPropagation(this.journalBackdropEl);
    this.journalBackdropEl.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (e.target === this.journalBackdropEl && e.button === 0) {
        this.toggleJournal();
      }
    });

    const book = document.createElement("div");
    book.className = "eomm-journal-book";
    book.setAttribute("role", "dialog");
    book.setAttribute("aria-modal", "true");

    const header = document.createElement("div");
    header.className = "eomm-journal-header";

    const headerMain = document.createElement("div");
    headerMain.className = "eomm-journal-header-main";

    const titleRow = document.createElement("div");
    titleRow.className = "eomm-journal-title-row";

    this.journalTitleEl = document.createElement("h2");
    this.journalTitleEl.className = "eomm-journal-title";

    this.journalKeywordEl = document.createElement("span");
    this.journalKeywordEl.className = "eomm-journal-keyword";

    titleRow.append(this.journalTitleEl, this.journalKeywordEl);

    this.journalObjectiveEl = document.createElement("div");
    this.journalObjectiveEl.className = "eomm-journal-objective";

    headerMain.append(titleRow, this.journalObjectiveEl);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "eomm-journal-close";
    closeBtn.textContent = "✕";
    closeBtn.title = "Fechar Diário [J]";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleJournal();
    });

    header.append(headerMain, closeBtn);

    const spread = document.createElement("div");
    spread.className = "eomm-journal-spread";

    this.journalListEl = document.createElement("div");
    this.journalListEl.className = "eomm-journal-left";

    this.journalDetailEl = document.createElement("div");
    this.journalDetailEl.className = "eomm-journal-right";

    spread.append(this.journalListEl, this.journalDetailEl);
    book.append(header, spread);
    this.journalBackdropEl.appendChild(book);
    this.rootEl.appendChild(this.journalBackdropEl);
  }

  private rebuildJournalContents(): void {
    const journal = this.stateManager.data.journal;
    const stageInfo = this.stateManager.getCurrentJournalStage();
    const unlocked = this.stateManager.state.evidences;

    this.journalTitleEl.textContent = journal.ui_title;
    this.journalKeywordEl.textContent = stageInfo.keyword;
    this.journalObjectiveEl.textContent = `Objetivo: ${stageInfo.objective}`;

    if (!this.selectedEvidenceId || !unlocked.includes(this.selectedEvidenceId)) {
      this.selectedEvidenceId = unlocked.length > 0 ? unlocked[unlocked.length - 1] : null;
    }

    // Left page: 5 evidence slots K1..K5
    this.journalListEl.innerHTML = "";
    const sectionLabel = document.createElement("div");
    sectionLabel.className = "eomm-journal-section-label";
    sectionLabel.textContent = `Evidências (${unlocked.length}/5)`;
    this.journalListEl.appendChild(sectionLabel);

    for (const entry of journal.entries) {
      const isUnlocked = unlocked.includes(entry.unlocked_by);
      const isSelected = this.selectedEvidenceId === entry.id;

      const row = document.createElement("button");
      row.type = "button";
      row.className = "eomm-evidence-row";
      if (!isUnlocked) row.classList.add("is-locked");
      if (isSelected && isUnlocked) row.classList.add("is-selected");
      row.disabled = !isUnlocked;

      const idSpan = document.createElement("span");
      idSpan.className = "eomm-evidence-id";
      idSpan.textContent = entry.id;

      const labelSpan = document.createElement("span");
      labelSpan.className = "eomm-evidence-label";
      labelSpan.textContent = isUnlocked ? entry.title : "[Bloqueado]";

      row.append(idSpan, labelSpan);

      if (isUnlocked) {
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          this.callbacks.onUiClick?.();
          this.selectedEvidenceId = entry.id;
          this.rebuildJournalContents();
        });
      }

      this.journalListEl.appendChild(row);
    }

    // Right page: detailed note
    this.journalDetailEl.innerHTML = "";
    const activeEntry = journal.entries.find(
      (e) => e.id === this.selectedEvidenceId && unlocked.includes(e.unlocked_by)
    );

    if (activeEntry) {
      const detTitle = document.createElement("div");
      detTitle.className = "eomm-evidence-detail-title";
      detTitle.textContent = `${activeEntry.id} — ${activeEntry.title}`;

      const detBody = document.createElement("p");
      detBody.className = "eomm-evidence-detail-body";
      detBody.textContent = activeEntry.text;

      this.journalDetailEl.append(detTitle, detBody);
    } else {
      const empty = document.createElement("div");
      empty.className = "eomm-evidence-empty";
      empty.textContent =
        "Nenhuma pista registrada ainda. Investigue pessoas e objetos para montar o quadro completo.";
      this.journalDetailEl.appendChild(empty);
    }
  }

  private buildCutsceneOverlay(): void {
    this.cutsceneEl = document.createElement("div");
    this.cutsceneEl.className = "eomm-cutscene is-hidden";
    this.bindStopPropagation(this.cutsceneEl);
    this.rootEl.appendChild(this.cutsceneEl);
  }

  // =========================================================
  // DIALOGUE & PORTRAIT HELPERS
  // =========================================================

  private renderCurrentLine(): void {
    const line = this.pendingLines[this.lineIndex];
    if (!line) return;
    const progress =
      this.pendingLines.length > 1
        ? `${this.lineIndex + 1}/${this.pendingLines.length}`
        : "";
    this.renderDialogueLine(line.speaker, line.text, true, progress);
  }

  private renderDialogueLine(
    speaker: EntityId,
    text: string,
    showContinue: boolean,
    progressLabel: string
  ): void {
    const visual = ENTITY_VISUALS[speaker] ?? ENTITY_VISUALS.SFX;
    const displayName = this.stateManager.getSpeakerName(speaker);
    const mood = this.resolvePortraitMood(speaker, text);

    this.currentLineShowContinue = showContinue;
    this.dialogueBoxEl.classList.toggle("is-cold", mood === "cold");

    this.dialogueSpeakerEl.textContent = displayName;
    this.dialogueSpeakerEl.style.color = mood === "cold" ? "#d5e4f0" : visual.accent;
    this.dialogueProgressEl.textContent = progressLabel;

    this.renderPortraitInto(this.dialoguePortraitInnerEl, speaker, text);
    this.activePortraitRef = { el: this.dialoguePortraitInnerEl, speaker, text };

    this.dialogueCaretEl.classList.add("is-hidden");
    this.startTypewriter(this.dialogueTextEl, text, speaker, () => {
      if (this.currentLineShowContinue) {
        this.dialogueCaretEl.classList.remove("is-hidden");
      }
    });
  }

  private renderOptions(options: DialogueOption[]): void {
    this.optionsPanelEl.innerHTML = "";

    options.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "eomm-option-btn";

      const num = document.createElement("span");
      num.className = "eomm-option-num";
      num.textContent = `${i + 1}.`;

      const txt = document.createElement("span");
      txt.className = "eomm-option-text";
      txt.textContent = opt.text;

      btn.append(num, txt);

      btn.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
      });
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.stopTypewriter();
        this.callbacks.onUiClick?.();
        const handler = this.optionChoiceHandler;
        this.activeOptions = [];
        this.optionChoiceHandler = null;
        this.optionsPanelEl.classList.add("is-hidden");
        this.optionsPanelEl.innerHTML = "";
        if (handler) handler(opt.next);
      });

      this.optionsPanelEl.appendChild(btn);
    });

    this.optionsPanelEl.classList.remove("is-hidden");
  }

  private resolvePortraitMood(speaker: EntityId, text: string): "default" | "cold" | "warm" {
    if (speaker === "ODELIA") {
      const upper = text.toUpperCase();
      if (upper.includes("APENAS NÃO INSISTA") || upper.includes("APENAS NAO INSISTA")) {
        return "cold";
      }
      const capsWords = text.match(/\b[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]{3,}\b/g);
      if (capsWords && capsWords.length >= 2) {
        return "cold";
      }
    }
    return "default";
  }

  private renderPortraitInto(container: HTMLElement, speaker: EntityId, text: string): void {
    const visual = ENTITY_VISUALS[speaker] ?? ENTITY_VISUALS.SFX;
    const mood = this.resolvePortraitMood(speaker, text);
    const url = this.portraits?.getPortraitUrl(speaker, mood) ?? null;

    container.innerHTML = "";
    container.style.backgroundColor = mood === "cold" ? "#1b242c" : visual.bg;

    if (url) {
      const img = document.createElement("img");
      img.className = "eomm-portrait-img";
      img.src = url;
      img.alt = this.stateManager.getSpeakerName(speaker);
      img.width = 64;
      img.height = 64;
      img.draggable = false;
      container.appendChild(img);
    } else {
      const mono = document.createElement("span");
      mono.className = "eomm-portrait-mono";
      mono.style.color = mood === "cold" ? "#c2d6e6" : visual.accent;
      mono.textContent = visual.monogram;
      container.appendChild(mono);
    }
  }

  private triggerSfxVisualPulse(): void {
    if (this.sfxPulseTimer !== null) {
      window.clearTimeout(this.sfxPulseTimer);
      this.sfxPulseTimer = null;
    }
    this.dialogueBoxEl.classList.remove("is-sfx-pulse");
    // Force reflow to restart animation cleanly
    void this.dialogueBoxEl.offsetWidth;
    this.dialogueBoxEl.classList.add("is-sfx-pulse");
    this.sfxPulseTimer = window.setTimeout(() => {
      this.dialogueBoxEl.classList.remove("is-sfx-pulse");
      this.sfxPulseTimer = null;
    }, 300);
  }

  private finishCutscene(onComplete: () => void): void {
    this.stopTypewriter();
    this.cutsceneActive = false;
    this.cutsceneAdvanceHandler = null;
    this.activePortraitRef = null;
    this.cutsceneEl.classList.add("is-hidden");
    this.cutsceneEl.innerHTML = "";
    onComplete();
  }

  // =========================================================
  // TYPEWRITER CONTROLLER
  // =========================================================

  private startTypewriter(
    targetEl: HTMLElement,
    fullText: string,
    speaker: EntityId,
    onDone?: () => void
  ): void {
    this.stopTypewriter();

    if (fullText.length === 0) {
      targetEl.textContent = "";
      if (onDone) onDone();
      return;
    }

    this.typewriterTargetEl = targetEl;
    this.typewriterFullText = fullText;
    this.typewriterCharIdx = 0;
    this.typewriterNonSpaceCount = 0;
    this.typewriterSpeaker = speaker;
    this.typewriterOnDone = onDone ?? null;
    this.isTyping = true;
    targetEl.textContent = "";

    this.typewriterTimer = window.setInterval(() => {
      this.typewriterCharIdx += 1;
      const ch = this.typewriterFullText.charAt(this.typewriterCharIdx - 1);

      if (this.typewriterTargetEl) {
        this.typewriterTargetEl.textContent = this.typewriterFullText.slice(
          0,
          this.typewriterCharIdx
        );
      }

      if (ch && !/\s/.test(ch)) {
        this.typewriterNonSpaceCount += 1;
        if (
          this.typewriterNonSpaceCount % BLIP_EVERY_N_CHARS === 1 &&
          this.typewriterSpeaker
        ) {
          this.callbacks.onTypewriterBlip?.(this.typewriterSpeaker);
        }
      }

      if (this.typewriterCharIdx >= this.typewriterFullText.length) {
        this.completeTypewriter();
      }
    }, TYPEWRITER_INTERVAL_MS);
  }

  private completeTypewriter(): void {
    if (!this.isTyping) return;

    if (this.typewriterTimer !== null) {
      window.clearInterval(this.typewriterTimer);
      this.typewriterTimer = null;
    }

    if (this.typewriterTargetEl) {
      this.typewriterTargetEl.textContent = this.typewriterFullText;
    }

    const done = this.typewriterOnDone;
    this.isTyping = false;
    this.typewriterTargetEl = null;
    this.typewriterFullText = "";
    this.typewriterCharIdx = 0;
    this.typewriterNonSpaceCount = 0;
    this.typewriterSpeaker = null;
    this.typewriterOnDone = null;

    if (done) done();
  }

  private stopTypewriter(): void {
    if (this.typewriterTimer !== null) {
      window.clearInterval(this.typewriterTimer);
      this.typewriterTimer = null;
    }
    this.isTyping = false;
    this.typewriterTargetEl = null;
    this.typewriterFullText = "";
    this.typewriterCharIdx = 0;
    this.typewriterNonSpaceCount = 0;
    this.typewriterSpeaker = null;
    this.typewriterOnDone = null;
  }
}
