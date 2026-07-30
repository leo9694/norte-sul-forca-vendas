import sharp from "sharp";
import { fileURLToPath } from "node:url";

const original = fileURLToPath(new URL("../assets/brand-logo-original.png", import.meta.url));
const originalOg = fileURLToPath(new URL("../assets/og-original.png", import.meta.url));
const publicFile = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));
const lightBackground = { r: 244, g: 247, b: 245, alpha: 1 };

async function logoBuffer(size) {
  return sharp(original)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize({ width: size, height: size, fit: "inside" })
    .png()
    .toBuffer();
}

async function appIcon(name, size, logoScale) {
  const logoSize = Math.round(size * logoScale);
  const logo = await sharp(original)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize({ width: logoSize, height: logoSize, fit: "inside" })
    .png()
    .toBuffer({ resolveWithObject: true });
  await sharp({
    create: { width: size, height: size, channels: 4, background: lightBackground },
  })
    .composite([{
      input: logo.data,
      left: Math.round((size - logo.info.width) / 2),
      top: Math.round((size - logo.info.height) / 2),
    }])
    .png()
    .toFile(publicFile(name));
}

await sharp(await logoBuffer(1024)).toFile(publicFile("brand-logo.png"));
await appIcon("brand-app-icon-192.png", 192, 0.84);
await appIcon("brand-app-icon-512.png", 512, 0.84);
await appIcon("brand-app-icon-maskable-512.png", 512, 0.7);
await appIcon("brand-apple-touch-icon.png", 180, 0.82);
await appIcon("favicon-48.png", 48, 0.88);

const badgeSize = 96;
const badgeSource = await sharp(original)
  .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .resize({ width: 78, height: 78, fit: "inside" })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
for (let offset = 0; offset < badgeSource.data.length; offset += 4) {
  badgeSource.data[offset] = 255;
  badgeSource.data[offset + 1] = 255;
  badgeSource.data[offset + 2] = 255;
}
const badgeLogo = await sharp(badgeSource.data, {
  raw: {
    width: badgeSource.info.width,
    height: badgeSource.info.height,
    channels: 4,
  },
}).png().toBuffer();
await sharp({
  create: {
    width: badgeSize,
    height: badgeSize,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([{
    input: badgeLogo,
    left: Math.round((badgeSize - badgeSource.info.width) / 2),
    top: Math.round((badgeSize - badgeSource.info.height) / 2),
  }])
  .png()
  .toFile(publicFile("notification-badge-96.png"));

const ogLogo = await sharp(original)
  .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .resize({ width: 116, height: 116, fit: "inside" })
  .png()
  .toBuffer();
const ogBackgroundPixels = Buffer.alloc(142 * 142 * 4);
for (let y = 0; y < 142; y += 1) {
  for (let x = 0; x < 142; x += 1) {
    const offset = (y * 142 + x) * 4;
    const inside = Math.hypot(x - 70.5, y - 70.5) <= 69;
    ogBackgroundPixels[offset] = 244;
    ogBackgroundPixels[offset + 1] = 247;
    ogBackgroundPixels[offset + 2] = 245;
    ogBackgroundPixels[offset + 3] = inside ? 245 : 0;
  }
}
const ogBackground = await sharp(ogBackgroundPixels, {
  raw: { width: 142, height: 142, channels: 4 },
}).png().toBuffer();
await sharp(originalOg)
  .composite([
    { input: ogBackground, left: 1295, top: 109 },
    { input: ogLogo, left: 1308, top: 122 },
  ])
  .png()
  .toFile(publicFile("og.png"));

console.log("Identidade visual atualizada.");
