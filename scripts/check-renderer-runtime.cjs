const assert = require("node:assert/strict");
const { app, BrowserWindow } = require("electron");

// Run in the shipped Electron engine: a Node typecheck cannot detect missing CSS support.
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false });
  try {
    await window.loadURL("data:text/html,<html><body></body></html>");
    const support = await window.webContents.executeJavaScript(`({
      round: CSS.supports("padding", "round(nearest, 2px, 1px)"),
      mod: CSS.supports("line-height", "mod(1, 1)"),
      linear: CSS.supports("animation-timing-function", "linear(0, 1)"),
      registerProperty: typeof CSS.registerProperty === "function"
    })`);
    for (const [feature, supported] of Object.entries(support)) {
      assert.equal(supported, true, `NumberFlow requires CSS ${feature} support`);
    }
    console.log(`NumberFlow CSS support passed in Electron ${process.versions.electron}`);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
