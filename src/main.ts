import Phaser from "phaser";
import "./style.css";
import { audioEngine } from "./audio/AudioEngine";
import { BootScene } from "./scenes/BootScene";
import { GameScene } from "./scenes/GameScene";

// Disable native right-click menu across the viewport (Hob's Barrow right-click Examine)
window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

// Unlock Web Audio API on the very first user gesture anywhere in the window/overlay/canvas
const unlockAudioOnGesture = (): void => {
  audioEngine.unlock();
};
window.addEventListener("pointerdown", unlockAudioOnGesture, { capture: true, passive: true });
window.addEventListener("keydown", unlockAudioOnGesture, { capture: true, passive: true });

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game-root",
  width: 320,
  height: 180,
  backgroundColor: "#090807",
  pixelArt: true,
  antialias: false,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 320,
    height: 180,
  },
  scene: [BootScene, GameScene],
};

new Phaser.Game(config);
